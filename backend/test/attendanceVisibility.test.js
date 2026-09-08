'use strict';
// ⚠️ MUST be the first statement in the file — before `pg` (and any Date) exists.
//
// Both bugs pinned here are invisible on a UTC box, and CI runs on UTC. The admin calendar's
// off-by-one only appears when the SERVER's zone is east of UTC, because that is when `pg`
// hands a `date` column back as a JS Date whose UTC calendar day is the day BEFORE. Prod runs
// Europe/Berlin, so this file pins that zone rather than trusting whatever the runner has.
process.env.TZ = 'Europe/Berlin';

// «البصمة ما تشتغل / ما تظهر» — the two defects behind the 2026-09-08 report.
// Runs against the LAPTOP-LOCAL dev PG. Self-cleaning, house pattern.
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { query, tx } = require('../lib/db');
const device = require('../lib/attendanceDevice');
const attendance = require('../controllers/attendanceController');
const { deliverPunchNotices } = require('../lib/attendanceNotices');

const TAG = `ZZTEST-avis-${crypto.randomUUID().slice(0, 8)}`;
const DEVICE_SN = `${TAG}-SN`;
const fx = { users: [], pins: [] };
// insertAdmins writes to EVERY admin, including the dev DB's real ones — so the sweep below
// is by type + start time, not by fixture id.
const STARTED_AT = new Date();

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(c) { res.statusCode = c; return res; },
    json(b) { res.body = b; return res; },
  };
  return res;
}

function freshPhone() {
  return '077' + String(crypto.randomInt(0, 1e8)).padStart(8, '0');
}

async function makeUser(name, role = 'staff') {
  const { rows } = await query(
    `INSERT INTO users (name, phone, password_hash, role)
     VALUES ($1, $2, 'x', $3) RETURNING id`,
    [`${TAG} ${name}`, freshPhone(), role]
  );
  fx.users.push(rows[0].id);
  return rows[0].id;
}

async function mapPin(userId, pin) {
  await query(
    `INSERT INTO staff_device_pins (user_id, pin, pushed_name, push_state)
     VALUES ($1, $2, 'x', 'confirmed')`,
    [userId, pin]
  );
  fx.pins.push(pin);
  return pin;
}

/** A free device PIN, so a parallel run or leftover row cannot collide. */
async function freePin() {
  const { rows } = await query(`SELECT pin FROM staff_device_pins`);
  const taken = new Set(rows.map((r) => Number(r.pin)));
  let pin = 900;
  while (taken.has(pin)) pin += 1;
  return pin;
}

/**
 * Apply stored punches at the instants they carry, then deliver the notices the batch
 * produced — the same two-step routes/iclock.js performs, and for the same reason: a
 * notification INSERT inside the punch transaction could abort the whole batch.
 */
async function replay(punches) {
  const notices = await tx(async (client) => {
    const collected = [];
    for (const p of punches) {
      const { rows } = await client.query(
        `INSERT INTO punch_raw (device_sn, device_pin, device_ts, punched_at, raw_status)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (device_sn, device_pin, device_ts, raw_status) DO NOTHING
         RETURNING id`,
        [DEVICE_SN, p.device_pin, p.device_ts, p.punched_at, p.raw_status]
      );
      if (rows.length) await device.applyPunch(client, { ...p, id: rows[0].id }, collected);
    }
    return collected;
  });
  await deliverPunchNotices(notices);
  return notices;
}

async function noticesFor(userId) {
  const { rows } = await query(
    `SELECT type, title_ar, body_ar FROM notifications WHERE user_id = $1 ORDER BY created_at`,
    [userId]
  );
  return rows;
}

/**
 * The ADMIN copy for one worker, found by the name inside it rather than by creating a
 * fixture admin. `insertAdmins` writes to EVERY role='admin' row, so a throwaway admin here
 * would receive every other test's device notice too — and the dev DB is shared with the
 * rest of the suite running in parallel. DISTINCT because there is one ROW per admin: the
 * question here is "was the admin told, and what does it say", not how many admins exist.
 */
async function adminNoticesAbout(name) {
  const { rows } = await query(
    `SELECT DISTINCT title_ar, body_ar FROM notifications
      WHERE type = 'attendance_device' AND created_at >= $1 AND body_ar LIKE $2`,
    [STARTED_AT, `%${TAG} ${name}%`]
  );
  return rows;
}

