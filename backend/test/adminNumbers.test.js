// Tests for the admin dashboard's numbers — bugs 9, 10 and 11 of
// docs/superpowers/specs/2026-08-13-eleven-bugs-parallel-tracks.md.
//
// These run against the dev DB (read-only: no INSERT/UPDATE/DELETE anywhere here) and
// assert IDENTITIES rather than fixed figures, so they keep working as the shop grows.
//
// WHY IDENTITIES. Every number these tests guard was wrong for the same reason: a figure
// was computed over one population and printed under a label describing another. An
// identity is the only kind of assertion that catches that — «إجمالي الربح» looked
// perfectly plausible for months while being the representatives' earnings, and no
// range check or snapshot would ever have noticed.
const test = require('node:test');
const assert = require('node:assert');
const counts = require('../lib/counts');
const { query } = require('../lib/db');

// ── Bug 11: the money split ────────────────────────────────────────────────

test('shop income = حصة الإدارة (reps) + retail revenue', async () => {
  const m = await counts.settledMoney();
  assert.strictEqual(
    Number(m.shop_income),
    Number(m.rep_admin_share) + Number(m.retail_revenue),
    'the headline figure must equal the two figures printed beside it'
  );
});

test('shop income = everything students paid MINUS the reps’ margin', async () => {
  // The accounting receipt prints exactly this subtraction, so it must be exact.
  const m = await counts.settledMoney();
  assert.strictEqual(
    Number(m.shop_income),
    Number(m.gross_collected) - Number(m.rep_margin),
    'the receipt subtracts its way to the bottom line; the arithmetic must tie out'
  );
});

test('rep gross = حصة الإدارة + the rep margin (nothing else hides in a rep order)', async () => {
  const m = await counts.settledMoney();
  assert.strictEqual(
    Number(m.rep_gross),
    Number(m.rep_admin_share) + Number(m.rep_margin)
  );
});

test('rep + retail revenue partition every settled dinar', async () => {
  const m = await counts.settledMoney();
  assert.strictEqual(
    Number(m.gross_collected),
    Number(m.rep_gross) + Number(m.retail_revenue),
    'the rep/retail predicates must leave no settled row unclassified'
  );
});

test('THE BUG: the reps’ margin is never part of the shop’s income', async () => {
  // This is bug 11 stated as an assertion. SUM(orders.profit) — what the dashboard used
  // to print as «إجمالي الربح» — is the representatives' margin plus retail revenue. If
  // shop_income ever equals that, the two populations have been merged again.
  const m = await counts.settledMoney();
  const oldWrongProfit = Number(m.rep_margin) + Number(m.retail_revenue) - Number(m.retail_cost);
  if (Number(m.rep_margin) > 0) {
    assert.notStrictEqual(
      Number(m.shop_income),
      oldWrongProfit,
      'shop income must not be SUM(orders.profit) — that figure is mostly the reps’'
    );
  }
  assert.ok(
    Number(m.shop_income) >= Number(m.retail_revenue),
    'shop income includes all retail revenue'
  );
});

test('settled bundle count matches counting bundles under the same filter', async () => {
  const m = await counts.settledMoney();
  const r = await query(
    `SELECT COUNT(DISTINCT COALESCE(o.checkout_group_id, o.id))::int AS n
       FROM orders o WHERE ${counts.billableOrderSql('o')}`
  );
  assert.strictEqual(Number(m.orders), r.rows[0].n);
});

test('retail cost is reported honestly (costed pieces never exceed retail pieces)', async () => {
  const m = await counts.settledMoney();
  assert.ok(
    m.retail_pieces_costed <= m.retail_pieces,
    `${m.retail_pieces_costed} costed > ${m.retail_pieces} retail pieces`
  );
  // If no retail piece carries a cost, retail "profit" IS revenue — and the dashboard
  // must be showing the «تكلفة الإنتاج غير مُدخلة» notice rather than a net-profit figure.
  if (m.retail_pieces_costed === 0) {
    assert.strictEqual(
      Number(m.retail_cost),
      0,
      'no costed retail piece can still sum to a non-zero cost'
    );
  }
});

// ── Bug 9: workable vs blocked ─────────────────────────────────────────────

test('THE CORE INVARIANT: workable + awaiting_rep + returned = pieces, per stage', async () => {
  const rows = await counts.stageFunnelSplit(counts.buildScope());
  for (const r of rows) {
    assert.strictEqual(
      r.workable + r.awaiting_rep + r.returned,
      r.pieces,
      `stage ${r.stage}: ${r.workable}+${r.awaiting_rep}+${r.returned} !== ${r.pieces}`
    );
  }
});

test('the split funnel still sums EXACTLY to the piece total', async () => {
  const scope = counts.buildScope();
  const [rows, pieces] = await Promise.all([
    counts.stageFunnelSplit(scope),
    counts.countPieces(scope),
  ]);
  const sum = rows.reduce((n, r) => n + r.pieces, 0);
  assert.strictEqual(sum, pieces, `split funnel sums to ${sum} but there are ${pieces} pieces`);
});

