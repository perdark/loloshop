// backend/lib/adminAnswerGuard.js — the last thing between the model and the shop's own numbers.
//
// ── WHY THIS IS A SEPARATE FILE FROM lib/answerGuard.js ────────────────────────────────────
// The two surfaces need OPPOSITE things, so sharing one guard would either gag this one or
// open that one. The storefront guard's central assertion is «no money figure the customer
// could act on unless we handed it to the model» — it exists to stop لولو quoting a price. The
// admin console's entire job is money figures: دخل المحل, حصة الإدارة, رواتب, كلفة المساعد.
// Point the storefront guard at this surface and every correct answer trips.
//
// So this asserts a DIFFERENT property with the same shape, and it is the one that actually
// matters here: **every number in the answer must be a number we computed.** The admin console
// never invents; it phrases. That single assertion covers the whole realistic failure set on
// this surface —
//
//   · the model inventing a figure outright;
//   · the model doing arithmetic on our figures (summing two totals, computing a percentage,
//     "منها ٤٠٪") — which is how a correct set of numbers becomes a false sentence. The
//     existing PHRASE_SYSTEM prompt already forbids exactly this, in those words, because the
//     model wrote «٨٠ طلبًا بانتظار الموافقة، ومن بينها ١٢٣ طالبًا» and invented a containment
//     relationship between two independent counts. A prompt rule nothing verifies is a wish;
//     this is the verification.
//   · a prompt-injected answer, which cannot smuggle a payload past "did we compute this".
//
// ── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────────────────────
// It does not rewrite or "fix" an answer — same rule as the storefront guard: an editing guard
// is a second author with no idea what it is saying. A tripped answer is replaced by the FACTS
// BLOCK ITSELF, which is the one degradation that loses nothing: the numbers were already
// correct before the phrasing call, and the admin sees them as a plain list instead of a
// sentence. That is a fine outcome on an admin screen and is why the controller already falls
// back to the same thing when the phrasing call errors.
//
// It also does not check for English, or for a "delivery promise", or any of the customer-
// facing rules. The owner is not a customer, and an admin console answering in a mix of Arabic
// and a Latin metric name is not a defect.

/** ٠١٢٣٤٥٦٧٨٩ → 0123456789, so a figure written in Arabic-Indic digits compares equal. */
function foldDigits(s) {
  return String(s || '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

/**
 * Every number in a string, normalised: separators dropped, Arabic-Indic folded, leading zeros
 * removed. «15,000» · «١٥،٠٠٠» · «15000» all become "15000".
 *
 * Decimals survive as-is ("0.42" stays "0.42") because AI spend is quoted in dollars and
 * rounding it away would let «$4.2» pass against a computed «$0.42`.
 */
function numbersIn(text) {
  const folded = foldDigits(text);
  const out = [];
  // A run of digits, optionally with thousands separators inside it, optionally with a decimal
  // tail. The separator class includes the Arabic comma (،) and the Arabic thousands mark (٬)
  // because the model writes both.
  const RE = /\d{1,3}(?:[,،٬]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
  let m;
  while ((m = RE.exec(folded)) !== null) {
    const raw = m[0].replace(/[,،٬]/g, '');
    // Trim trailing zeros in a decimal so "3.00" and "3" are the same number, then drop a
    // pointless leading zero. Integers are untouched.
    const num = Number(raw);
    if (!Number.isFinite(num)) continue;
    out.push(normalise(num));
  }
  return out;
}

function normalise(n) {
  // Keep two decimal places at most — every decimal on this surface is USD spend, which we
  // ourselves format to two. More precision than we printed cannot have come from us.
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

/**
 * Inspect an admin answer against the facts we computed.
 *
 * `factsText` is the exact block handed to the model — label plus fact lines. Anything the
 * model says must be traceable to it.
 *
 * Returns { ok: true } or { ok: false, reason, detail }.
 */
function inspect(answer, factsText) {
  const text = String(answer || '').trim();
  if (!text) return { ok: false, reason: 'EMPTY_ANSWER', detail: '' };

  const allowed = new Set(numbersIn(factsText));

  // Small integers are exempt. A sentence naturally contains ordinals and quantities that are
  // not claims about the shop — «آخر ٣٠ يوم», «أفضل ٥ ممثلين», «جملتين» — and the day/limit
  // parameters are OURS anyway (clamped in adminMetrics), so treating them as unverified would
  // trip nearly every correct answer while catching nothing. A shop figure is never ≤ 100:
  // prices are thousands, counts of anything worth asking about are printed in the facts.
  const SMALL = 100;

  const unexplained = [];
  for (const n of numbersIn(text)) {
    if (allowed.has(n)) continue;
    const num = Number(n);
    if (Number.isFinite(num) && Math.abs(num) <= SMALL && Number.isInteger(num)) continue;
    unexplained.push(n);
  }

  if (unexplained.length) {
    return {
      ok: false,
      reason: 'NUMBER_NOT_IN_FACTS',
      detail: unexplained.slice(0, 5).join(' · '),
    };
  }

  // ── PERCENTAGES ──────────────────────────────────────────────────────────────────────────
  // A percentage is almost always DERIVED — the model dividing one of our totals by another —
  // and the small-integer exemption above would wave every one of them through, because a
  // percentage is by definition ≤ 100. So a figure wearing a % sign loses the exemption and
  // must appear in the facts like any other claim. We do compute shares in some metrics; those
  // still pass, because they are in the block.
  const pct = foldDigits(text).match(/(\d+(?:\.\d+)?)\s*(?:%|٪|بالمئة|بالمية|في المئة)/g);
  if (pct) {
    const bad = pct
      .map((p) => normalise(Number(p.replace(/[^\d.]/g, ''))))
      .filter((n) => !allowed.has(n));
    if (bad.length) return { ok: false, reason: 'DERIVED_PERCENTAGE', detail: bad.join(' · ') };
  }

  // ── CONTAINMENT ──────────────────────────────────────────────────────────────────────────
  // THE defect this guard exists for, and the one the number check alone cannot catch: both
  // figures are ours and correct, and the SENTENCE JOINING THEM is false. Observed on this
  // surface — «٨٠ طلبًا بانتظار الموافقة، ومن بينها ١٢٣ طالبًا», inventing a containment
  // relationship between two counts that are simply separate facts.
  //
  // The rule is not "never say منها" — revenue_summary's own facts say «منها حصة الإدارة»,
  // and an answer echoing that is correct. The rule is that the model may only assert a
  // containment WE asserted: the connective has to be in the facts block before it may appear
  // in the answer.
  const CONTAINMENT_RE = /منها|من بينها|من ضمنها|ومنها/;
  if (CONTAINMENT_RE.test(text) && !CONTAINMENT_RE.test(String(factsText || ''))) {
    return { ok: false, reason: 'INVENTED_CONTAINMENT', detail: '' };
  }

  return { ok: true };
}

module.exports = { inspect, _internals: { numbersIn, foldDigits, normalise } };
