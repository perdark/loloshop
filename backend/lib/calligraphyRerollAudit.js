// backend/lib/calligraphyRerollAudit.js — «أي خصائص اللوحة تتنبأ بإعادة توليد مدفوعة؟»
//
// PURE ON PURPOSE. No `pg`, no `fs`, no network — not tidiness, it is what makes the answer
// checkable. The question is statistical, so the unit under test has to be «rows in, numbers
// out»; anything that needs a database to run is a claim nobody can re-check later.
// `scripts/calligraphy-reroll-audit.js` owns the SQL and hands its rows here.
//
// ⚠️ ARABIC COUNTING IS THE WHOLE TRAP. A harakah is its own code point, so «مُحَمَّد» is 8
// code points and 4 letters. Measure length with `.length` and every vocalised name looks
// long — and then «long names reroll more» is really «vocalised names reroll more» wearing a
// disguise. `letterCount` and `hasDiacritics` exist precisely to keep those two apart, which
// is why they are separate dimensions in the report and must stay separate.

// \p{M} is every combining mark: harakat, shadda, sukun, the superscript alef, and the
// non-Arabic ones too. TATWEEL (U+0640) is category Lm — a letter to Unicode, a stretched
// connector to a calligrapher — so it is excluded by hand or a kashida inflates the length.
const MARKS = /\p{M}/gu;
const HAS_MARK = /\p{M}/u;
const TATWEEL = /ـ/g;
const LETTER = /\p{L}/gu;

function countLetters(text) {
  return (text.replace(MARKS, '').replace(TATWEEL, '').match(LETTER) || []).length;
}

/**
 * Per-plate features off `calligraphy_plates.render_text`.
 * `charCount` keeps the marks (it is what the renderer was handed); every letter measure
 * drops them. Never throws: a null/empty text is a real row shape and reports all zeros.
 */
function textFeatures(text) {
  const value = typeof text === 'string' ? text : '';
  const trimmed = value.trim();
  const words = trimmed ? trimmed.split(/\s+/u) : [];

  return {
    charCount: Array.from(value).length,
    letterCount: countLetters(value),
    wordCount: words.length,
    longestWord: words.reduce((max, word) => Math.max(max, countLetters(word)), 0),
    hasDiacritics: HAS_MARK.test(value),
  };
}

// ---------------------------------------------------------------------------
// Bucketing
// ---------------------------------------------------------------------------
// Ranges, never one bucket per distinct value: 20 distinct name lengths would give 20
// buckets of n≈2, every one of them underpowered, and a report where nothing is readable
// and nothing is trustworthy. `order` keeps an ordinal dimension printing in its own order
// instead of by rate, so the shape of the trend is visible at a glance.

const DEFAULT_STYLE = 'الافتراضي (بدون ستايل)';
const UNKNOWN = 'غير معروف';

// A null style is the shop default and must be LABELLED. «null: 0%» tells a designer
// nothing about which style that was — and `String(null)` is a coercion bug, not a category.
function categorical(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return fallback;
}

function banded(count, edges, unit) {
  let lower = 1;
  for (let i = 0; i < edges.length; i += 1) {
    const upper = edges[i];
    if (count <= upper) {
      return { bucket: lower === upper ? `${lower} ${unit}` : `${lower}–${upper} ${unit}`, order: i + 1 };
    }
    lower = upper + 1;
  }
  return { bucket: `${lower}+ ${unit}`, order: edges.length + 1 };
}

// ⚠️ THE BAND EDGES ARE A MEASUREMENT DECISION, NOT A FORMATTING ONE. A 3-letter and a
// 4-letter Arabic name are the same size of name; splitting between them manufactures a
// difference out of noise and lets «length» borrow a spread that really belongs to whatever
// else those two names differ in. Bands start at 4 for that reason, and they match
// `longestWordBand` so the two length measures stay comparable.
function lengthBand(count) {
  if (count === 0) return { bucket: '0 letters', order: 0 };
  return banded(count, [4, 8, 12, 16], 'letters');
}

function wordBand(count) {
  if (count === 0) return { bucket: '0 words', order: 0 };
  if (count === 1) return { bucket: '1 word', order: 1 };
  if (count === 2) return { bucket: '2 words', order: 2 };
  return { bucket: '3+ words', order: 3 };
}

