// ───────────────────────────────────────────────────────────────────────────
// counts.js — the ONE owner of every order-related count in the app.
//
// WHY THIS FILE EXISTS (spec: docs/superpowers/specs/2026-07-21-counts-units-design.md)
//
// An `orders` row is ONE PIECE (وشاح / قبعة / روب / شال). Pieces bought together
// share a checkout_group_id, and THAT group is what a human calls a student's
// order («طلب»). Before this file, ~15 controllers hand-wrote their own COUNT
// expression and ~25 of them disagreed with the Arabic label they were rendered
// under — the same shop read as 1727 «طلب» on one screen and 578 on another.
//
// THE THREE UNITS — never interchangeable:
//   قطعة  piece    = one `orders` row          → production, stage funnels, workload
//   طلب   bundle   = one checkout_group        → admin totals, money, rank ladder
//   طالب  student  = one student               → people counts
//
// THE STRUCTURAL RULE, measured on live data 2026-07-21:
//   Only PIECES have a stage. 76% of bundles span 2-3 statuses at once (a student's
//   وشاح can be at التطريز while his قبعة is still at بانتظار التصميم), so summing
//   per-stage bundle counts gave 1035 against a real total of 578 — a 79% overcount.
//   NEVER break bundles or students down by stage as if they summed to a total.
//   `stageFunnel` returns both columns and the caller must label the student column
//   as a membership count («طلاب لديهم قطعة هنا»), not a share.
// ───────────────────────────────────────────────────────────────────────────
const { query } = require('./db');

// A piece is finished at «جاهز». `delivered` exists in the enum but has NEVER been
// written (0 rows, 0 audit entries as of 2026-07-21) — the delivery step is not part
// of anyone's workflow, so treating it as the finish line would leave every order
// permanently "in progress". Revisit if/when the رف collect flow starts closing sets.
const FINISHED_STATUSES = ['ready', 'delivered'];

/** SQL for the bundle identity of an order row. Retail cart pieces and rep طقم
 *  pieces both carry checkout_group_id; standalone legacy rows fall back to id. */
const bundleKey = (a = 'o') => `COALESCE(${a}.checkout_group_id, ${a}.id)`;

/** ── The three canonical count expressions. Embed these in a SELECT. ── */
const piecesExpr = () => `COUNT(*)::int`;
const bundlesExpr = (a = 'o') => `COUNT(DISTINCT ${bundleKey(a)})::int`;
const studentsExpr = (a = 'o') => `COUNT(DISTINCT ${a}.student_id)::int`;

/** Live = everything except cancelled. This is the OPERATIONAL filter; money
 *  aggregates use billableOrderSql (approval-gated) below. */
const liveSql = (a = 'o') => `${a}.status <> 'cancelled'`;

/**
 * The SETTLEMENT filter — the money counterpart to liveSql.
 *
 * Money shown as revenue/cost/profit is settlement money: retail rows have NULL approval;
 * representative rows count only after approval. Pending/rejected rows stay operationally
 * visible elsewhere but never inflate settled totals.
 *
 * Lives here (moved out of adminController 2026-08-10) so the admin dashboard and the AI
 * analytics assistant compute revenue the SAME way. Two definitions of "revenue" that
 * disagree by a few pending bundles is exactly the bug that destroys trust in an assistant
 * the owner cannot audit — there must be one.
 */
function billableOrderSql(alias = 'o') {
  return `${alias}.status <> 'cancelled'
    AND (
      ${alias}.wholesaler_approval = 'approved'
      OR (${alias}.wholesaler_approval IS NULL AND EXISTS (
        SELECT 1 FROM students settled_student
        WHERE settled_student.id = ${alias}.student_id
          AND settled_student.wholesaler_id IS NULL
      ))
    )`;
}

const finishedSql = (a = 'o') =>
  `${a}.status IN (${FINISHED_STATUSES.map((s) => `'${s}'`).join(', ')})`;

/**
 * Build a reusable scope for the helpers below.
 * @param {object} f
 * @param {'all'|'retail'|'wholesaler'} [f.source] retail = students with no rep
 * @param {string} [f.wholesalerId] restrict to one rep
 * @param {string} [f.since] ISO date — orders created on/after
 * @returns {{ where: string, params: any[], joinStudents: boolean }}
 */
