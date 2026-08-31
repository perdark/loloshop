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

/**
 * Derive punches AT THE TIMES THEY CARRY, bypassing ingestPunches' server-clock stamp.
 *
 * ⚠️ Why this helper exists, 2026-08-30: `ingestPunches` now stamps `punched_at` with the
 * moment the batch ARRIVED, not the device's reading (owner decision — the K40's wall clock
 * was wrong on site; see the function's header). That makes it useless for testing the SHIFT
 * MATH, which is about a punch landing at 09:04 or 23:40 or five past midnight — every one of
 * those tests would otherwise be asserting against "now".
 *
 * So the two concerns are tested apart: test 1 pins the ingest contract (the stamp is the
 * arrival), and everything below pins `applyPunch`'s resolution against a chosen instant.
 * This mirrors the real replay path — `assignUnmapped` also applies STORED punches rather
 * than freshly-arrived ones — so it is not a synthetic shortcut.
 */
async function replay(punches) {
  return tx(async (client) => {
    const actions = [];
    for (const p of punches) {
      const { rows } = await client.query(
        `INSERT INTO punch_raw
           (device_sn, device_pin, device_ts, punched_at, raw_status, raw_verify, raw_line)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (device_sn, device_pin, device_ts, raw_status) DO NOTHING
         RETURNING id`,
        [DEVICE_SN, p.device_pin, p.device_ts, p.punched_at, p.raw_status, p.raw_verify, p.raw_line]
      );
      if (rows.length) actions.push(await device.applyPunch(client, { ...p, id: rows[0].id }));
    }
    return { stored: actions.length, actions };
  });
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

/**
 * ⚠️ THIS TEST WAS INVERTED ON 2026-08-30 AND THAT IS THE POINT OF IT.
 *
 * It used to be «lateness from the PUNCH time, not now()», and it drove the whole ingest
 * design: a batch buffered through an internet outage replayed at the times the fingers
 * actually touched the sensor. The owner overruled that after the K40's own clock was found
 * wrong on site — a wrong clock silently mis-marks every تأخير, and there is no way for
 * anyone to notice from the screen. Baghdad time now comes from OUR server.
 *
 * The cost is stated plainly in `ingestPunches`' header and is not hypothetical: punches that
 * arrive in one batch after an outage all get that batch's arrival time. If this test is ever
 * flipped back, flip the header comment and the HANDOFF landmine with it — do not leave the
 * code claiming one rule and the suite asserting the other.
 */
test('1. the stamp is the ARRIVAL time, not the device\'s clock — and lateness follows it', async () => {
  const userId = await mkStaff({ start: '09:00', grace: 0, rate: 100 });
  const pin = await mkPin(userId);

  // A device whose clock is three hours slow. Under the old rule this punch would have been
  // filed three hours ago; under the new one the device's opinion changes nothing.
  const nowLocal = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date()).reduce((a, p) => { a[p.type] = p.value; return a; }, {});
  const wrongClock = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const wrongLocal = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(wrongClock).reduce((a, p) => { a[p.type] = p.value; return a; }, {});
  const localStr = `${wrongLocal.year}-${wrongLocal.month}-${wrongLocal.day} ${wrongLocal.hour}:${wrongLocal.minute}:${wrongLocal.second}`;

  // Lateness is measured from NOW against the 09:00 start — the device's three-hour error
  // must not appear in it.
  const expectedLate = Math.max(0, Number(nowLocal.hour) * 60 + Number(nowLocal.minute) - 9 * 60);

  const before = Date.now();
  const punch = mkPunch(pin, localStr);
  const result = await ingest([punch]);
  const after = Date.now();
  assert.equal(result.stored, 1);
  assert.equal(result.duplicate, 0);

  const { rows } = await query(
    `SELECT * FROM staff_attendance_records WHERE user_id = $1`, [userId]
  );
  assert.equal(rows.length, 1);
  const rec = rows[0];
  const stamped = new Date(rec.check_in_at).getTime();
  assert.ok(stamped >= before && stamped <= after,
    `check_in_at must be the arrival instant, got ${rec.check_in_at}`);
  assert.notEqual(stamped, punch.punched_at.getTime(), 'the device clock must not have been used');
  assert.ok(Math.abs(rec.late_minutes - expectedLate) <= 1,
    `expected ~${expectedLate} late minutes (arrival vs 09:00), got ${rec.late_minutes}`);

  // The device's own reading survives as evidence — it is what an admin overriding a record
  // after an outage has to work from, and it is still the dedupe key.
  // `device_ts` is a timestamp column, not text, so it comes back as a Date — read it back
  // formatted in Baghdad, which is the zone it was written in.
  const { rows: raw } = await query(
    `SELECT to_char(device_ts AT TIME ZONE 'Asia/Baghdad', 'YYYY-MM-DD HH24:MI:SS') AS ts
       FROM punch_raw WHERE device_sn = $1 AND device_pin = $2`,
    [DEVICE_SN, String(pin)]
  );
  assert.equal(raw.length, 1);
  assert.equal(raw[0].ts, localStr);
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

// ⚠️ The second punch is at 22:00, the shift's own end, NOT mid-afternoon as it was until
// 2026-08-30. Under the sequence rule a punch while the shop is still open opens a خروج مؤقت;
// only one at or after the end time closes the day. Moving this time is the behaviour change,
// not a test convenience — test «S» below asserts the mid-shift half.
test('3. two punches in one shift produce one record, check_out_at = the later punch', async () => {
  const userId = await mkStaff();
  const pin = await mkPin(userId);
  const p1 = mkPunch(pin, '2027-01-12 09:04:00');
  const p2 = mkPunch(pin, '2027-01-12 22:00:00');

  await replay([p1, p2]);

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

  await replay([p1, p2]);
  const before = (await query(`SELECT * FROM staff_attendance_records WHERE user_id = $1`, [userId])).rows[0];

  const result = await replay([p3]);
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

  await replay([late]);
  const before = (await query(`SELECT * FROM staff_attendance_records WHERE user_id = $1`, [userId])).rows[0];
  assert.ok(Math.abs(before.late_minutes - 60) <= 1);

  await replay([earlier]);
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
  await replay([punch]);

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
  await replay([rollover]);

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
  await replay([checkIn]);
  await replay([postMidnight]);

  const { rows } = await query(
    `SELECT to_char(work_date, 'YYYY-MM-DD') AS d, check_in_at, check_out_at
       FROM staff_attendance_records WHERE user_id = $1`,
    [userId]
  );
  assert.equal(rows.length, 1, 'both punches belong to the SAME overnight shift');
  assert.equal(rows[0].d, day1, 'a genuinely midnight-crossing shift files under the day it STARTED');

  // ⚠️ The 01:00 punch is INSIDE the shift, so under the sequence rule it is a خروج مؤقت, not
  // the خروج — this assertion changed on 2026-08-30 and the day being still open is correct.
  // Which punch closes a crossing shift is test 6d's problem, and the answer is "none of
  // them": see closeStaleOpenDay.
  assert.equal(rows[0].check_out_at, null);
  const brk = (await query(`SELECT attendance_id FROM staff_attendance_breaks WHERE user_id = $1`, [userId])).rows;
  assert.equal(brk.length, 1);
  assert.equal(brk[0].attendance_id, (await query(
    `SELECT id FROM staff_attendance_records WHERE user_id = $1`, [userId]
  )).rows[0].id, 'the break belongs to the shift that started yesterday');
});

/**
 * ⚠️ THE CASE THE SEQUENCE RULE CANNOT HANDLE ON ITS OWN, and مضر محمد is living it on prod
 * with a 22:16 → 10:15 shift. "A punch at or after the end closes the day" can never fire for
 * a midnight-crossing shift: resolveStamp files a stamp under the previous day only while it
 * is STRICTLY BEFORE that end, so the closing instant is already the next shift's دخول. The
 * next day's first punch is what closes the previous one, at its own scheduled end.
 */
test('6d. on a crossing shift the NEXT day\'s first punch closes the previous day and its open break', async () => {
  const userId = await mkStaff({ start: '22:00', end: '02:00', grace: 0, rate: 100 });
  const pin = await mkPin(userId);

  await replay([mkPunch(pin, '2027-02-11 22:10:00')]); // دخول
  await replay([mkPunch(pin, '2027-02-12 00:30:00')]); // خروج مؤقت, never returned from
  await replay([mkPunch(pin, '2027-02-12 22:05:00')]); // the NEXT night's دخول

  const recs = (await query(
    `SELECT to_char(work_date,'YYYY-MM-DD') d, check_out_at FROM staff_attendance_records
      WHERE user_id = $1 ORDER BY work_date`, [userId]
  )).rows;
  assert.equal(recs.length, 2);
  assert.equal(recs[0].d, '2027-02-11');
  assert.ok(recs[0].check_out_at, 'the stale night must have been closed');
  // Closed at the shift's own end (02:00 the following morning), not at the new punch's time.
  assert.equal(new Date(recs[0].check_out_at).getTime(),
    zonedToUtc('2027-02-12 02:00:00', 'Asia/Baghdad').getTime());
  assert.equal(recs[1].check_out_at, null, 'tonight is still open');

  const brk = (await query(
    `SELECT state, auto_closed, returned_at FROM staff_attendance_breaks WHERE user_id = $1`, [userId]
  )).rows;
  assert.equal(brk.length, 1);
  assert.equal(brk[0].state, 'returned');
  assert.equal(brk[0].auto_closed, true, 'an auto-closed break must be distinguishable from a real عودة');
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
  await replay([punch]);

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

/**
 * THE SEQUENCE RULE — owner decision 2026-08-30.
 *   بصمة ١ دخول · ٢ خروج مؤقت · ٣ عودة · ٤ خروج
 * with the clock, not the count, deciding whether a punch is a break edge or the end of the
 * day: at/after the shift's end_time it closes the day, before it the punches alternate.
 */
test('S1. four punches read as دخول / خروج مؤقت / عودة / خروج, and the break is 32 minutes', async () => {
  const userId = await mkStaff({ start: '10:00', end: '22:00', grace: 0, rate: 100 });
  const pin = await mkPin(userId);

  // The owner's own example: out at 9:30 PM, back at 10:02 PM → 32 minutes.
  await replay([mkPunch(pin, '2027-03-08 10:05:00')]);
  await replay([mkPunch(pin, '2027-03-08 21:30:00')]);
  await replay([mkPunch(pin, '2027-03-08 22:02:00')]);
  await replay([mkPunch(pin, '2027-03-08 22:50:00')]);

  const rec = (await query(
    `SELECT * FROM staff_attendance_records WHERE user_id = $1`, [userId]
  )).rows;
  assert.equal(rec.length, 1);
  assert.equal(new Date(rec[0].check_in_at).getTime(),
    zonedToUtc('2027-03-08 10:05:00', 'Asia/Baghdad').getTime(), 'punch 1 is the دخول');
  assert.equal(new Date(rec[0].check_out_at).getTime(),
    zonedToUtc('2027-03-08 22:50:00', 'Asia/Baghdad').getTime(), 'punch 4 is the خروج');

  const brk = (await query(
    `SELECT * FROM staff_attendance_breaks WHERE user_id = $1`, [userId]
  )).rows;
  assert.equal(brk.length, 1, 'punches 2 and 3 are ONE break, not two');
  assert.equal(brk[0].state, 'returned');
  assert.equal(brk[0].minutes, 32, '21:30 → 22:02 is 32 minutes');
  // ⚠️ Money: an unapproved break is charged for EVERY minute (computeCharge), so a device
  // break must be born approved or the shop silently starts billing every worker.
  assert.equal(brk[0].approval, 'approved');
});

test('S2. a punch while the shop is still open opens a break — it is NOT the خروج', async () => {
  const userId = await mkStaff({ start: '10:00', end: '22:00', grace: 0, rate: 100 });
  const pin = await mkPin(userId);

  await replay([mkPunch(pin, '2027-03-09 10:05:00')]);
  await replay([mkPunch(pin, '2027-03-09 14:00:00')]);

  const rec = (await query(`SELECT * FROM staff_attendance_records WHERE user_id = $1`, [userId])).rows[0];
  assert.equal(rec.check_out_at, null, 'the day must still be open');
  const brk = (await query(`SELECT * FROM staff_attendance_breaks WHERE user_id = $1`, [userId])).rows;
  assert.equal(brk.length, 1);
  assert.equal(brk[0].state, 'out', 'the worker is still out');
});

test('S3. a second trip out the same day is its own break', async () => {
  const userId = await mkStaff({ start: '10:00', end: '22:00', grace: 0, rate: 100 });
  const pin = await mkPin(userId);

  await replay([mkPunch(pin, '2027-03-10 10:05:00')]);
  await replay([mkPunch(pin, '2027-03-10 13:00:00')]); // break 1 out
  await replay([mkPunch(pin, '2027-03-10 13:20:00')]); // break 1 back  → 20 min
  await replay([mkPunch(pin, '2027-03-10 17:00:00')]); // break 2 out
  await replay([mkPunch(pin, '2027-03-10 17:15:00')]); // break 2 back  → 15 min
  await replay([mkPunch(pin, '2027-03-10 22:30:00')]); // خروج

  const brk = (await query(
    `SELECT minutes, state FROM staff_attendance_breaks WHERE user_id = $1 ORDER BY left_at`,
    [userId]
  )).rows;
  assert.equal(brk.length, 2);
  assert.deepEqual(brk.map((b) => b.minutes), [20, 15]);
  assert.ok(brk.every((b) => b.state === 'returned'));

  const rec = (await query(`SELECT * FROM staff_attendance_records WHERE user_id = $1`, [userId])).rows[0];
  assert.equal(new Date(rec.check_out_at).getTime(),
    zonedToUtc('2027-03-10 22:30:00', 'Asia/Baghdad').getTime());
});

/**
 * THE PER-WORKER COOLDOWN — owner decision 2026-08-30. A finger resting on the sensor reads
 * twice, and under the sequence rule a stray second read would open a break nobody took.
 */
test('C1. the same worker punching again within 5 minutes is ignored — the owner\'s 10:15/10:16/10:17 case', async () => {
  const userId = await mkStaff({ start: '10:00', end: '22:00', grace: 0, rate: 100 });
  const pin = await mkPin(userId);

  await replay([mkPunch(pin, '2027-03-11 10:15:00')]);
  await replay([mkPunch(pin, '2027-03-11 10:16:00')]);
  await replay([mkPunch(pin, '2027-03-11 10:17:00')]);

  const rec = (await query(`SELECT * FROM staff_attendance_records WHERE user_id = $1`, [userId])).rows;
  assert.equal(rec.length, 1);
  assert.equal(rec[0].check_out_at, null, 'the repeats must not have become a خروج');
  const brk = (await query(`SELECT * FROM staff_attendance_breaks WHERE user_id = $1`, [userId])).rows;
  assert.equal(brk.length, 0, 'and must not have opened a خروج مؤقت either');

  // ⚠️ The cooldown runs from the last ACCEPTED punch (10:15), never from the last rejected
  // one — otherwise a worker tapping every four minutes locks themselves out all day.
  await replay([mkPunch(pin, '2027-03-11 10:21:00')]);
  const brkAfter = (await query(`SELECT * FROM staff_attendance_breaks WHERE user_id = $1`, [userId])).rows;
  assert.equal(brkAfter.length, 1, '10:21 is >5 min after 10:15 and must count');
});

test('C2. the cooldown is per WORKER — two people a minute apart both count', async () => {
  const a = await mkStaff({ start: '10:00', end: '22:00', grace: 0, rate: 100 });
  const b = await mkStaff({ start: '10:00', end: '22:00', grace: 0, rate: 100 });
  const pinA = await mkPin(a);
  const pinB = await mkPin(b);

  await replay([mkPunch(pinA, '2027-03-12 10:15:00')]);
  await replay([mkPunch(pinB, '2027-03-12 10:16:00')]);

  for (const [userId, who] of [[a, 'A'], [b, 'B']]) {
    const rec = (await query(`SELECT * FROM staff_attendance_records WHERE user_id = $1`, [userId])).rows;
    assert.equal(rec.length, 1, `worker ${who} must have their own دخول`);
  }
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
