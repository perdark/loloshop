// backend/lib/staffPresence.js — the app-open signal (migration 084) and the daily staff report.
//
// The owner's question is «هل الموظفين يفتحون التطبيق أو لا، وشكد يشتغلون كل يوم». Three
// existing tables each answer a PIECE of that and none answers it:
//
//   · staff_attendance_records — بصمة. One deliberate act at the start of a shift. Cannot tell
//     a preparer who stamped and worked from one who stamped and left.
//   · staff_activity_log       — only fires when a PIECE MOVES, so a designer reading briefs
//     is invisible in it and an empty station makes its staff look idle.
//   · site_visits              — anonymous by design (no user_id, ever). Cannot name a person.
//
// So `staff_app_opens` is a fourth signal, and this file owns both writing it and joining all
// four into one row per employee per day.
//
// ⚠️ THE FOUR SIGNALS ARE NEVER MERGED. Opening the app is not attendance; not opening it is
// not a deduction. Nothing here writes staff_salary_transactions — attendance already owns the
// money rule and stays its only owner. The report prints the columns SIDE BY SIDE because the
// interesting row is the one where they disagree (stamped بصمة, zero opens, zero actions), and
// folding them together would erase exactly that row.

const { query } = require('./db');
// The same helper attendance itself uses (extracted to lib/shopTime.js for exactly this).
// Sharing it is the whole point: an app-open and a بصمة for the same Baghdad evening must
// never land on different work_dates.
const { localParts, DEFAULT_TZ: TZ } = require('./shopTime');

// A ping older than this starts a new "open". Sized for "did they come back", not "are they
// still here" — three hours in a queue is one open; leaving for lunch and returning is two.
const SESSION_GAP_MINUTES = 30;

const PLATFORMS = new Set(['android', 'ios', 'web']);

/** Today in shop-local time. Exported so the report and the beacon cannot drift apart. */
function shopToday(now = new Date()) {
  return localParts(now, TZ).date;
}

/**
 * Record that a staff member has the app open.
 *
 * Idempotent and cheap: one UPSERT, no read first. `opens` advances only across a session gap,
 * which is why the increment is a CASE inside the DO UPDATE rather than a `+ 1` — two pings a
 * minute apart must cost one row-write and zero opens, and doing that check in JS would need a
 * SELECT and would race two tabs against each other.
 */
async function recordAppOpen({ userId, platform = null, now = new Date() }) {
  const plat = PLATFORMS.has(String(platform)) ? String(platform) : null;
  const { rows } = await query(
    `INSERT INTO staff_app_opens (user_id, work_date, first_seen_at, last_seen_at, opens, platform)
     VALUES ($1, $2, $3, $3, 1, $4)
     ON CONFLICT (user_id, work_date) DO UPDATE
       SET last_seen_at = GREATEST(staff_app_opens.last_seen_at, EXCLUDED.last_seen_at),
           opens = staff_app_opens.opens
                 + CASE WHEN EXCLUDED.last_seen_at - staff_app_opens.last_seen_at
                             > INTERVAL '${SESSION_GAP_MINUTES} minutes'
                        THEN 1 ELSE 0 END,
           platform = COALESCE(EXCLUDED.platform, staff_app_opens.platform)
     RETURNING opens, first_seen_at, last_seen_at`,
    [userId, shopToday(now), now, plat]
  );
  return rows[0] || null;
}

/**
 * The day's report for every `role = 'staff'` employee.
 *
 * One query, four LEFT JOINs. The two aggregate joins (breaks, activity) are lateral
 * subqueries rather than joins-then-GROUP BY: joining two one-to-many tables to the same base
 * row multiplies them together, so a worker with 2 breaks and 30 production actions would
 * report 60 actions and 60 breaks. That is the classic fan-out bug and it is silent — the
 * numbers just come back wrong and plausible.
 */