function buildScope(f = {}) {
  const params = [];
  const clauses = [liveSql('o')];
  let joinStudents = false;

  if (f.source === 'retail') {
    joinStudents = true;
    clauses.push('s.wholesaler_id IS NULL');
  } else if (f.source === 'wholesaler') {
    joinStudents = true;
    clauses.push('s.wholesaler_id IS NOT NULL');
  }
  if (f.wholesalerId) {
    joinStudents = true;
    params.push(f.wholesalerId);
    clauses.push(`s.wholesaler_id = $${params.length}`);
  }
  if (f.since) {
    params.push(f.since);
    clauses.push(`o.created_at >= $${params.length}`);
  }
  return { where: clauses.join(' AND '), params, joinStudents };
}

function fromSql(scope) {
  return scope.joinStudents
    ? 'FROM orders o JOIN students s ON s.id = o.student_id'
    : 'FROM orders o';
}

/** قطعة — how many physical pieces. Sums exactly across stages. */
async function countPieces(scope = buildScope()) {
  const r = await query(
    `SELECT ${piecesExpr()} AS n ${fromSql(scope)} WHERE ${scope.where}`,
    scope.params
  );
  return r.rows[0].n;
}

/** طلب — how many student orders (bundles). This is what «طلب» means in the UI. */
async function countBundles(scope = buildScope()) {
  const r = await query(
    `SELECT ${bundlesExpr('o')} AS n ${fromSql(scope)} WHERE ${scope.where}`,
    scope.params
  );
  return r.rows[0].n;
}

/** طالب — distinct people. Lower than bundles: a student can order twice. */
async function countStudents(scope = buildScope()) {
  const r = await query(
    `SELECT ${studentsExpr('o')} AS n ${fromSql(scope)} WHERE ${scope.where}`,
    scope.params
  );
  return r.rows[0].n;
}

/**
 * طلب قيد التنفيذ — bundles where AT LEAST ONE piece has not reached «جاهز».
 * A student cannot collect his طقم with the قبعة missing, so the bundle is only
 * done when every piece in it is done. HAVING bool_or(...) expresses exactly that.
 */
async function countBundlesInProgress(scope = buildScope()) {
  const r = await query(
    `SELECT COUNT(*)::int AS n FROM (
       SELECT ${bundleKey('o')} AS g
       ${fromSql(scope)}
       WHERE ${scope.where}
       GROUP BY 1
       HAVING bool_or(NOT (${finishedSql('o')}))
     ) t`,
    scope.params
  );
  return r.rows[0].n;
}

/**
 * The stage funnel — the one query that returns BOTH units per stage.
 *
 * `pieces` sums to countPieces(). `students` does NOT sum to countStudents():
 * a student with pieces in two stages is counted in both. That is a membership
 * count, and the UI must name the column so it can never be mistakenly summed.
 *
 * @returns {Promise<Array<{stage:string, pieces:number, students:number}>>}
 */
async function stageFunnel(scope = buildScope()) {
  const r = await query(
    `SELECT o.status AS stage, ${piecesExpr()} AS pieces, ${studentsExpr('o')} AS students
     ${fromSql(scope)}
     WHERE ${scope.where}
     GROUP BY o.status
     ORDER BY pieces DESC`,
    scope.params
  );
  return r.rows;
}

