'use strict';
// GET /payroll/me/summary — «راتبي ونشاطي», the whole month in one call.
//
// Owner request 2026-08-27: «الأيام يلي أنجز بيها والساعات وعدد الفتحات وتقصيره والخصومات
// وليش والحوافز وليش وكلشي».
//
// ⚠️ THE INVARIANT THIS FILE EXISTS TO PIN: lateness and salary are two ledgers and the
// payload must never merge them. `staff_attendance_records.deduction_amount` is displayed and
// reported but NEVER posted to `staff_salary_transactions` — nothing writes that row, and
// `deduction_transaction_id` is only ever cleared. If a future change folds `late_amount_shown`
// into `salary.balance`, the staff page starts showing a debt the shop has not charged.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { getMySummary } = require('../controllers/salaryController');
const { query } = require('../lib/db');

const TAG = `ZZTEST-payroll-${crypto.randomUUID().slice(0, 8)}`;
const fx = { users: [] };
const ctx = {};

// A fixed month in the past, so the run never depends on today's date.
const MONTH = '2026-04';
const WORKED = '2026-04-01'; // Wednesday
const LATE_DAY = '2026-04-02';
const FRIDAY = '2026-04-03';

function mockRes() {
  const res = {
    statusCode: 200, body: null,
    status(c) { res.statusCode = c; return res; },
    json(b) { res.body = b; return res; },
  };
  return res;
}

