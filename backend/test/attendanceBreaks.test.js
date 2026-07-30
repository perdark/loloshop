'use strict';
// الخروج المؤقت — monthly allowance + deduction rules (migration 075).
// Runs against the LAPTOP-LOCAL dev PG (:5433). Self-cleaning. Never point at prod.
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { query } = require('../lib/db');
const breaks = require('../lib/attendanceBreak');
const bc = require('../controllers/attendanceBreakController');
const attendance = require('../controllers/attendanceController');

const TAG = `brk-${crypto.randomBytes(4).toString('hex')}`;
const RATE = 1000; // IQD per deducted minute
const START = new Date();
const createdUsers = [];

function freshPhone() {
  return '077' + String(crypto.randomInt(0, 1e8)).padStart(8, '0');
}

/** Minimal res double: records status + body the way the controllers set them. */
function mkRes() {
  return {
    code: 200,
    body: null,
    status(c) {
      this.code = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}

function mkReq(user, { body = {}, params = {}, q = {} } = {}) {
  return { user, body, params, query: q, ip: '127.0.0.1', headers: {}, socket: {} };
}

/**
 * A staff member with an explicit per-user attendance override, so the test does
 * not depend on whatever the shop settings happen to be.
 */
async function mkStaff({ allowance = 600, rate = RATE, required = true } = {}) {
  const { rows } = await query(
    `INSERT INTO users (name, phone, password_hash, role)
     VALUES ($1, $2, 'x', 'staff') RETURNING id, name, role`,
    [`${TAG}-staff`, freshPhone()]
  );
  const user = rows[0];
  createdUsers.push(user.id);
  await query(
    `INSERT INTO staff_attendance_user_settings
       (user_id, start_time, end_time, grace_minutes, deduction_per_minute,
        attendance_required, break_monthly_minutes)
     VALUES ($1, '09:00', '18:00', 15, $2, $3, $4)`,
    [user.id, rate, required, allowance]
  );
  return user;
}

/** An open بصمة دخول for today — the precondition for any break. */
async function mkCheckin(userId) {
  const { rows } = await query(
    `INSERT INTO staff_attendance_records
       (user_id, work_date, check_in_at, expected_start_time, expected_end_time)
     VALUES ($1, CURRENT_DATE, NOW() - INTERVAL '3 hours', '09:00', '18:00')
     RETURNING id`,
    [userId]
  );
  return rows[0].id;
}

/** Pretend the worker left N minutes ago, so the return computes a known duration. */
async function backdateLeave(breakId, minutes) {
  await query(
    `UPDATE staff_attendance_breaks
        SET left_at = NOW() - ($2 || ' minutes')::interval
      WHERE id = $1`,
    [breakId, String(minutes)]
  );
}

/** Full cycle: request → (optional approve) → leave → return, `minutes` long. */
async function takeBreak(user, { minutes, approved, withoutApproval = false }) {
  const req = mkReq(user, { body: {} });
  const res = mkRes();
  await bc.requestBreak(req, res);
  assert.strictEqual(res.code, 201, JSON.stringify(res.body));
  const id = res.body.data.break.id;

  if (approved) {
    const admin = await adminUser();
    const ares = mkRes();
    await bc.approveBreak(mkReq(admin, { params: { id } }), ares);
    assert.strictEqual(ares.code, 200, JSON.stringify(ares.body));
  }

  const lres = mkRes();
  await bc.leaveBreak(
    mkReq(user, { params: { id }, body: { without_approval: withoutApproval } }),
    lres
  );
  assert.strictEqual(lres.code, 200, JSON.stringify(lres.body));

  await backdateLeave(id, minutes);

  const rres = mkRes();
  await bc.returnBreak(mkReq(user, { params: { id } }), rres);
  assert.strictEqual(rres.code, 200, JSON.stringify(rres.body));
  return { id, payload: rres.body.data };
}

let _admin = null;
async function adminUser() {
  if (_admin) return _admin;
  const { rows } = await query(`SELECT id, name, role FROM users WHERE role = 'admin' LIMIT 1`);
  assert.ok(rows.length, 'dev DB has no admin user to act as approver');
  _admin = rows[0];
  return _admin;
}

async function breakRow(id) {
  const { rows } = await query(`SELECT * FROM staff_attendance_breaks WHERE id = $1`, [id]);
  return rows[0];
}

async function liveDeduction(userId) {
  const { rows } = await query(
    `SELECT id, amount, source_type FROM staff_salary_transactions
      WHERE user_id = $1 AND deleted_at IS NULL AND type = 'deduction'`,
    [userId]
  );
  return rows;
}

test.after(async () => {
  if (createdUsers.length) {
    await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [createdUsers]);
  }
  // notifications for admins do not cascade with the test staff row
  await query(`DELETE FROM notifications WHERE type = 'attendance_break' AND created_at >= $1`, [
    START,
  ]);
  const { rows } = await query(
    `SELECT COUNT(*)::int n FROM staff_attendance_breaks b
       JOIN users u ON u.id = b.user_id WHERE u.name LIKE $1`,
    [`${TAG}%`]
  );
  assert.strictEqual(rows[0].n, 0, 'test breaks leaked');
});

// ─── the rule, as pure math ──────────────────────────────────────────────────

test('computeCharge: approved and inside the allowance is free', () => {
  const c = breaks.computeCharge({ minutes: 30, approved: true, remainingBefore: 600, perMinute: RATE });
  assert.deepStrictEqual(c, { freeMinutes: 30, deductedMinutes: 0, amount: 0 });
});

test('computeCharge: approved but crossing the allowance charges only the excess', () => {
  const c = breaks.computeCharge({ minutes: 30, approved: true, remainingBefore: 10, perMinute: RATE });
  assert.deepStrictEqual(c, { freeMinutes: 10, deductedMinutes: 20, amount: 20 * RATE });
});

test('computeCharge: unapproved charges every minute even with allowance left', () => {
  const c = breaks.computeCharge({ minutes: 30, approved: false, remainingBefore: 600, perMinute: RATE });
  assert.deepStrictEqual(c, { freeMinutes: 0, deductedMinutes: 30, amount: 30 * RATE });
});

test('monthKeyFor buckets by the shop timezone', () => {
  // 2026-07-31 22:30 UTC is already 2026-08-01 in Baghdad (UTC+3)
  assert.strictEqual(breaks.monthKeyFor(new Date('2026-07-31T22:30:00Z')), '2026-08');
  assert.strictEqual(breaks.monthKeyFor(new Date('2026-07-31T18:30:00Z')), '2026-07');
});

test('elapsedMinutes never returns 0 for a real break', () => {
  const from = new Date('2026-07-30T10:00:00Z');
  assert.strictEqual(breaks.elapsedMinutes(from, new Date('2026-07-30T10:00:20Z')), 1);
  assert.strictEqual(breaks.elapsedMinutes(from, new Date('2026-07-30T10:23:00Z')), 23);
  assert.strictEqual(breaks.elapsedMinutes(from, null), 0);
});

// ─── the flow, end to end on the DB ──────────────────────────────────────────

test('approved break inside the allowance costs nothing', async () => {
  const user = await mkStaff({ allowance: 600 });
  await mkCheckin(user.id);
  const { id, payload } = await takeBreak(user, { minutes: 23, approved: true });

  const row = await breakRow(id);
  assert.strictEqual(row.state, 'returned');
  assert.strictEqual(row.minutes, 23);
  assert.strictEqual(row.free_minutes, 23);
  assert.strictEqual(row.deducted_minutes, 0);
  assert.strictEqual(Number(row.deduction_amount), 0);
  assert.strictEqual(row.deduction_transaction_id, null);
  assert.deepStrictEqual(await liveDeduction(user.id), []);
  assert.strictEqual(payload.break_balance.used_minutes, 23);
  assert.strictEqual(payload.break_balance.remaining_minutes, 577);
});

test('leaving without approval deducts every minute and writes a salary transaction', async () => {
  const user = await mkStaff({ allowance: 600 });
  await mkCheckin(user.id);
  const { id } = await takeBreak(user, { minutes: 30, approved: false, withoutApproval: true });

  const row = await breakRow(id);
  assert.strictEqual(row.left_without_approval, true);
  assert.strictEqual(row.free_minutes, 0);
  assert.strictEqual(row.deducted_minutes, 30);
  assert.strictEqual(Number(row.deduction_amount), 30 * RATE);

  const txns = await liveDeduction(user.id);
  assert.strictEqual(txns.length, 1);
  assert.strictEqual(Number(txns[0].amount), 30 * RATE);
  assert.strictEqual(txns[0].source_type, 'attendance_break');
  assert.strictEqual(txns[0].id, row.deduction_transaction_id);
});

test('approving after the fact cancels the deduction', async () => {
  const user = await mkStaff({ allowance: 600 });
  await mkCheckin(user.id);
  const { id } = await takeBreak(user, { minutes: 30, approved: false, withoutApproval: true });
  assert.strictEqual((await liveDeduction(user.id)).length, 1);

  const admin = await adminUser();
  const res = mkRes();
  await bc.approveBreak(mkReq(admin, { params: { id }, body: { note_ar: 'ماشي' } }), res);
  assert.strictEqual(res.code, 200, JSON.stringify(res.body));

  const row = await breakRow(id);
  assert.strictEqual(row.approval, 'approved');
  assert.strictEqual(row.free_minutes, 30);
  assert.strictEqual(row.deducted_minutes, 0);
  assert.strictEqual(row.deduction_transaction_id, null);
  assert.deepStrictEqual(await liveDeduction(user.id), [], 'the deduction must be gone');
  // the cancelled transaction is soft-deleted, not erased
  const { rows } = await query(
    `SELECT delete_reason_ar FROM staff_salary_transactions
      WHERE user_id = $1 AND deleted_at IS NOT NULL`,
    [user.id]
  );
  assert.strictEqual(rows.length, 1);
  assert.ok(rows[0].delete_reason_ar);
});

test('rejecting a returned break keeps the deduction', async () => {
  const user = await mkStaff({ allowance: 600 });
  await mkCheckin(user.id);
  const { id } = await takeBreak(user, { minutes: 20, approved: true });
  assert.deepStrictEqual(await liveDeduction(user.id), []);

  const admin = await adminUser();
  await bc.rejectBreak(mkReq(admin, { params: { id } }), mkRes());

  const row = await breakRow(id);
  assert.strictEqual(row.deducted_minutes, 20);
  assert.strictEqual(Number(row.deduction_amount), 20 * RATE);
  assert.strictEqual((await liveDeduction(user.id)).length, 1);
});

test('the allowance is spent in chronological order — only the excess is charged', async () => {
  const user = await mkStaff({ allowance: 30 });
  await mkCheckin(user.id);
  const first = await takeBreak(user, { minutes: 20, approved: true });
  const second = await takeBreak(user, { minutes: 20, approved: true });

  const a = await breakRow(first.id);
  const b = await breakRow(second.id);
  assert.strictEqual(a.free_minutes, 20, 'first break fits entirely');
  assert.strictEqual(a.deducted_minutes, 0);
  assert.strictEqual(b.free_minutes, 10, 'second break only had 10 minutes of allowance left');
  assert.strictEqual(b.deducted_minutes, 10);
  assert.strictEqual(Number(b.deduction_amount), 10 * RATE);
  assert.strictEqual(second.payload.break_balance.used_minutes, 40);
  assert.strictEqual(second.payload.break_balance.remaining_minutes, 0);
});

test('unapproved minutes still consume the allowance', async () => {
  const user = await mkStaff({ allowance: 60 });
  await mkCheckin(user.id);
  await takeBreak(user, { minutes: 40, approved: false, withoutApproval: true });
  const second = await takeBreak(user, { minutes: 30, approved: true });

  const b = await breakRow(second.id);
  assert.strictEqual(b.free_minutes, 20, '40 unapproved minutes left only 20 of the 60');
  assert.strictEqual(b.deducted_minutes, 10);
});

test('raising the allowance re-prices the month and forgives the deduction', async () => {
  const user = await mkStaff({ allowance: 10 });
  await mkCheckin(user.id);
  const { id } = await takeBreak(user, { minutes: 30, approved: true });
  assert.strictEqual((await breakRow(id)).deducted_minutes, 20);

  const admin = await adminUser();
  const res = mkRes();
  await attendance.setUserSettings(
    mkReq(admin, {
      params: { userId: user.id },
      body: {
        start_time: '09:00',
        end_time: '18:00',
        grace_minutes: 15,
        deduction_per_minute: RATE,
        attendance_required: true,
        break_monthly_minutes: 600,
      },
    }),
    res
  );
  assert.strictEqual(res.code, 200, JSON.stringify(res.body));

  const row = await breakRow(id);
  assert.strictEqual(row.deducted_minutes, 0, 'the extra allowance must forgive the charge');
  assert.deepStrictEqual(await liveDeduction(user.id), []);
});

test('the frozen rate survives a later rate change', async () => {
  const user = await mkStaff({ allowance: 0, rate: RATE });
  await mkCheckin(user.id);
  const { id } = await takeBreak(user, { minutes: 10, approved: true });
  assert.strictEqual(Number((await breakRow(id)).deduction_amount), 10 * RATE);

  await query(
    `UPDATE staff_attendance_user_settings SET deduction_per_minute = 5000 WHERE user_id = $1`,
    [user.id]
  );
  const admin = await adminUser();
  await bc.rejectBreak(mkReq(admin, { params: { id } }), mkRes()); // forces a recompute

  const row = await breakRow(id);
  assert.strictEqual(Number(row.deduction_per_minute), RATE);
  assert.strictEqual(Number(row.deduction_amount), 10 * RATE, 'past charges must not be rewritten');
});

test('a break in another month does not spend this month allowance', async () => {
  const user = await mkStaff({ allowance: 60 });
  await mkCheckin(user.id);
  const { id } = await takeBreak(user, { minutes: 50, approved: true });
  await query(`UPDATE staff_attendance_breaks SET month_key = '2020-01' WHERE id = $1`, [id]);

  const settings = await attendance.loadEffectiveSettings(user.id);
  const balance = await breaks.loadBalance(
    { query },
    user.id,
    breaks.monthKeyFor(new Date()),
    breaks.effectiveAllowance(settings)
  );
  assert.strictEqual(balance.used_minutes, 0);
  assert.strictEqual(balance.remaining_minutes, 60);
});

// ─── guards ──────────────────────────────────────────────────────────────────

test('a break needs an open بصمة دخول', async () => {
  const user = await mkStaff();
  const res = mkRes();
  await bc.requestBreak(mkReq(user), res).catch((e) => {
    res.code = e.status;
    res.body = { code: e.code };
  });
  assert.strictEqual(res.code, 409);
  assert.strictEqual(res.body.code, 'ERR_NO_OPEN_ATTENDANCE');
});

test('only one open break at a time', async () => {
  const user = await mkStaff();
  await mkCheckin(user.id);
  const first = mkRes();
  await bc.requestBreak(mkReq(user), first);
  assert.strictEqual(first.code, 201);

  const second = mkRes();
  await bc.requestBreak(mkReq(user), second).catch((e) => {
    second.code = e.status;
    second.body = { code: e.code };
  });
  assert.strictEqual(second.code, 409);
  assert.strictEqual(second.body.code, 'ERR_OPEN_BREAK');
});

test('the database itself rejects a second open break', async () => {
  // The JS pre-check above can be raced; uq_attendance_break_open is the real guard.
  const user = await mkStaff();
  const attendanceId = await mkCheckin(user.id);
  const insert = () =>
    query(
      `INSERT INTO staff_attendance_breaks (user_id, attendance_id, work_date, month_key, state)
       VALUES ($1, $2, CURRENT_DATE, $3, 'out')`,
      [user.id, attendanceId, breaks.monthKeyFor(new Date())]
    );
  await insert();
  await assert.rejects(insert, (err) => err.code === '23505');
});

test('leaving before approval is refused unless it is explicit', async () => {
  const user = await mkStaff();
  await mkCheckin(user.id);
  const req = mkRes();
  await bc.requestBreak(mkReq(user), req);
  const id = req.body.data.break.id;

  const blocked = mkRes();
  await bc.leaveBreak(mkReq(user, { params: { id } }), blocked).catch((e) => {
    blocked.code = e.status;
    blocked.body = { code: e.code };
  });
  assert.strictEqual(blocked.code, 409);
  assert.strictEqual(blocked.body.code, 'ERR_BREAK_PENDING');

  const allowed = mkRes();
  await bc.leaveBreak(mkReq(user, { params: { id }, body: { without_approval: true } }), allowed);
  assert.strictEqual(allowed.code, 200);
  assert.strictEqual(allowed.body.data.break.state, 'out');
  assert.strictEqual(allowed.body.data.break.left_without_approval, true);
});

test('staff exempt from بصمة get no breaks', async () => {
  const user = await mkStaff({ required: false });
  const res = mkRes();
  await bc.requestBreak(mkReq(user), res).catch((e) => {
    res.code = e.status;
    res.body = { code: e.code };
  });
  assert.strictEqual(res.code, 400);
  assert.strictEqual(res.body.code, 'ERR_ATTENDANCE_NOT_REQUIRED');
});

test('a worker cannot act on someone else break', async () => {
  const owner = await mkStaff();
  const other = await mkStaff();
  await mkCheckin(owner.id);
  const res = mkRes();
  await bc.requestBreak(mkReq(owner), res);
  const id = res.body.data.break.id;

  const stolen = mkRes();
  await bc
    .leaveBreak(mkReq(other, { params: { id }, body: { without_approval: true } }), stolen)
    .catch((e) => {
      stolen.code = e.status;
      stolen.body = { code: e.code };
    });
  assert.strictEqual(stolen.code, 404);
});

// ─── integration with بصمة الخروج ────────────────────────────────────────────

test('بصمة الخروج closes a break the worker forgot to end', async () => {
  const user = await mkStaff({ allowance: 600 });
  await mkCheckin(user.id);
  const res = mkRes();
  await bc.requestBreak(mkReq(user), res);
  const id = res.body.data.break.id;
  await bc.leaveBreak(mkReq(user, { params: { id }, body: { without_approval: true } }), mkRes());
  await backdateLeave(id, 45);

  const out = mkRes();
  await attendance.checkOut(mkReq(user), out);
  assert.strictEqual(out.code, 200, JSON.stringify(out.body));
  assert.strictEqual(out.body.data.auto_closed_break_id, id);

  const row = await breakRow(id);
  assert.strictEqual(row.state, 'returned');
  assert.strictEqual(row.auto_closed, true);
  assert.strictEqual(row.minutes, 45);
  assert.strictEqual(out.body.data.break, null, 'no break is left open after stamping out');
});

test('worked_minutes excludes time spent outside the shop', async () => {
  const user = await mkStaff({ allowance: 600 });
  await mkCheckin(user.id); // checked in 3 hours ago
  await takeBreak(user, { minutes: 30, approved: true });

  const res = mkRes();
  await attendance.getToday(mkReq(user), res);
  const record = res.body.data.record;
  assert.strictEqual(record.break_minutes, 30);
  assert.strictEqual(
    record.worked_minutes,
    record.present_minutes - 30,
    'break time must not be paid as worked time'
  );
});

test('an unacted request is dropped when the shift ends', async () => {
  const user = await mkStaff();
  await mkCheckin(user.id);
  const res = mkRes();
  await bc.requestBreak(mkReq(user), res);
  const id = res.body.data.break.id;

  await attendance.checkOut(mkReq(user), mkRes());
  assert.strictEqual((await breakRow(id)).state, 'cancelled');
});

// ─── admin views ─────────────────────────────────────────────────────────────

test('the admin balance list reports the allowance and what is left', async () => {
  const user = await mkStaff({ allowance: 120 });
  await mkCheckin(user.id);
  await takeBreak(user, { minutes: 25, approved: true });

  const admin = await adminUser();
  const res = mkRes();
  await bc.listBalances(mkReq(admin), res);
  const mine = res.body.data.staff.find((s) => s.user_id === user.id);
  assert.ok(mine, 'the staff member must appear in the balances list');
  assert.strictEqual(mine.monthly_minutes, 120);
  assert.strictEqual(mine.used_minutes, 25);
  assert.strictEqual(mine.remaining_minutes, 95);
});

test('pending requests sort to the top of the admin list', async () => {
  const user = await mkStaff();
  await mkCheckin(user.id);
  await takeBreak(user, { minutes: 5, approved: true });
  const pending = mkRes();
  await bc.requestBreak(mkReq(user), pending);
  const pendingId = pending.body.data.break.id;

  const admin = await adminUser();
  const res = mkRes();
  await bc.listBreaks(mkReq(admin, { q: { user_id: user.id } }), res);
  assert.strictEqual(res.body.data[0].id, pendingId);
  assert.strictEqual(res.body.data.length, 2);
});

test('the admin can correct a forgotten return', async () => {
  const user = await mkStaff({ allowance: 0 });
  await mkCheckin(user.id);
  const res = mkRes();
  await bc.requestBreak(mkReq(user), res);
  const id = res.body.data.break.id;
  await bc.leaveBreak(mkReq(user, { params: { id }, body: { without_approval: true } }), mkRes());
  await backdateLeave(id, 300); // "forgot to tap back for 5 hours"

  const admin = await adminUser();
  const fix = mkRes();
  await bc.correctBreak(
    mkReq(admin, { params: { id }, body: { minutes: 20, admin_note_ar: 'رجع بعد 20 دقيقة' } }),
    fix
  );
  assert.strictEqual(fix.code, 200, JSON.stringify(fix.body));

  const row = await breakRow(id);
  assert.strictEqual(row.minutes, 20);
  assert.strictEqual(row.deducted_minutes, 20);
  assert.strictEqual(Number(row.deduction_amount), 20 * RATE);
  const txns = await liveDeduction(user.id);
  assert.strictEqual(txns.length, 1, 'the 300-minute charge must be replaced, not doubled');
  assert.strictEqual(Number(txns[0].amount), 20 * RATE);
});