test('the split funnel agrees with the unsplit one, stage for stage', async () => {
  const scope = counts.buildScope();
  const [split, plain] = await Promise.all([
    counts.stageFunnelSplit(scope),
    counts.stageFunnel(scope),
  ]);
  const byStage = new Map(plain.map((r) => [r.stage, r]));
  assert.strictEqual(split.length, plain.length, 'both must return the same stages');
  for (const r of split) {
    const p = byStage.get(r.stage);
    assert.ok(p, `stage ${r.stage} missing from the unsplit funnel`);
    assert.strictEqual(r.pieces, p.pieces, `stage ${r.stage} piece count diverged`);
    assert.strictEqual(r.students, p.students, `stage ${r.stage} student count diverged`);
  }
});

test('«قابل للعمل» matches a hand-written mirror of the staff queue’s own filter', async () => {
  // The point of bug 9 is that /admin and the staff queue disagreed. This check is written
  // out longhand — NOT through lib/counts.js — against productionController.getQueue's two
  // gates, so a future edit to the helper cannot quietly redefine "workable" and still pass.
  const rows = await counts.stageFunnelSplit(counts.buildScope());
  const independent = await query(
    `SELECT o.status AS stage, COUNT(*)::int AS n
       FROM orders o
       JOIN students s ON s.id = o.student_id
      WHERE o.status <> 'cancelled'
        AND (s.wholesaler_id IS NULL OR o.wholesaler_approval = 'approved')
        AND o.returned_to_customer = FALSE
      GROUP BY o.status`
  );
  const byStage = new Map(independent.rows.map((r) => [r.stage, r.n]));
  for (const r of rows) {
    assert.strictEqual(
      r.workable,
      byStage.get(r.stage) || 0,
      `stage ${r.stage}: dashboard says ${r.workable} workable, the queue's own filter says ${byStage.get(r.stage) || 0}`
    );
  }
});

test('blocked work is really blocked — awaiting_rep rows are all rep-owned', async () => {
  const r = await query(
    `SELECT COUNT(*)::int AS n
       FROM orders o JOIN students s ON s.id = o.student_id
      WHERE o.status <> 'cancelled'
        AND NOT (s.wholesaler_id IS NULL OR o.wholesaler_approval = 'approved')
        AND s.wholesaler_id IS NULL`
  );
  assert.strictEqual(r.rows[0].n, 0, 'a retail order can never be awaiting a rep’s approval');
});

// ── Bug 10: two populations on one daily bar ───────────────────────────────

test('daily: the settled subset never exceeds every live bundle that day', async () => {
  const { rows } = await query(
    `SELECT DATE(o.created_at AT TIME ZONE 'Asia/Baghdad') AS date,
            COUNT(DISTINCT COALESCE(o.checkout_group_id, o.id))::int AS orders,
            COUNT(DISTINCT COALESCE(o.checkout_group_id, o.id))
              FILTER (WHERE ${counts.billableOrderSql('o')})::int AS billable_orders,
            COALESCE(SUM(o.price) FILTER (WHERE ${counts.billableOrderSql('o')}), 0)::bigint AS revenue
       FROM orders o
      WHERE o.created_at > NOW() - INTERVAL '30 days'
        AND o.status <> 'cancelled'
      GROUP BY 1`
  );
  for (const r of rows) {
    assert.ok(
      r.billable_orders <= r.orders,
      `${r.date}: ${r.billable_orders} settled > ${r.orders} live bundles`
    );
    // The bug: revenue can only come from the settled bundles. A day with revenue and no
    // settled bundle would mean the chart is once again earning from a set it doesn't count.
    if (Number(r.revenue) > 0) {
      assert.ok(
        r.billable_orders > 0,
        `${r.date}: revenue ${r.revenue} with 0 settled bundles — the two populations diverged again`
      );
    }
  }
});

// ── Guard rails on the vocabulary itself ───────────────────────────────────

test('rep and retail predicates are exact complements', () => {
  assert.strictEqual(counts.repRowSql('o'), 'o.wholesaler_approval IS NOT NULL');
  assert.strictEqual(counts.retailRowSql('o'), 'o.wholesaler_approval IS NULL');
});

test('shopIncomeExpr splices its FILTER inside the aggregate, not after the cast', () => {
  // Appending FILTER to the finished expression is a syntax error, not a narrower sum —
  // an easy edit to get wrong and impossible to notice without running the query.
  const withFilter = counts.shopIncomeExpr('o', 'o.status <> \'cancelled\'');
  assert.ok(
    withFilter.indexOf('FILTER') < withFilter.indexOf('::bigint'),
    'FILTER must attach to SUM(...), before the cast'
  );
  assert.ok(!counts.shopIncomeExpr('o').includes('FILTER'), 'no filter → no FILTER clause');
});
