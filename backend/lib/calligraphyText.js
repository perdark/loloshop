// backend/lib/calligraphyText.js
// Is this string a NAME we can hand to the paid calligraphy generator, or is it a MESSAGE
// the student wrote to a human?
//
// WHY THIS EXISTS. `order_items.customer_text` is a free-text box. On the rep full-set form it
// is labelled «تطريز الوشاح من الأمام» and students mostly type their name — but a real slice
// of them type a request instead, addressed to the shop:
//
//     «نفس الصوره»                        «تطريز هذه الصورة فقط»
//     «نفس الي بالصورة بس اصغر»           «نبأ اوريد نفس الخط الموجود في الصورة»
//
// The generator had no idea and rendered those WORDS as Thuluth calligraphy — a paid image of
// the sentence "same as the photo" — and then (before migration 080) overwrote the very photo
// the sentence was pointing at. 55 orders ended up carrying a junk 'done' plate, which made
// `poolFor` skip them forever: they sit in a designer's «يخصّني الآن» and are invisible in the
// calligraphy queue, because the queue's whole definition of "needs work" is "has no done plate".
//
// So this module is the gate BEFORE the money is spent. A flagged line is not silently dropped —
// `getQueue` returns it under `needs_review` so the designer sees exactly what the generator
// refused and can retype the real name (calligraphyController.reroll takes a `render_text`
// override for precisely this).
//
// CALIBRATION. A false positive costs a designer ten seconds of retyping. A false negative costs
// a paid image and puts an order back in the invisible bucket. Both are recoverable, neither is
// free — so the matching is deliberately narrow and token-based rather than clever: only explicit
// markers fire, never length or "feels like a sentence". Substring matching was rejected outright
// because «منصور» contains «صور».

// Arabic diacritics + tatweel carry no lexical meaning here.
const DIACRITICS = /[ً-ْٰـ]/g;

/** Fold the orthographic variants students actually type (أ/إ/آ→ا, ى→ي, ة→ه). */
function normalizeAr(value) {
  return String(value || '')
    .replace(DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[ؤئ]/g, 'ء');
}

// Clitics Arabic glues onto the front of a word: «بالصورة» is «صورة» with بـ + الـ.
// Longest first, so «بال» wins over «ب». Only ONE pass — «وبالصورة» is covered explicitly
// rather than by looping, because repeated stripping starts eating real names.
const PREFIXES = ['وبال', 'فبال', 'وال', 'فال', 'بال', 'كال', 'لل', 'ال', 'و', 'ف', 'ب', 'ك', 'ل'];
function stripPrefix(token) {
  for (const p of PREFIXES) {
    if (token.length > p.length + 1 && token.startsWith(p)) return token.slice(p.length);
  }
  return token;
}

