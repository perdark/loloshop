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
// ── `none` IS THE COMMON CASE, AND MUST STAY THAT WAY ──────────────────────────────────────
// «شكد سعر الروب؟» earns no reaction. A face that jumps on every single reply is noise, and a
// reaction that fires always is not a reaction — it is an animation. Every regex below is
// deliberately narrow for that reason: it must MISS an ordinary question, not catch it.
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

// Laughter. `ه{3,}` and not `هه`, because two of them appear inside ordinary words while three
// in a row is only ever someone laughing. Iraqi typing also uses خخخ.
const LAUGH_RE = /ه{3,}|خ{3,}|[\u{1F602}\u{1F923}\u{1F639}\u{1F606}\u{1F605}]/u;

// Thanks, congratulations, and plain delight. `تخرجت` is in here on purpose: on a graduation
// shop, a student announcing they graduated is the single most cheerful sentence in the inbox.
const CHEER_RE =
  /شكرا|شكراً|شكرًا|تسلم|تسلمين|ممنون|ممنونة|يعطيك العافية|مبروك|مبارك|الف مبروك|ألف مبروك|تخرجت|تخرجنا|نجحت|نجحنا|خلصت|تمام|ممتاز|رهيب|روعة|[\u{1F389}\u{1F973}\u{1F44F}\u{1F64C}]/u;

/**
 * لولو's reaction to one message from the student.
 *
 * ORDER IS LOAD-BEARING, and it is the same precedence lib/mood.js already uses: sadness
 * outranks everything, including a compliment paid in the same breath («تسلم ايدك بس اني
 * تعبانة» — that student gets the caring beat, not the heart). Affection then outranks
 * laughter, and laughter outranks a plain thank-you.
 *
 * @param {string} question      the student's own words
 * @param {object} [opts]
 * @param {boolean} [opts.guardTripped]  the answer was blocked and replaced with a safe
 *   fallback. Whatever the student wrote, لولو is about to say «اسأل ممثلك» — a face cheering
 *   over that reads as not listening, so the beat is suppressed entirely.
 * @returns {'love'|'care'|'laugh'|'cheer'|'none'}
 */
function pickReaction(question, { guardTripped = false } = {}) {
  if (guardTripped) return 'none';

  const q = String(question || '');
  if (!q.trim()) return 'none';

  if (SAD_RE.test(q)) return 'care';
  if (COMPLIMENT_RE.test(q) || HEART_RE.test(q)) return 'love';
  if (LAUGH_RE.test(q)) return 'laugh';
  if (CHEER_RE.test(q)) return 'cheer';
  return 'none';
}

module.exports = {
  pickReaction,
  _internals: { HEART_RE, LAUGH_RE, CHEER_RE },
};
