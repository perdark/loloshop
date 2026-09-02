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
const breaks = require('./attendanceBreak');
const { localParts, DEFAULT_TZ } = require('./shopTime');

const REASON_UNMAPPED = 'رقم الجهاز غير مرتبط بأي موظف';
const REASON_OVERRIDDEN = 'اليوم بحالة معدَّلة من الإدارة، ما ينلمس';
// ⚠️ THE ONE THING AN `overridden` DAY STILL ACCEPTS. An admin who corrects a check-in has
// ruled on when the worker ARRIVED; they have not declared the day finished. Before this,
// every departure punch on a repaired day was stored and ignored, so nobody checked out —
// measured on prod 2026-09-01, when repairing seven collapsed batch timestamps froze the
// whole day and محمد عادل's 22:41 خروج vanished. See the guard in applyPunch for what stays
// frozen: check_in_at, late_minutes, status, and every break (breaks post to salary).
const REASON_OVERRIDDEN_OUT = 'خروج مسجّل على يوم معدَّل من الإدارة';
const REASON_NOT_REQUIRED = 'الموظف معفى من شرط البصمة';
const REASON_BETWEEN = 'بصمة وقعت بين وقتي الدخول والخروج المسجلين';
// A break edge is NOT an error — the reason column doubles as "what this punch meant", and
// these two are why a punch mid-shift no longer looks like a stray touch.
/**
 * Two punches from the SAME worker inside this many minutes are one touch. Owner decision
 * 2026-08-30. It is a per-user rule, not a per-device one — see the query in applyPunch.
 */
const PUNCH_COOLDOWN_MINUTES = 5;
const REASON_TOO_SOON = 'بصمة مكررة خلال ٥ دقائق من بصمة سابقة';
const REASON_BREAK_START = 'بصمة خروج مؤقت';
const REASON_BREAK_END = 'بصمة عودة من الخروج المؤقت';

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
 * Close the worker's most recent still-open day when a NEW shift day begins, at that day's own
 * scheduled end — plus any break still `out` inside it, flagged `auto_closed` so an admin can
 * tell it apart from a real عودة.
 *
 * ⚠️ Only touches days STRICTLY BEFORE the one starting now.
 *
 * ⚠️ AN `overridden` DAY IS CLOSED TOO — owner decision 2026-09-01, reversing the original
 * rule. It used to be excluded on the reasoning that "a day the admin has ruled on stays
 * exactly as they left it, open or not", and the cost of that was a repaired day nobody could
 * ever close: derivation refused the departure punch (rule 5) AND this refused to close it, so
 * the row stayed open forever and kept tripping the openTooLong alert. An override says when
 * someone ARRIVED; it does not say the day never ended. Only `check_out_at` is written here —
 * check_in_at, late_minutes and status are still untouchable.
 */
