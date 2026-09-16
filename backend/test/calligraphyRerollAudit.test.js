// backend/test/calligraphyRerollAudit.test.js
//
// THE CONTRACT for `lib/calligraphyRerollAudit.js` — the reroll-predictor audit.
//
// Written 2026-09-16 BEFORE any implementation exists, and deliberately written by a party
// that will not implement it. Two agents (Claude Code / Codex CLI) get the same brief and the
// same base commit; this file is the only judge. Neither may edit it — a diff here voids the
// round.
//
// WHY A PURE FUNCTION: the question is «which plate features predict a paid regeneration»,
// and that answer must be checkable without a database. `analyze()` therefore takes ROWS and
// returns numbers. Whatever SQL the script uses to fetch those rows is the implementer's
// business and is not tested here — so neither agent can win by mocking `pg` more cleverly.
//
// READ-ONLY: nothing under test may write to the database. There is no INSERT/UPDATE anywhere
// in this contract, and `scripts/calligraphy-reroll-audit.js` must open a read-only query path.
const test = require('node:test');
const assert = require('node:assert');
const { textFeatures, analyze } = require('../lib/calligraphyRerollAudit');

// ---------------------------------------------------------------------------
// 1. textFeatures — the per-plate feature extractor
// ---------------------------------------------------------------------------
// Real shapes off `calligraphy_plates.render_text`. Arabic counting is the trap: a diacritic
// is its own code point, so «مُحَمَّد» is 8 code points but 5 letters, and a naive .length
// makes every vocalised name look "long" — which is exactly the confound this audit exists
// to separate from a genuine length effect.

test('letterCount ignores diacritics; charCount does not', () => {
  const plain = textFeatures('محمد');
  const voweled = textFeatures('مُحَمَّد');
  assert.strictEqual(plain.letterCount, 4);
  assert.strictEqual(voweled.letterCount, 4, 'harakat are not letters');
  assert.ok(voweled.charCount > voweled.letterCount, 'charCount keeps the marks');
});

test('hasDiacritics distinguishes the two', () => {
  assert.strictEqual(textFeatures('محمد').hasDiacritics, false);
  assert.strictEqual(textFeatures('مُحَمَّد').hasDiacritics, true);
  // shadda alone counts — it is the mark the prompt fights over
  assert.strictEqual(textFeatures('محمّد').hasDiacritics, true);
});

test('wordCount is whitespace-robust', () => {
  assert.strictEqual(textFeatures('محمد علي حسين').wordCount, 3);
  assert.strictEqual(textFeatures('  محمد   علي  ').wordCount, 2, 'no empty words');
  assert.strictEqual(textFeatures('محمد').wordCount, 1);
});

test('empty and null text never throw', () => {
  for (const bad of ['', '   ', null, undefined]) {
    const f = textFeatures(bad);
    assert.strictEqual(f.letterCount, 0);
    assert.strictEqual(f.wordCount, 0);
    assert.strictEqual(f.hasDiacritics, false);
  }
});

test('longestWord is measured in letters, not code points', () => {
  // «عبدالرحمن» (9 letters) is the long one even when «مُحَمَّد» carries more code points.
  const f = textFeatures('مُحَمَّد عبدالرحمن');
  assert.strictEqual(f.longestWord, 9);
});

// ---------------------------------------------------------------------------
// 2. analyze — bucketed reroll rates
// ---------------------------------------------------------------------------
// A row is the shape the script selects: at minimum
//   { render_text, reroll_count, variant, style, status }
// `analyze(rows, { minSample })` returns:
//   { total, rerolled, overallRate, dimensions: [ ... ] }
// each dimension: { dimension, buckets: [ { bucket, n, rerolled, rate, underpowered } ], spread }
// A plate counts as rerolled when reroll_count > 0. `rate` is rerolled/n in [0,1].
// `spread` = max(rate) - min(rate) over buckets with n >= minSample. Dimensions are sorted by
// spread DESC — the point of the report is "what matters most", not alphabetical order.

const plate = (text, reroll, extra = {}) => ({
  render_text: text, reroll_count: reroll, variant: 'front', style: null, status: 'done', ...extra,
});

