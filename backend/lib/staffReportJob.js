// backend/lib/staffReportJob.js — the nightly «تقرير الموظفين» push.
//
// Owner decision 2026-08-21: the daily staff report arrives on his phone, it is not something
// he has to remember to go and read. A report nobody opens answers nothing.
//
// ── DELIVERY ───────────────────────────────────────────────────────────────────────────────
// Writing a `notifications` row IS the whole delivery mechanism. lib/pushOutbox.js drains
// pending rows within its freshness window and turns them into FCM/APNs sends, so this file
// knows nothing about either provider — exactly the path lib/aiChat.js's spend warning already
// uses. Adding a second delivery mechanism for the same job would be two things to keep working.
//
// ── SCHEDULING ─────────────────────────────────────────────────────────────────────────────
// pg-boss v10 (already a dependency, already running as PM2 app `loloshop-worker`) schedules
// this with a cron expression and an explicit `tz`. The tz matters: the cron runs on a UTC box
// and «٩ مساءً» must mean nine at the shop, not nine in London.
//
// ⚠️ IDEMPOTENT BY `NOT EXISTS`, not by trusting the scheduler. A worker restart, a redeploy,
// or pg-boss redelivering a job after a crash must not push the same evening's summary twice —
// and the owner would read a second push as a second day. The guard is a same-day check on the
// notification type, the same shape as the spend warning's once-per-24h rule.

const { query } = require('./db');
const presence = require('./staffPresence');
// «2026/8/30» — the shop's one human-readable date format. See lib/shopTime.js.
const { fmtShopDate } = require('./shopTime');

const QUEUE_STAFF_REPORT = 'staff-daily-report';

// 21:00 Asia/Baghdad. Late enough that the day's بصمة check-outs have happened, early enough
// that the owner is still awake to act on «فلان ما فتح التطبيق اليوم».
const CRON = '0 21 * * *';

/** «٧ ساعات و٣٠ دقيقة» — see adminMetrics for why minutes alone are unreadable at shift scale. */
function fmtHours(mins) {
  const m = Math.max(0, Math.round(Number(mins) || 0));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!h) return `${rest} دقيقة`;
  return rest ? `${h} ساعة و${rest} دقيقة` : `${h} ساعة`;
}

/**
 * The push body. Deliberately SHORT — this lands on a lock screen, where a paragraph is
 * truncated into nonsense. It carries the four numbers the owner asked for and the names of
 * whoever did not show, because a name is what he acts on and a count is what he then has to
 * open the app to resolve.
 */
function composeBody(report) {
  const t = report.totals;
  const lines = [
    `فتحوا التطبيق: ${t.opened} من ${t.staff}`,
    `بصموا حضور: ${t.checked_in}`,
    `ساعات العمل: ${fmtHours(t.worked_minutes)}`,
  ];

  const absent = report.rows.filter((r) => r.attendance_required && !r.check_in_at);
  if (absent.length) {
    lines.push(`غايبين: ${absent.slice(0, 5).map((r) => r.name).join('، ')}${absent.length > 5 ? ' وغيرهم' : ''}`);
  }

  // The row worth a push. Someone who stamped in and never opened the app is a different
  // situation from someone who did neither, and it is invisible on the attendance screen —
  // which is precisely why the app-open signal was added.
  const ghosts = report.rows.filter((r) => r.check_in_at && !r.opened);
  if (ghosts.length) {
    lines.push(`بصموا بس ما فتحوا التطبيق: ${ghosts.map((r) => r.name).join('، ')}`);
  }

  return lines.join(' · ');
}

/**
 * Build the day's report and notify every admin, at most once per day.
 * Returns { skipped: true } when today's notification already exists.
 */
async function runDailyReport(now = new Date()) {
  const date = presence.shopToday(now);
  const report = await presence.dailyReport(date, now);

  const { rowCount } = await query(
    `INSERT INTO notifications (user_id, type, title_ar, body_ar, link)
     SELECT u.id, 'staff_daily_report', $1, $2, '/admin/assistant'
       FROM users u
      WHERE u.role = 'admin' AND u.deleted_at IS NULL
        AND NOT EXISTS (
              SELECT 1 FROM notifications n
               WHERE n.type = 'staff_daily_report'
                 AND n.user_id = u.id
                 AND n.created_at > NOW() - INTERVAL '20 hours')`,
    [`تقرير الموظفين — ${fmtShopDate(date)}`, composeBody(report)]
  );

  if (rowCount === 0) {
    console.log(`[staff-report] ${date}: already sent, nothing written`);
    return { date, skipped: true, notified: 0 };
  }
  console.log(`[staff-report] ${date}: notified ${rowCount} admin(s)`);
  return { date, skipped: false, notified: rowCount, report };
}

/**
 * Register the queue and its schedule. Called once from worker.js at boot.
 *
 * `boss.schedule` is idempotent on (queue, cron) — calling it every boot updates the schedule
 * rather than stacking duplicates, so a redeploy cannot end up sending the report twice. The
 * `NOT EXISTS` guard in runDailyReport is still the real protection; this is the cheap one.
 */
async function register(boss) {
  await boss.createQueue(QUEUE_STAFF_REPORT).catch(() => {}); // idempotent (exists → throws)
  await boss.schedule(QUEUE_STAFF_REPORT, CRON, {}, { tz: presence.TZ });
  await boss.work(QUEUE_STAFF_REPORT, { batchSize: 1 }, async () => {
    await runDailyReport();
  });
  console.log(`[staff-report] scheduled ${CRON} ${presence.TZ}`);
}

module.exports = { runDailyReport, register, composeBody, QUEUE_STAFF_REPORT, CRON };
