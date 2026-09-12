// backend/lib/shopAnalytics.js — «شنو يصير بالمحل» in one round trip, for /admin/analytics.
//
// ⚠️ THIS FILE DELIBERATELY DOES NOT TOUCH MONEY. `lib/counts.js` owns what الربح means and
// `adminController.analytics` owns reporting it; a second place computing revenue is exactly the
// drift lib/counts.js's own header warns about. Everything here is people, devices and pages.
//
// ⚠️ FOUR SOURCES THAT MEASURE FOUR DIFFERENT THINGS, NEVER SUMMED AND NEVER SUBSTITUTED:
//   · users          — accounts. Complete since the shop opened.
//   · app_opens      — signed-in usage, with a platform. Starts 2026-08-25 (migration 087) and
//                      has NOTHING before it. `user_id` is NOT NULL, so a visitor who never
//                      signs in is invisible here — that is not a bug, it is the table's shape.
//   · site_visits    — sessions, including anonymous, with a PATH and (since migration 110) a
//                      CLIENT-CLAIMED platform. NULL there means «قبل ١١٠» and is never 'web'.
//                      One row per
//                      session per 5 minutes (trackController), which is what makes a row a
//                      usable ~5-minute time slice. Only the (student) layout mounts the beacon.
//   · device_tokens  — a FLOOR on installs: install + sign-in + notification permission granted.
//                      It is never «تنزيلات»; the real download count lives only in the Play and
//                      App Store consoles and cannot be derived from anything we store.
// The payload keeps them in four separate objects so the page cannot accidentally add two of
// them together, and every block carries its own «من متى» so a young table never reads as zero.

const { query } = require('./db');
const { localParts, DEFAULT_TZ: TZ } = require('./shopTime');

/** One row per session per 5 minutes — see trackController. A row is therefore ~5 minutes. */
const VISIT_SLICE_MINUTES = 5;

/** «الزيارات الآن» counts distinct sessions in this window — the same one the TV board uses. */
const LIVE_WINDOW_MINUTES = 30;

/**
 * Collapse an id out of a path so `/product/<uuid>` is one row and not 1,330.
 *
 * Two passes, because both shapes are live: UUIDs (`/product/<uuid>`, `/full-set/<uuid>`) and
 * bare numbers. Done in SQL rather than JS so the GROUP BY happens in Postgres — the table is
 * 34k rows today and grows with every visitor.
 */
const NORMALISED_PATH = `
  regexp_replace(
    regexp_replace(COALESCE(path, '/'),
      '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '/:id', 'gi'),
    '/[0-9]{2,}', '/:id', 'g')`;

function shopToday(now = new Date()) {
  return localParts(now, TZ).date;
}

/**
 * Everything /admin/analytics draws.
 *
 * `days` bounds the usage and page blocks only. Growth is deliberately NOT bounded by it: «هل
 * نكبر؟» is a question about the whole life of the shop, and a 30-day window would answer a
 * different one.
 */