// ───────────────────────────────────────────────────────────────────────────
// THE MONEY VOCABULARY (2026-08-13, bug 11)
//
// Same disease as the units above, in dinars: one word, two populations.
//
// `orders.profit` is a STORED GENERATED column, `price - COALESCE(cost, 0)`. For a
// REPRESENTATIVE's order that reads:
//     price = what the student paid the REP
//     cost  = «حصة الإدارة» — the shop's cut, i.e. THE SHOP'S INCOME
//     profit = price − cost = THE REP'S MARGIN. It never reaches the shop.
// staffController.buildWholesalerAccountSummary labels this exact expression
// `representative_profit`, correctly. The admin dashboard called the same number
// «إجمالي الربح» / «صافي الربح», so the shop was reading the reps' earnings as its own
// (4,240,000 IQD of it on prod, 2026-08-13).
//
// For a RETAIL order there is no rep, so `price` is the shop's income outright — and
// `cost` is NULL on every retail row ever written, because nobody has entered a
// production cost. profit therefore collapses to `price`: it is REVENUE wearing the
// word "profit". `retail_pieces_costed` exists so the UI can say that out loud instead
// of printing a profit figure that cannot be true.
//
// Hence exactly two honest aggregates, and they partition the settled set:
//     shop income  = حصة الإدارة (rep rows) + price (retail rows)
//     rep margin   = profit (rep rows) — THEIRS, reported separately and labelled so
//
// ⚠️ Do NOT redefine `orders.profit` to fix this. It is a generated column that
// wholesaler payouts, the rep account summary and the TV board all read with the
// per-row meaning above; the bug is the AGGREGATE and its LABEL, not the column.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Inside billableOrderSql the approval column is a two-valued flag: 'approved' for a
 * row that went through a rep, NULL for a direct retail row (pending/rejected never
 * get in). So these two predicates PARTITION the settled set by construction — which
 * is what lets every split below reconcile to its total instead of merely looking close.
 *
 * Deliberately keyed off `wholesaler_approval`, not `students.wholesaler_id`: deleting a
 * rep NULLs its students' `wholesaler_id` but leaves their orders 'approved', and those
 * orders were still priced with a حصة الإدارة. Keying off the student would silently
 * reclassify that money as retail revenue.
 */
const repRowSql = (a = 'o') => `${a}.wholesaler_approval IS NOT NULL`;
const retailRowSql = (a = 'o') => `${a}.wholesaler_approval IS NULL`;

/**
 * WHAT THE SHOP ACTUALLY TAKES IN — حصة الإدارة on rep rows, the full price on retail.
 *
 * `filter` is an optional extra predicate for callers whose WHERE clause is wider than the
 * settled set (the daily chart counts every live bundle but may only earn from settled ones).
 * It is spliced into the aggregate's own FILTER, which is the only place SQL accepts it —
 * a cast sits outside the aggregate, so appending `FILTER` to the finished expression is a
 * syntax error rather than a narrower sum.
 */
const shopIncomeExpr = (a = 'o', filter = null) =>
  `COALESCE(SUM(CASE WHEN ${repRowSql(a)} THEN COALESCE(${a}.cost, 0) ELSE ${a}.price END)` +
  `${filter ? ` FILTER (WHERE ${filter})` : ''}, 0)::bigint`;

/** WHAT THE REPS TAKE — their margin. Never the shop's, never added to shop income. */
const repMarginExpr = (a = 'o', filter = null) =>
  `COALESCE(SUM(${a}.profit) FILTER (WHERE ${repRowSql(a)}${filter ? ` AND ${filter}` : ''}), 0)::bigint`;

/**
 * The settled money split for one optional extra filter (e.g. a date window).
 * Every field is derived from the same rows, so the reconciliation the dashboard
 * prints — `shop_income = rep_admin_share + retail_revenue` — is an identity, not a
 * hope. `gross_collected` is the OLD «إجمالي الإيرادات»: it is money students paid
 * *somebody*, and it is kept only so the UI can show how much of it was never the shop's.
 */
async function settledMoney({ where = null, params = [] } = {}) {
  const extra = where ? ` AND ${where}` : '';
  const r = await query(
    `SELECT
       ${shopIncomeExpr('o')} AS shop_income,
       ${repMarginExpr('o')}  AS rep_margin,
       COALESCE(SUM(COALESCE(o.cost, 0)) FILTER (WHERE ${repRowSql('o')}), 0)::bigint AS rep_admin_share,
       COALESCE(SUM(o.price)             FILTER (WHERE ${repRowSql('o')}), 0)::bigint AS rep_gross,
       COALESCE(SUM(o.price)             FILTER (WHERE ${retailRowSql('o')}), 0)::bigint AS retail_revenue,
       COALESCE(SUM(o.cost)              FILTER (WHERE ${retailRowSql('o')}), 0)::bigint AS retail_cost,
       COALESCE(SUM(o.price), 0)::bigint AS gross_collected,
       COUNT(*) FILTER (WHERE ${retailRowSql('o')})::int AS retail_pieces,
       COUNT(*) FILTER (WHERE ${retailRowSql('o')} AND o.cost IS NOT NULL)::int AS retail_pieces_costed,
       ${bundlesExpr('o')} AS orders
     FROM orders o
     WHERE ${billableOrderSql('o')}${extra}`,
    params
  );
  return r.rows[0];
}

