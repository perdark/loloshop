// backend/lib/reaction.js — what «لولو» DOES the moment she reads what the student wrote.
//
// ── THREE FIELDS, THREE DIFFERENT QUESTIONS ────────────────────────────────────────────────
// The assistant already sends two feelings fields, and a third only earns its place because it
// answers something neither of them does:
//
//   `emotion`  (lib/supportActions.js → pickEmotion) — what the ANSWER is ABOUT. A price, an
//              order, small talk. Drives the big mascot face in the header and the launcher.
//   `mood`     (lib/mood.js → classifyMood) — the REGISTER the reply is written in. Drives the
//              bubble's own tone and the resting face beside it.
//   `reaction` (here) — what لولو does the moment she READS THE STUDENT. Not a state the face
//              settles into: a one-off beat that plays once, big, and then goes away.
//
// The distinction that matters: the other two are computed from the answer as much as the
// question, and they persist. This one is computed from the STUDENT'S OWN WORDS and it expires.
// A student who says «شغلكم حلو» gets a heart the instant لولو reads it — the same way a person
// reacts before they reply.
//
// ── A BARE QUESTION EARNS NOTHING — THAT LINE IS THE WHOLE DESIGN ──────────────────────────
// «شكد سعر الروب؟» gets no reaction. A face that jumps on every single reply is noise, and a
// reaction that fires always is not a reaction — it is an animation. Every regex below is
// written to MISS a plain question, not to catch it.
//
// ⚠️ What changed 2026-08-16, and what did NOT. The owner asked to «make her livelier, react
// more», so the vocabularies were widened (everyday Iraqi approval words, more affection, more
// laughter spellings) and a `greet` beat was added — greetings open nearly every conversation
// and used to score `none`, which is why she felt flat: she met «السلام عليكم» blank and only
// woke up if the student happened to thank her later. `none` is therefore no longer the
// MAJORITY case, and that is the requested change.
// What was NOT relaxed is the line itself: a message with no feeling in it still earns nothing.
// If you widen these further, keep the `none` test below green — the moment «شكد سعر الروب؟»
// or «وين وصل طلبي؟» earns a sticker, the feature has become the animation it was built not to
// be, and every reaction after that reads as لولو not having listened.
//
// ── PURE, KEYWORD-HEURISTIC, ON PURPOSE ────────────────────────────────────────────────────
// Same trade-off lib/mood.js and supportActions.js already document: no model call and no DB,
// so it is instant and testable, and a wrong reaction is a wrong facial expression — never a
// wrong fact. The model is never asked what to feel, because the model is not allowed to decide
// anything the answer guard cannot check.

const { _internals: moodInternals } = require('./mood');

// Sadness and compliments are read with mood.js's OWN regexes, imported rather than copied, so
// «لولو looks caring» and «the bubble goes soft» can never disagree about what a sad message is.
const { SAD_RE, COMPLIMENT_RE } = moodInternals;

// Affection aimed at لولو or the shop that COMPLIMENT_RE does not cover: the emoji a student
// sends instead of words. Hearts only — 👍 and 🙏 are acknowledgement, not affection.
const HEART_RE = /[❤\u{1F9E1}\u{1F49B}\u{1F49A}\u{1F499}\u{1F49C}\u{1F496}\u{1F495}\u{1F60D}\u{1F970}\u{1F618}]/u;

// ── WHY SOME OF THESE ARE BOUNDARY-WRAPPED AND SOME ARE NOT ────────────────────────────────
// Arabic has no casing and these lists are matched against free text, so a SHORT word is a
// substring waiting to happen. Real collisions, all found while widening this on 2026-08-16:
//   «حلو»  is inside «حلول»    → «شنو الحلول؟» would congratulate someone for asking
//   «زين»  is inside «خزين»    → «عندكم خزين؟» likewise
//   «تمام» is inside «اهتمام»  → this one was ALREADY live before today
//   «جميل» is inside «تجميل»
// So: multi-word phrases and long words are matched as plain substrings (they cannot collide),
// while every short standalone word goes through `word()`, which refuses a match that has an
// Arabic letter glued to either side. `\b` is useless here — it is defined on ASCII word
// characters, so it "succeeds" everywhere in Arabic text and buys nothing.
// The boundary is «not a LETTER», written with a Unicode property escape rather than a code
// range. `؀-ۿ` (the whole Arabic block) looked right and is not: it also contains Arabic
// punctuation — «،» is U+060C — so «مرحبا، شكد السعر؟» would fail its own boundary check
// because the comma counts as Arabic. `\p{L}` is letters in any script, which is exactly the
// question being asked: is another letter glued to this word.
const NOT_LETTER_BEFORE = '(?<!\\p{L})';
const NOT_LETTER_AFTER = '(?!\\p{L})';
const word = (alternatives) =>
  new RegExp(`${NOT_LETTER_BEFORE}(?:${alternatives})${NOT_LETTER_AFTER}`, 'u');

// Affection in words that mood.js's COMPLIMENT_RE does not carry. COMPLIMENT_RE is shared with
// the bubble's own tone, so widening it there would change what «wink» means; this stays local
// to the reaction on purpose. Iraqi first person is `اني احبكم` / `احبج` (to a woman).
const AFFECTION_PHRASE_RE = /اموت عليكم|أموت عليكم|الله يخليكم|احبكم|أحبكم|حبيبتي|حبيبي|عاشقة/u;
const AFFECTION_WORD_RE = word('احبج|أحبج|احبچ|عاشق|غاوي|غاوية|تحفة|يجنن|جنان');