function longestWordBand(count) {
  if (count === 0) return { bucket: '0 letters', order: 0 };
  return banded(count, [4, 8, 12], 'letters');
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function buildDimension(name, records, bucketFor, minSample, ordinal) {
  const grouped = new Map();
  for (const record of records) {
    const resolved = bucketFor(record);
    const label = typeof resolved === 'object' ? resolved.bucket : resolved;
    const order = typeof resolved === 'object' ? resolved.order : null;
    let cell = grouped.get(label);
    if (!cell) {
      cell = { bucket: label, order, n: 0, rerolled: 0 };
      grouped.set(label, cell);
    }
    cell.n += 1;
    if (record.rerolled) cell.rerolled += 1;
  }

  const buckets = [...grouped.values()].map((cell) => ({
    bucket: cell.bucket,
    order: cell.order,
    n: cell.n,
    rerolled: cell.rerolled,
    rate: cell.rerolled / cell.n,
    // ⚠️ A thin slice is MARKED and dropped from the spread, never silently trusted. One
    // plate that happened to reroll is a 100% bucket, and an unguarded max() would put that
    // noise at the top of the report as if it were the finding.
    underpowered: cell.n < minSample,
  }));

  // Ordinal dimensions read in their own order (the trend is the point); categorical ones
  // read worst-first, which is the question being asked of them.
  buckets.sort(ordinal
    ? (a, b) => a.order - b.order
    : (a, b) => b.rate - a.rate || b.n - a.n);

  const eligible = buckets.filter((b) => !b.underpowered).map((b) => b.rate);
  // Fewer than two comparable buckets means nothing was compared — 0, never NaN, and never
  // a spread borrowed from a bucket too small to believe.
  const spread = eligible.length < 2 ? 0 : Math.max(...eligible) - Math.min(...eligible);

  return { dimension: name, buckets, spread };
}

function normaliseMinSample(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : 5;
}

/**
 * analyze(rows, { minSample }) → { total, rerolled, overallRate, dimensions }
 *
 * A plate counts as rerolled when `reroll_count > 0` — ONE plate, however many presses it
 * cost. (The money question «how many rerolls» is `cost_usd`; this is «how often does a
 * plate need one at all».) `rate` is a fraction in [0,1], never a percentage: formatting
 * belongs to whatever prints it.
 *
 * Dimensions come back sorted by `spread` DESC because the report's job is «what matters
 * most», not «what I declared first». Never mutates the rows it is given.
 */
function analyze(rows, options = {}) {
  const minSample = normaliseMinSample(options && options.minSample);
  const input = Array.isArray(rows) ? rows : [];

  const records = input.map((row) => {
    const plate = row && typeof row === 'object' ? row : {};
    return {
      plate,
      features: textFeatures(plate.render_text),
      rerolled: Number(plate.reroll_count) > 0,
    };
  });

  const rerolled = records.reduce((sum, r) => sum + (r.rerolled ? 1 : 0), 0);

  const dimensions = [
    buildDimension('hasDiacritics', records, (r) => (r.features.hasDiacritics ? 'مشكّل' : 'غير مشكّل'), minSample, false),
    buildDimension('letterCount', records, (r) => lengthBand(r.features.letterCount), minSample, true),
    buildDimension('wordCount', records, (r) => wordBand(r.features.wordCount), minSample, true),
    buildDimension('longestWord', records, (r) => longestWordBand(r.features.longestWord), minSample, true),
    buildDimension('variant', records, (r) => categorical(r.plate.variant, UNKNOWN), minSample, false),
    buildDimension('style', records, (r) => categorical(r.plate.style, DEFAULT_STYLE), minSample, false),
    buildDimension('status', records, (r) => categorical(r.plate.status, UNKNOWN), minSample, false),
  ];

  // Ranked by effect. The tie-break is EVIDENCE, never declaration order: two dimensions
  // showing the same spread are not equally believable if one of them rests on twice the
  // plates, and «whichever I happened to list first» is exactly the fake ranking this
  // report must not print.
  const evidence = (d) => d.buckets.reduce((sum, b) => sum + (b.underpowered ? 0 : b.n), 0);
  dimensions.sort((a, b) => b.spread - a.spread || evidence(b) - evidence(a));

  return {
    total: records.length,
    rerolled,
    overallRate: records.length ? rerolled / records.length : 0,
    dimensions,
  };
}

module.exports = { textFeatures, analyze };
