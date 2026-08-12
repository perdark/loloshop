// backend/lib/supportActions.js — the tappable next step under every answer, and the face
// the mascot wears while giving it.
//
// ── WHY THE SERVER DECIDES THIS ────────────────────────────────────────────────────────────
// The obvious design is to let the model emit its own links. That is exactly the design that
// lets a prompt-injected model publish a link to anywhere, and it puts a hallucinated URL one
// bad completion away from a customer. So the model never sees a URL and never writes one.
// The server picks from a CLOSED list of the shop's own destinations, using the question, the
// facts it already looked up, and whether the guard tripped. An injected prompt can change the
// prose; it cannot add a destination that is not in this file.
//
// ── WHY IT MATTERS MORE THAN IT LOOKS ──────────────────────────────────────────────────────
// The assistant is the shop's main marketing surface (owner, 2026-08-12). Before this, an
// answer like «راجع ممثل جامعتك» or «شوف الخريطة بآخر الصفحة» was dead text: correct, and a
// dead end on a phone. The rep's number came back as digits the student had to select and copy.
// Every answer now ends somewhere they can tap.
//
// Matching is deliberately keyword-based rather than a second model call: it is free, instant,
// deterministic, and testable — and a wrong chip is a wasted tap, not a wrong fact, so the
// cheap method is the right one.

const INSTAGRAM = 'https://instagram.com/lolo_shop96';
const MAP = 'https://maps.app.goo.gl/tjfh7JuSQGqNVUEd9';

/**
 * Iraqi local form (07XXXXXXXXX) to the international digits wa.me wants (9647XXXXXXXXX).
 * Returns null for anything that is not a plausible number, so a malformed rep phone becomes
 * "no chip" rather than a link to nowhere.
 */
function waNumber(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('964')) return digits.length >= 12 ? digits : null;
  if (digits.startsWith('07')) return digits.length === 11 ? `964${digits.slice(1)}` : null;
  if (digits.startsWith('7')) return digits.length === 10 ? `964${digits}` : null;
  return null;
}

