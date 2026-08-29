'use strict';
// backend/lib/attendanceDevice.js — raw K40 punches → staff_attendance_records.
//
// This is the ONLY place a device touches attendance. It calls lib/staffSchedule.js for
// every weekday/holiday/midnight decision — never a second copy of that logic — the same
// way attendanceController.checkIn does today.
//
// ⚠️ Unlike grandlayan/027's attendance_day, staff_attendance_records is NOT a cache that may
// be wiped and rebuilt. It carries late_minutes frozen at write time, admin overrides
// (status='overridden'), and staff_attendance_breaks.attendance_id pointing at it. So every
// write here is an UPSERT, never a DELETE, and a row an admin has ruled on is never touched.
//
// Every function here takes `client` as its first argument rather than importing lib/db.js
// itself — `ingestPunches` needs SAVEPOINTs around each punch (see below), which only make
// sense inside a transaction the CALLER owns (the same pattern checkIn's `tx()` wrapper uses).
//
// What is deliberately NOT reused from attendanceController.js: its `loadEffectiveSettings`
// is the full HTTP-facing serialisation (verification mode, break allowance, etc). This file
// only needs the handful of raw columns that feed schedule.resolveStamp()/lateMinutesFor(), so
// it reads them directly here rather than importing a controller — the same "a lib must not
// import a controller" rule that moved localParts into lib/shopTime.js.
const schedule = require('./staffSchedule');
const { localParts, DEFAULT_TZ } = require('./shopTime');

const REASON_UNMAPPED = 'رقم الجهاز غير مرتبط بأي موظف';
const REASON_OVERRIDDEN = 'اليوم بحالة معدَّلة من الإدارة، ما ينلمس';
const REASON_NOT_REQUIRED = 'الموظف معفى من شرط البصمة';
const REASON_BETWEEN = 'بصمة وقعت بين وقتي الدخول والخروج المسجلين';

/**
 * The subset of staff_attendance_settings + a per-user staff_attendance_user_settings override
 * that schedule.resolveStamp()/lateMinutesFor() need. Mirrors
 * attendanceController.loadEffectiveSettings's resolution order (personal override beats the
 * shop-wide row), without pulling in that function's full HTTP-serialisation surface.
 */
async function loadPunchSettings(client, userId) {
  let base = await client.query(`SELECT * FROM staff_attendance_settings WHERE id = TRUE`);
  if (!base.rows.length) {
    // Defensive only — attendanceController.loadSettings lazily creates this row too, and a
    // brand-new database may not have run that path yet.
    base = await client.query(
      `INSERT INTO staff_attendance_settings (id) VALUES (TRUE)
       ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
       RETURNING *`
    );
  }
  const row = base.rows[0];
  const { rows } = await client.query(
    `SELECT start_time, end_time, grace_minutes, deduction_per_minute,
            COALESCE(attendance_required, TRUE) AS attendance_required
       FROM staff_attendance_user_settings
      WHERE user_id = $1`,
    [userId]
  );
  if (!rows.length) {
    return { ...row, is_user_override: false, attendance_required: true };
  }
  const o = rows[0];
  return {
    ...row,
    start_time: o.start_time,
    end_time: o.end_time,
    grace_minutes: o.grace_minutes,
    deduction_per_minute: o.deduction_per_minute,
    attendance_required: o.attendance_required,
    is_user_override: true,
  };
}

async function findUserForPin(client, devicePin) {
  const pin = Number(devicePin);
  if (!Number.isInteger(pin)) return null;
  const { rows } = await client.query(
    `SELECT user_id FROM staff_device_pins WHERE pin = $1`,
    [pin]
  );
  return rows.length ? rows[0].user_id : null;
}

async function markPunch(client, punchId, { userId = null, attendanceId = null, ignoredReason = null } = {}) {
  await client.query(
    `UPDATE punch_raw SET user_id = $2, attendance_id = $3, ignored_reason = $4 WHERE id = $1`,
    [punchId, userId, attendanceId, ignoredReason]
  );
}

/**
 * Apply one stored punch_raw row to staff_attendance_records. `punch` must carry at least
 * `{ id, device_pin, punched_at }` — the shape of a punch_raw row (what ingestPunches passes
 * right after INSERT, and what a re-derivation of previously-stored punches, e.g. the admin
 * "assign this PIN" flow, would pass straight from a SELECT).
 *
 * Returns which of the five things happened — see module header.
 */
