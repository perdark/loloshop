// backend/lib/adminMetrics.js — the CLOSED set of questions the analytics assistant can answer.
//
// SECURITY MODEL: the model never writes SQL and never sees the database. It picks one `key`
// from the list below plus a couple of scalar parameters; this file owns every query, all
// parameterised. The blast radius of a bad model output is "wrong metric chosen", never
// "arbitrary read" — which matters because this DB has no RLS and Postgres access is the
// whole shop. Adding a metric is a deliberate code change, reviewed like any other.
//
// 2026-08-21: the catalogue grew from 8 metrics to 22 for the admin console (/admin/assistant),
// adding the staff/attendance/workshop/spend half the owner actually asks about day to day. The
// security model below did not change and must not: every query still lives in THIS file.
//
// Money metrics all go through counts.billableOrderSql AND counts' money vocabulary
// (settledMoney · shopIncomeExpr · repMarginExpr) so the assistant and the /admin dashboard
// agree to the dinar. Operational counts use liveSql, matching the funnel.
//
// ⚠️ NEVER answer a money question with SUM(price)/SUM(cost)/SUM(profit) here. On a
// representative's order `price − cost` is the REP's margin — money that never reaches this
// shop — so that triple under the words مبيعات/تكاليف/أرباح quotes the reps' earnings as the
// shop's. counts.js documents this at length; read it before adding a money metric.

const { query } = require('./db');
const {
  billableOrderSql,
  liveSql,
  bundleKey,
  settledMoney,
  shopIncomeExpr,
  repMarginExpr,
} = require('./counts');

const presence = require('./staffPresence');

const fmtIQD = (n) => `${Number(n || 0).toLocaleString('en-US')} دينار`;

// «٧ ساعات و٣٠ دقيقة». Minutes alone are unreadable at shift scale — an owner scanning a
// report should not have to divide 4,380 by 60 to learn it was 73 hours.
const fmtHours = (mins) => {
  const m = Math.max(0, Math.round(Number(mins) || 0));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!h) return `${rest} دقيقة`;
  return rest ? `${h} ساعة و${rest} دقيقة` : `${h} ساعة`;
};

// `days` is always an integer we clamp ourselves — it is interpolated into an INTERVAL,
// which cannot take a bind parameter in this position, so it must never come from the model
// unvalidated. clampDays is the only way a day count reaches SQL in this file.
const clampDays = (d) => Math.min(Math.max(parseInt(d, 10) || 30, 1), 730);