const waLink = (num, text) =>
  `https://wa.me/${num}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

/** Where «تواصل مع الفريق» goes. WhatsApp when the shop has configured a number, Instagram
 *  otherwise — the fallback is always correct, so escalation is never a dead button. */
function shopContact() {
  const num = waNumber(process.env.SHOP_WHATSAPP);
  return num
    ? { id: 'contact', label: 'تواصل مع الفريق', kind: 'external', href: waLink(num, 'مرحباً، عندي سؤال عن') }
    : { id: 'contact', label: 'راسلنا على إنستغرام', kind: 'external', href: INSTAGRAM };
}

// Topic detection. Each list is the words Iraqi customers actually use — taken from the real
// question log in ai_chat_messages, not invented: «شكد سعر الروب؟», «وين وصل طلبي؟»,
// «منو ممثل جامعتي وشنو رقمه؟», «وين انتوا ؟».
const TOPICS = [
  ['order', /طلب(ي|اتي)?|وين وصل|وصل طلب|حالة|حالت|وضع طلب|متابعة|اتابع|تتبع/],
  ['price', /سعر|اسعار|أسعار|شكد|شگد|بكم|كلف|كلفة|تكلفة|غالي|رخيص|خصم|عرض/],
  ['rep', /ممثل|مندوب|ممثلي|ممثلة|مسؤول (جامعت|كليت)/],
  ['location', /وين(كم| انتوا| المحل)?|موقع|عنوان|محل|فرع|خريطة|اجيكم|أجيكم/],
  ['design', /صمم|أصمم|اصمم|تصميم|ارسم|أرسم|شلون اسوي|شلون أسوي/],
  ['size', /مقاس|قياس|مقاسات|طول|وزن|مقاسي/],
  ['product', /وشاح|شال|روب|قبعة|منتج|قطع|موديل|الوان|ألوان/],
];

function topicOf(question) {
  const q = String(question || '');
  for (const [name, re] of TOPICS) if (re.test(q)) return name;
  return null;
}

// The assistant said, in one phrasing or another, that it does not know. Worth detecting
// because that is precisely the moment a customer should be handed to a person instead of
// being left holding an apology.
const DUNNO_RE =
  /ما (عندي|أعرف|اعرف|أكدر أجاوب|اكدر اجاوب)|مو متوفر|مو موجود عندي|ما عندي علم|تأكد من|راجع ممثل/;

/**
 * The chips to show under one answer.
 *
 * @returns {Array<{id,label,kind,href}>} at most three — a phone screen, and a wall of
 *          buttons reads as a menu, which is the opposite of a conversation.
 */
function buildActions({ question, answer = '', profile = null, guardTripped = false, signedIn = false }) {
  const topic = topicOf(question);
  const out = [];
  const push = (a) => {
    if (a && !out.some((x) => x.id === a.id)) out.push(a);
  };

  // A tripped guard means the answer was replaced with one that says "ask a human" — so the
  // way to reach a human has to be the first thing under it, before anything else.
  if (guardTripped) {
    push(shopContact());
    push({ id: 'shop', label: 'شوف القطع', kind: 'internal', href: '/shop' });
    return out.slice(0, 3);
  }

  switch (topic) {
    case 'order':
      // Signed out, the honest chip is the sign-in — the bot genuinely cannot see their order.
      push(
        signedIn
          ? { id: 'my-order', label: 'تابع طلبك', kind: 'internal', href: '/my-order' }
          : { id: 'login', label: 'سجّل دخولك وشوف طلبك', kind: 'internal', href: '/login' }
      );
      break;
    case 'price':
      push({ id: 'shop', label: 'شوف الأسعار كلها', kind: 'internal', href: '/shop' });
      break;
    case 'location':
      push({ id: 'map', label: 'افتح الموقع بالخريطة', kind: 'external', href: MAP });
      break;
    case 'design':
      push({ id: 'shop', label: 'ابدأ من القطع', kind: 'internal', href: '/shop' });
      break;
    case 'size':
      push({ id: 'sizes', label: 'جدول المقاسات', kind: 'internal', href: '/sizes' });
      break;
    case 'product':
      push({ id: 'shop', label: 'شوف القطع', kind: 'internal', href: '/shop' });
      break;
    default:
      break;
  }

  // The rep's phone arrives as digits inside the answer, which on a phone is something to
  // squint at and copy. If we know it, it becomes one tap.
  const repNum = waNumber(profile?.repPhone);
  if (repNum && (topic === 'rep' || topic === 'order')) {
    push({
      id: 'rep',
      label: profile?.repName ? `كلّم ${profile.repName}` : 'كلّم ممثلك',
      kind: 'external',
      href: waLink(repNum, 'مرحباً، آني طالب من جامعتك'),
    });
  }

  // Reaching the edge of what it knows is the other moment a human helps more than a retry.
  if (DUNNO_RE.test(answer)) push(shopContact());

  // Never leave an answer with nowhere to go — this is the shop's marketing surface, and a
  // dead end is a lost customer. The catalogue is the safe universal next step.
  if (!out.length) push({ id: 'shop', label: 'شوف القطع', kind: 'internal', href: '/shop' });

  return out.slice(0, 3);
}

/**
 * Which face the mascot wears with this answer.
 *
 * Chosen by the server so it matches the CONTENT, not merely the request lifecycle — the
 * client already knows when it is waiting, but only the server knows the answer was a price
 * list rather than a shrug. Names match frontend/public/lolo/lolo-<emotion>.webp.
 */
function pickEmotion({ question, answer = '', guardTripped = false }) {
  if (guardTripped) return 'thinking';
  if (/^\s*(هلا|هلو|سلام|السلام|مرحبا|مرحباً|صباح|مساء|شلونك|هاي)/.test(String(question))) return 'love';
  if (/شكرا|شكراً|تسلم|ممنون|احسنت|أحسنت|يعطيك العافية/.test(String(question))) return 'love';
  if (DUNNO_RE.test(answer)) return 'thinking';
  const topic = topicOf(question);
  if (topic === 'price' || topic === 'product' || topic === 'design') return 'excited';
  if (topic === 'order') return 'happy';
  return 'happy';
}

module.exports = {
  buildActions,
  pickEmotion,
  shopContact,
  _internals: { waNumber, topicOf, DUNNO_RE, INSTAGRAM, MAP },
};
