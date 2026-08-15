// backend/lib/mood.js — which face «لولو» wears' EMOTIONAL cousin: not the topic (that's
// supportActions.pickEmotion), the REGISTER of the exchange.
//
// WHY A SEPARATE FIELD FROM `emotion`. `pickEmotion` answers "what was this message ABOUT"
// (a price, an order, small talk) so the mascot's face matches the CONTENT. `mood` answers "how
// should the mascot's illustration behave" — a coarser, four-way split the frontend uses to pick
// among a handful of character poses, independent of topic: a sad customer asking about a price
// still gets the caring pose, not the price pose.
//
// PURE, KEYWORD-HEURISTIC, ON PURPOSE. No model call, no DB — this exists to be instant and
// testable, and a wrong mood is a wrong illustration, not a wrong fact, so the cheap method is
// the right one (same trade-off documented in supportActions.js for `topicOf`).
//
// ORDER OF THE CHECKS IS LOAD-BEARING: sadness beats a compliment beats "don't know" beats the
// 'happy' default, so «شكرا بس اني تعبانة اليوم» reads as caring, not wink.

const { _internals: actionInternals } = require('./supportActions');

// A customer expressing sadness, tiredness or frustration — reused word-for-word from
// supportActions' own social-tone list so the two files never disagree about what "sad" looks
// like in Iraqi Arabic.
const SAD_RE =
  /حزين|حزينة|زعلان|زعلانة|تعبان|تعبانة|مو زين|ماتحبني|ما تحبني|مخنوق|مخنوقة|متضايق|متضايقة|زهقان|زهقانة|مكتئب|مكتئبة|وحيد|وحيدة|احبطت|أحبطت|مرهق|مرهقة/;

// A compliment aimed at لولو or the shop — playful/joking register, the "wink" mood. Kept
// narrower than supportActions' SOCIAL_RE (which also matches greetings and thank-yous, both
// ordinary 'happy' territory here).
const COMPLIMENT_RE =
  /معجب|معجبة|حلو شغلك|حلو شغلكم|حلوين|رهيبين|روعة|تسلم ايدك|تسلم إيدك|عاشت ايدك|عاشت إيدك|أحسنتم|احسنتم|ذوقكم حلو|شغلكم حلو|أفضل محل|احلى محل|أحلى محل|احبك|أحبك|بحبك/;

/**
 * Which illustration the assistant's answer earns.
 *
 * @param {string} question    the customer's own words
 * @param {string} answerText  what لولو actually said (guard fallbacks and «مو متوفرة»
 *                             answers share DUNNO_RE with supportActions, so they land 'neutral'
 *                             for free — no separate error/guard flag needed)
 * @returns {'wink'|'caring'|'happy'|'neutral'}
 */
function classifyMood(question, answerText = '') {
  const q = String(question || '');
  const a = String(answerText || '');

  // Sadness first: a customer being sad outranks anything else in the message, including a
  // compliment paid in the same breath («تسلم ايدك بس اني تعبانة»).
  if (SAD_RE.test(q)) return 'caring';

  if (COMPLIMENT_RE.test(q)) return 'wink';

  // Reached the edge of what لولو knows — a guard fallback, or an honest «مو متوفرة» — is not a
  // happy moment, but it is not sad or playful either.
  if (!a.trim() || actionInternals.DUNNO_RE.test(a)) return 'neutral';

  return 'happy';
}

module.exports = { classifyMood, _internals: { SAD_RE, COMPLIMENT_RE } };
