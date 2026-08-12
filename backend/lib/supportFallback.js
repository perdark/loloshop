// backend/lib/supportFallback.js — answers that need no model at all.
//
// ── WHY ────────────────────────────────────────────────────────────────────────────────────
// The assistant is the shop's main marketing surface (owner, 2026-08-12): it is the second
// thing on the home page, and «المساعد مو متوفر» there is worse than having no assistant. But
// it depends on a third-party API over an Iraqi network, so it WILL be unreachable sometimes —
// an OpenRouter incident, a timeout, an expired key, an exhausted daily ceiling.
//
// The response cache covers the repeat of a question somebody already asked. This covers the
// first one. The shop's most common questions have answers that are pure data — the price book
// we already computed, and facts the owner has fixed («ماكو توصيل», «كاش فقط») — so when the
// model is unreachable the honest thing is not an error, it is the answer, written out of the
// same numbers the model would have been handed.
//
// ── THE RULE THAT KEEPS THIS SAFE ──────────────────────────────────────────────────────────
// Every sentence here is built from data the caller was already entitled to see, and matches
// only on an unambiguous topic. When nothing matches with confidence it returns null and the
// caller surfaces a real error — a fallback that guesses would be a worse failure than the
// outage it is covering. It never touches order status: that is per-customer, it is the one
// thing worth being unavailable over, and «سجّل دخولك» is not an answer to «وين وصل طلبي؟».

const PATTERNS = [
  // Prices — the single most asked question the shop gets, and the one whose answer is
  // already sitting in a variable by the time we get here.
  {
    id: 'price',
    re: /سعر|اسعار|أسعار|شكد|شگد|بكم|بيش|كلف|تكلفة/,
    build: ({ priceBlock }) =>
      priceBlock &&
      `${priceBlock.replace(/^قائمة الأسعار \(أسعار البداية\):\n/, 'هذي أسعارنا (أسعار البداية):\n')}`,
  },
  {
    id: 'delivery',
    re: /توصيل|يوصل|شحن|ديليفري|تجهيز.*بيت|يجيني للبيت/,
    build: () =>
      'ماكو توصيل ولا شحن نهائياً — لا لبغداد ولا لأي محافظة. الاستلام يكون من محلنا ببغداد، '
      + 'وإذا إنت طالب جامعة ممثل جامعتك هو اللي يرتّب معك الاستلام.',
  },
  {
    id: 'payment',
    re: /دفع|ادفع|أدفع|فيزا|ماستر|بطاقة|كاش|زين كاش|كي كارد|تحويل|قسط/,
    build: () =>
      'الدفع نقدي فقط (كاش) عند الاستلام. ماكو دفع إلكتروني ولا بطاقات ولا تحويل.',
  },
  {
    id: 'location',
    re: /وين(كم| انتوا| المحل)|موقع|عنوان|المحل|فرع|خريطة|اجيكم|أجيكم/,
    build: () =>
      'عدنا محل ببغداد، وتلگاه على خرائط كوكل باسم «مطبعة لولو شوب» — أو من زر الموقع تحت.',
  },
  {
    id: 'howto',
    re: /شلون أطلب|شلون اطلب|كيف أطلب|كيف اطلب|شلون أشتري|شلون اشتري|طريقة الطلب/,
    build: () =>
      'إذا إنت طالب جامعة، الطلب يمر عن طريق ممثل جامعتك وهو اللي يوافق عليه. وإذا طلب شخصي، '
      + 'تكدر تختار القطعة من صفحة القطع وتكمل طلبك من هناك.',
  },
];

/**
 * A model-free answer for this question, or null when none applies with confidence.
 *
 * @param {object}  ctx
 * @param {string}  ctx.question
 * @param {string?} ctx.priceBlock  the price book already built for this caller's role
 */
function answerFor({ question, priceBlock = null }) {
  const q = String(question || '');
  for (const p of PATTERNS) {
    if (!p.re.test(q)) continue;
    const text = p.build({ priceBlock });
    if (text) return { id: p.id, text };
  }
  return null;
}

module.exports = { answerFor, _internals: { PATTERNS } };
