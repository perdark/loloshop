'use strict';
// Raw K40 punches → staff_attendance_records. Runs against the LAPTOP-LOCAL dev PG.
// Self-cleaning, house pattern (see test/attendanceBreaks.test.js / optionGroupAudience.test.js).
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { query, tx } = require('../lib/db');
const { zonedToUtc } = require('../lib/iclockProtocol');
const device = require('../lib/attendanceDevice');

// ingestPunches runs each punch inside a SAVEPOINT so one bad row can't poison the whole
// batch's Postgres transaction — that only makes sense inside a transaction the CALLER owns
// (backend/lib/attendanceDevice.js's own header comment spells this out). Task 5's Express
// route will wrap it in `tx()`; these tests do the same instead of passing a bare `{ query }`.
async function ingest(punches, rejects = []) {
  return tx((client) => device.ingestPunches(client, DEVICE_SN, punches, rejects));
}

const TAG = `ZZTEST-adev-${crypto.randomUUID().slice(0, 8)}`;
const DEVICE_SN = `${TAG}-SN`;
const fx = { users: [], pins: [], holidays: [] };

function freshPhone() {
  return '077' + String(crypto.randomInt(0, 1e8)).padStart(8, '0');
}

/**
 * A staff member with a deterministic per-user attendance override.
 * `override: false` skips the staff_attendance_user_settings row entirely, so the user
 * inherits the SHOP-WIDE weekday schedule (staff_schedule_days) instead — required for any
 * test that needs الجمعة's real midnight-crossing shift, since shiftForDate documents that a
 * personal override replaces the shop's hours on every day of the week, Friday included.
 */