test('overall rate counts any reroll_count > 0 as one rerolled plate', () => {
  const r = analyze([plate('محمد', 0), plate('علي', 3), plate('حسين', 1), plate('زينب', 0)]);
  assert.strictEqual(r.total, 4);
  assert.strictEqual(r.rerolled, 2, 'reroll_count 3 is ONE rerolled plate, not three');
  assert.ok(Math.abs(r.overallRate - 0.5) < 1e-9);
});

test('a dimension splits the population and its bucket n sums to total', () => {
  const rows = [
    plate('محمد', 0, { variant: 'front' }),
    plate('علي', 1, { variant: 'front' }),
    plate('حسين', 0, { variant: 'cap' }),
    plate('زينب', 1, { variant: 'cap' }),
    plate('نور', 1, { variant: 'cap' }),
  ];
  const r = analyze(rows, { minSample: 1 });
  const dim = r.dimensions.find((d) => d.dimension === 'variant');
  assert.ok(dim, 'variant must be one of the reported dimensions');
  assert.strictEqual(dim.buckets.reduce((a, b) => a + b.n, 0), 5);
  const cap = dim.buckets.find((b) => b.bucket === 'cap');
  assert.strictEqual(cap.n, 3);
  assert.strictEqual(cap.rerolled, 2);
  assert.ok(Math.abs(cap.rate - 2 / 3) < 1e-9);
});

test('diacritics is reported as its own dimension', () => {
  const rows = [
    ...Array.from({ length: 5 }, () => plate('محمد', 0)),
    ...Array.from({ length: 5 }, () => plate('مُحَمَّد', 1)),
  ];
  const r = analyze(rows, { minSample: 2 });
  const dim = r.dimensions.find((d) => d.dimension === 'hasDiacritics');
  assert.ok(dim, 'the audit must test the diacritics hypothesis');
  assert.ok(Math.abs(dim.spread - 1) < 1e-9, 'a perfect 0%/100% split is a spread of 1.0');
});

test('thin buckets are flagged underpowered and excluded from spread', () => {
  const rows = [
    ...Array.from({ length: 20 }, () => plate('محمد', 0, { style: 'a' })),   // 0%
    ...Array.from({ length: 20 }, () => plate('علي', 1, { style: 'b' })),    // 100%
    plate('نادر', 1, { style: 'rare' }),                                     // n=1, 100%
  ];
  const r = analyze(rows, { minSample: 5 });
  const dim = r.dimensions.find((d) => d.dimension === 'style');
  const rare = dim.buckets.find((b) => b.bucket === 'rare');
  assert.strictEqual(rare.n, 1);
  assert.strictEqual(rare.underpowered, true, 'n=1 must be marked, never silently trusted');
  assert.ok(Math.abs(dim.spread - 1) < 1e-9, 'spread comes from the two real buckets only');
});

test('a dimension with no eligible bucket reports spread 0, not NaN', () => {
  const rows = [plate('محمد', 0, { style: 'x' }), plate('علي', 1, { style: 'y' })];
  const r = analyze(rows, { minSample: 10 });
  const dim = r.dimensions.find((d) => d.dimension === 'style');
  assert.ok(Number.isFinite(dim.spread), `spread must be a number, got ${dim.spread}`);
  assert.strictEqual(dim.spread, 0);
});

test('dimensions are sorted by spread descending', () => {
  const rows = [];
  // variant: a clean 0% / 100% split  → spread 1.0
  // style:   50% / 50%                → spread 0
  for (let i = 0; i < 10; i++) {
    rows.push(plate('محمد', 0, { variant: 'front', style: i % 2 ? 'a' : 'b' }));
    rows.push(plate('علي', 1, { variant: 'cap', style: i % 2 ? 'b' : 'a' }));
  }
  const r = analyze(rows, { minSample: 5 });
  const spreads = r.dimensions.map((d) => d.spread);
  assert.deepStrictEqual([...spreads].sort((a, b) => b - a), spreads, 'must be ranked by impact');
  assert.strictEqual(r.dimensions[0].dimension, 'variant');
});