// Laughter. `ه{3,}` and not `هه`, because two of them appear inside ordinary words while three
// in a row is only ever someone laughing. Iraqi typing also uses خخخ, and `هع` is its own thing
// — boundary-wrapped, since two loose letters would otherwise turn up inside real words.
const LAUGH_RE =
  /ه{3,}|خ{3,}|ضحكتيني|ضحكتني|مضحك|[\u{1F602}\u{1F923}\u{1F639}\u{1F606}\u{1F605}\u{1F604}\u{1F603}]/u;
const LAUGH_WORD_RE = word('هع|هههع');

// Thanks, congratulations, and plain delight. `تخرجت` is in here on purpose: on a graduation
// shop, a student announcing they graduated is the single most cheerful sentence in the inbox.
// Widened 2026-08-16 on the owner's «make her livelier» call with the everyday Iraqi approval
// words — «زين» «حلو» «عجبني» «خرافي» — which are how a student actually says they are pleased,
// plus the graduation nouns (حفلة التخرج / تخرجي) that the verb-only list was missing.
const CHEER_PHRASE_RE =
  /يعطيك العافية|يعطيكم العافية|الف مبروك|ألف مبروك|حفلة التخرج|حفل التخرج|ولا اروع|ولا أروع|شكرا|شكراً|شكرًا|مشكور|مشكورة|ممنون|ممنونة|تسلمين|تسلمون|تسلم|مبروك|مبارك|تخرجت|تخرجنا|عجبني|عجبتني|ممتاز|خرافي|خرافية|[\u{1F389}\u{1F973}\u{1F44F}\u{1F64C}\u{1F929}\u{1F44D}]/u;
const CHEER_WORD_RE = word(
  'شكرن|تخرجي|نجحت|نجحنا|خلصت|تمام|رهيب|روعة|زين|حلو|حلوة|حلوين|جميل|جميلة|اشطر|أشطر'
);

// A greeting — the lowest-priority beat, and the one that changes the felt liveliness most.
// Almost every conversation opens with one and the old list scored all of them `none`, so لولو
// met «السلام عليكم» with a blank face and started reacting only if the student happened to
// thank her later. It sits LAST in the precedence below so «هلا، شكرا الك» still cheers: a
// greeting is what someone says on the way to their real point, so anything else in the same
// message outranks it.
// ⚠️ Anchored to the START of the message. Unanchored, «هلا» matches inside «اهلا وسهلا بيكم»
// in a student QUOTING us, and `مرحبا` appears mid-sentence in ordinary prose — which is
// exactly how a reaction decays into an animation.
// ⚠️ The trailing guard is `(?!\p{L})`, NOT `\b`. `\b` is defined on ASCII word characters, so
// after an Arabic letter it never fires — an earlier draft of this regex ended in `\b` and
// matched NOTHING AT ALL, silently. Same family of bug as the substring collisions above.
//
// ⛔ «هاي» IS NOT A GREETING HERE AND MUST NOT BE ADDED. In Iraqi Arabic it is the everyday
// demonstrative — «هاي وشاح» is «this is a sash», not «hi, a sash». It was in the first draft
// of this list and the pre-existing `none` test caught it. English «hi» transliterated is rare
// enough in this inbox that catching it is not worth reacting to a pronoun.
const GREET_RE = new RegExp(
  `^\\s*(?:السلام عليكم|سلام عليكم|سلام|هلا|هلو|اهلا|أهلا|اهلين|مرحبا|مرحبتين|صباح الخير|مساء الخير|هالو|شلونك|شلونكم|شخبارك|شخباركم|كيفك|كيفكم)${NOT_LETTER_AFTER}`,
  'u'
);

/**
 * لولو's reaction to one message from the student.
 *
 * ORDER IS LOAD-BEARING, and it is the same precedence lib/mood.js already uses: sadness
 * outranks everything, including a compliment paid in the same breath («تسلم ايدك بس اني
 * تعبانة» — that student gets the caring beat, not the heart). Affection then outranks
 * laughter, laughter outranks a plain thank-you, and a GREETING comes last of all — it is
 * what someone says on the way to their real point, so anything else in the message wins.
 *
 * @param {string} question      the student's own words
 * @param {object} [opts]
 * @param {boolean} [opts.guardTripped]  the answer was blocked and replaced with a safe
 *   fallback. Whatever the student wrote, لولو is about to say «اسأل ممثلك» — a face cheering
 *   over that reads as not listening, so the beat is suppressed entirely.
 * @returns {'love'|'care'|'laugh'|'cheer'|'greet'|'none'}
 */
function pickReaction(question, { guardTripped = false } = {}) {
  if (guardTripped) return 'none';

  const q = String(question || '');
  if (!q.trim()) return 'none';

  if (SAD_RE.test(q)) return 'care';
  if (
    COMPLIMENT_RE.test(q) ||
    HEART_RE.test(q) ||
    AFFECTION_PHRASE_RE.test(q) ||
    AFFECTION_WORD_RE.test(q)
  ) {
    return 'love';
  }
  if (LAUGH_RE.test(q) || LAUGH_WORD_RE.test(q)) return 'laugh';
  if (CHEER_PHRASE_RE.test(q) || CHEER_WORD_RE.test(q)) return 'cheer';
  if (GREET_RE.test(q)) return 'greet';
  return 'none';
}

module.exports = {
  pickReaction,
  // `word` is exported so a test can prove the Arabic-boundary rule directly rather than only
  // through the vocabularies that happen to use it today.
  _internals: {
    word,
    HEART_RE,
    AFFECTION_PHRASE_RE,
    AFFECTION_WORD_RE,
    LAUGH_RE,
    LAUGH_WORD_RE,
    CHEER_PHRASE_RE,
    CHEER_WORD_RE,
    GREET_RE,
  },
};
