#!/usr/bin/env node
'use strict';
/**
 * npm run friday-deduction-report
 *
 * READ-ONLY. Writes nothing, deletes nothing, and does not touch a single salary row.
 *
 * WHY IT EXISTS. Until migration 093 there was no weekday schedule: `checkIn` computed
 * lateness against one global start time (09:00) on all seven days, while the shop opens
 * 3 م الجمعة. So every Friday check-in was recorded as roughly six hours late.
 *
 * ⚠️ NOTHING WAS EVER DEDUCTED FOR IT — verify that claim in this report's own output rather
 * than taking it on faith. `staff_attendance_records.deduction_transaction_id` is only ever
 * cleared by the code, never set; the sole writer of an attendance salary transaction is
 * lib/attendanceBreak.js, for breaks. The «معاملة راتب» column below is printed precisely so
 * a reader can see that for themselves, row by row. If any row shows a transaction id, the
 * assumption behind this script is wrong and the owner needs to know before deciding.
 *
 * So what is damaged is a RECORD, not a payment: `status='late'`, a wrong `late_minutes`, and
 * a `deduction_amount` that both /staff/me and the admin reports display and a human then
 * pays from. The fix is a person reading this list and deciding, which is why this script
 * proposes nothing and changes nothing.
 */
require('dotenv').config();

const { query } = require('../lib/db');
const { WEEKDAY_LABEL_AR } = require('../lib/staffSchedule');

const iqd = (n) => Number(n || 0).toLocaleString('en-US');
const clock = (ts, tz) =>
  ts ? new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ts)) : '—';

async function main() {
  const tzRow = await query(`SELECT timezone FROM staff_attendance_settings WHERE id = TRUE`);
  const tz = tzRow.rows[0]?.timezone || 'Asia/Baghdad';

  // EXTRACT(DOW) = 5 is الجمعة. `work_date` is already the shop's local date (checkIn files
  // it from lib/shopTime), so no timezone arithmetic belongs in this filter.
  // الجمعة's CURRENT opening time — the yardstick. A Friday row is only suspect if the
  // expectation frozen onto it is EARLIER than this; a row already recorded against 3 م was
  // measured correctly (a per-user override, or a stamp taken after 093 shipped) and the
  // person really was late. Reporting those as damage would send the owner to refund work
  // that was genuinely missed, which is the opposite of what this script is for.
  const fri = await query(
    `SELECT to_char(start_time, 'HH24:MI') AS start_time FROM staff_schedule_days WHERE weekday = 5`
  );
  const fridayStart = fri.rows[0]?.start_time || '15:00';

  const { rows } = await query(
    `SELECT r.id,
            to_char(r.work_date, 'YYYY-MM-DD') AS work_date,
            r.check_in_at,
            to_char(r.expected_start_time, 'HH24:MI') AS expected_start_time,
            r.late_minutes, r.deduction_amount, r.deduction_transaction_id, r.status,
            u.name AS staff_name,
            (r.expected_start_time < $1::time) AS measured_against_wrong_opening
       FROM staff_attendance_records r
       JOIN users u ON u.id = r.user_id
      WHERE EXTRACT(DOW FROM r.work_date) = 5
        AND r.late_minutes > 0
      ORDER BY r.work_date DESC, u.name`,
    [fridayStart]
  );

  console.log('\n═══ بصمات الجمعة المسجّلة «متأخر» قبل جدول الدوام (migration 093) ═══');
  console.log(`    دوام الجمعة الحالي يبدأ ${fridayStart} — أي صف متوقَّعه أبكر من هذا انقاس غلط.\n`);

  const suspect = rows.filter((r) => r.measured_against_wrong_opening);
  const genuine = rows.filter((r) => !r.measured_against_wrong_opening);

  if (!suspect.length) {
    console.log('لا توجد أي بصمة جمعة انقاست على وقت فتح غلط. لا شيء يحتاج قراراً.\n');
    if (genuine.length) {
      console.log(`  (${genuine.length} بصمة جمعة مسجّلة كتأخير، لكن كلها انقاست على ${fridayStart} — تأخير حقيقي.)\n`);
    }
    return;
  }

  const byStaff = new Map();
  let linked = 0;
  for (const r of suspect) {
    const entry = byStaff.get(r.staff_name) || { rows: [], minutes: 0, amount: 0 };
    entry.rows.push(r);
    entry.minutes += Number(r.late_minutes);
    entry.amount += Number(r.deduction_amount);
    byStaff.set(r.staff_name, entry);
    if (r.deduction_transaction_id) linked += 1;
  }

  for (const [name, e] of byStaff) {
    console.log(`── ${name} — ${e.rows.length} جمعة · ${e.minutes} دقيقة · ${iqd(e.amount)} د.ع`);
    for (const r of e.rows) {
      const d = new Date(`${r.work_date}T00:00:00Z`);
      console.log(
        `     ${r.work_date} (${WEEKDAY_LABEL_AR[d.getUTCDay()]})` +
        ` · دخل ${clock(r.check_in_at, tz)}` +
        ` · المتوقع ${r.expected_start_time}` +
        ` · تأخير ${r.late_minutes} د` +
        ` · خصم ${iqd(r.deduction_amount)}` +
        ` · معاملة راتب: ${r.deduction_transaction_id || 'لا يوجد'}`
      );
    }
    console.log('');
  }

  const totalMinutes = suspect.reduce((a, r) => a + Number(r.late_minutes), 0);
  const totalAmount = suspect.reduce((a, r) => a + Number(r.deduction_amount), 0);
  console.log('═══ الخلاصة ═══');
  console.log(`  ${suspect.length} بصمة · ${byStaff.size} موظف · ${totalMinutes} دقيقة · ${iqd(totalAmount)} د.ع معروضة كخصم`);
  if (genuine.length) {
    console.log(`  (بالإضافة إلى ${genuine.length} بصمة جمعة انقاست على ${fridayStart} — تأخير حقيقي، مو مشمولة أعلاه.)`);
  }
  console.log(
    linked === 0
      ? '  ✅ ولا واحدة منها مربوطة بمعاملة راتب — يعني ما انخصم فلوس فعلياً، الرقم كان معروض بس.'
      : `  🔴 ${linked} صف مربوط بمعاملة راتب فعلية — راجعها وحدة وحدة قبل أي قرار.`
  );
  console.log('\n  هذا التقرير ما غيّر ولا شي. القرار (تعديل الصفوف أو تركها) قرار صاحب المحل.\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
