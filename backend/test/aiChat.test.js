// Tests for the AI assistant — the decisions in it that fail SILENTLY and point at either
// the shop's bill or a student's trust.
//
// Nothing here touches the database or the network: every function under test is pure, which
// is exactly why they were split out of the query code (lib/aiChat.js `_internals`,
// lib/supportContext.js `formatContext`, lib/adminMetrics.js `_internals`).
//
// What is deliberately NOT tested here: the reserve/settle transaction itself. Its correctness
// is the advisory lock plus the single transaction, which a unit test cannot observe — it
// needs concurrent connections. The pure cap DECISION is tested; the serialisation around it
// is reviewed, not asserted.
const test = require('node:test');
const assert = require('node:assert');

const { evaluateCaps, estimateCostUsd } = require('../lib/aiChat')._internals;
const { formatContext, formatPriceBook } = require('../lib/supportContext');
const { clampDays } = require('../lib/adminMetrics')._internals;
const { parseRoute } = require('../controllers/adminAnalyticsChatController')._internals;

const CAPS = { perUserPerDay: 30, perSessionPerDay: 10, globalUsdPerDay: 1.0 };
const zero = { userToday: 0, sessionToday: 0, spendToday: 0 };

// ── Cost accounting ─────────────────────────────────────────────────────────────────────
//
// THE BUG THIS EXISTS FOR: `Number(usage.cost || 0)` records $0.00 whenever OpenRouter does
// not report a cost. Every row reads zero, SUM(cost_usd) never grows, and the $1/day ceiling
// — the backstop that makes every other cap optional — is switched off with nothing in any
// log to say so. A spend guard must fail toward over-counting.

test('a reported cost is stored as-is', () => {
  const cost = estimateCostUsd({
    reportedCost: 0.000042,
    model: 'google/gemini-2.5-flash-lite',
    promptTokens: 900,
    completionTokens: 120,
  });
  assert.strictEqual(cost, 0.000042);
});

test('a MISSING cost is estimated from tokens, never recorded as zero', () => {
  for (const reportedCost of [undefined, null, 0, '']) {
    const cost = estimateCostUsd({
      reportedCost,
      model: 'google/gemini-2.5-flash-lite',
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
    });
    // 1M in @ $0.10 + 1M out @ $0.40
    assert.ok(cost > 0, `reportedCost ${JSON.stringify(reportedCost)} must not price at zero`);
    assert.ok(Math.abs(cost - 0.5) < 1e-9, `expected ~0.5, got ${cost}`);
  }
});

test('an UNKNOWN model is assumed expensive, so the ceiling trips early rather than never', () => {
  const known = estimateCostUsd({
    reportedCost: 0,
    model: 'google/gemini-2.5-flash-lite',
    promptTokens: 1_000_000,
    completionTokens: 0,
  });
  const unknown = estimateCostUsd({
    reportedCost: 0,
    model: 'some/model-nobody-priced',
    promptTokens: 1_000_000,
    completionTokens: 0,
  });
  assert.ok(unknown > known, 'an unpriced model must not be cheaper than a priced one');
});

test('a call with no cost AND no tokens is genuinely free', () => {
  assert.strictEqual(
    estimateCostUsd({ reportedCost: 0, model: 'x', promptTokens: 0, completionTokens: 0 }),
    0
  );
});

// ── Cap boundaries ──────────────────────────────────────────────────────────────────────

test('an under-quota caller is allowed', () => {
  assert.strictEqual(evaluateCaps(zero, { userId: 'u1', caps: CAPS }), null);
  assert.strictEqual(evaluateCaps(zero, { userId: null, caps: CAPS }), null);
});

test('the cap is >=, not > — the 30th question is the last one', () => {
  const at = { ...zero, userToday: 30 };
  const below = { ...zero, userToday: 29 };
  assert.strictEqual(evaluateCaps(below, { userId: 'u1', caps: CAPS }), null);
  assert.strictEqual(evaluateCaps(at, { userId: 'u1', caps: CAPS })?.code, 'ERR_AI_USER_LIMIT');
});