test.after(async () => {
  await query(`DELETE FROM punch_raw WHERE device_sn = $1`, [DEVICE_SN]);
  await query(
    `DELETE FROM notifications WHERE type = 'attendance_device' AND created_at >= $1`,
    [STARTED_AT]
  );
  if (fx.pins.length) {
    await query(`DELETE FROM staff_device_pins WHERE pin = ANY($1::int[])`, [fx.pins]);
  }
  if (fx.users.length) {
    // notifications / breaks / records all cascade from users
    await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [fx.users]);
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// 1. «الوقت غلط» — the admin calendar must file a day under ITS OWN date.
//
// `pg` returns `work_date` as a JS Date at the SERVER's local midnight. On prod
// (Europe/Berlin) 2026-09-08 arrives as 2026-09-08T00:00+02:00, whose `toISOString()` reads
// 2026-09-07 — so every day's totals landed in the previous cell on /admin/attendance and
// today's square said «لا توجد بصمات». Same trap lib/attendanceBreak.js's `dateOnly` header
// documents; the grouping key must come from Postgres, not from the driver's Date.
// ─────────────────────────────────────────────────────────────────────────────────────────
test('the admin calendar groups a day under its own work_date, not the day before', async () => {
  const userId = await makeUser('cal');
  const workDate = '2026-03-11';
  await query(
    `INSERT INTO staff_attendance_records
       (user_id, work_date, check_in_at, expected_start_time, expected_end_time,
        grace_minutes, late_minutes, deduction_amount, verification_mode, status)
     VALUES ($1, $2, $3, '10:00', '22:00', 15, 0, 0, 'device', 'present')`,
    [userId, workDate, `${workDate}T07:05:00Z`]
  );

  const res = mockRes();
  await attendance.calendar(
    { query: { from: '2026-03-01', to: '2026-03-31', user_id: userId } },
    res
  );

  const days = res.body.data.days;
  assert.equal(days.length, 1, 'one day has a record');
  assert.equal(days[0].date, workDate);
  assert.equal(days[0].totals.present_count, 1);
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// 2. «ضغطت رجعت وما انسجل» — a discarded break key must reach a human.
//
// routes/iclock.js answers the K40 `OK` on every line, so the device beeps accepted whatever
// the server decides. Before this, applyPunch wrote the reason into punch_raw.ignored_reason
// and NOTHING read that column: not listRejects (punch_reject only), not listUnmapped
// (unknown PINs only), not the worker's phone. Measured on prod 2026-09-06..08: 5 of 14
// mapped break presses were thrown away in silence, and مضر's next move 19 seconds later was
// to open a phone break request instead — the worker discovering it by accident.
// ─────────────────────────────────────────────────────────────────────────────────────────
test('pressing → رجعت with no open break notifies the worker and the admin', async () => {
  const userId = await makeUser('noopen');
  const pin = await mapPin(userId, await freePin());

  await replay([
    // دخول, so there is a day to attach a break edge to
    { device_pin: pin, device_ts: '2026-03-12 10:05:00', punched_at: '2026-03-12T07:05:00Z', raw_status: 0 },
    // → «رجعت» (status 5) with nothing open
    { device_pin: pin, device_ts: '2026-03-12 14:20:00', punched_at: '2026-03-12T11:20:00Z', raw_status: 5 },
  ]);

  const mine = await noticesFor(userId);
  assert.equal(mine.length, 1, 'the worker is told their press did nothing');
  assert.match(mine[0].body_ar, /خروج مؤقت/);

  const boss = await adminNoticesAbout('noopen');
  assert.equal(boss.length, 1, 'the admin sees it too — this is the «ما تشتغل» report');
  assert.match(boss[0].body_ar, /ما عنده خروج مؤقت مفتوح/);
});

test('pressing ← أطلع twice notifies the worker instead of silently doing nothing', async () => {
  const userId = await makeUser('twice');
  const pin = await mapPin(userId, await freePin());

  await replay([
    { device_pin: pin, device_ts: '2026-03-13 10:05:00', punched_at: '2026-03-13T07:05:00Z', raw_status: 0 },
    { device_pin: pin, device_ts: '2026-03-13 14:00:00', punched_at: '2026-03-13T11:00:00Z', raw_status: 4 },
    { device_pin: pin, device_ts: '2026-03-13 14:30:00', punched_at: '2026-03-13T11:30:00Z', raw_status: 4 },
  ]);

  const mine = await noticesFor(userId);
  assert.equal(mine.length, 1, 'only the SECOND ← (status 4) is a notice; the first opened the break');
  assert.match(mine[0].body_ar, /أصلاً/);
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// 3. «ما تظهر عندي» — a break opened at the DEVICE told the admin nothing.
//
// The phone flow calls notifyAdmins on every request; the device flow (openDeviceBreak) sent
// nothing at all, so from the admin's chair a worker walking out was invisible until they
// opened the breaks table and looked.
// ─────────────────────────────────────────────────────────────────────────────────────────
test('a break opened at the device notifies the admin', async () => {
  const userId = await makeUser('walker');
  const pin = await mapPin(userId, await freePin());

  await replay([
    { device_pin: pin, device_ts: '2026-03-14 10:05:00', punched_at: '2026-03-14T07:05:00Z', raw_status: 0 },
    { device_pin: pin, device_ts: '2026-03-14 14:00:00', punched_at: '2026-03-14T11:00:00Z', raw_status: 4 },
  ]);

  const boss = await adminNoticesAbout('walker');
  assert.equal(boss.length, 1);
  assert.match(boss[0].title_ar, /خروج مؤقت/);
  assert.equal((await noticesFor(userId)).length, 0, 'the worker knows — they pressed it');
});
