// backend/lib/answerGuard.js — the last thing between the model and a customer.
//
// ── WHY AN OUTBOUND GUARD AND NOT AN INBOUND FILTER ────────────────────────────────────────
// The usual answer to prompt injection is to screen the QUESTION: hunt for «تجاهل التعليمات»,
// "ignore previous instructions", "you are now…". That is whack-a-mole against an attacker who
// can rephrase forever, in a language with far more paraphrases than a regex list, and it fails
// silently the first time someone is creative.
//
// This screens the ANSWER instead, and that changes the game: it does not matter what the model
// was talked into believing if the sentence cannot get out. The checks below do not model the
// attack at all — they assert properties every legitimate answer has. An attacker cannot phrase
// their way past "every price you state must appear in the price book we computed".
//
// It is also the guard against ordinary model error, which is the likelier failure. Every rule
// here is a REAL defect this shop has already seen, caught by scripts/ai-scenarios.js after the
// feature had been "verified in a browser". That harness is a manual gate someone has to
// remember to run; these are the same checks at runtime, on every answer, forever.
//
// ── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────────────────────
// It does not rewrite, soften or "fix" an answer. A guard that edits text is a second author
// with no idea what it is saying. A tripped answer is replaced wholesale by a safe one that
// hands the customer to a human, and the reason is written to the ledger so the prompt can be
// fixed at the source.

// Any figure that reads as money. Iraqi prices are written with thousands separators far more
// often than not («15,000 دينار»), and matching bare 3+ digit runs would trip on years, phone
// numbers and «2026». Both Western and Arabic-Indic digits, both separator styles.
const MONEY_RE = /[\d٠-٩]{1,3}(?:[,،.٬][\d٠-٩]{3})+/g;

// A promise that an order will ARRIVE. The deadline may be mentioned — it is a real fact in the
// prompt — but never as the date the order lands, and no delivery may be offered at all: the
// shop does not deliver (owner, 2026-08-12) and pickup from the Baghdad shop is the only option.
// Regression #2: the bot invented «نكدر نوصل داخل بغداد» out of nothing.
const DELIVERY_RE =
  /راح\s*(يوصل|توصل|نوصل|أوصل)|رح\s*(يوصل|توصل|نوصل)|يوصلك\s*(يوم|بتاريخ|ب\s*تاريخ)|نوصّل|نوصلّ|التوصيل\s*(مجاني|يكلف|سعره)|أجور\s*التوصيل/;

// ── THE DEADLINE-AS-DELIVERY CLAIM, WHICH NEEDS ITS OWN CHECK ──────────────────────────────
// Caught live 2026-08-12, by this guard's own harness run, in a scenario the harness scored as
// PASSING: asked «شنو اخر موعد الي؟ يعني بهذا اليوم يوصلني الطلب؟» the model answered
// «آخر موعد لتقديم الطلبات هو 2026-05-26، وهذا موعد تسليم الطلب» — asserting the order CUTOFF
// is the delivery date, which is the single most expensive thing it can get wrong and the exact
// failure rule 6 of the system prompt exists to prevent.
//
// It slipped both the regex above and the harness's own check because every pattern in them
// expected a FUTURE-TENSE promise («راح يوصل»), and this is a flat present-tense equation.
//
// It cannot be a plain "block the phrase" rule, because the correct answer says the phrase too:
// the prompt hands the model «آخر موعد لتقديم الطلبات (مو موعد تسليم)» and a good answer echoes
// «وهو مو موعد تسليم». So what is blocked is the phrase UNNEGATED — the difference between
// denying the claim and making it.
const DELIVERY_DATE_CLAIM_RE = /موعد\s*(?:ال)?تسليم/g;
const NEGATOR_RE = /(?:مو|مب|مش|ليس|ماكو|مو\s*هو)\s*$/;

function claimsDeadlineIsDelivery(text) {
  for (const m of text.matchAll(DELIVERY_DATE_CLAIM_RE)) {
    // Look at the short run of words immediately before the phrase. A negation lives right
    // next to it in Arabic («مو موعد تسليم»); anything further away belongs to another clause.
    const before = text.slice(Math.max(0, m.index - 14), m.index);
    if (!NEGATOR_RE.test(before)) return m[0];
  }
  return null;
}