test('signed-in and anonymous allowances are separate, and neither leaks into the other', () => {
  // A user at their limit is blocked even with an empty session count...
  assert.strictEqual(
    evaluateCaps({ ...zero, userToday: 30 }, { userId: 'u1', caps: CAPS })?.code,
    'ERR_AI_USER_LIMIT'
  );
  // ...and an exhausted session must not block a signed-in user who shares the browser.
  assert.strictEqual(evaluateCaps({ ...zero, sessionToday: 99 }, { userId: 'u1', caps: CAPS }), null);
  // The reverse: an anon caller is bounded by the session cap, not the (higher) user cap.
  assert.strictEqual(
    evaluateCaps({ ...zero, sessionToday: 10 }, { userId: null, caps: CAPS })?.code,
    'ERR_AI_ANON_LIMIT'
  );
  assert.strictEqual(evaluateCaps({ ...zero, userToday: 99 }, { userId: null, caps: CAPS }), null);
});

test('the shop-wide USD ceiling outranks every per-caller cap', () => {
  // It is the backstop: it must fire for a caller who has asked nothing at all.
  const err = evaluateCaps({ ...zero, spendToday: 1.0 }, { userId: 'u1', caps: CAPS });
  assert.strictEqual(err?.code, 'ERR_AI_BUDGET');
  assert.strictEqual(err.status, 503, '503 not 429 — it is the shop that is out, not the user');
  // And it must not disclose the shop's budget to a student.
  assert.ok(!/\$|USD|1\.0/.test(err.message), 'the budget must not leak into the Arabic message');
});

test('cap counts arriving as strings from pg still compare numerically', () => {
  // COUNT()/SUM() come back as strings from node-postgres for bigint/numeric. '9' > '10'
  // lexicographically, so a string comparison here would block a caller 21 questions early
  // and let a $9 day through as under $10.
  assert.strictEqual(
    evaluateCaps({ userToday: '30', sessionToday: '0', spendToday: '0' }, { userId: 'u1', caps: CAPS })?.code,
    'ERR_AI_USER_LIMIT'
  );
  assert.strictEqual(
    evaluateCaps({ userToday: '9', sessionToday: '0', spendToday: '0' }, { userId: 'u1', caps: CAPS }),
    null
  );
  assert.strictEqual(
    evaluateCaps({ userToday: '0', sessionToday: '0', spendToday: '0.9999' }, { userId: 'u1', caps: CAPS }),
    null
  );
});

// ── The facts the bot is allowed to state ───────────────────────────────────────────────

const student = {
  user_name: 'أحمد',
  full_name_third: 'أحمد علي حسن',
  university_name: 'كلية بلاد الرافدين',
  department: 'هندسة',
  rep_name: 'مضر محمد',
  rep_phone: '07700000000',
  rep_deadline: '2026-04-15',
  student_status: 'active',
};

test('A ZERO PRICE IS NEVER STATED AS FREE — it means the line belongs to a bundle', () => {
  // This one nearly shipped: bundle order lines carry the whole bundle's price on one row and
  // 0 on the rest, so the bot was about to tell a student their robe cost nothing.
  const text = formatContext(student, [
    { status: 'embroidery', price: 0, product_name: 'روب تخرج', delivered_at: null },
  ]);
  assert.ok(text.includes('ضمن طلب مشترك'), 'a 0 price must be labelled as part of a bundle');
  assert.ok(!/0 دينار/.test(text), 'the bot must never be handed "0 دينار" to phrase');
});

test('a real price IS stated', () => {
  const text = formatContext(student, [
    { status: 'ready', price: 25000, product_name: 'وشاح تخرج', delivered_at: null },
  ]);
  assert.ok(text.includes('25,000 دينار'));
});

test('the deadline is labelled as an ORDER cutoff, not a delivery date', () => {
  // Every model tested reused this date as a delivery promise. The label is the first guard;
  // rule 5 of the system prompt is the second.
  const text = formatContext(student, []);
  assert.ok(text.includes('2026-04-15'));
  assert.ok(text.includes('مو موعد تسليم'), 'the date must carry its disambiguation inline');
});