const METRICS = {
  revenue_summary: {
    desc: 'دخل المحل وحصة الإدارة ومبيعات التجزئة وربح الممثلين خلال فترة (بالأيام)',
    params: ['days'],
    // ⚠️ This metric MUST stay on counts.settledMoney. It used to answer with
    // SUM(price)/SUM(cost)/SUM(profit) under the words مبيعات/تكاليف/أرباح, which is
    // exactly the failure counts.js warns about in its own header: on a rep's order
    // `price − cost` is THE REP's margin, so «الأرباح» was quoting money that never
    // reaches this shop — and quoting it in a voice the owner cannot audit, beside a
    // dashboard that now says something different. One definition, one file.
    run: async ({ days }) => {
      const d = clampDays(days);
      const m = await settledMoney({
        where: `o.created_at > NOW() - INTERVAL '${d} days'`,
      });
      const facts = [
        `دخل المحل: ${fmtIQD(m.shop_income)}`,
        `منها حصة الإدارة من طلبات الممثلين: ${fmtIQD(m.rep_admin_share)}`,
        `ومنها مبيعات التجزئة: ${fmtIQD(m.retail_revenue)}`,
        `ربح الممثلين (يبقى عندهم، مو من دخل المحل): ${fmtIQD(m.rep_margin)}`,
        `إجمالي اللي دفعه الطلاب: ${fmtIQD(m.gross_collected)}`,
        `عدد الطلبات: ${m.orders}`,
      ];
      // The dashboard refuses to print a net profit while no production cost exists;
      // the assistant must refuse in the same breath, or it becomes the easy place to
      // get the number the dashboard would not give.
      if (Number(m.retail_pieces_costed) === 0) {
        facts.push(
          'ماكو تكلفة إنتاج مُدخلة لأي طلب تجزئة، فمبيعات التجزئة إيراد مو ربح، وصافي ربح المحل ما ينحسب بعد'
        );
      }
      return { label: `آخر ${d} يوم`, facts };
    },
  },

  top_reps: {
    desc: 'أفضل ممثلي الجامعات حسب دخل المحل منهم خلال فترة',
    params: ['days', 'limit'],
    // Ranked by what the SHOP takes from each rep (حصة الإدارة), not by what students
    // handed the rep. The old ordering was `SUM(o.price) DESC`, which ranks reps by the
    // size of their own business — a rep who marks up heavily outranks one who sends the
    // shop more money. The rep's margin is still reported, labelled as theirs.
    run: async ({ days, limit }) => {
      const d = clampDays(days);
      const n = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 20);
      const { rows } = await query(
        `SELECT u.name AS rep_name,
                s.university_name,
                ${shopIncomeExpr('o')} AS shop_income,
                ${repMarginExpr('o')}  AS rep_margin,
                COALESCE(SUM(o.price), 0)::bigint AS student_paid,
                COUNT(DISTINCT ${bundleKey('o')})::int AS orders
           FROM orders o
           JOIN students     s  ON s.id = o.student_id
           JOIN wholesalers  w  ON w.id = s.wholesaler_id
           JOIN users        u  ON u.id = w.user_id
          WHERE ${billableOrderSql('o')}
            AND o.created_at > NOW() - INTERVAL '${d} days'
          GROUP BY u.name, s.university_name
          ORDER BY shop_income DESC
          LIMIT $1`,
        [n]
      );
      if (!rows.length) return { label: `آخر ${d} يوم`, facts: ['ماكو مبيعات عن طريق الممثلين بهذي الفترة'] };
      return {
        label: `أفضل ${rows.length} ممثل — آخر ${d} يوم`,
        facts: rows.map(
          (r, i) =>
            `${i + 1}. ${r.rep_name}${r.university_name ? ` (${r.university_name})` : ''} — ` +
            `دخل المحل ${fmtIQD(r.shop_income)}، دفع الطلاب ${fmtIQD(r.student_paid)}، ` +
            `ربح الممثل ${fmtIQD(r.rep_margin)}، ${r.orders} طلب`
        ),
      };
    },
  },

  orders_by_status: {
    desc: 'توزيع القطع على مراحل الإنتاج (كم قطعة بكل مرحلة)',
    params: [],
    run: async () => {
      const { rows } = await query(
        `SELECT o.status, COUNT(*)::int AS pieces
           FROM orders o
          WHERE ${liveSql('o')}
          GROUP BY o.status
          ORDER BY pieces DESC`
      );
      const { STATUS_AR } = require('./supportContext');
      return {
        label: 'القطع حسب المرحلة (الطلبات النشطة)',
        facts: rows.map((r) => `${STATUS_AR[r.status] || r.status}: ${r.pieces} قطعة`),
      };
    },
  },

  new_students: {
    desc: 'عدد الطلاب الجدد المسجّلين خلال فترة',
    params: ['days'],
    run: async ({ days }) => {
      const d = clampDays(days);
      const { rows } = await query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE wholesaler_id IS NOT NULL)::int AS via_rep,
                COUNT(*) FILTER (WHERE wholesaler_id IS NULL)::int     AS retail
           FROM students
          WHERE created_at > NOW() - INTERVAL '${d} days'`
      );
      const r = rows[0];
      return {
        label: `الطلاب الجدد — آخر ${d} يوم`,
        facts: [`الإجمالي: ${r.total}`, `عن طريق ممثل: ${r.via_rep}`, `تجزئة: ${r.retail}`],
      };
    },
  },

  top_products: {
    desc: 'المنتجات الأكثر مبيعاً خلال فترة',
    params: ['days', 'limit'],
    run: async ({ days, limit }) => {
      const d = clampDays(days);
      const n = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 20);
      const { rows } = await query(
        `SELECT p.name_ar AS name,
                COUNT(*)::int                     AS pieces,
                COALESCE(SUM(o.price), 0)::bigint AS revenue
           FROM orders o
           JOIN products p ON p.id = o.product_id
          WHERE ${billableOrderSql('o')}
            AND o.created_at > NOW() - INTERVAL '${d} days'
          GROUP BY p.name_ar
          ORDER BY pieces DESC
          LIMIT $1`,
        [n]
      );
      if (!rows.length) return { label: `آخر ${d} يوم`, facts: ['ماكو مبيعات بهذي الفترة'] };
      return {
        label: `المنتجات الأكثر مبيعاً — آخر ${d} يوم`,
        facts: rows.map((r, i) => `${i + 1}. ${r.name} — ${r.pieces} قطعة، ${fmtIQD(r.revenue)}`),
      };
    },
  },

  pending_approvals: {
    desc: 'الطلبات والطلاب المنتظرين موافقة ممثل الجامعة',
    params: [],
    run: async () => {
      const { rows } = await query(
        `SELECT
           (SELECT COUNT(*)::int FROM students WHERE status = 'pending_approval')             AS students_pending,
           (SELECT COUNT(DISTINCT ${bundleKey('o')})::int FROM orders o
             WHERE o.wholesaler_approval = 'pending' AND ${liveSql('o')})                     AS orders_pending`
      );
      const r = rows[0];
      return {
        label: 'بانتظار الموافقة',
        facts: [`طلاب بانتظار موافقة الممثل: ${r.students_pending}`, `طلبات بانتظار الموافقة: ${r.orders_pending}`],
      };
    },
  },

  deadlines: {
    desc: 'مواعيد إغلاق الطلبات لكل ممثل جامعة',
    params: [],
    run: async () => {
      const { rows } = await query(
        `SELECT u.name AS rep_name, w.deadline
           FROM wholesalers w
           JOIN users u ON u.id = w.user_id
          WHERE w.deadline IS NOT NULL
          ORDER BY w.deadline ASC
          LIMIT 15`
      );
      if (!rows.length) return { label: 'المواعيد', facts: ['ماكو مواعيد محددة لأي ممثل'] };
      return {
        label: 'آخر موعد لتقديم الطلبات لكل ممثل',
        facts: rows.map((r) => `${r.rep_name}: ${new Date(r.deadline).toISOString().slice(0, 10)}`),
      };
    },
  },

  ai_spend: {
    desc: 'كلفة المساعد الذكي (استهلاك الذكاء الاصطناعي) خلال فترة',
    params: ['days'],
    run: async ({ days }) => {
      const d = clampDays(days);
      const { rows } = await query(
        `SELECT COUNT(*)::int AS calls,
                COALESCE(SUM(cost_usd), 0)::numeric(12,6) AS cost,
                COUNT(*) FILTER (WHERE error IS NOT NULL)::int AS failures
           FROM ai_chat_messages
          WHERE created_at > NOW() - INTERVAL '${d} days'`
      );
      const r = rows[0];
      return {
        label: `كلفة المساعد — آخر ${d} يوم`,
        facts: [`عدد الأسئلة: ${r.calls}`, `الكلفة: $${Number(r.cost).toFixed(4)}`, `أخطاء: ${r.failures}`],
      };
    },
  },
  // ══════════════════════════════════════════════════════════════════════════════════════════
  // STAFF & ATTENDANCE — added 2026-08-21 for the admin console. The owner's standing question
  // is «هل الموظفين يشتغلون». Four independent signals answer it and the report keeps them
  // SEPARATE on purpose (lib/staffPresence.js explains why folding them loses the useful row).
  // ══════════════════════════════════════════════════════════════════════════════════════════

  staff_today: {
    desc: 'حالة الموظفين اليوم: منو فتح التطبيق، منو بصم، منو غايب، وشكد اشتغلوا',
    params: [],
    run: async () => {
      const rep = await presence.dailyReport();
      const t = rep.totals;
      const facts = [
        `عدد الموظفين: ${t.staff}`,
        `فتحوا التطبيق اليوم: ${t.opened}`,
        `ما فتحوا التطبيق: ${t.not_opened}`,
        `بصموا حضور: ${t.checked_in}`,
        `غايبين (بدون بصمة): ${t.absent}`,
        `لا زالوا بالدوام: ${t.still_in}`,
        `مجموع ساعات العمل المنجزة: ${fmtHours(t.worked_minutes)}`,
        `حركات إنتاج اليوم: ${t.production_actions}`,
      ];
      if (t.not_required > 0) facts.push(`معفيين من البصمة: ${t.not_required}`);
      return { label: `حالة الموظفين — ${rep.date}`, facts };
    },
  },

  staff_not_opened: {
    desc: 'الموظفون اللي ما فتحوا التطبيق اليوم بالاسم',
    params: [],
    run: async () => {
      const rep = await presence.dailyReport();
      const idle = rep.rows.filter((r) => !r.opened);
      if (!idle.length) {
        return { label: `${rep.date}`, facts: ['كل الموظفين فتحوا التطبيق اليوم'] };
      }
      return {
        label: `ما فتحوا التطبيق — ${rep.date}`,
        // Naming whether they stamped beside each name is the whole value: "no app, no بصمة"
        // is a different situation from "stamped in but never opened the app", and the owner
        // acts differently on each.
        facts: idle.map((r) => `${r.name}${r.check_in_at ? ' (بصم حضور بس ما فتح التطبيق)' : ' (ولا بصم)'}`),
      };
    },
  },

  staff_worked_ranking: {
    desc: 'ترتيب الموظفين حسب ساعات العمل خلال فترة (params: days, limit)',
    params: ['days', 'limit'],
    run: async ({ days, limit }) => {
      const d = clampDays(days);
      const n = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 30);
      const { rows } = await query(
        `SELECT u.name,
                COUNT(r.id) FILTER (WHERE r.check_in_at IS NOT NULL)::int AS days_present,
                COALESCE(SUM(
                  GREATEST(0,
                    EXTRACT(EPOCH FROM (r.check_out_at - r.check_in_at)) / 60
                    - COALESCE((SELECT SUM(b.minutes) FROM staff_attendance_breaks b
                                 WHERE b.attendance_id = r.id AND b.state = 'returned'), 0)
                  )
                ), 0)::int AS minutes
           FROM users u
           LEFT JOIN staff_attendance_records r
                  ON r.user_id = u.id
                 AND r.work_date > (CURRENT_DATE - $1::int)
                 AND r.check_out_at IS NOT NULL
          WHERE u.role = 'staff' AND u.deleted_at IS NULL
          GROUP BY u.id, u.name
          ORDER BY minutes DESC
          LIMIT $2`,
        [d, n]
      );
      if (!rows.length) return { label: `آخر ${d} يوم`, facts: ['ماكو موظفين'] };
      return {
        label: `ساعات العمل — آخر ${d} يوم`,
        facts: rows.map(
          (r, i) => `${i + 1}. ${r.name} — ${fmtHours(r.minutes)} خلال ${r.days_present} يوم دوام`
        ),
      };
    },
  },

  staff_app_usage: {
    desc: 'كم مرة فتح الموظفون التطبيق خلال فترة (params: days)',
    params: ['days'],
    run: async ({ days }) => {
      const d = clampDays(days);
      const { rows } = await query(
        `SELECT u.name,
                COALESCE(SUM(o.opens), 0)::int          AS opens,
                COUNT(o.work_date)::int                 AS days_opened,
                MAX(o.last_seen_at)                     AS last_seen
           FROM users u
           LEFT JOIN staff_app_opens o
                  ON o.user_id = u.id AND o.work_date > (CURRENT_DATE - $1::int)
          WHERE u.role = 'staff' AND u.deleted_at IS NULL
          GROUP BY u.id, u.name
          ORDER BY opens DESC`,
        [d]
      );
      return {
        label: `فتح التطبيق — آخر ${d} يوم`,
        facts: rows.map(
          (r) =>
            `${r.name}: ${r.opens} مرة خلال ${r.days_opened} يوم` +
            `${r.last_seen ? `، آخر مرة ${new Date(r.last_seen).toISOString().slice(0, 10)}` : '، ولا مرة'}`
        ),
      };
    },
  },

  breaks_pending: {
    desc: 'طلبات الخروج المؤقت المنتظرة قرار',
    params: [],
    run: async () => {
      const { rows } = await query(
        `SELECT u.name, b.reason_ar, b.requested_minutes, b.requested_at, b.left_without_approval
           FROM staff_attendance_breaks b
           JOIN users u ON u.id = b.user_id
          WHERE b.approval = 'pending' AND b.state <> 'cancelled'
          ORDER BY b.requested_at DESC
          LIMIT 20`
      );
      if (!rows.length) return { label: 'الخروج المؤقت', facts: ['ماكو طلبات خروج معلّقة'] };
      return {
        label: 'طلبات خروج مؤقت بانتظار قرارك',
        facts: rows.map(
          (r) =>
            `${r.name}${r.requested_minutes ? ` — ${r.requested_minutes} دقيقة` : ''}` +
            `${r.reason_ar ? ` (${r.reason_ar})` : ''}` +
            `${r.left_without_approval ? ' ⚠️ طلع بدون موافقة' : ''}`
        ),
      };
    },
  },

  salary_summary: {
    desc: 'ملخص الرواتب والمكافآت والخصومات للموظفين خلال فترة (params: days)',
    params: ['days'],
    run: async ({ days }) => {
      const d = clampDays(days);
      const { rows } = await query(
        `SELECT type, COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::bigint AS total
           FROM staff_salary_transactions
          WHERE created_at > NOW() - INTERVAL '${d} days' AND deleted_at IS NULL
          GROUP BY type
          ORDER BY total DESC`
      );
      if (!rows.length) return { label: `آخر ${d} يوم`, facts: ['ماكو حركات رواتب بهذي الفترة'] };
      const AR = { salary: 'راتب', bonus: 'مكافأة', deduction: 'خصم', advance: 'سلفة', payout: 'تحويل' };
      return {
        label: `حركات الرواتب — آخر ${d} يوم`,
        facts: rows.map((r) => `${AR[r.type] || r.type}: ${r.n} حركة، ${fmtIQD(r.total)}`),
      };
    },
  },

  workshop_production: {
    desc: 'إنتاج الورشة (القطع المنجزة وأجورها) خلال فترة (params: days)',
    params: ['days'],
    run: async ({ days }) => {
      const d = clampDays(days);
      const { rows } = await query(
        `SELECT COUNT(*)::int AS entries,
                COALESCE(SUM(qty), 0)::int AS pieces,
                COALESCE(SUM(amount), 0)::bigint AS wages
           FROM workshop_production_entries
          WHERE work_date > (CURRENT_DATE - $1::int)`,
        [d]
      );
      const r = rows[0];
      return {
        label: `إنتاج الورشة — آخر ${d} يوم`,
        facts: [`عدد الحركات: ${r.entries}`, `القطع المنجزة: ${r.pieces}`, `أجور القطع: ${fmtIQD(r.wages)}`],
      };
    },
  },

  workshop_top_workers: {
    desc: 'أفضل عمال الورشة إنتاجاً خلال فترة (params: days, limit)',
    params: ['days', 'limit'],
    run: async ({ days, limit }) => {
      const d = clampDays(days);
      const n = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 20);
      const { rows } = await query(
        `SELECT u.name,
                COALESCE(SUM(e.qty), 0)::int    AS pieces,
                COALESCE(SUM(e.amount), 0)::bigint AS wages
           FROM workshop_production_entries e
           JOIN workshop_workers w ON w.id = e.worker_id
           JOIN users u ON u.id = w.user_id
          WHERE e.work_date > (CURRENT_DATE - $1::int)
          GROUP BY u.id, u.name
          ORDER BY pieces DESC
          LIMIT $2`,
        [d, n]
      );
      if (!rows.length) return { label: `آخر ${d} يوم`, facts: ['ماكو إنتاج ورشة بهذي الفترة'] };
      return {
        label: `أفضل عمال الورشة — آخر ${d} يوم`,
        facts: rows.map((r, i) => `${i + 1}. ${r.name} — ${r.pieces} قطعة، ${fmtIQD(r.wages)}`),
      };
    },
  },

  calligraphy_spend: {
    desc: 'كلفة مولّد الخط العربي بالدولار خلال فترة (params: days)',
    params: ['days'],
    run: async ({ days }) => {
      const d = clampDays(days);
      const { rows } = await query(
        `SELECT COUNT(*)::int AS calls,
                COALESCE(SUM(cost_usd), 0)::numeric(12,6) AS cost
           FROM calligraphy_spend_log
          WHERE created_at > NOW() - INTERVAL '${d} days'`
      );
      const r = rows[0];
      return {
        label: `كلفة مولّد الخط — آخر ${d} يوم`,
        facts: [`عدد التوليدات: ${r.calls}`, `الكلفة: $${Number(r.cost).toFixed(4)}`],
      };
    },
  },

  calligraphy_jobs: {
    desc: 'حالة لوحات الخط العربي (منجزة، معلّقة، فاشلة)',
    params: [],
    run: async () => {
      const { rows } = await query(
        `SELECT status::text AS status, COUNT(*)::int AS n
           FROM calligraphy_plates
          GROUP BY status
          ORDER BY n DESC`
      );
      const AR = { done: 'منجزة', pending: 'معلّقة', failed: 'فاشلة' };
      if (!rows.length) return { label: 'لوحات الخط', facts: ['ماكو لوحات'] };
      return {
        label: 'لوحات الخط العربي',
        facts: rows.map((r) => `${AR[r.status] || r.status}: ${r.n} لوحة`),
      };
    },
  },

  visitors: {
    desc: 'عدد زوار الموقع (جلسات مختلفة) خلال فترة (params: days)',
    params: ['days'],
    run: async ({ days }) => {
      const d = clampDays(days);
      const { rows } = await query(
        `SELECT COUNT(DISTINCT session_id)::int AS sessions,
                COUNT(*)::int AS pings,
                COUNT(DISTINCT session_id) FILTER (
                  WHERE created_at > NOW() - INTERVAL '30 minutes')::int AS live
           FROM site_visits
          WHERE created_at > NOW() - INTERVAL '${d} days'`
      );
      const r = rows[0];
      return {
        label: `الزوار — آخر ${d} يوم`,
        facts: [`جلسات مختلفة: ${r.sessions}`, `زيارات الآن (آخر ٣٠ دقيقة): ${r.live}`],
      };
    },
  },

  orders_stalled: {
    desc: 'القطع اللي واقفة بنفس المرحلة من مدة طويلة (params: days)',
    params: ['days'],
    run: async ({ days }) => {
      const d = Math.min(Math.max(parseInt(days, 10) || 7, 1), 120);
      const { rows } = await query(
        `SELECT o.status, COUNT(*)::int AS pieces,
                MIN(o.updated_at) AS oldest
           FROM orders o
          WHERE ${liveSql('o')}
            AND o.status NOT IN ('ready', 'delivered')
            AND o.updated_at < NOW() - INTERVAL '${d} days'
          GROUP BY o.status
          ORDER BY pieces DESC`
      );
      const { STATUS_AR } = require('./supportContext');
      if (!rows.length) return { label: `أكثر من ${d} يوم`, facts: ['ماكو قطع واقفة بهذي المدة'] };
      return {
        label: `قطع ما تحركت من أكثر من ${d} يوم`,
        facts: rows.map(
          (r) => `${STATUS_AR[r.status] || r.status}: ${r.pieces} قطعة، أقدمها من ${new Date(r.oldest).toISOString().slice(0, 10)}`
        ),
      };
    },
  },

  deadlines_near: {
    desc: 'الممثلون اللي موعدهم النهائي قرب أو فات (params: days)',
    params: ['days'],
    run: async ({ days }) => {
      const d = Math.min(Math.max(parseInt(days, 10) || 14, 1), 180);
      const { rows } = await query(
        `SELECT u.name AS rep_name, w.university_name, w.deadline,
                (w.deadline::date - CURRENT_DATE) AS days_left
           FROM wholesalers w
           JOIN users u ON u.id = w.user_id
          WHERE w.deadline IS NOT NULL
            AND w.deadline < NOW() + INTERVAL '${d} days'
          ORDER BY w.deadline ASC
          LIMIT 20`
      );
      if (!rows.length) return { label: `خلال ${d} يوم`, facts: ['ماكو مواعيد قريبة'] };
      return {
        label: `مواعيد تنتهي خلال ${d} يوم`,
        facts: rows.map((r) => {
          const left = Number(r.days_left);
          const when = left < 0 ? `فات من ${Math.abs(left)} يوم` : left === 0 ? 'ينتهي اليوم' : `باقي ${left} يوم`;
          return `${r.university_name || r.rep_name}: ${when}`;
        }),
      };
    },
  },

  retail_vs_rep: {
    desc: 'مقارنة مبيعات التجزئة مقابل مبيعات الممثلين خلال فترة (params: days)',
    params: ['days'],
    run: async ({ days }) => {
      const d = clampDays(days);
      const m = await settledMoney({ where: `o.created_at > NOW() - INTERVAL '${d} days'` });
      return {
        label: `التجزئة مقابل الممثلين — آخر ${d} يوم`,
        facts: [
          `مبيعات التجزئة: ${fmtIQD(m.retail_revenue)}`,
          `حصة الإدارة من طلبات الممثلين: ${fmtIQD(m.rep_admin_share)}`,
          `دخل المحل الكلي: ${fmtIQD(m.shop_income)}`,
          `ربح الممثلين (يبقى عندهم): ${fmtIQD(m.rep_margin)}`,
        ],
      };
    },
  },
};

const catalogForPrompt = () =>
  Object.entries(METRICS)
    .map(([key, m]) => `- ${key}: ${m.desc}${m.params.length ? ` (وسائط: ${m.params.join(', ')})` : ''}`)
    .join('\n');

async function run(key, params) {
  const metric = METRICS[key];
  if (!metric) return null;
  return metric.run(params || {});
}

module.exports = {
  METRICS,
  catalogForPrompt,
  run,
  // Pure, for test/aiChat.test.js — clampDays is the ONLY thing standing between a model's
  // `days` output and an interpolated SQL interval, so it is tested directly.
  _internals: { clampDays },
};
