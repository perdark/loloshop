// backend/lib/appPresence.js — «شكد ينفتح التطبيق، ومنو يفتحه، وعلى أي منصة» (migration 087).
//
// The all-roles twin of lib/staffPresence.js. Read that file's header first: the four-signals
// reasoning is the same, and the session semantics here are deliberately IDENTICAL so the two
// tables can be read side by side without a mental conversion.
//
// ⚠️ WHY THIS IS A SECOND FILE AND NOT A WIDENING OF staffPresence. `staff_app_opens` feeds the
// nightly staff report and sits next to payroll rules whose one owner is the attendance code.
// A stats dashboard must not be able to change what that table means. Staff therefore write
// BOTH tables from one request (see recordOpen), and the duplicated staff rows are the accepted
// price of leaving 084 alone.
//
// ⚠️ NOTHING HERE IS RETROACTIVE. No table recorded a student opening the app before this one
// existed, so every figure starts at zero on deploy day. The admin page says that in words —
// a chart that silently starts at zero reads as "nobody uses the app".

const { query } = require('./db');
// The same helper attendance and staffPresence use. Sharing it is the point: an app-open at
// 23:30 Baghdad must land on the same work_date as everything else that evening, and
// CURRENT_DATE (UTC) would file it under tomorrow.
const { localParts, DEFAULT_TZ: TZ } = require('./shopTime');

/** A ping after this long starts a new "open". Matches 084 exactly — see staffPresence. */
const SESSION_GAP_MINUTES = 30;

const PLATFORMS = new Set(['android', 'ios', 'web']);

/** Today in shop-local time. */
function shopToday(now = new Date()) {
  return localParts(now, TZ).date;
}

/**
 * Record that a signed-in user has the app open.
 *
 * One UPSERT, no read first, and `opens` advances only across a session gap — the increment is
 * a CASE inside DO UPDATE rather than a `+ 1` in JS, so two tabs pinging a minute apart cost
 * one row-write and zero opens and cannot race each other.
 *
 * `platform` is COALESCEd, never overwritten with NULL: a client that stops sending one (an old
 * build, a web tab) must not erase the fact that this user is on Android.
 */
async function recordOpen({ userId, platform = null, appVersion = null, now = new Date() }) {
  const plat = PLATFORMS.has(String(platform)) ? String(platform) : null;
  // Capped here rather than in the schema: the value is client-supplied and only ever looks
  // like "1.0.4", so anything longer is noise or an attack, not a version.
  const version =
    typeof appVersion === 'string' && appVersion.trim() ? appVersion.trim().slice(0, 32) : null;
  const { rows } = await query(
    `INSERT INTO app_opens (user_id, work_date, first_seen_at, last_seen_at, opens, platform,
                            app_version)
     VALUES ($1, $2, $3, $3, 1, $4, $5)
     ON CONFLICT (user_id, work_date) DO UPDATE
       SET last_seen_at = GREATEST(app_opens.last_seen_at, EXCLUDED.last_seen_at),
           opens = app_opens.opens
                 + CASE WHEN EXCLUDED.last_seen_at - app_opens.last_seen_at
                             > INTERVAL '${SESSION_GAP_MINUTES} minutes'
                        THEN 1 ELSE 0 END,
           platform = COALESCE(EXCLUDED.platform, app_opens.platform),
           -- Newest wins, unlike the platform column above: a person who UPDATES the app
           -- mid-day must show the new version, and that transition is the whole reason this
           -- column exists. (No backticks in here: this is inside a JS template literal.)
           app_version = COALESCE(EXCLUDED.app_version, app_opens.app_version)
     RETURNING opens, first_seen_at, last_seen_at`,
    [userId, shopToday(now), now, plat, version]
  );
  return rows[0];
}

/**
 * Record a device refusing to register for push.
 *
 * ⚠️ Written on a path that must never fail loudly: the caller is a fire-and-forget beacon on a
 * student's phone. Everything is capped and the insert is best-effort.
 */
async function recordRegisterError({ userId, platform = null, appVersion = null, message = null }) {
  await query(
    `INSERT INTO push_register_errors (user_id, platform, app_version, message)
     VALUES ($1, $2, $3, $4)`,
    [
      userId || null,
      platform ? String(platform).slice(0, 16) : null,
      appVersion ? String(appVersion).slice(0, 32) : null,
      message ? String(message).slice(0, 500) : null,
    ]
  );
}

/**
 * Everything /admin/app draws, in one round trip.
 *
 * ⚠️ THE TWO SOURCES MEASURE DIFFERENT THINGS AND ARE NEVER ADDED TOGETHER.
 *   · `device_tokens` — a FLOOR on installs. A row exists only if the person installed the app,
 *     signed in, AND granted the notification prompt. Someone who declined notifications is a
 *     real app user with no row here, so this under-counts and can never be called "installs".
 *   · `app_opens`     — actual usage, but only since migration 087 deployed.
 * Presenting either as the other is the one way this page can lie, so the payload keeps them in
 * separate objects and the page labels them separately.
 */