async function buildOverview({ days = 30, now = new Date() } = {}) {
  const today = shopToday(now);

  const [live, accounts, signups, ordersTrend, reach, platforms, installs, installTrend, pages, sessionTrend, visitPlatforms, coverage] =
    await Promise.all([
      // ── اليوم ────────────────────────────────────────────────────────────────────────────
      query(
        `SELECT
           (SELECT COUNT(DISTINCT session_id)::int FROM site_visits
             WHERE created_at > NOW() - ($1 || ' minutes')::interval) AS sessions_now,
           (SELECT COUNT(DISTINCT session_id)::int FROM site_visits
             WHERE (created_at AT TIME ZONE $2)::date = $3::date) AS sessions_today,
           (SELECT COUNT(DISTINCT user_id)::int FROM app_opens WHERE work_date = $3::date) AS people_today,
           (SELECT COALESCE(SUM(opens), 0)::int FROM app_opens WHERE work_date = $3::date) AS opens_today`,
        [LIVE_WINDOW_MINUTES, TZ, today]
      ),

      // ── الحسابات ─────────────────────────────────────────────────────────────────────────
      query(`SELECT role, COUNT(*)::int AS accounts FROM users GROUP BY role ORDER BY accounts DESC`),

      // ── النمو: تسجيلات بالشهر ────────────────────────────────────────────────────────────
      // Every month the shop has existed, not a window. 24 is a cap against an unbounded page,
      // not a meaningful horizon — the shop is younger than that.
      query(
        `SELECT to_char(date_trunc('month', created_at AT TIME ZONE $1), 'YYYY-MM') AS month,
                COUNT(*) FILTER (WHERE role = 'retail')::int     AS students,
                COUNT(*) FILTER (WHERE role = 'wholesaler')::int AS reps,
                COUNT(*)::int                                    AS total
           FROM users
          GROUP BY 1 ORDER BY 1 DESC LIMIT 24`,
        [TZ]
      ),

      // ── النمو: طلبات بالأسبوع ────────────────────────────────────────────────────────────
      // COUNT of orders only. Their value is money and belongs to lib/counts.js — see header.
      query(
        `SELECT to_char(date_trunc('week', created_at AT TIME ZONE $1), 'YYYY-MM-DD') AS week,
                COUNT(*)::int AS orders,
                COUNT(DISTINCT student_id)::int AS students
           FROM orders
          WHERE status <> 'cancelled'
          GROUP BY 1 ORDER BY 1 DESC LIMIT 14`,
        [TZ]
      ),

      // ── منو فتح التطبيق فعلاً ────────────────────────────────────────────────────────────
      // ⚠️ LIFETIME, not windowed, and that is the point: «كم واحد من حساباتنا شاف التطبيق ولو
      // مرة» is a reach question. Windowing it would answer «كم واحد نشط»، which `usage` below
      // already answers. `native` is the half that matters for the app-only gate — a person
      // whose only platform is 'web' is someone the gate is about to send to the store.
      query(
        `SELECT u.role,
                COUNT(*)::int                                      AS accounts,
                COUNT(a.user_id)::int                              AS ever_opened,
                COUNT(*) FILTER (WHERE a.native)::int              AS native_users
           FROM users u
           LEFT JOIN (SELECT user_id, bool_or(platform IN ('android','ios')) AS native
                        FROM app_opens GROUP BY user_id) a ON a.user_id = u.id
          GROUP BY u.role ORDER BY accounts DESC`
      ),

      // ── على أي جهاز، لكل دور ─────────────────────────────────────────────────────────────
      query(
        `SELECT COALESCE(a.platform, 'unknown') AS platform, u.role,
                COUNT(DISTINCT a.user_id)::int AS people,
                SUM(a.opens)::int              AS opens
           FROM app_opens a JOIN users u ON u.id = a.user_id
          WHERE a.work_date > $1::date - ($2 || ' days')::interval
          GROUP BY 1, 2 ORDER BY people DESC`,
        [today, days]
      ),

      // ── أرضية التنزيلات ──────────────────────────────────────────────────────────────────
      // `anon` are handsets that granted the prompt with nobody signed in (migration 095), so
      // they are counted as devices and never as people.
      query(
        `SELECT platform,
                COUNT(*)::int                                   AS devices,
                COUNT(DISTINCT user_id)::int                    AS people,
                COUNT(*) FILTER (WHERE user_id IS NULL)::int    AS anon,
                COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS new_7d
           FROM device_tokens GROUP BY platform ORDER BY devices DESC`
      ),

      query(
        `SELECT to_char(date_trunc('week', created_at AT TIME ZONE $1), 'YYYY-MM-DD') AS week,
                platform, COUNT(*)::int AS devices
           FROM device_tokens GROUP BY 1, 2 ORDER BY 1 DESC LIMIT 24`,
        [TZ]
      ),

      // ── وين يقضون وقتهم ──────────────────────────────────────────────────────────────────
      // `minutes` is sessions × slices × 5, i.e. an UPPER bound on attention: a session that
      // pinged twice on a page was there for at least one interval, not necessarily two full
      // ones. Named `approx_minutes` in the payload so the page cannot print it as exact.
      query(
        `SELECT ${NORMALISED_PATH} AS path,
                COUNT(*)::int                                  AS slices,
                COUNT(DISTINCT session_id)::int                AS sessions,
                (COUNT(*) * ${VISIT_SLICE_MINUTES})::int       AS approx_minutes
           FROM site_visits
          WHERE created_at > NOW() - ($1 || ' days')::interval
          GROUP BY 1 ORDER BY slices DESC LIMIT 20`,
        [days]
      ),

      // ⚠️ The native/web split is only meaningful from migration 110 onward. Everything older
      // lands in `unknown`, and the page must keep showing that bucket rather than folding it
      // into «متصفح» — 34k historical rows would otherwise become a fact nobody measured.
      query(
        `SELECT to_char(date_trunc('week', created_at AT TIME ZONE $1), 'YYYY-MM-DD') AS week,
                COUNT(DISTINCT session_id)::int AS sessions,
                COUNT(*)::int                   AS slices,
                COUNT(DISTINCT session_id) FILTER (WHERE platform IN ('android','ios'))::int AS native,
                COUNT(DISTINCT session_id) FILTER (WHERE platform = 'web')::int              AS web,
                COUNT(DISTINCT session_id) FILTER (WHERE platform IS NULL)::int              AS unknown
           FROM site_visits GROUP BY 1 ORDER BY 1 DESC LIMIT 14`,
        [TZ]
      ),

      // «شكد من الزيارات من التطبيق ولو من المتصفح» — THE number that says whether the
      // app-only gate worked, and the only place an anonymous visitor's platform is visible at
      // all (app_opens.user_id is NOT NULL by design).
      query(
        `SELECT COALESCE(platform, 'unknown') AS platform,
                COUNT(DISTINCT session_id)::int AS sessions,
                COUNT(*)::int                   AS slices
           FROM site_visits
          WHERE created_at > NOW() - ($1 || ' days')::interval
          GROUP BY 1 ORDER BY sessions DESC`,
        [days]
      ),

      // ⚠️ Every block states when its own table started. A page that draws app_opens back to
      // June would show four flat months of zero and read as «التطبيق ما يفتحه أحد».
      query(
        `SELECT (SELECT MIN(work_date) FROM app_opens)                       AS app_opens_since,
                (SELECT MIN(created_at)::date FROM site_visits)              AS visits_since,
                (SELECT MIN(created_at)::date FROM device_tokens)            AS devices_since,
                (SELECT MIN(created_at)::date FROM users)                    AS users_since`
      ),
    ]);

  const c = coverage.rows[0] || {};
  return {
    window_days: days,
    today,
    live: live.rows[0],
    accounts: accounts.rows,
    growth: { by_month: signups.rows.reverse(), orders_by_week: ordersTrend.rows.reverse() },
    reach: { by_role: reach.rows, by_platform: platforms.rows },
    installs: { by_platform: installs.rows, by_week: installTrend.rows.reverse() },
    pages: {
      top: pages.rows,
      sessions_by_week: sessionTrend.rows.reverse(),
      by_platform: visitPlatforms.rows,
      slice_minutes: VISIT_SLICE_MINUTES,
    },
    since: {
      app_opens: c.app_opens_since || null,
      visits: c.visits_since || null,
      devices: c.devices_since || null,
      users: c.users_since || null,
    },
  };
}

module.exports = { buildOverview, shopToday, VISIT_SLICE_MINUTES, LIVE_WINDOW_MINUTES };