async function mkStaff({ start = '09:00', end = '22:00', grace = 0, rate = 100, required = true, override = true } = {}) {
  const { rows } = await query(
    `INSERT INTO users (name, phone, password_hash, role)
     VALUES ($1, $2, 'x', 'staff') RETURNING id`,
    [`${TAG}-staff`, freshPhone()]
  );
  const userId = rows[0].id;
  fx.users.push(userId);
  if (override) {
    await query(
      `INSERT INTO staff_attendance_user_settings
         (user_id, start_time, end_time, grace_minutes, deduction_per_minute, attendance_required)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, start, end, grace, rate, required]
    );
  }
  return userId;
}

async function mkPin(userId) {
  const pin = await device.allocatePin({ query });
  await query(
    `INSERT INTO staff_device_pins (user_id, pin, push_state) VALUES ($1, $2, 'confirmed')`,
    [userId, pin]
  );
  fx.pins.push(pin);
  return pin;
}

/** Build a Punch the way parseAttlog would, from a Baghdad-local 'YYYY-MM-DD HH:MM:SS'. */
function mkPunch(pin, localStr, { status = 0, verify = 1 } = {}) {
  return {
    device_pin: String(pin),
    device_ts: localStr,
    punched_at: zonedToUtc(localStr, 'Asia/Baghdad'),
    raw_status: status,
    raw_verify: verify,
    raw_line: `${pin}\t${localStr}\t${status}\t${verify}`,
  };
}

/** The next Friday (weekday 5) at least `daysOut` days from now, as 'YYYY-MM-DD'. */
function nextFriday(daysOut = 21) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysOut);
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

test.after(async () => {
  await query(`DELETE FROM punch_raw WHERE device_sn = $1`, [DEVICE_SN]);
  await query(`DELETE FROM staff_attendance_records WHERE user_id = ANY($1::uuid[])`, [fx.users]);
  await query(`DELETE FROM staff_device_pins WHERE pin = ANY($1::int[])`, [fx.pins]);
  await query(`DELETE FROM staff_attendance_user_settings WHERE user_id = ANY($1::uuid[])`, [fx.users]);
  await query(`DELETE FROM staff_holidays WHERE work_date = ANY($1::date[])`, [fx.holidays]);
  await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [fx.users]);
  const left = await query(`SELECT count(*)::int n FROM users WHERE name LIKE $1`, [`${TAG}%`]);
  assert.equal(left.rows[0].n, 0, 'fixture rows left behind');
});

test('1. a punch creates the day\'s record with lateness from the PUNCH time, not now()', async () => {
  const userId = await mkStaff({ start: '09:00', grace: 0, rate: 100 });
  const pin = await mkPin(userId);

  // "3 hours ago" relative to a fixed instant, expressed as the device's own local clock.
  const now = new Date();
  const punchedAt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(punchedAt).reduce((a, p) => { a[p.type] = p.value; return a; }, {});
  const localStr = `${local.year}-${local.month}-${local.day} ${local.hour}:${local.minute}:${local.second}`;
  // Expected lateness is whatever "3 hours before test-run time" actually is on the clock,
  // vs the 09:00 start — NOT a fixed 180, which only holds if the suite happens to run at
  // noon Baghdad time. This is exactly why lateness must come from the punch, not now().
  const expectedLate = Math.max(0, Number(local.hour) * 60 + Number(local.minute) - 9 * 60);

  const punch = mkPunch(pin, localStr);
  const result = await ingest([punch]);
  assert.equal(result.stored, 1);
  assert.equal(result.duplicate, 0);

  const { rows } = await query(
    `SELECT * FROM staff_attendance_records WHERE user_id = $1`, [userId]
  );
  assert.equal(rows.length, 1);
  const rec = rows[0];
  assert.equal(new Date(rec.check_in_at).getTime(), punch.punched_at.getTime());
  // Lateness must come from the 3-hours-ago punch time, never from "now".
  assert.ok(Math.abs(rec.late_minutes - expectedLate) <= 1,
    `expected ~${expectedLate} late minutes (punch time vs 09:00), got ${rec.late_minutes}`);
});

test('2. re-ingesting the identical batch stores 0 and duplicates N', async () => {
  const userId = await mkStaff();
  const pin = await mkPin(userId);
  const punches = [mkPunch(pin, '2027-01-11 09:04:00'), mkPunch(pin, '2027-01-11 12:00:00')];

  const first = await ingest(punches);
  assert.equal(first.stored, 2);
  assert.equal(first.duplicate, 0);

  const second = await ingest(punches);
  assert.equal(second.stored, 0);
  assert.equal(second.duplicate, 2);
});

test('3. two punches in one shift produce one record, check_out_at = the later punch', async () => {
  const userId = await mkStaff();
  const pin = await mkPin(userId);
  const p1 = mkPunch(pin, '2027-01-12 09:04:00');
  const p2 = mkPunch(pin, '2027-01-12 18:10:00');

  await ingest([p1, p2]);

  const { rows } = await query(`SELECT * FROM staff_attendance_records WHERE user_id = $1`, [userId]);
  assert.equal(rows.length, 1);
  assert.equal(new Date(rows[0].check_in_at).getTime(), p1.punched_at.getTime());
  assert.equal(new Date(rows[0].check_out_at).getTime(), p2.punched_at.getTime());
});

test('4. a third punch BETWEEN check-in and check-out changes nothing', async () => {
  const userId = await mkStaff();
  const pin = await mkPin(userId);
  const p1 = mkPunch(pin, '2027-01-13 09:04:00');
  const p2 = mkPunch(pin, '2027-01-13 18:10:00');
  const p3 = mkPunch(pin, '2027-01-13 13:00:00');

  await ingest([p1, p2]);
  const before = (await query(`SELECT * FROM staff_attendance_records WHERE user_id = $1`, [userId])).rows[0];

  const result = await ingest([p3]);
  assert.equal(result.stored, 1);

  const after = (await query(`SELECT * FROM staff_attendance_records WHERE user_id = $1`, [userId])).rows[0];
  assert.equal(new Date(after.check_in_at).getTime(), new Date(before.check_in_at).getTime());
  assert.equal(new Date(after.check_out_at).getTime(), new Date(before.check_out_at).getTime());
  assert.equal(after.late_minutes, before.late_minutes);

  const raw = (await query(
    `SELECT ignored_reason, attendance_id FROM punch_raw WHERE device_sn = $1 AND device_ts = $2`,
    [DEVICE_SN, p3.device_ts]
  )).rows[0];
  assert.ok(raw.ignored_reason, 'the in-between punch should carry an ignored_reason');
  assert.equal(raw.attendance_id, before.id);
});

test('5. a punch earlier than check_in_at moves check-in back and recomputes late_minutes downward', async () => {
  const userId = await mkStaff({ start: '09:00', grace: 0, rate: 100 });
  const pin = await mkPin(userId);
  const late = mkPunch(pin, '2027-01-14 10:00:00'); // 60 min late
  const earlier = mkPunch(pin, '2027-01-14 09:10:00'); // 10 min late

  await ingest([late]);
  const before = (await query(`SELECT * FROM staff_attendance_records WHERE user_id = $1`, [userId])).rows[0];
  assert.ok(Math.abs(before.late_minutes - 60) <= 1);

  await ingest([earlier]);
  const after = (await query(`SELECT * FROM staff_attendance_records WHERE user_id = $1`, [userId])).rows[0];
  assert.equal(new Date(after.check_in_at).getTime(), earlier.punched_at.getTime());
  assert.ok(Math.abs(after.late_minutes - 10) <= 1, `expected ~10 late minutes, got ${after.late_minutes}`);
  // The old (later) check-in becomes the checkout, since it is later than the current one (none yet).
  assert.equal(new Date(after.check_out_at).getTime(), late.punched_at.getTime());
});

// ⚠️ The plan draft's scenario 6 (as written) asserts the OPPOSITE of the codebase's own
// documented, deliberate design and is factually wrong — verified against a real
// resolveStamp() call before writing this test, not assumed. HANDOFF.md's own landmine says
// it explicitly: "الجمعة ends at EXACTLY 00:00, so it has no after-midnight window, and that
// is correct — a 00:10 stamp is a new السبت shift." Mechanically: resolveStamp only files a
// stamp under the PREVIOUS day when `local.minutes < timeToMinutes(prev.end_time)`, and for a
// shift ending at exactly 00:00 that bound is 0 — no non-negative minute value can ever be
// less than 0, so the "belongs to previous day" branch is structurally unreachable for a
// midnight-ending shift. Do NOT "fix" lib/staffSchedule.js to make a 00:10 stamp roll back to
// الجمعة — that would contradict migration 093's own accepted behaviour and its landmine.
test('6a. a punch on الجمعة\'s own calendar date files under that date (no rollover needed)', async () => {
  // No personal override: this user must inherit the SHOP's Friday row (15:00 → 00:00) so the
  // real shop schedule — not a synthetic one — is what is under test.
  const userId = await mkStaff({ override: false });
  const pin = await mkPin(userId);
  const friday = nextFriday();
  const punch = mkPunch(pin, `${friday} 23:40:00`);
  await ingest([punch]);

  const { rows } = await query(
    `SELECT to_char(work_date, 'YYYY-MM-DD') AS d FROM staff_attendance_records WHERE user_id = $1`,
    [userId]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].d, friday);
});

test('6b. a stamp just after midnight on الجمعة\'s OWN calendar date is a new Saturday shift', async () => {
  const userId = await mkStaff({ override: false });
  const pin = await mkPin(userId);
  const friday = nextFriday();
  const saturdayCalendarDate = new Date(`${friday}T00:00:00Z`);
  saturdayCalendarDate.setUTCDate(saturdayCalendarDate.getUTCDate() + 1);
  const saturdayStr = saturdayCalendarDate.toISOString().slice(0, 10);
  const rollover = mkPunch(pin, `${saturdayStr} 00:10:00`);
  await ingest([rollover]);

  const { rows } = await query(
    `SELECT to_char(work_date, 'YYYY-MM-DD') AS d FROM staff_attendance_records WHERE user_id = $1`,
    [userId]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].d, saturdayStr, 'الجمعة ending at exactly 00:00 has no after-midnight window');
});

// The rollover mechanism DOES exist and DOES work — it just cannot be demonstrated against the
// real shop Friday (which ends at exactly 00:00, see 6a/6b above). A shift that genuinely
// extends past midnight (a per-user override, isolated from other tests/agents sharing this
// DB) exercises the actual belongs_to_previous_day branch in lib/staffSchedule.js.
test('6c. a shift that genuinely crosses midnight (22:00→02:00) rolls a post-midnight punch back to the previous day', async () => {
  const userId = await mkStaff({ start: '22:00', end: '02:00', grace: 0, rate: 100 });
  const pin = await mkPin(userId);
  const day1 = '2027-02-04'; // arbitrary Thursday-ish date, isolated by TAG-scoped fixtures
  const day2Date = new Date(`${day1}T00:00:00Z`);
  day2Date.setUTCDate(day2Date.getUTCDate() + 1);
  const day2 = day2Date.toISOString().slice(0, 10);

  const checkIn = mkPunch(pin, `${day1} 22:10:00`);
  const postMidnight = mkPunch(pin, `${day2} 01:00:00`); // before the 02:00 end — still "tonight"
  await ingest([checkIn]);
  await ingest([postMidnight]);

  const { rows } = await query(
    `SELECT to_char(work_date, 'YYYY-MM-DD') AS d, check_in_at, check_out_at
       FROM staff_attendance_records WHERE user_id = $1`,
    [userId]
  );
  assert.equal(rows.length, 1, 'both punches belong to the SAME overnight shift');
  assert.equal(rows[0].d, day1, 'a genuinely midnight-crossing shift files under the day it STARTED');
  assert.equal(new Date(rows[0].check_out_at).getTime(), postMidnight.punched_at.getTime());
});

test('7. a punch on a date in staff_holidays records late_minutes = 0', async () => {
  const userId = await mkStaff({ start: '09:00', grace: 0, rate: 100 });
  const pin = await mkPin(userId);
  const holidayDate = '2027-03-15';
  fx.holidays.push(holidayDate);
  await query(
    `INSERT INTO staff_holidays (work_date, label_ar) VALUES ($1, $2)`,
    [holidayDate, `${TAG}-عيد`]
  );

  const punch = mkPunch(pin, `${holidayDate} 14:00:00`); // hours after 09:00, would normally be late
  await ingest([punch]);

  const { rows } = await query(`SELECT * FROM staff_attendance_records WHERE user_id = $1`, [userId]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].late_minutes, 0);
});

test('8. a punch from an unmapped PIN stores user_id NULL and creates no record', async () => {
  const orphanPin = 60000 + Math.floor(Math.random() * 5000);
  const punch = mkPunch(orphanPin, '2027-01-16 09:04:00');

  const result = await ingest([punch]);
  assert.equal(result.stored, 1);

  const raw = (await query(
    `SELECT user_id, attendance_id FROM punch_raw WHERE device_sn = $1 AND device_pin = $2`,
    [DEVICE_SN, String(orphanPin)]
  )).rows[0];
  assert.equal(raw.user_id, null);
  assert.equal(raw.attendance_id, null);

  const recs = await query(
    `SELECT count(*)::int n FROM staff_attendance_records sar
      JOIN punch_raw pr ON pr.attendance_id = sar.id
     WHERE pr.device_sn = $2 AND pr.device_pin = $1`,
    [String(orphanPin), DEVICE_SN]
  );
  assert.equal(recs.rows[0].n, 0);
});

test('9. a record with status=overridden is left completely untouched by a later punch', async () => {
  const userId = await mkStaff();
  const pin = await mkPin(userId);
  const p1 = mkPunch(pin, '2027-01-17 09:04:00');
  await ingest([p1]);

  await query(
    `UPDATE staff_attendance_records SET status = 'overridden', check_out_at = NULL, admin_note_ar = $2
      WHERE user_id = $1`,
    [userId, `${TAG}-admin ruled on this day`]
  );
  const before = (await query(`SELECT * FROM staff_attendance_records WHERE user_id = $1`, [userId])).rows[0];

  const p2 = mkPunch(pin, '2027-01-17 20:00:00');
  await ingest([p2]);

  const after = (await query(`SELECT * FROM staff_attendance_records WHERE user_id = $1`, [userId])).rows[0];
  assert.deepEqual(after, before, 'an overridden row must never be written to by a device punch');
});

test('10. allocatePin returns the lowest free number, skipping taken ones', async () => {
  const a = await mkStaff();
  const b = await mkStaff();
  const c = await mkStaff();
  const pinA = await mkPin(a); // e.g. 1
  const pinB = await mkPin(b); // e.g. 2
  await query(`DELETE FROM staff_device_pins WHERE pin = $1`, [pinB]);
  fx.pins = fx.pins.filter((p) => p !== pinB);

  const next = await device.allocatePin({ query });
  assert.equal(next, pinB, 'the freed pin must be reused before a brand-new higher number');

  const pinC = await mkPin(c);
  assert.equal(pinC, pinB);
  assert.notEqual(pinC, pinA);
});