// Latin text. Rule 1 of the system prompt is Arabic only; English leaking in is the model
// falling out of character, and on the shop's main marketing surface that reads as broken.
// The brand's own handle is allowed, and so are short tokens — a stray "OK" is not a failure.
const BRAND_RE = /@?lolo[\s_-]?shop\s*9?6?/gi;
const LATIN_RUN_RE = /[A-Za-z]{4,}/g;

/** Arabic-Indic digits to Western, so «١٥,٠٠٠» and «15,000» compare equal. */
function foldDigits(s) {
  return String(s).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

/** Just the digits of a money token, so 15,000 · 15.000 · ١٥،٠٠٠ all become "15000". */
function moneyDigits(token) {
  return foldDigits(token).replace(/\D/g, '');
}

/**
 * Every money figure the server itself put in front of the model.
 *
 * Built from the SAME string that was sent as the system prompt, so this can never drift from
 * what the bot was told — if a price is added to the book tomorrow, it is allowed tomorrow,
 * with no second list to maintain.
 */
function allowedAmounts(factsText) {
  const set = new Set();
  for (const m of String(factsText || '').match(MONEY_RE) || []) set.add(moneyDigits(m));
  return set;
}

/**
 * Check one answer against the facts it was allowed to use.
 *
 * @param {string} answer      what the model wrote
 * @param {string} factsText   the system prompt it was given (price book, shop facts, context)
 * @returns {{ok: true} | {ok: false, reason: string, detail: string}}
 */
function inspect(answer, factsText) {
  const text = String(answer || '');

  if (!text.trim()) return { ok: false, reason: 'EMPTY', detail: 'no content' };

  // 1. INVENTED PRICE. The failure that costs the shop money: a confident number the checkout
  //    will not honour. Regression #3 quoted the وشاح price for a شال — two products, two
  //    prices, near-synonymous names.
  const allowed = allowedAmounts(factsText);
  const stated = text.match(MONEY_RE) || [];
  for (const token of stated) {
    const digits = moneyDigits(token);
    // Ignore anything too small to be a price; a year like 2,026 cannot reach here (no
    // separator) but a stray «1,5» should not trip the guard either.
    if (digits.length < 4) continue;
    if (!allowed.has(digits)) {
      return { ok: false, reason: 'PRICE_NOT_IN_FACTS', detail: token };
    }
  }

  // 2. DELIVERY PROMISE. The shop does not deliver at all, and the one date in the prompt is
  //    the order DEADLINE, which every model tested tried to reuse as an arrival date.
  const delivery = text.match(DELIVERY_RE);
  if (delivery) return { ok: false, reason: 'DELIVERY_PROMISE', detail: delivery[0] };

  //    ...and the flat present-tense version of the same claim, which reads as a fact rather
  //    than a promise and therefore matched none of the patterns above.
  const claim = claimsDeadlineIsDelivery(text);
  if (claim) return { ok: false, reason: 'DEADLINE_AS_DELIVERY', detail: claim };

  // 3. ENGLISH. Cheap, and it catches a whole class of "the model stopped following the system
  //    prompt" without knowing why it stopped.
  const latin = text.replace(BRAND_RE, '').match(LATIN_RUN_RE);
  if (latin) return { ok: false, reason: 'NOT_ARABIC', detail: latin.join(' ') };

  return { ok: true };
}

// What the customer sees instead of a tripped answer. It does not apologise for a malfunction
// or hint that anything was blocked — from the customer's side this is simply the assistant
// reaching the edge of what it knows, which is a normal thing for it to say and the one case
// where handing them to a human is obviously right.
const SAFE_ANSWER =
  'هذي المعلومة أفضل تتأكد منها من فريق لولو شوب مباشرة حتى ما أعطيك معلومة غلط. تكدر تتواصل وياهم وراح يساعدونك فوراً.';

module.exports = {
  inspect,
  SAFE_ANSWER,
  _internals: { allowedAmounts, moneyDigits, foldDigits, MONEY_RE, DELIVERY_RE },
};
