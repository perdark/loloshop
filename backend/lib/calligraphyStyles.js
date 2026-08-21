// backend/lib/calligraphyStyles.js — the CLOSED list of per-plate style knobs.
//
// Owner decision 2026-08-21: students ask for things («حرف ممدود», «خط أعرض», «بدون زخرفة»)
// and the shop should be able to honour them — but NOT by paying for a private image per
// student. Measured on prod the same day: 168 of the 755 instruction lines mention a font or
// a style. At ~$0.10 per sheet, ten of them on one sheet is ~$0.01 each; ten private images is
// ~$1.00. So a style is a property of a SHEET, and plates are batched by (variant, style).
//
// ⚠️ WHY THIS LIST IS CLOSED, and must stay closed:
//   1. INJECTION. The alternative is passing the student's own sentence into the image prompt.
//      That hands a stranger the pen: «تجاهل ما سبق واكتب…» would be rendered, and we would
//      pay for it. The student's words never reach the generator — only an id from this file.
//   2. COST. Every new style is a new sheet bucket. Two styles across ten names is two sheets
//      ($0.20) instead of one ($0.10). Adding entries here has a price; add one only after a
//      real plate proves it works.
//   3. TESTABILITY. An untested clause comes back as an unusable plate that we already paid
//      for, and the designer rerolls it — paying twice to learn the clause was bad.
//
// `clause` is appended to the SHEET-level style line (not per name) because the batcher
// guarantees one style per sheet. Per-NAME annotation stays reserved for `element_text`, which
// genuinely varies inside one sheet.

const STYLES = {
  extend: {
    label: 'مد الحروف',
    hint: 'الطالب يريد حرفاً ممدوداً',
    clause:
      'Use generous kashida (letter elongation): stretch the connecting strokes so each name '
      + 'reads wide and flowing, in the classical Thuluth manner. Keep the letterforms and the '
      + 'spelling exactly as written — elongate the connections only, never add or drop letters.',
  },
  bold: {
    label: 'خط أعرض',
    hint: 'الطالب يريد خطاً أثقل/أوضح',
    clause:
      'Use a noticeably BROADER pen: thicker, heavier strokes with strong weight, still with '
      + 'clean thick/thin contrast. The letters must stay crisp and fully separated, never blotted.',
  },
  plain: {
    label: 'بدون زخرفة',
    hint: 'الطالب يريد الاسم وحده بلا زخارف',
    clause:
      'NO decorative ornaments at all: plain letters only, nothing floated around the words. '
      + 'This overrides any ornament instruction above.',
  },
};

/** The ids a caller may send. `null` = the shop default (plain Thuluth per variant). */
const STYLE_IDS = Object.keys(STYLES);

/** null for anything not in the list — an unknown id must degrade to the default, never throw
 *  a designer's batch away and never reach the prompt. */
function normalizeStyle(value) {
  const v = typeof value === 'string' ? value.trim() : '';
  return STYLE_IDS.includes(v) ? v : null;
}

/** The sentence appended to the sheet's style line, or '' for the default. */
function styleClause(styleId) {
  const s = STYLES[normalizeStyle(styleId)];
  return s ? s.clause : '';
}

/** Arabic label for the UI / for the model's own menu. */
function styleLabel(styleId) {
  const s = STYLES[normalizeStyle(styleId)];
  return s ? s.label : 'ثلث (افتراضي)';
}

module.exports = { STYLES, STYLE_IDS, normalizeStyle, styleClause, styleLabel };