test('statuses are Arabic, and an unmapped status degrades to the raw value instead of vanishing', () => {
  const text = formatContext(student, [
    { status: 'embroidery', price: 1, product_name: 'أ', delivered_at: null },
    { status: 'some_new_status', price: 1, product_name: 'ب', delivered_at: null },
  ]);
  assert.ok(text.includes('قيد التطريز'));
  assert.ok(text.includes('some_new_status'), 'ugly is fine; silently dropping a status is not');
});

test('a retail customer is described as having no rep rather than an empty one', () => {
  const text = formatContext({ user_name: 'سارة', rep_name: null }, []);
  assert.ok(text.includes('ما عنده ممثل جامعة'));
  assert.ok(text.includes('ماكو طلبات'));
});

// ── The price book ──────────────────────────────────────────────────────────────────────
//
// products.base_price is a STARTING price that options add to. If the bot ever states one as
// a flat price it has quoted a total the checkout will not honour — so every line must carry
// «يبدأ من», including the single-product case where a range would collapse.

test('every price line is stated as a STARTING price, never a flat one', () => {
  const text = formatPriceBook([
    { type: 'robe', min_price: 20000, max_price: 50000 },
    { type: 'cap', min_price: 15000, max_price: 15000 },
  ]);
  assert.ok(text.includes('روب تخرج: يبدأ من 20,000 دينار'));
  assert.ok(text.includes('وأغلى موديل 50,000 دينار'));
  // The collapsed case is the trap: min === max must still say «يبدأ من».
  assert.ok(text.includes('قبعة تخرج: يبدأ من 15,000 دينار'));
  assert.ok(!/قبعة تخرج: 15,000/.test(text), 'a flat price would be a quote, not a starting price');
  assert.ok(text.includes('أسعار البداية'), 'the caveat line must survive');
});

test('full-set packages are listed at their real flat price', () => {
  const text = formatPriceBook(
    [{ type: 'sash', min_price: 15000, max_price: 15000 }],
    [{ name_ar: 'طقم ميلانو', price: 150000 }]
  );
  assert.ok(text.includes('طقم ميلانو (طقم كامل): 150,000 دينار'));
});

test('an unknown product type is dropped rather than shown with a raw English key', () => {
  // Unlike order STATUS, where degrading to the raw value is right, a price line is customer-
  // facing money: «hoodie: يبدأ من 5,000» in an Arabic answer is worse than silence.
  const text = formatPriceBook([
    { type: 'robe', min_price: 20000, max_price: 20000 },
    { type: 'hoodie', min_price: 5000, max_price: 5000 },
  ]);
  assert.ok(text.includes('روب تخرج'));
  assert.ok(!text.includes('hoodie'));
});

test('an empty catalogue yields no price block at all, not an empty heading', () => {
  // The controller filters falsy blocks out of the prompt. A bare «قائمة الأسعار:» with
  // nothing under it would invite the model to fill the gap.
  assert.strictEqual(formatPriceBook([]), null);
  assert.strictEqual(formatPriceBook([{ type: 'hoodie', min_price: 1, max_price: 1 }]), null);
});

// ── The response cache ──────────────────────────────────────────────────────────────────
//
// Two ways a cache like this fails, and both are silent:
//   · too LOOSE — two different questions collapse to one key and a customer is answered
//     something they did not ask;
//   · STALE — prices change and the old answer keeps being served.
// The key is a hash of (whole system prompt + normalised question), which is what makes the
// second impossible rather than merely unlikely. These tests pin both directions.

const support = require('../controllers/supportChatController')._internals;
const { normalizeQuestion, cacheKeyFor } = support;

test('spelling variants of ONE question fold to one key', () => {
  const base = normalizeQuestion('شكد سعر الروب؟');
  assert.strictEqual(normalizeQuestion('شكد سعر الروب'), base, 'trailing ؟');
  assert.strictEqual(normalizeQuestion('  شكد   سعر  الروب ؟ '), base, 'stray whitespace');
  assert.strictEqual(normalizeQuestion('شكد سعر الروب؟؟؟'), base, 'repeated punctuation');
  assert.strictEqual(normalizeQuestion('شكد سعر الروب? 😊'), base, 'emoji + latin question mark');
});

