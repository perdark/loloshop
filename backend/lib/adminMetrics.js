// backend/lib/adminMetrics.js — the CLOSED set of questions the analytics assistant can answer.
//
// SECURITY MODEL: the model never writes SQL and never sees the database. It picks one `key`
// from the list below plus a couple of scalar parameters; this file owns every query, all
// parameterised. The blast radius of a bad model output is "wrong metric chosen", never
// "arbitrary read" — which matters because this DB has no RLS and Postgres access is the
// whole shop. Adding a metric is a deliberate code change, reviewed like any other.
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

const fmtIQD = (n) => `${Number(n || 0).toLocaleString('en-US')} دينار`;

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