async function closeStaleOpenDay(client, userId, newWorkDate, settings, timeZone) {
  const { rows } = await client.query(
    `SELECT * FROM staff_attendance_records
      WHERE user_id = $1 AND work_date < $2 AND check_out_at IS NULL
      ORDER BY work_date DESC
      LIMIT 1
      FOR UPDATE`,
    [userId, newWorkDate]
  );
  if (!rows.length) return;
  const stale = rows[0];

  // The stored expected_end_time is the hours that applied on THAT day — reading today's
  // schedule instead would re-date history every time the admin edits the week.
  const end = stale.expected_end_time || '23:59:00';
  const crosses = schedule.timeToMinutes(end) <= schedule.timeToMinutes(stale.expected_start_time || '00:00:00');
  const { rows: at } = await client.query(
    `SELECT (($1::date + $2::time) AT TIME ZONE $3) + ($4 || ' day')::interval AS ts`,
    [stale.work_date, end, timeZone, crosses ? 1 : 0]
  );
  const closeAt = at[0].ts;

  const open = await breaks.openBreakFor(client, userId);
  if (open && open.state === 'out' && open.attendance_id === stale.id) {
    await breaks.finishBreak(client, open, {
      returnedAt: closeAt,
      perMinute: settings.deduction_per_minute,
      autoClosed: true,
    });
    await breaks.recomputeMonth(client, {
      userId,
      monthKey: breaks.monthKeyFor(closeAt, timeZone),
      allowanceMinutes: breaks.effectiveAllowance(settings),
    });
  }

  await client.query(
    `UPDATE staff_attendance_records SET check_out_at = $2, updated_at = NOW() WHERE id = $1`,
    [stale.id, closeAt]
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

  // ─── The per-worker cooldown ──────────────────────────────────────────────────────────
  // A finger resting on the sensor reads twice, and under the sequence rule below a stray
  // second read is not harmless any more: it would open a خروج مؤقت the worker never took.
  // (The owner's own test punch did exactly this — 20:30:56 and 20:31:01, two rows.)
  //
  // ⚠️ PER WORKER, NEVER PER DEVICE. Two people punching at 10:15 and 10:16 is the normal
  // morning queue and must both count; the same person at 10:15 and 10:16 is one arrival.
  // Scoped by user_id for that reason.
  //
  // ⚠️ Measured from the last ACCEPTED punch, not the last punch of any kind. Chaining it off
  // rejected ones lets a worker who taps every four minutes lock themselves out for the whole
  // day: 10:15 accepted → 10:16 and 10:17 both rejected (the owner's example), and 10:21 is
  // accepted because it is more than five minutes past 10:15, not past 10:17.
  const { rows: recent } = await client.query(
    `SELECT punched_at FROM punch_raw
      WHERE user_id = $1
        AND id <> $2
        AND punched_at <= $3
        AND punched_at > $3::timestamptz - ($4 || ' minutes')::interval
        AND (ignored_reason IS NULL OR ignored_reason <> $5)
      ORDER BY punched_at DESC
      LIMIT 1`,
    [userId, punch.id, punchedAt, String(PUNCH_COOLDOWN_MINUTES), REASON_TOO_SOON]
  );
  if (recent.length) {
    await markPunch(client, punch.id, { userId, ignoredReason: REASON_TOO_SOON });
    return 'ignored';
  }
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
    // ⚠️ A NEW SHIFT DAY CLOSES THE PREVIOUS ONE, AND ON A MIDNIGHT-CROSSING SHIFT IT IS THE
    // ONLY THING THAT CAN. The "at or after end_time" test below cannot fire for a shift like
    // 22:16 → 10:15 (مضر's, on prod): resolveStamp files a stamp under the previous day only
    // while it is STRICTLY BEFORE that end, so the very instant that would close the day is
    // already the next shift's دخول. Without this the day — and any break inside it — would
    // stay open forever, which is the same shape of bug migration 093 fixed for lateness.
    //
    // The previous day is closed at ITS OWN scheduled end, never at this punch's time: the
    // worker went home at some unknown hour, and the shift end is the only defensible
    // stand-in. `openTooLong` still marks it so the admin can see a day nobody punched out of.
    await closeStaleOpenDay(client, userId, shift.date, settings, timeZone);
    await markPunch(client, punch.id, { userId, attendanceId: inserted.rows[0].id });
    return 'created';
  }

  const row = existing.rows[0];

  const punchedAtMs = punchedAt.getTime();
  const checkInAtMs = new Date(row.check_in_at).getTime();
  const checkOutAtMs = row.check_out_at ? new Date(row.check_out_at).getTime() : null;

  // "Is the shop shut for this worker" — the clock test the sequence rule below is built on.
  // Computed HERE rather than beside that rule because rule 5 needs it too: it is the whole
  // difference between a departure and a break edge on an `overridden` day.
  const hasHours = !!(shift.start_time && shift.end_time);
  let shiftIsOver = false;
  if (hasHours) {
    const startM = schedule.timeToMinutes(shift.start_time);
    const endM = schedule.timeToMinutes(shift.end_time) + (shift.crosses_midnight ? 24 * 60 : 0);
    // Same normalisation lateMinutesFor uses: after midnight on a crossing shift, "minutes
    // since midnight" is tiny and would read as long before the start.
    const nowM = shift.crosses_midnight && shift.minutes_now < startM
      ? shift.minutes_now + 24 * 60
      : shift.minutes_now;
    shiftIsOver = nowM >= endM;
  }

  // ─── Rule 5 — an admin has ruled on this day ─────────────────────────────────────────
  // Almost nothing may touch it. The ONE exception is the worker going home: an override
  // fixes when someone ARRIVED, it does not declare the day over, and freezing the whole row
  // meant a repaired day could never be checked out of by anybody (prod, 2026-09-01).
  //
  // ⚠️ DELIBERATELY NARROWER THAN A NORMAL DAY, and each exclusion is load-bearing:
  //   · Only when `check_out_at IS NULL` — a checkout the admin already wrote is never moved.
  //   · Only once the shift is over. A mid-shift punch on a normal day opens a خروج مؤقت, and
  //     break minutes ARE posted to salary (lib/attendanceBreak.js); an overridden day never
  //     grew those break rows, so inventing them here would bill against hours an admin set
  //     by hand. Money stays out of an override.
  //   · check_in_at, late_minutes, deduction_amount and status are never rewritten — the
  //     admin's correction is exactly what this rule exists to protect.
  // A worker on a midnight-crossing shift can therefore still not close their own day; that
  // is not a gap, it is closeStaleOpenDay's job, on an overridden row as on any other.
  if (row.status === 'overridden') {
    if (checkOutAtMs == null && shiftIsOver && punchedAtMs > checkInAtMs) {
      await client.query(
        `UPDATE staff_attendance_records SET check_out_at = $2, updated_at = NOW() WHERE id = $1`,
        [row.id, punchedAt]
      );
      await markPunch(client, punch.id, {
        userId,
        attendanceId: row.id,
        ignoredReason: REASON_OVERRIDDEN_OUT,
      });
      return 'extended';
    }
    await markPunch(client, punch.id, { userId, attendanceId: row.id, ignoredReason: REASON_OVERRIDDEN });
    return 'ignored';
  }

  // ─────────────────────────────────────────────────────────────────────────────────────
  // THE SEQUENCE RULE — owner decision 2026-08-30. A day reads:
  //   بصمة ١ دخول · ٢ خروج مؤقت · ٣ عودة · ٤ خروج   (or just دخول + خروج)
  //
  // What tells بصمة ٢ apart from a plain خروج is THE CLOCK, not the count: a punch at or
  // after the shift's own end time closes the day; anything earlier opens or closes a break.
  // Breaks alternate, so a worker may leave more than once and every pair is its own break.
  //
  // ⚠️ THE ACCEPTED FLAW, stated by the owner when choosing this rule: someone who genuinely
  // goes home BEFORE the shift ends opens a break instead of closing their day. Nothing
  // silently swallows that — the break stays `out`, crosses OPEN_BREAK_ALERT_MINUTES (4h) and
  // surfaces to the admin, who fixes the day with
  // `PATCH /admin/attendance/records/:id/override`. Do not "fix" it by guessing at intent.
  //
  // ⚠️ A DEVICE BREAK IS CREATED `approval = 'approved'` ON PURPOSE, AND THAT IS A MONEY
  // DECISION. computeCharge gives an UNAPPROVED break zero free minutes — every minute is
  // deducted from salary — so creating these as pending would quietly bill every worker for
  // every break the moment the shop stopped using the phone's request flow. There is no إذن
  // to ask for at a sensor: the finger IS the record. (`ffcb0ce` removes الإذن from the money
  // rule outright; this line is what keeps the two consistent until that branch merges.)
  // (`hasHours` / `shiftIsOver` are computed above rule 5, which needs the same test.)

  // A punch that is not the earliest of the day and lands while the shop is still open is a
  // break edge. `openBreakFor` is scoped to the worker, not the day, which is what closes a
  // break that was opened just before midnight on a crossing shift.
  if (hasHours && punchedAtMs > checkInAtMs) {
    const open = await breaks.openBreakFor(client, userId);
    if (open && open.state === 'out') {
      // عودة — always closes the break, even past the shift end. A return is a return; if the
      // shift is also over, the same instant closes the day below.
      await breaks.finishBreak(client, open, {
        returnedAt: punchedAt,
        perMinute: settings.deduction_per_minute,
        autoClosed: false,
      });
      await breaks.recomputeMonth(client, {
        userId,
        monthKey: breaks.monthKeyFor(punchedAt, timeZone),
        allowanceMinutes: breaks.effectiveAllowance(settings),
      });
      if (!shiftIsOver) {
        await markPunch(client, punch.id, { userId, attendanceId: row.id, ignoredReason: REASON_BREAK_END });
        return 'break_end';
      }
    } else if (!shiftIsOver) {
      // خروج مؤقت — the shop is still open, so leaving is a break, not the end of the day.
      await client.query(
        `INSERT INTO staff_attendance_breaks
           (user_id, attendance_id, work_date, month_key, left_at, state, approval,
            left_without_approval, requested_at, deduction_per_minute)
         VALUES ($1, $2, $3, $4, $5, 'out', 'approved', FALSE, $5, $6)`,
        [
          userId,
          row.id,
          shift.date,
          breaks.monthKeyFor(punchedAt, timeZone),
          punchedAt,
          Number(settings.deduction_per_minute || 0),
        ]
      );
      await markPunch(client, punch.id, { userId, attendanceId: row.id, ignoredReason: REASON_BREAK_START });
      return 'break_start';
    }
  }

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
/**
 * ⚠️ THE SERVER CLOCK STAMPS THE PUNCH, NOT THE DEVICE — owner decision 2026-08-30.
 *
 * The K40's wall clock was wrong on site, and it is the thing every تأخير is measured
 * against, so the owner asked for Baghdad time to come from our own code instead. What the
 * device says is NOT thrown away: `device_ts` keeps its verbatim reading (and is still the
 * dedupe key, so a re-sent batch is still recognised as the same punch), while `punched_at`
 * — the column every derivation, report and تأخير reads — is now the instant the punch
 * REACHED US.
 *
 * ⚠️ THE PRICE, AND IT IS REAL: a punch is only as accurate as the connection. `Realtime=1`
 * in the handshake makes the device push within seconds, so in normal operation the two are
 * the same to the second. But if the shop's internet drops for two hours, every punch made
 * in those two hours arrives in one batch and they ALL get that batch's arrival time — the
 * worker who came at 9:00 and the one who came at 10:30 land on the same minute. That is
 * exactly what happened to the 2026-08-30 backlog, and under this rule the whole day would
 * have collapsed onto 20:55 instead of replaying correctly.
 *
 * So: if an outage is ever longer than a few minutes, the honest repair is the admin's
 * `PATCH /admin/attendance/records/:id/override`, using `device_ts` on the punch — which is
 * still there for exactly this — as the evidence of what the finger actually did.
 */
async function ingestPunches(client, deviceSn, punches = [], rejects = []) {
  // One instant for the whole batch: two punches in the same POST arrived together, and
  // giving them microsecond-apart times would invent a precision this rule does not have.
  const receivedAt = new Date();
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
          receivedAt,
          punch.raw_status ?? null,
          punch.raw_verify ?? null,
          punch.raw_line ?? null,
        ]
      );
      if (!rows.length) {
        duplicate += 1;
      } else {
        stored += 1;
        // `punched_at` is overridden here too, not just in the INSERT: applyPunch resolves
        // the shift and the تأخير from it, so handing it the device's reading would derive
        // the day from a clock we just decided not to trust.
        const action = await applyPunch(client, { ...punch, id: rows[0].id, punched_at: receivedAt });
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