async function applyPunch(client, punch) {
  const userId = await findUserForPin(client, punch.device_pin);
  if (!userId) {
    await markPunch(client, punch.id, { ignoredReason: REASON_UNMAPPED });
    return 'unmapped';
  }

  const settings = await loadPunchSettings(client, userId);
  if (settings.attendance_required === false) {
    await markPunch(client, punch.id, { userId, ignoredReason: REASON_NOT_REQUIRED });
    return 'ignored';
  }

  const timeZone = settings.timezone || DEFAULT_TZ;
  const punchedAt = punch.punched_at instanceof Date ? punch.punched_at : new Date(punch.punched_at);
  const local = localParts(punchedAt, timeZone);

  // Both days, same reason checkIn loads them: a stamp just after midnight can belong to
  // YESTERDAY's shift (الجمعة runs 15:00 → 00:00 on most databases, though see the landmine
  // this function's tests pin down — a shift ending at EXACTLY 00:00 has no after-midnight
  // window at all, and that is correct, not a bug).
  const week = await schedule.loadWeek(client);
  const holidays = await schedule.loadHolidays(
    schedule.shiftDate(local.date, -1), local.date, client
  );
  const shift = schedule.resolveStamp(punchedAt, { week, settings, holidays, timeZone });
  // 0 on a holiday or a closed day, always — counts_lateness carries that decision.
  const lateMinutes = schedule.lateMinutesFor(shift, shift.minutes_now, settings.grace_minutes);
  const deduction = lateMinutes * Number(settings.deduction_per_minute || 0);
  const status = lateMinutes > 0 ? 'late' : 'present';

  // Locks the row (if any) for the rest of this punch's handling — safe to hold inside the
  // caller's transaction, released at COMMIT/ROLLBACK like any other row lock.
  const existing = await client.query(
    `SELECT * FROM staff_attendance_records WHERE user_id = $1 AND work_date = $2 FOR UPDATE`,
    [userId, shift.date]
  );

  if (!existing.rows.length) {
    const inserted = await client.query(
      `INSERT INTO staff_attendance_records
         (user_id, work_date, check_in_at, expected_start_time, expected_end_time, grace_minutes,
          late_minutes, deduction_amount, verification_mode, network_ok, location_ok, verified,
          status, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'device',FALSE,FALSE,TRUE,$9,NOW())
       ON CONFLICT (user_id, work_date) DO NOTHING
       RETURNING id`,
      [
        userId,
        // shift.date, never local.date directly — a stamp just after midnight on a
        // midnight-crossing shift can belong to yesterday's work_date (see resolveStamp).
        shift.date,
        punchedAt,
        shift.start_time,
        shift.end_time,
        settings.grace_minutes,
        lateMinutes,
        deduction,
        status,
      ]
    );
    if (!inserted.rows.length) {
      // Cannot happen from a single caller processing punches sequentially on one connection
      // (the FOR UPDATE above already found no row), but never silently drop a punch either.
      throw new Error('تعارض غير متوقع عند إنشاء سجل حضور من نبضة الجهاز');
    }
    await markPunch(client, punch.id, { userId, attendanceId: inserted.rows[0].id });
    return 'created';
  }

  const row = existing.rows[0];

  // Rule 5 — an admin has ruled on this day. Never touch it, whatever the punch says.
  if (row.status === 'overridden') {
    await markPunch(client, punch.id, { userId, attendanceId: row.id, ignoredReason: REASON_OVERRIDDEN });
    return 'ignored';
  }

  const punchedAtMs = punchedAt.getTime();
  const checkInAtMs = new Date(row.check_in_at).getTime();
  const checkOutAtMs = row.check_out_at ? new Date(row.check_out_at).getTime() : null;

  // Rule 3 — an out-of-order punch earlier than the recorded check-in moves it back and
  // recomputes lateness from the new, earlier time. The old check-in becomes the checkout
  // unless one already exists later than it (which, given check-out only ever extends
  // forward, is the only case that can arise — the `||` below is just defensive).
  if (punchedAtMs < checkInAtMs) {
    const newCheckOut =
      checkOutAtMs == null || checkInAtMs > checkOutAtMs ? row.check_in_at : row.check_out_at;
    await client.query(
      `UPDATE staff_attendance_records
          SET check_in_at = $2, check_out_at = $3, late_minutes = $4, deduction_amount = $5,
              status = $6, updated_at = NOW()
        WHERE id = $1`,
      [row.id, punchedAt, newCheckOut, lateMinutes, deduction, status]
    );
    await markPunch(client, punch.id, { userId, attendanceId: row.id });
    return 'moved_in';
  }

  // Rule 2 — the last punch of the shift extends check_out_at. Never moves it backward.
  if (checkOutAtMs == null) {
    if (punchedAtMs > checkInAtMs) {
      await client.query(
        `UPDATE staff_attendance_records SET check_out_at = $2, updated_at = NOW() WHERE id = $1`,
        [row.id, punchedAt]
      );
      await markPunch(client, punch.id, { userId, attendanceId: row.id });
      return 'extended';
    }
    // Same instant as the recorded check-in (a distinct raw row that dodged the dedupe key,
    // e.g. a differing raw_status) — nothing to do.
    await markPunch(client, punch.id, { userId, attendanceId: row.id, ignoredReason: REASON_BETWEEN });
    return 'ignored';
  }

  if (punchedAtMs > checkOutAtMs) {
    await client.query(
      `UPDATE staff_attendance_records SET check_out_at = $2, updated_at = NOW() WHERE id = $1`,
      [row.id, punchedAt]
    );
    await markPunch(client, punch.id, { userId, attendanceId: row.id });
    return 'extended';
  }

  // Rule 4 — a punch between the recorded in and out (the lunchtime double-touch). Stored,
  // never affects the record.
  await markPunch(client, punch.id, { userId, attendanceId: row.id, ignoredReason: REASON_BETWEEN });
  return 'ignored';
}