test('alef, ya and ta-marbuta variants fold — Iraqi typing varies on all three', () => {
  assert.strictEqual(normalizeQuestion('أسعار القبعة'), normalizeQuestion('اسعار القبعه'));
  assert.strictEqual(normalizeQuestion('إلى متى'), normalizeQuestion('الي متي'));
});

test('a REAL word difference must NOT fold — the failure that answers the wrong question', () => {
  const pairs = [
    ['شكد سعر الروب', 'شكد سعر الوشاح'],
    ['شكد سعر الوشاح', 'شكد سعر الشال'],
    ['عندكم توصيل', 'ماكو توصيل'],
    ['وين وصل طلبي', 'وين موقعكم'],
  ];
  for (const [a, b] of pairs) {
    assert.notStrictEqual(normalizeQuestion(a), normalizeQuestion(b), `${a} vs ${b}`);
  }
});

test('an empty or punctuation-only question normalises to empty, so it is never cached', () => {
  // The caller treats '' as "not cacheable" — a blank key must not become a shared entry.
  assert.strictEqual(normalizeQuestion('؟؟؟'), '');
  assert.strictEqual(normalizeQuestion('   '), '');
  assert.strictEqual(normalizeQuestion('😊'), '');
});

test('THE STALENESS GUARD: any change to the system prompt changes every key', () => {
  const q = normalizeQuestion('شكد سعر الروب؟');
  const before = cacheKeyFor('facts\nروب: يبدأ من 20,000 دينار', q);
  const afterPriceChange = cacheKeyFor('facts\nروب: يبدأ من 25,000 دينار', q);
  assert.notStrictEqual(before, afterPriceChange, 'a price change MUST invalidate the entry');
  // Same prompt + same question is stable, or nothing would ever hit.
  assert.strictEqual(before, cacheKeyFor('facts\nروب: يبدأ من 20,000 دينار', q));
});

test('different questions against the same prompt get different keys', () => {
  const sys = 'the same system prompt';
  assert.notStrictEqual(
    cacheKeyFor(sys, normalizeQuestion('شكد سعر الروب')),
    cacheKeyFor(sys, normalizeQuestion('شكد سعر الوشاح'))
  );
});

// ── The analytics router ────────────────────────────────────────────────────────────────

test('the router tolerates a ```json fence, which cheap models emit even in JSON mode', () => {
  assert.deepStrictEqual(parseRoute('```json\n{"key":"revenue_summary","days":7}\n```'), {
    key: 'revenue_summary',
    days: 7,
  });
  assert.deepStrictEqual(parseRoute('{"key":"top_reps","days":30,"limit":5}'), {
    key: 'top_reps',
    days: 30,
    limit: 5,
  });
});

test('unparseable router output is null, not a crash', () => {
  // The caller treats null as "no metric matched" and answers with the capability list.
  for (const bad of ['', 'ما فهمت السؤال', '{broken', 'null', '42', '"a string"']) {
    const r = parseRoute(bad);
    assert.ok(r === null || typeof r === 'object', `parseRoute(${JSON.stringify(bad)}) must be safe`);
  }
  assert.strictEqual(parseRoute('{broken'), null);
  assert.strictEqual(parseRoute('42'), null);
});

// ── The only value the model puts into SQL ──────────────────────────────────────────────

test('clampDays is the guard on the one model-supplied value that reaches SQL text', () => {
  // `days` is interpolated into an INTERVAL, which cannot take a bind parameter, so this
  // function is the entire defence. It must return an integer for EVERY input a model can
  // produce — including a deliberate injection attempt.
  const hostile = [
    "1; DROP TABLE orders --",
    '30 OR 1=1',
    "' UNION SELECT",
    null,
    undefined,
    NaN,
    Infinity,
    -5,
    0,
    1e9,
    '7.9',
    {},
    [],
  ];
  for (const input of hostile) {
    const d = clampDays(input);
    assert.ok(Number.isInteger(d), `clampDays(${JSON.stringify(input)}) returned ${d}`);
    assert.ok(d >= 1 && d <= 730, `clampDays(${JSON.stringify(input)}) escaped the range: ${d}`);
  }
  // Sane inputs pass through unchanged.
  assert.strictEqual(clampDays(7), 7);
  assert.strictEqual(clampDays('30'), 30);
  assert.strictEqual(clampDays(365), 365);
});