async function buildStats({ days = 30, now = new Date() } = {}) {
  const today = shopToday(now);

  const [devices, deviceTrend, daily, roles, totals, versions, regErrors] = await Promise.all([
    // Registered devices, split by platform. `last_seen_at` is refreshed by the push pipeline,
    // so "active" here means the token still works, not that the app was opened.
    query(
      `SELECT platform,
              COUNT(*)::int AS devices,
              COUNT(*) FILTER (WHERE created_at   > NOW() - INTERVAL '7 days')::int  AS new_7d,
              COUNT(*) FILTER (WHERE last_seen_at > NOW() - INTERVAL '7 days')::int  AS active_7d,
              COUNT(*) FILTER (WHERE last_seen_at > NOW() - INTERVAL '30 days')::int AS active_30d
         FROM device_tokens
        GROUP BY platform`
    ),
    // When each device first appeared — the closest thing to an install curve that exists.
    query(
      `SELECT (created_at AT TIME ZONE $2)::date AS day, platform, COUNT(*)::int AS devices
         FROM device_tokens
        WHERE created_at > NOW() - ($1 || ' days')::interval
        GROUP BY 1, 2
        ORDER BY 1`,
      [days, TZ]
    ),
    // Real usage: opens and distinct people, per day, per platform.
    query(
      `SELECT work_date AS day,
              COALESCE(platform, 'unknown') AS platform,
              SUM(opens)::int  AS opens,
              COUNT(*)::int    AS users
         FROM app_opens
        WHERE work_date > $1::date - ($2 || ' days')::interval
        GROUP BY 1, 2
        ORDER BY 1`,
      [today, days]
    ),
    // Who the app users are. Joined from users rather than snapshotted on the row: a student
    // who later becomes a ممثل should count as one today, not forever as what they were.
    query(
      `SELECT u.role,
              COUNT(DISTINCT a.user_id)::int AS users,
              SUM(a.opens)::int              AS opens
         FROM app_opens a
         JOIN users u ON u.id = a.user_id
        WHERE a.work_date > $1::date - ($2 || ' days')::interval
        GROUP BY u.role
        ORDER BY users DESC`,
      [today, days]
    ),
    query(
      `SELECT
         (SELECT COUNT(*)::int FROM device_tokens) AS devices,
         (SELECT COUNT(DISTINCT user_id)::int FROM device_tokens) AS device_users,
         (SELECT COUNT(DISTINCT user_id)::int FROM app_opens
           WHERE work_date > $1::date - ($2 || ' days')::interval) AS active_users,
         (SELECT COUNT(DISTINCT user_id)::int FROM app_opens WHERE work_date = $1::date) AS today_users,
         (SELECT COALESCE(SUM(opens), 0)::int FROM app_opens WHERE work_date = $1::date) AS today_opens,
         (SELECT MIN(work_date) FROM app_opens) AS tracking_since`,
      [today, days]
    ),
    // ⚠️ THE ROW THAT EXPLAINS «0 iOS TOKENS» (migration 090). A client older than 2026-08-26
    // sends no version, so NULL means "an app too old to tell us" — which, on iOS, is itself
    // the likely answer, because a build predating 1.0.4 cannot register for push at all.
    query(
      `SELECT COALESCE(platform, 'unknown') AS platform,
              COALESCE(app_version, 'أقدم من ٢٦ آب') AS app_version,
              COUNT(DISTINCT user_id)::int AS users
         FROM app_opens
        WHERE work_date > $1::date - ($2 || ' days')::interval
        GROUP BY 1, 2
        ORDER BY users DESC`,
      [today, days]
    ),
    query(
      `SELECT platform, app_version, message, COUNT(*)::int AS hits, MAX(created_at) AS newest
         FROM push_register_errors
        WHERE created_at > NOW() - ($1 || ' days')::interval
        GROUP BY platform, app_version, message
        ORDER BY newest DESC
        LIMIT 20`,
      [days]
    ),
  ]);

  // Both keys always present, zeroed rather than absent: iOS genuinely has no devices yet, and
  // a missing key would render as «—» (unknown) where the honest answer is «٠».
  const EMPTY = { devices: 0, new_7d: 0, active_7d: 0, active_30d: 0 };
  const byPlatform = (rows) => {
    const out = { android: { ...EMPTY }, ios: { ...EMPTY } };
    for (const r of rows) {
      const { platform, ...rest } = r;
      out[platform] = rest;
    }
    return out;
  };

  return {
    window_days: days,
    today,
    // Named `devices`, never `installs` — see the warning on this function.
    devices: {
      by_platform: byPlatform(devices.rows),
      trend: deviceTrend.rows,
      total: totals.rows[0].devices,
      people: totals.rows[0].device_users,
    },
    usage: {
      daily: daily.rows,
      by_role: roles.rows,
      active_users: totals.rows[0].active_users,
      today_users: totals.rows[0].today_users,
      today_opens: totals.rows[0].today_opens,
      // NULL until the first ping ever lands. The page uses this to say «القياس بدأ يوم X»
      // instead of drawing an empty chart that reads as "nobody opens the app".
      tracking_since: totals.rows[0].tracking_since,
      by_version: versions.rows,
    },
    // Empty is the goal. A row here names the reason a phone refused to register, which is
    // otherwise only visible in a console on someone else's device.
    register_errors: regErrors.rows,
  };
}

module.exports = {
  recordOpen,
  recordRegisterError,
  buildStats,
  shopToday,
  SESSION_GAP_MINUTES,
};
