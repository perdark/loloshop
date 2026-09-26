// backend/lib/trueProfit.js — «الربح الحقيقي»: shop income minus EVERYTHING it cost.
//
// Before 2026-09-26 no screen subtracted anything from دخل المحل. The inputs existed in five
// separate places and were never put in one sentence; this file is that sentence:
//
//   net = shop income                               (counts.js — the ONE definition)
//       − materials       (product_cost_lines × cost_items, per billable piece)
//       − workshop wages  (workshop_production_entries + workshop_adjustments — ACTUAL)
//       − salaries        (payroll statement → base salary → estimate, per person-month)
//       − fixed monthly   (shop_expenses kind=monthly)
//       − one-off         (shop_expenses kind=one_off)
//       − losses          (shop_expenses kind=loss + materials of cancelled-after-work pieces)
//       − AI              (calligraphy_spend_log + ai_chat_messages, USD × usd_iqd)
//
// ⚠️ INCOME COMES FROM counts.js, NEVER A NEW EXPRESSION. `shopIncomeExpr` + `billableOrderSql`
// are what /admin prints as دخل المحل; a second definition here is how the dashboard and this
// page would disagree by a few pending bundles — the exact failure counts.js exists to prevent.
// The rep margin is reported beside it for context and is never added or subtracted.
//
// ⚠️ RECIPES ARE MATERIALS ONLY. Sewing is paid from the workshop log and staff from payroll.
// A recipe line for labour counts that labour twice. The /admin/costs copy says so.
//
// Months are SHOP months (Asia/Baghdad), like every other date on the admin screens. The
// current month is PARTIAL: time-based costs (monthly expenses, base salaries) are pro-rated to
// the days elapsed, so a half-month of income is never compared with a whole month of rent.

const { query } = require('./db');
const { billableOrderSql, repRowSql, shopIncomeExpr, repMarginExpr, bundleKey } = require('./counts');
const { localParts } = require('./shopTime');

const TZ = 'Asia/Baghdad';
const FIRST_MONTH = '2026-06';
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DEFAULT_SETTINGS = { usd_iqd: 1450, unsalaried_day_rate: 16600 };

const monthOf = (col) => `to_char(${col} AT TIME ZONE '${TZ}', 'YYYY-MM')`;

function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthList(from, to) {
  const out = [];
  for (let k = from; k <= to; k = addMonths(k, 1)) out.push(k);
  return out;
}

/** {current:'YYYY-MM', fraction} — how much of the current shop month has elapsed (today counts). */
function currentMonth(now = new Date()) {
  const { date } = localParts(now, TZ);
  const [y, m, d] = date.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { current: `${y}-${String(m).padStart(2, '0')}`, fraction: d / days };
}

/** Validate + clamp a requested range. Throws a 400-shaped error on garbage. */
function resolveRange(from, to, now = new Date()) {
  const { current } = currentMonth(now);
  const f = from || addMonths(current, -2);
  const t = to || current;
  if (!MONTH_RE.test(f) || !MONTH_RE.test(t)) {
    const e = new Error('صيغة الشهر لازم تكون YYYY-MM');
    e.status = 400; e.code = 'ERR_BAD_MONTH';
    throw e;
  }
  const lo = f < FIRST_MONTH ? FIRST_MONTH : f;
  const hi = t > current ? current : t;
  if (lo > hi) {
    const e = new Error('بداية الفترة بعد نهايتها');
    e.status = 400; e.code = 'ERR_BAD_RANGE';
    throw e;
  }
  return { from: lo, to: hi };
}

async function loadSettings() {
  const r = await query(`SELECT value FROM site_settings WHERE key = 'cost_settings'`);
  const v = r.rows[0]?.value || {};
  return {
    usd_iqd: Number(v.usd_iqd) > 0 ? Number(v.usd_iqd) : DEFAULT_SETTINGS.usd_iqd,
    unsalaried_day_rate: Number(v.unsalaried_day_rate) >= 0 && v.unsalaried_day_rate != null
      ? Number(v.unsalaried_day_rate) : DEFAULT_SETTINGS.unsalaried_day_rate,
  };
}