// Every marker below is a word that appears in a request and never inside an Iraqi name.
// Tokens are checked BOTH raw and prefix-stripped, so «بالصوره» and «بس» both land.
// TWO CATEGORIES ONLY, and the shortlist is deliberate. An earlier, wider version was measured
// against the live embroidery text on 2026-08-13 and flagged real work:
//   · «الحمدلله هذا ماسعيت له وهذا ماوعدني به ربي» — matched «هذا»
//   · «الى عائلتي انتم حكاية نجاحي»                — matched «الي», because «الى» normalises to it
//   · «كل نفس ذائقة الموت»                          — would match «نفس»
// The back of a sash is where students put dedications and Quranic verses, so pointing words,
// «نفس», «مثل», «فقط» and «الخط» all appear there legitimately. They are gone.
//
// What remains catches ALL FOUR instructions measured on prod anyway — every one of them names
// a photo — at a fraction of the false-positive surface. A false positive HOLDS real work out
// of the queue, which is the very failure this bug is about, so the rule is: fire only on an
// explicit reference to an attached image, or an explicit request/command verb.
const INSTRUCTION_WORDS = new Set([
  // (1) the photo the student is pointing at — present in every measured case
  'صوره', 'صور', 'صورتي', 'صورته', 'صورها', 'الصوره', 'مرفق', 'مرفقه', 'المرفقه', 'مرفوعه',
  // (2) asking. FIRST PERSON SINGULAR ONLY. «يريد»/«نريد» were dropped after they flagged
  // ﴿مَّن كَانَ يُرِيدُ ثَوَابَ الدُّنْيَا﴾ on the live table — third-person "wants" belongs to
  // scripture, not to a student writing to the shop, and verses are common on the back of a sash.
  'اريد', 'اوريد', 'ابغي', 'ابغى', 'ارجو', 'رجاء', 'رجاءا', 'ممكن', 'فضلك',
  // (2) commanding
  'اكتب', 'اكتبوا', 'اكتبي', 'سوي', 'سووا', 'حط', 'حطوا', 'ضع', 'ضعوا', 'خلي', 'خليها',
  'غيروا', 'عدل', 'بدل', 'احذف', 'الغي', 'الغاء', 'يرجي', 'يرجى', 'طباعه',
  // talking ABOUT the work rather than being the work. «تطريز» never appears in a dedication;
  // «تصميم» «شعار» «حرف» «حروف» do (real departments: «قسم تصميم الأزياء», «الحرف اليدوية»).
  'تطريز', 'تطريزه',
]);

// A real embroiderable name has at least two Arabic letters. Rejects pure numbers, Latin,
// emoji, single chars and punctuation so the PAID generator is never spent on junk (the "no
// API call for a retarded name" guard). This is the server-side choke point; the UI mirrors it.
//
// ⚠️ The diacritic strip is LOAD-BEARING, not tidiness. Tatweel (ـ, U+0640) sits INSIDE the
// ء–ي range, so the original guard in calligraphyController counted it as a letter and «ـــ»
// bought a paid image — despite the comment there claiming the opposite. Stripping first is
// what finally makes that claim true. It cannot reject a real name: a stretched «مـحـمـد»
// still has six real letters after the strip.
const ARABIC_LETTER = /[ء-يٱ-ۓۺ-ۼ]/g;
function isRealName(text) {
  const m = normalizeAr(text).match(ARABIC_LETTER);
  return !!m && m.length >= 2;
}

/**
 * True when the text reads as a message to the shop rather than something to embroider.
 * Returns the matched marker via `instructionMarkers` when the caller needs to show the
 * designer WHY a line was held back.
 */
function instructionMarkers(text) {
  const tokens = normalizeAr(text)
    .split(/[^ء-ي٠-٩a-zA-Z0-9]+/)
    .filter(Boolean);
  const hits = [];
  for (const tok of tokens) {
    if (INSTRUCTION_WORDS.has(tok) || INSTRUCTION_WORDS.has(stripPrefix(tok))) hits.push(tok);
  }
  return hits;
}

function looksLikeInstruction(text) {
  return instructionMarkers(text).length > 0;
}

/**
 * The one question every caller actually asks: may we spend a paid generation on this string?
 * `{ ok }` plus an Arabic reason the UI can print verbatim.
 */
function checkRenderText(text) {
  const clean = String(text || '').trim();
  if (!clean) return { ok: false, reason: 'nonempty', message: 'النص فارغ' };
  if (!isRealName(clean)) {
    return { ok: false, reason: 'junk', message: 'يجب أن يحتوي النص على حروف عربية' };
  }
  const markers = instructionMarkers(clean);
  if (markers.length) {
    return {
      ok: false,
      reason: 'instruction',
      markers,
      message: `هذا النص تعليمات للمحل وليس اسماً للتطريز (${markers.slice(0, 3).join('، ')}) — اكتب الاسم الصحيح`,
    };
  }
  return { ok: true };
}

module.exports = {
  isRealName, looksLikeInstruction, instructionMarkers, checkRenderText, normalizeAr,
};