const newPhone = () => `079${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

async function record({ date, inAt, outAt, expStart, late, deduction }) {
  const { rows } = await query(
    `INSERT INTO staff_attendance_records
       (user_id, work_date, check_in_at, check_out_at, expected_start_time, expected_end_time,
        grace_minutes, late_minutes, deduction_amount, status)
     VALUES ($1,$2::date,$3,$4,$5::time,'22:00',15,$6,$7,$8) RETURNING id`,
    [ctx.userId, date, inAt, outAt, expStart, late, deduction, late > 0 ? 'late' : 'present']
  );
  return rows[0].id;
}

test.before(async () => {
  const u = await query(
    `INSERT INTO users (name, phone, password_hash, role) VALUES ($1,$2,'x','staff') RETURNING id`,
    [`${TAG} موظف`, newPhone()]
  );
  ctx.userId = u.rows[0].id;
  fx.users.push(ctx.userId);

  await query(
    `INSERT INTO staff_salaries (user_id, base_salary) VALUES ($1, 500000)
     ON CONFLICT (user_id) DO UPDATE SET base_salary = 500000`,
    [ctx.userId]
  );
  // A REAL salary deduction, with a reason — the kind that does move the balance.
  await query(
    `INSERT INTO staff_salary_transactions (user_id, type, amount, reason_ar, source_type)
     VALUES ($1, 'deduction', 25000, $2, 'manual')`,
    [ctx.userId, `${TAG} كسر قطعة`]
  );

  // 09:00 → 17:00 = 8 hours, on time.
  await record({
    date: WORKED, inAt: `${WORKED}T06:00:00Z`, outAt: `${WORKED}T14:00:00Z`,
    expStart: '09:00', late: 0, deduction: 0,
  });
  // Late by 40 minutes, showing 40,000 — displayed, never charged.
  const lateId = await record({
    date: LATE_DAY, inAt: `${LATE_DAY}T06:55:00Z`, outAt: `${LATE_DAY}T14:00:00Z`,
    expStart: '09:00', late: 40, deduction: 40000,
  });
  ctx.lateId = lateId;

  // A returned break on the late day: 30 minutes, 10 of them charged.
  await query(
    `INSERT INTO staff_attendance_breaks
       (user_id, attendance_id, work_date, month_key, reason_ar, left_at, returned_at,
        minutes, state, approval, free_minutes, deducted_minutes, deduction_per_minute,
        deduction_amount)
     VALUES ($1,$2,$3::date,$4,$5,$6,$7,30,'returned','approved',20,10,1000,10000)`,
    [ctx.userId, lateId, LATE_DAY, MONTH, `${TAG} مشوار`,
     `${LATE_DAY}T09:00:00Z`, `${LATE_DAY}T09:30:00Z`]
  );

  await query(
    `INSERT INTO staff_holidays (work_date, label_ar) VALUES ($1::date, $2)
     ON CONFLICT (work_date) DO UPDATE SET label_ar = EXCLUDED.label_ar`,
    ['2026-04-10', `${TAG} عيد`]
  );
});

test.after(async () => {
  await query(`DELETE FROM staff_attendance_breaks WHERE user_id = ANY($1::uuid[])`, [fx.users]);
  await query(`DELETE FROM staff_attendance_records WHERE user_id = ANY($1::uuid[])`, [fx.users]);
  await query(`DELETE FROM staff_salary_transactions WHERE user_id = ANY($1::uuid[])`, [fx.users]);
  await query(`DELETE FROM staff_salaries WHERE user_id = ANY($1::uuid[])`, [fx.users]);
  await query(`DELETE FROM staff_holidays WHERE label_ar LIKE $1`, [`${TAG}%`]);
  await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [fx.users]);
  const left = await query(`SELECT count(*)::int n FROM users WHERE name LIKE $1`, [`${TAG}%`]);
  assert.strictEqual(left.rows[0].n, 0, 'fixture rows left behind');
});

async function summary(month = MONTH) {
  const res = mockRes();
  await getMySummary({ user: { id: ctx.userId }, query: { month } }, res);
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  return res.body.data;
}

test('the month is every calendar day, not only the days someone showed up', async () => {
  const d = await summary();
  assert.strictEqual(d.month, MONTH);
  assert.strictEqual(d.days.length, 30, 'April has 30 days — «وين غبت» needs the whole calendar');
  assert.strictEqual(d.schedule.length, 7);
});

test('hours exclude break time — a 8h day with a 30-minute break is 7h30', async () => {
  const d = await summary();
  const worked = d.days.find((x) => x.date === WORKED);
  assert.strictEqual(worked.worked_minutes, 480, 'no break that day');
  const late = d.days.find((x) => x.date === LATE_DAY);
  // 06:55Z → 14:00Z is 425 minutes at the shop; 30 of them were spent outside it.
  assert.strictEqual(late.break_minutes, 30);
  assert.strictEqual(late.worked_minutes, 395, 'break time is not worked time');
  assert.strictEqual(d.totals.worked_minutes, 480 + 395);
});

test('THE INVARIANT: lateness is shown, and is NOT in the salary balance', async () => {
  const d = await summary();
  const late = d.days.find((x) => x.date === LATE_DAY);
  assert.strictEqual(late.late_minutes, 40);
  assert.strictEqual(late.late_amount_shown, 40000, 'displayed…');
  assert.strictEqual(d.totals.late_amount_shown, 40000);

  // …and nowhere near the money. 500,000 − 25,000 manual deduction, and not a dinar of the
  // 40,000 lateness. If this ever fails, the page has started inventing a debt.
  assert.strictEqual(d.salary.base_salary, 500000);
  assert.strictEqual(d.salary.balance, 475000);
  const reasons = d.salary.transactions.map((t) => t.reason_ar);
  assert.ok(reasons.some((r) => r && r.includes('كسر قطعة')), 'every deduction carries its reason');
  assert.ok(
    !d.salary.transactions.some((t) => Number(t.amount) === 40000),
    'the lateness amount must not appear as a salary transaction'
  );
});

test('breaks report count, minutes, free vs deducted, and the remaining allowance', async () => {
  const d = await summary();
  assert.strictEqual(d.breaks.break_count, 1);
  assert.strictEqual(d.breaks.used_minutes, 30);
  assert.strictEqual(d.breaks.deducted_minutes, 10);
  assert.strictEqual(d.breaks.deduction_amount, 10000);
  assert.strictEqual(d.breaks.remaining_minutes, d.breaks.allowance_minutes - 30);
  assert.strictEqual(d.breaks.rows.length, 1);
  assert.ok(d.breaks.rows[0].reason_ar.includes('مشوار'), 'a break carries its reason too');
});

test('a holiday is marked, counts as no lateness, and is never an absence', async () => {
  const d = await summary();
  const eid = d.days.find((x) => x.date === '2026-04-10');
  assert.ok(eid.holiday_ar && eid.holiday_ar.includes('عيد'));
  assert.strictEqual(eid.absent, false, 'nobody is absent on a holiday');
  assert.strictEqual(d.totals.holiday_days, 1);
});

test('الجمعة carries the Friday schedule, not the shop-wide default', async () => {
  const d = await summary();
  const fri = d.days.find((x) => x.date === FRIDAY);
  assert.strictEqual(fri.weekday_label_ar, 'الجمعة');
  assert.strictEqual(fri.expected_start_time, '15:00', 'the whole point of migration 093');
});

test('a past open day with no stamp is غياب; a future one is not', async () => {
  const d = await summary();
  // April 2026 is in the past relative to any run of this suite after it.
  const openNoStamp = d.days.find((x) => !x.check_in_at && !x.is_off && !x.holiday_ar);
  assert.strictEqual(openNoStamp.absent, true);
  // The next month has not happened yet, so nothing in it may be called an absence.
  const future = await summary('2099-01');
  assert.ok(future.days.every((x) => x.absent === false), 'the future is not an absence');
});

test('a bad ?month= falls back to the current shop month instead of 500ing', async () => {
  const res = mockRes();
  await getMySummary({ user: { id: ctx.userId }, query: { month: 'not-a-month' } }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.match(res.body.data.month, /^\d{4}-\d{2}$/);
});