// The per-piece material cost of order row `o` (product `p`), as a correlated SQL expression.
// Type-wide lines + extras for this product or its parent, filtered by audience.
const pieceMaterialSql = (o = 'o', p = 'p') => `(
  SELECT COALESCE(SUM(l.qty * ci.unit_cost), 0)
    FROM product_cost_lines l JOIN cost_items ci ON ci.id = l.cost_item_id
   WHERE l.product_type = ${p}.type::text
     AND (l.product_id IS NULL OR l.product_id = ${o}.product_id OR l.product_id = ${p}.parent_id)
     AND (l.audience = 'all'
          OR (l.audience = 'rep'    AND ${repRowSql(o)})
          OR (l.audience = 'retail' AND NOT (${repRowSql(o)})))
)`;

const zeroCosts = () => ({
  materials: 0, workshop_wages: 0, salaries: 0, fixed_expenses: 0,
  one_off_expenses: 0, losses: 0, ai: 0,
});
const zeroIncome = () => ({ shop_income: 0, rep_admin_share: 0, retail_revenue: 0, rep_margin: 0, pieces: 0 });

function finish(row) {
  const total = Object.values(row.costs).reduce((a, b) => a + b, 0);
  row.total_costs = Math.round(total);
  for (const k of Object.keys(row.costs)) row.costs[k] = Math.round(row.costs[k]);
  row.net = Math.round(row.income.shop_income - total);
  row.margin_pct = row.income.shop_income > 0
    ? Math.round((row.net / row.income.shop_income) * 1000) / 10
    : null;
  return row;
}