test('ranking is a real sort, not the order the dimensions happen to be declared in', () => {
  // The decisive case: the STRONGEST predictor here is a text feature, and every structural
  // dimension (variant, style) is flat. An implementation that emits dimensions in its own
  // declaration order and calls that "ranked" passes the test above by luck; it cannot pass
  // this one. Diacritics splits 0%/100%, variant and style are constant.
  const rows = [
    ...Array.from({ length: 10 }, () => plate('محمد', 0, { variant: 'front', style: 'a' })),
    ...Array.from({ length: 10 }, () => plate('مُحَمَّد', 1, { variant: 'front', style: 'a' })),
  ];
  const r = analyze(rows, { minSample: 5 });
  const spreads = r.dimensions.map((d) => d.spread);
  assert.deepStrictEqual([...spreads].sort((a, b) => b - a), spreads, 'must be ranked by impact');
  assert.strictEqual(r.dimensions[0].dimension, 'hasDiacritics',
    'the strongest predictor must lead, whatever order the code declares dimensions in');
  const variant = r.dimensions.find((d) => d.dimension === 'variant');
  assert.strictEqual(variant.spread, 0, 'a single-bucket dimension has no spread');
});

test('length is bucketed into ranges, not one bucket per distinct length', () => {
  const rows = Array.from({ length: 40 }, (_, i) =>
    plate('م'.repeat((i % 20) + 1), i % 2));
  const r = analyze(rows, { minSample: 1 });
  const dim = r.dimensions.find((d) => /length|letterCount/i.test(d.dimension));
  assert.ok(dim, 'name length must be one of the tested hypotheses');
  assert.ok(dim.buckets.length <= 6, `20 distinct lengths must collapse into ranges, got ${dim.buckets.length}`);
  assert.ok(dim.buckets.length >= 2, 'but it must actually split');
});

test('an empty population does not divide by zero', () => {
  const r = analyze([]);
  assert.strictEqual(r.total, 0);
  assert.strictEqual(r.rerolled, 0);
  assert.strictEqual(r.overallRate, 0, 'not NaN');
  assert.ok(Array.isArray(r.dimensions));
  for (const d of r.dimensions) assert.ok(Number.isFinite(d.spread));
});

test('null style is a real bucket, not a crash and not a silent drop', () => {
  const rows = [
    ...Array.from({ length: 6 }, () => plate('محمد', 0, { style: null })),
    ...Array.from({ length: 6 }, () => plate('علي', 1, { style: 'kufi' })),
  ];
  const r = analyze(rows, { minSample: 5 });
  const dim = r.dimensions.find((d) => d.dimension === 'style');
  assert.strictEqual(dim.buckets.reduce((a, b) => a + b.n, 0), 12, 'the 6 default-style plates are not dropped');
  // ...and the shop default must be LABELLED, not printed as a leaked JS coercion. A report
  // that says «null: 0%» tells a designer nothing about which style that was.
  const labels = dim.buckets.map((b) => String(b.bucket));
  for (const bad of ['null', 'undefined', 'NaN', '[object Object]']) {
    assert.ok(!labels.includes(bad), `bucket label «${bad}» is a coercion bug, not a style`);
  }
  const def = dim.buckets.find((b) => b.bucket !== 'kufi');
  assert.strictEqual(def.n, 6);
  assert.strictEqual(def.rerolled, 0);
});

test('analyze does not mutate the rows it is given', () => {
  const rows = [plate('محمد', 0), plate('علي', 1)];
  const snapshot = JSON.parse(JSON.stringify(rows));
  analyze(rows, { minSample: 1 });
  assert.deepStrictEqual(rows, snapshot);
});

test('rates are proper fractions in [0,1], never percentages', () => {
  const rows = Array.from({ length: 10 }, (_, i) => plate('محمد', i < 3 ? 1 : 0));
  const r = analyze(rows, { minSample: 1 });
  assert.ok(Math.abs(r.overallRate - 0.3) < 1e-9, '3/10 is 0.3, not 30');
  for (const d of r.dimensions) {
    for (const b of d.buckets) {
      assert.ok(b.rate >= 0 && b.rate <= 1, `${d.dimension}/${b.bucket} rate out of range: ${b.rate}`);
    }
  }
});