/**
 * Store a batch of already-parsed punches (and their already-rejected siblings) from one
 * device upload. `client` must be a transactional client (e.g. from lib/db.js's `tx()`) —
 * each punch runs inside its own SAVEPOINT so one bad punch is quarantined into punch_reject
 * instead of poisoning the whole batch's Postgres transaction (a single failed statement
 * aborts everything after it until ROLLBACK, which SAVEPOINT scopes down to just that punch).
 */
async function ingestPunches(client, deviceSn, punches = [], rejects = []) {
  let stored = 0;
  let duplicate = 0;
  let rejected = 0;
  const derived = { created: 0, extended: 0, moved_in: 0, ignored: 0, unmapped: 0 };

  for (const r of rejects || []) {
    await client.query(
      `INSERT INTO punch_reject (device_sn, raw_line, reason) VALUES ($1, $2, $3)`,
      [deviceSn, r.raw_line ?? null, r.reason]
    );
    rejected += 1;
  }

  for (const punch of punches || []) {
    await client.query('SAVEPOINT punch_ingest_sp');
    try {
      const { rows } = await client.query(
        `INSERT INTO punch_raw
           (device_sn, device_pin, device_ts, punched_at, raw_status, raw_verify, raw_line)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (device_sn, device_pin, device_ts, raw_status) DO NOTHING
         RETURNING id`,
        [
          deviceSn,
          punch.device_pin,
          punch.device_ts,
          punch.punched_at,
          punch.raw_status ?? null,
          punch.raw_verify ?? null,
          punch.raw_line ?? null,
        ]
      );
      if (!rows.length) {
        duplicate += 1;
      } else {
        stored += 1;
        const action = await applyPunch(client, { ...punch, id: rows[0].id });
        derived[action] = (derived[action] || 0) + 1;
      }
      await client.query('RELEASE SAVEPOINT punch_ingest_sp');
    } catch (e) {
      await client.query('ROLLBACK TO SAVEPOINT punch_ingest_sp');
      await client.query('RELEASE SAVEPOINT punch_ingest_sp');
      rejected += 1;
      await client.query(
        `INSERT INTO punch_reject (device_sn, raw_line, reason) VALUES ($1, $2, $3)`,
        [deviceSn, punch.raw_line ?? null, `فشل حفظ النبضة: ${String(e.message || e).slice(0, 300)}`]
      );
    }
  }

  await client.query(
    `UPDATE attendance_devices SET last_seen_at = NOW() WHERE serial_number = $1`,
    [deviceSn]
  );

  return { stored, duplicate, rejected, derived };
}

/** The lowest pin not already in staff_device_pins, starting at 1. */
async function allocatePin(client) {
  const { rows } = await client.query(`SELECT pin FROM staff_device_pins ORDER BY pin ASC`);
  const taken = new Set(rows.map((r) => Number(r.pin)));
  let pin = 1;
  while (taken.has(pin)) pin += 1;
  return pin;
}

module.exports = { ingestPunches, applyPunch, allocatePin };
