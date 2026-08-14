// «لولو» and the admin dashboard must quote the SAME money — bug 11's third home.
//
// WHY THIS TEST EXISTS. `lib/counts.js` states in its own header that the dashboard and the
// analytics assistant must compute revenue identically, because two definitions of "revenue"
// that disagree by a few pending bundles destroys trust in an assistant the owner cannot
// audit. `lib/adminMetrics.js` then answered `revenue_summary` and `top_reps` with
// SUM(price)/SUM(cost)/SUM(profit) under the words مبيعات/تكاليف/أرباح — the exact failure
// that header warns about, because on a representative's order `price − cost` is the REP's
// margin, money that never reaches this shop.
//
// The two files were fixed at different times, on different branches, by different work. The
// only thing that can stop them drifting apart again is an assertion that reads both and
// compares them — so that is what this file does. Read-only against the dev DB.
const test = require('node:test');
const assert = require('node:assert/strict');
const { METRICS } = require('../lib/adminMetrics');
const counts = require('../lib/counts');

const DAYS = 730;
const WINDOW = `o.created_at > NOW() - INTERVAL '${DAYS} days'`;

/** The assistant answers in Arabic prose; the number is what must match. */
const parseIQD = (fact) => Number(String(fact).replace(/[^\d-]/g, ''));
const factStartingWith = (facts, prefix) => {
  const hit = facts.find((f) => f.startsWith(prefix));
  assert.ok(hit, `the assistant no longer reports «${prefix}» — facts were: ${facts.join(' | ')}`);
  return parseIQD(hit);
};

test('the assistant quotes the dashboard’s دخل المحل to the dinar', async () => {
  const [summary, dashboard] = await Promise.all([
    METRICS.revenue_summary.run({ days: DAYS }),
    counts.settledMoney({ where: WINDOW }),
  ]);
  assert.equal(
    factStartingWith(summary.facts, 'دخل المحل'),
    Number(dashboard.shop_income),
    'the assistant and /admin disagree about what the shop earned'
  );
});

test('THE BUG: the assistant never quotes the reps’ margin as the shop’s', async () => {
  // `SUM(profit)` over settled rows — what `revenue_summary` used to print as «الأرباح» —
  // is the representatives' margin plus retail revenue. If any figure the assistant
  // reports as the shop's equals that, the two populations have been merged again.
  const [summary, dashboard] = await Promise.all([
    METRICS.revenue_summary.run({ days: DAYS }),
    counts.settledMoney({ where: WINDOW }),
  ]);
  const oldWrongProfit =
    Number(dashboard.rep_margin) +
    Number(dashboard.retail_revenue) -
    Number(dashboard.retail_cost);
  assert.notEqual(factStartingWith(summary.facts, 'دخل المحل'), oldWrongProfit);
});

test('the reps’ margin is reported, and reported as theirs', async () => {
  const [summary, dashboard] = await Promise.all([
    METRICS.revenue_summary.run({ days: DAYS }),
    counts.settledMoney({ where: WINDOW }),
  ]);
  assert.equal(
    factStartingWith(summary.facts, 'ربح الممثلين'),
    Number(dashboard.rep_margin)
  );
  assert.ok(
    summary.facts.some((f) => f.startsWith('ربح الممثلين') && f.includes('يبقى عندهم')),
    'the rep margin must be labelled as the reps’ money, not left ambiguous'
  );
});

test('the split reconciles: حصة الإدارة + مبيعات التجزئة = دخل المحل', async () => {
  const summary = await METRICS.revenue_summary.run({ days: DAYS });
  assert.equal(
    factStartingWith(summary.facts, 'منها حصة الإدارة') +
      factStartingWith(summary.facts, 'ومنها مبيعات التجزئة'),
    factStartingWith(summary.facts, 'دخل المحل'),
    'the assistant prints a breakdown that does not add up to its own headline'
  );
});

test('with no production cost entered, the assistant refuses to call revenue profit', async () => {
  // The dashboard prints «لم تُدخل تكلفة إنتاج …» instead of a net profit. If the assistant
  // stayed silent it would become the easy place to get the number /admin declines to give.
  const [summary, dashboard] = await Promise.all([
    METRICS.revenue_summary.run({ days: DAYS }),
    counts.settledMoney({ where: WINDOW }),
  ]);
  if (Number(dashboard.retail_pieces_costed) === 0) {
    assert.ok(
      summary.facts.some((f) => f.includes('إيراد مو ربح')),
      'no retail cost exists, so the assistant must say revenue is not profit'
    );
  }
});

test('top_reps ranks by what the SHOP earned, not by the reps’ turnover', async () => {
  // Ordering by SUM(price) ranks a rep who marks up heavily above one who sends the shop
  // more money — the ladder would reward the wrong behaviour.
  const reps = await METRICS.top_reps.run({ days: DAYS, limit: 10 });
  if (reps.facts[0].startsWith('ماكو')) return; // no rep orders in window
  const shopIncomes = reps.facts.map((f) => parseIQD(f.split('دخل المحل')[1].split('،')[0]));
  const sorted = [...shopIncomes].sort((a, b) => b - a);
  assert.deepEqual(shopIncomes, sorted, 'the rep ladder is not ordered by shop income');
});

test('every rep line separates the shop’s money from the rep’s', async () => {
  const reps = await METRICS.top_reps.run({ days: DAYS, limit: 5 });
  if (reps.facts[0].startsWith('ماكو')) return;
  for (const fact of reps.facts) {
    assert.ok(fact.includes('دخل المحل'), `missing دخل المحل: ${fact}`);
    assert.ok(fact.includes('ربح الممثل'), `missing ربح الممثل: ${fact}`);
    assert.ok(!/(^|[^ال])أرباح/.test(fact), `ambiguous «أرباح» is back: ${fact}`);
  }
});