// ───────────────────────────────────────────────────────────────────────────
// WORKABLE vs BLOCKED (2026-08-13, bug 9)
//
// A stage total answers «how many pieces are sitting here», which is not the question
// the owner is asking when they read it — they are asking «how much work is waiting».
// The staff queue (productionController.getQueue) answers the second one, and drops two
// populations the admin total keeps: rep orders nobody approved yet, and orders returned
// to the student to edit. On prod 2026-08-13 that was admin 1,162 vs designer 797 at
// «بانتظار التصميم» — a 365-piece gap that read as a broken screen.
//
// ⚠️ The staff screens are CORRECT. These predicates MIRROR getQueue's two gates and must
// keep mirroring them; if that query's gates ever change, change these in the same commit.
// (The third gate there — `users.order_scope` — is per-account and has no meaning for an
// admin total, so it is deliberately absent.)
// ───────────────────────────────────────────────────────────────────────────

/** Rep orders still waiting on their rep's verdict. Invisible to every station. */
const awaitingRepSql = (o = 'o', s = 's') =>
  `NOT (${s}.wholesaler_id IS NULL OR ${o}.wholesaler_approval = 'approved')`;

/** «إرجاع للطالب» — out of production until the student resubmits. */
const returnedSql = (o = 'o') => `${o}.returned_to_customer = TRUE`;

/** What a station can actually pick up: approved (or retail) AND not returned. */
const workableSql = (o = 'o', s = 's') =>
  `NOT ${awaitingRepSql(o, s)} AND NOT ${returnedSql(o)}`;

/**
 * The stage funnel, split into work a station can start and work that is blocked.
 *
 * `workable + awaiting_rep + returned = pieces` EXACTLY: the three buckets are written as
 * mutually exclusive predicates (a returned row that is also unapproved counts once, under
 * `awaiting_rep`, because it is blocked on the rep first). The dashboard reconciles against
 * that identity, so a future edit that breaks it fails the test rather than the owner's trust.
 *
 * Scope note: `buildScope` may already JOIN students; this query always does, because the
 * approval gate needs `s.wholesaler_id`.
 */
async function stageFunnelSplit(scope = buildScope()) {
  const r = await query(
    `SELECT o.status AS stage,
            ${piecesExpr()} AS pieces,
            ${studentsExpr('o')} AS students,
            COUNT(*) FILTER (WHERE ${workableSql('o', 's')})::int AS workable,
            COUNT(*) FILTER (WHERE ${awaitingRepSql('o', 's')})::int AS awaiting_rep,
            COUNT(*) FILTER (WHERE NOT ${awaitingRepSql('o', 's')} AND ${returnedSql('o')})::int AS returned
     FROM orders o JOIN students s ON s.id = o.student_id
     WHERE ${scope.where}
     GROUP BY o.status
     ORDER BY pieces DESC`,
    scope.params
  );
  return r.rows;
}

/** Every headline number for one scope in a single round trip. */
async function summary(scope = buildScope()) {
  const [pieces, bundles, students, inProgress] = await Promise.all([
    countPieces(scope),
    countBundles(scope),
    countStudents(scope),
    countBundlesInProgress(scope),
  ]);
  return { pieces, bundles, students, in_progress: inProgress };
}

module.exports = {
  FINISHED_STATUSES,
  bundleKey,
  piecesExpr,
  bundlesExpr,
  studentsExpr,
  liveSql,
  billableOrderSql,
  finishedSql,
  buildScope,
  countPieces,
  countBundles,
  countStudents,
  countBundlesInProgress,
  stageFunnel,
  summary,
  // Money vocabulary (bug 11)
  repRowSql,
  retailRowSql,
  shopIncomeExpr,
  repMarginExpr,
  settledMoney,
  // Workable vs blocked (bug 9)
  awaitingRepSql,
  returnedSql,
  workableSql,
  stageFunnelSplit,
};