async function dailyReport(dateISO, now = new Date()) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(dateISO || '')) ? String(dateISO) : shopToday(now);

  const { rows } = await query(
    `SELECT u.id                                   AS user_id,
            u.name,
            u.staff_type::text                     AS staff_type,
            COALESCE(us.attendance_required, TRUE) AS attendance_required,
            o.opens,
            o.first_seen_at,
            o.last_seen_at,
            o.platform,
            r.check_in_at,
            r.check_out_at,
            r.late_minutes,
            r.status                               AS attendance_status,
            COALESCE(b.break_minutes, 0)::int      AS break_minutes,
            COALESCE(a.actions, 0)::int            AS production_actions
       FROM users u
       LEFT JOIN staff_attendance_user_settings us ON us.user_id = u.id
       LEFT JOIN staff_app_opens o  ON o.user_id = u.id AND o.work_date = $1::date
       LEFT JOIN staff_attendance_records r ON r.user_id = u.id AND r.work_date = $1::date
       LEFT JOIN LATERAL (
              SELECT COALESCE(SUM(minutes), 0) AS break_minutes
                FROM staff_attendance_breaks
               WHERE user_id = u.id AND work_date = $1::date AND state = 'returned'
            ) b ON TRUE
       LEFT JOIN LATERAL (
              SELECT COUNT(*) AS actions
                FROM staff_activity_log
               WHERE user_id = u.id
                 AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE $2)::date = $1::date
            ) a ON TRUE
      WHERE u.role = 'staff' AND u.deleted_at IS NULL
      ORDER BY u.name`,
    [date, TZ]
  );

  const out = rows.map((row) => {
    const checkIn = row.check_in_at ? new Date(row.check_in_at) : null;
    const checkOut = row.check_out_at ? new Date(row.check_out_at) : null;

    // ⚠️ null, NOT 0, while someone is still checked in. "Still at work" and "worked nothing"
    // are different claims, and a report that prints the second when it means the first is
    // exactly the kind of wrong number the owner would act on.
    let workedMinutes = null;
    if (checkIn && checkOut) {
      const gross = Math.round((checkOut - checkIn) / 60000);
      workedMinutes = Math.max(0, gross - Number(row.break_minutes || 0));
    }

    return {
      user_id: row.user_id,
      name: row.name,
      staff_type: row.staff_type,
      attendance_required: row.attendance_required !== false,
      opened: Number(row.opens || 0) > 0,
      opens: Number(row.opens || 0),
      first_seen_at: row.first_seen_at,
      last_seen_at: row.last_seen_at,
      platform: row.platform,
      check_in_at: row.check_in_at,
      check_out_at: row.check_out_at,
      still_in: Boolean(checkIn && !checkOut),
      worked_minutes: workedMinutes,
      late_minutes: Number(row.late_minutes || 0),
      break_minutes: Number(row.break_minutes || 0),
      attendance_status: row.attendance_status,
      production_actions: Number(row.production_actions || 0),
    };
  });

  const required = out.filter((r) => r.attendance_required);
  const totals = {
    staff: out.length,
    opened: out.filter((r) => r.opened).length,
    not_opened: out.filter((r) => !r.opened).length,
    checked_in: out.filter((r) => r.check_in_at).length,
    // Absence is only meaningful for someone we EXPECT. A staff member with
    // attendance_required = false (the owner's own exemptions) is not absent, they are exempt,
    // and counting them as absent would make every report permanently wrong by a constant.
    absent: required.filter((r) => !r.check_in_at).length,
    not_required: out.length - required.length,
    still_in: out.filter((r) => r.still_in).length,
    opens: out.reduce((s, r) => s + r.opens, 0),
    worked_minutes: out.reduce((s, r) => s + (r.worked_minutes || 0), 0),
    production_actions: out.reduce((s, r) => s + r.production_actions, 0),
  };

  return { date, totals, rows: out };
}

module.exports = {
  recordAppOpen,
  dailyReport,
  shopToday,
  TZ,
  SESSION_GAP_MINUTES,
};