async function computePnl({ from, to, now = new Date() } = {}) {
  const range = resolveRange(from, to, now);
  const { current, fraction } = currentMonth(now);
  const months = monthList(range.from, range.to);
  const frac = (m) => (m === current ? fraction : 1);
  const settings = await loadSettings();
  const params = [range.from, range.to];
  const inRange = (col) => `${monthOf(col)} BETWEEN $1 AND $2`;

  const [pieces, lostPieces, workshop, salaryRows, expenses, ai, conf, typesWithoutRecipe] =
    await Promise.all([
      // 1+2. Income and materials, per month × product. Income via counts.js.
      query(
        // A rep set is ONE sale whose whole حصة الإدارة sits on the sash row — the robe and cap
        // rows carry ~2,000 IQD. Per product they would read as a robe that loses 11,000 a
        // piece. So rep rows are one pseudo-product, «طقم عن طريق ممثل», counted in SETS.
        // A retail PACKAGE (باقة VIP) has the same shape — 340,000 on the sash, ~0 on the rest.
        `SELECT ${monthOf('o.created_at')} AS month,
                CASE WHEN ${repRowSql('o')} THEN 'rep_set'
                     WHEN o.package_id IS NOT NULL THEN 'package'
                     ELSE o.product_id::text END AS product_id,
                CASE WHEN ${repRowSql('o')} THEN 'طقم عن طريق ممثل (كل القطع)'
                     WHEN o.package_id IS NOT NULL THEN 'باقات التجزئة (كل القطع)'
                     ELSE p.name_ar END AS name_ar,
                CASE WHEN ${repRowSql('o')} OR o.package_id IS NOT NULL THEN 'sash' ELSE p.type::text END AS type,
                COUNT(*)::int AS pieces,
                COUNT(DISTINCT ${bundleKey('o')})::int AS sets,
                ${shopIncomeExpr('o')} AS shop_income,
                COALESCE(SUM(COALESCE(o.cost,0)) FILTER (WHERE ${repRowSql('o')}), 0)::bigint AS rep_admin_share,
                COALESCE(SUM(o.price) FILTER (WHERE NOT (${repRowSql('o')})), 0)::bigint AS retail_revenue,
                ${repMarginExpr('o')} AS rep_margin,
                COALESCE(SUM(${pieceMaterialSql('o', 'p')}), 0)::numeric AS materials,
                COUNT(*) FILTER (WHERE p.type IN ('robe','cap'))::int AS sewn_pieces
           FROM orders o JOIN products p ON p.id = o.product_id
          WHERE ${billableOrderSql('o')} AND ${inRange('o.created_at')}
          GROUP BY 1, 2, 3, 4`,
        params
      ),
      // 6b. Cancelled after somebody already worked on it → its materials are a loss.
      query(
        `SELECT ${monthOf('o.created_at')} AS month, COUNT(*)::int AS pieces,
                COALESCE(SUM(${pieceMaterialSql('o', 'p')}), 0)::numeric AS materials
           FROM orders o JOIN products p ON p.id = o.product_id
          WHERE o.status = 'cancelled' AND ${inRange('o.created_at')}
            AND EXISTS (SELECT 1 FROM staff_activity_log a WHERE a.order_id = o.id)
          GROUP BY 1`,
        params
      ),
      // 3. Workshop piece wages — what was actually logged, by work date.
      query(
        `SELECT month, worker_id, name, SUM(amount)::bigint AS amount, SUM(qty)::int AS qty FROM (
           SELECT to_char(e.work_date, 'YYYY-MM') AS month, e.worker_id, e.amount,
                  CASE WHEN e.operation IN ('robe_sew','cap_sew') THEN e.qty ELSE 0 END AS qty
             FROM workshop_production_entries e
           UNION ALL
           SELECT to_char(a.entry_date, 'YYYY-MM'), a.worker_id,
                  CASE a.kind WHEN 'bonus' THEN a.amount ELSE -a.amount END, 0
             FROM workshop_adjustments a
         ) x JOIN workshop_workers w ON w.id = x.worker_id JOIN users u ON u.id = w.user_id
         WHERE month BETWEEN $1 AND $2
         GROUP BY 1, 2, 3`,
        params
      ),
      // 4. Salaries — one row per staff person × month with every signal we have.
      query(
        `WITH m AS (
           SELECT to_char(g, 'YYYY-MM') AS month
             FROM generate_series(to_date($1,'YYYY-MM'), to_date($2,'YYYY-MM'), interval '1 month') g
         ),
         first_att AS (SELECT to_char(MIN(work_date), 'YYYY-MM') AS k FROM staff_attendance_records)
         SELECT m.month, u.id AS user_id, u.name,
                st.net AS statement_net,
                COALESCE(ss.base_salary, 0)::bigint AS base_salary,
                (SELECT COUNT(DISTINCT r.work_date)::int FROM staff_attendance_records r
                  WHERE r.user_id = u.id AND to_char(r.work_date,'YYYY-MM') = m.month) AS days,
                (m.month < (SELECT k FROM first_att)) AS before_attendance,
                (SELECT COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'bonus'), 0)::bigint
                   FROM staff_salary_transactions t
                  WHERE t.user_id = u.id AND t.deleted_at IS NULL
                    AND ${monthOf('t.created_at')} = m.month) AS bonuses,
                (SELECT COALESCE(SUM(CASE t.type WHEN 'bonus' THEN t.amount WHEN 'deduction' THEN -t.amount ELSE 0 END), 0)::bigint
                   FROM staff_salary_transactions t
                  WHERE t.user_id = u.id AND t.deleted_at IS NULL AND t.source_type <> 'attendance'
                    AND ${monthOf('t.created_at')} = m.month) AS adjustments
           FROM m CROSS JOIN users u
           LEFT JOIN staff_salaries ss ON ss.user_id = u.id
           LEFT JOIN staff_payroll_statements st ON st.user_id = u.id AND st.month_key = m.month
          WHERE u.role = 'staff'
            -- Someone on the workshop roster is paid by the piece ONLY (payoutMath.mergeRecipients);
            -- counting a salary for them too would pay the same person twice.
            AND NOT EXISTS (SELECT 1 FROM workshop_workers w WHERE w.user_id = u.id)`,
        params
      ),
      query(`SELECT kind, name_ar, amount::bigint AS amount,
                    to_char(starts_on,'YYYY-MM') AS start_m,
                    to_char(ends_on,'YYYY-MM') AS end_m
               FROM shop_expenses`),
      query(
        `SELECT month, SUM(usd)::float AS usd FROM (
           SELECT ${monthOf('created_at')} AS month, cost_usd AS usd FROM calligraphy_spend_log
           UNION ALL
           SELECT ${monthOf('created_at')}, cost_usd FROM ai_chat_messages
         ) x WHERE month BETWEEN $1 AND $2 GROUP BY 1`,
        params
      ),
      query(`SELECT (SELECT COUNT(*) FROM cost_items)::int AS items_total,
                    (SELECT COUNT(*) FROM cost_items WHERE confirmed)::int AS items_confirmed,
                    (SELECT COUNT(*) FROM shop_expenses)::int AS expenses_total,
                    (SELECT COUNT(*) FROM shop_expenses WHERE confirmed)::int AS expenses_confirmed`),
      query(`SELECT t FROM unnest(ARRAY['sash','robe','cap','shawl']) t
              WHERE NOT EXISTS (SELECT 1 FROM product_cost_lines l WHERE l.product_type = t AND l.product_id IS NULL)`),
    ]);

  const byMonth = new Map(months.map((m) => [m, {
    month: m, partial: m === current, income: zeroIncome(), costs: zeroCosts(),
  }]));
  const perProduct = new Map();
  const sewnPieces = new Map(); // month → robes + caps sold (who sewed them?)
  const sewnLogged = new Map(); // month → robe_sew + cap_sew qty in the workshop log

  for (const r of pieces.rows) {
    const row = byMonth.get(r.month);
    if (!row) continue;
    row.income.shop_income += Number(r.shop_income);
    row.income.rep_admin_share += Number(r.rep_admin_share);
    row.income.retail_revenue += Number(r.retail_revenue);
    row.income.rep_margin += Number(r.rep_margin);
    row.income.pieces += r.pieces;
    row.costs.materials += Number(r.materials);
    sewnPieces.set(r.month, (sewnPieces.get(r.month) || 0) + r.sewn_pieces);
    const pp = perProduct.get(r.product_id) || {
      product_id: r.product_id, name_ar: r.name_ar, product_type: r.type,
      pieces: 0, shop_income: 0, material_cost: 0,
    };
    pp.pieces += (r.product_id === 'rep_set' || r.product_id === 'package') ? r.sets : r.pieces;
    pp.shop_income += Number(r.shop_income);
    pp.material_cost += Number(r.materials);
    perProduct.set(r.product_id, pp);
  }

  let lostCount = 0; let lostMaterials = 0;
  for (const r of lostPieces.rows) {
    const row = byMonth.get(r.month);
    if (!row) continue;
    row.costs.losses += Number(r.materials);
    lostCount += r.pieces; lostMaterials += Number(r.materials);
  }

  const salaryDetail = new Map(); // key → PnlSalaryRow
  const addSalary = (key, base, amount) => {
    const cur = salaryDetail.get(key) || { ...base, amount: 0 };
    cur.amount += amount;
    salaryDetail.set(key, cur);
  };

  for (const r of workshop.rows) {
    const row = byMonth.get(r.month);
    if (!row) continue;
    row.costs.workshop_wages += Number(r.amount);
    sewnLogged.set(r.month, (sewnLogged.get(r.month) || 0) + (r.qty || 0));
    addSalary(`w:${r.worker_id}`, { user_id: r.worker_id, name: r.name, source: 'workshop', note_ar: null }, Number(r.amount));
  }

  const estimated = new Set();
  for (const r of salaryRows.rows) {
    const row = byMonth.get(r.month);
    if (!row) continue;
    let amount = 0; let source = null;
    if (r.statement_net != null) {
      // A payslip's net already carries its deductions but never the goal bonuses.
      amount = Number(r.statement_net) + Number(r.bonuses); source = 'statement';
    } else if (Number(r.base_salary) > 0 && (r.days > 0 || r.before_attendance)) {
      amount = Number(r.base_salary) * frac(r.month) + Number(r.adjustments); source = 'base';
    } else if (r.days > 0) {
      amount = r.days * settings.unsalaried_day_rate + Number(r.adjustments); source = 'estimate';
      estimated.add(r.name);
    }
    if (!source) continue;
    row.costs.salaries += amount;
    // ONE row per person over the whole range (the UI keys on user_id). A person paid from
    // a payslip in August and from the base salary in September gets both named in the note.
    const key = `s:${r.user_id}`;
    const cur = salaryDetail.get(key);
    if (cur) {
      cur.sources.add(source);
      if (source === 'estimate') cur.source = 'estimate';
      cur.amount += amount;
    } else {
      salaryDetail.set(key, { user_id: r.user_id, name: r.name, source, sources: new Set([source]), amount });
    }
  }

  let manualLosses = 0;
  for (const e of expenses.rows) {
    const amt = Number(e.amount);
    if (e.kind === 'monthly') {
      for (const m of months) {
        if (m >= e.start_m && (!e.end_m || m <= e.end_m)) byMonth.get(m).costs.fixed_expenses += amt * frac(m);
      }
    } else if (byMonth.has(e.start_m)) {
      const row = byMonth.get(e.start_m);
      if (e.kind === 'loss') { row.costs.losses += amt; manualLosses += amt; }
      else row.costs.one_off_expenses += amt;
    }
  }

  let aiUsd = 0;
  for (const r of ai.rows) {
    const row = byMonth.get(r.month);
    if (!row) continue;
    row.costs.ai += r.usd * settings.usd_iqd;
    aiUsd += r.usd;
  }

  const monthRows = months.map((m) => finish(byMonth.get(m)));
  const total = { month: 'total', partial: monthRows.some((r) => r.partial), income: zeroIncome(), costs: zeroCosts() };
  for (const r of monthRows) {
    for (const k of Object.keys(total.income)) total.income[k] += r.income[k];
    for (const k of Object.keys(total.costs)) total.costs[k] += r.costs[k];
  }
  finish(total);

  const per_product = [...perProduct.values()].map((p) => ({
    ...p,
    material_cost: Math.round(p.material_cost),
    income_per_piece: p.pieces ? Math.round(p.shop_income / p.pieces) : 0,
    material_cost_per_piece: p.pieces ? Math.round(p.material_cost / p.pieces) : 0,
    contribution: Math.round(p.shop_income - p.material_cost),
  })).sort((a, b) => b.contribution - a.contribution);

  // ── Warnings: everything that makes the net LESS true than it looks ──
  const c = conf.rows[0];
  const warnings = [];
  const unconfirmed = (c.items_total - c.items_confirmed) + (c.expenses_total - c.expenses_confirmed);
  if (unconfirmed > 0) {
    warnings.push({ code: 'UNCONFIRMED', text_ar: `${unconfirmed} بند تكلفة أو مصروف بعده تقديري — أكّدها أو صحّح سعرها حتى يصير الصافي حقيقي.` });
  }
  if (estimated.size) {
    warnings.push({ code: 'STAFF_NO_SALARY', text_ar: `موظفين بدون راتب مسجل (${[...estimated].join('، ')}) — حسبناهم تقديرياً بأجر اليوم. سجّل رواتبهم من «فريق العمل».` });
  }
  // Sewing logged for fewer than half the robes + caps sold that month → its wages are
  // mostly missing. (Half, not all: pieces sold late in a month are sewn the next one.)
  const noWages = months.filter((m) => (sewnPieces.get(m) || 0) > 20 && (sewnLogged.get(m) || 0) < (sewnPieces.get(m) || 0) / 2);
  if (noWages.length) {
    const detail = noWages.map((m) => `${m}: ${sewnLogged.get(m) || 0} من ${sewnPieces.get(m)}`).join('، ');
    warnings.push({ code: 'WORKSHOP_GAP', text_ar: `أجور الخياطة ناقصة بسجل الورشة (قطع مخيّطة مسجلة من الروبات والقبعات المباعة — ${detail}). إذا انصرفت أجور بهذي الأشهر ضيفها كمصروف لمرة واحدة.` });
  }
  if (typesWithoutRecipe.rows.length) {
    const ar = { sash: 'الوشاح', robe: 'الروب', cap: 'القبعة', shawl: 'الشال' };
    warnings.push({ code: 'NO_RECIPE', text_ar: `ماكو وصفة مواد لـ ${typesWithoutRecipe.rows.map((r) => ar[r.t]).join('، ')} — تكلفتها محسوبة صفر.` });
  }
  if (months.some((m) => m < '2026-08')) {
    warnings.push({ code: 'AI_LOG_START', text_ar: 'سجل صرف الذكاء الاصطناعي يبدأ من آب ٢٠٢٦ — الأشهر قبله ما بيها هذا البند.' });
  }
  if (monthRows.some((r) => r.partial)) {
    warnings.push({ code: 'PARTIAL_MONTH', text_ar: 'الشهر الحالي لحد اليوم: الإيجار والرواتب محسوبة بنسبة الأيام اللي مضت.' });
  }

  return {
    from: range.from,
    to: range.to,
    months: monthRows,
    total,
    per_product,
    salaries_detail: [...salaryDetail.values()]
      .map(({ sources, ...s }) => {
        const AR = { statement: 'كشف راتب', base: 'راتب أساسي', estimate: 'تقديري بأجر اليوم' };
        let note = s.note_ar || null;
        if (sources && sources.has('estimate')) {
          note = `ماله راتب مسجل — أيام الدوام × ${settings.unsalaried_day_rate.toLocaleString('en-US')}`;
        } else if (sources && sources.size > 1) {
          note = [...sources].map((x) => AR[x]).join(' + ');
        }
        return { ...s, note_ar: note, amount: Math.round(s.amount) };
      })
      .sort((a, b) => b.amount - a.amount),
    losses_detail: { manual: manualLosses, cancelled_after_work: { pieces: lostCount, material_estimate: Math.round(lostMaterials) } },
    ai_usd: Math.round(aiUsd * 100) / 100,
    usd_iqd: settings.usd_iqd,
    confidence: c,
    warnings,
  };
}

module.exports = { computePnl, resolveRange, currentMonth, monthList, loadSettings, pieceMaterialSql, DEFAULT_SETTINGS };
