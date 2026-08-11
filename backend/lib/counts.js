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
};
