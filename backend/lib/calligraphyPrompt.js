// backend/lib/calligraphyPrompt.js — variant- and style-aware calligraphy prompt builders.
//
// ⚠️ Nothing a STUDENT typed ever reaches these strings. A style arrives as an id from the
// closed list in lib/calligraphyStyles.js and `element` is a single motif word the designer
// approved. The student's own sentence stays on the order line where it belongs.
const { styleClause } = require('./calligraphyStyles');

// ⚠️ TWO RULES PULL AGAINST EACH OTHER HERE, EACH PAID FOR IN REAL PLATES. KEEP BOTH.
//
// 1. NEVER ASK THIS MODEL FOR DIACRITICS. «masterful diacritics» used to sit in this block,
//    and it is the whole of the owner's «الخط زين بس مو زين» (2026-09-14). Measured live
//    against `google/gemini-3.1-flash-image`, same five names, same day:
//      · WITH it — 0 of 5 lines clean. Every name came back vocalised («مُصَطَفَى عَلِي»,
//        «دِيَّالَى» with a shadda that does not belong in the word at all), and the harakat
//        dragged STRAY GLYPHS in with them: a floating «ص» under مصطفى, a «ء» dropped inside
//        علي, an extra «مُ» beside حوم, a second «س» under قسم. The model draws marks at
//        letter weight, so on a sash those become stitched specks nobody ordered.
//      · WITHOUT it — 5 of 5 clean, correctly spelled, bare. Same model, same price, same
//        ~16s. The sheet still cropped 5/5 through lib/sheetCrop.js.
//    A student's name on a graduation sash is never vocalised. The ban stays, and it stays
//    ENUMERATED — the long list is what was measured, not a shorter paraphrase of it.
//
// 2. BUT THE BAN ON ITS OWN DRAWS A FONT — the owner's «يولد صور بخطوط عادية وليس مزخرفة»
//    (2026-09-15, one day after the fix above). The 09-14 rewrite removed the only word in the
//    entire prompt that asked for ARTISTRY and put restrictions in its place: «masterful» went;
//    «THICK, BOLD … never thin, faint, wiry or hairline» arrived; nine separate negations about
//    marks arrived; and ORNAMENT below was already contributing «keep it mostly clean plain
//    letters». What remained described heavy, bare, unornamented Arabic on white — which is a
//    description of a bold TYPEFACE, not of Thuluth. Two specific traps, both fixed below:
//      · «strong thick/thin contrast» together with «never thin … or hairline» is a flat
//        CONTRADICTION, and the model resolved it the cheap way. The thin stroke IS the
//        contrast — a broad nib makes it wherever the pen turns. Banning thinness outright
//        flattens every stroke to one weight, and one weight is what a font looks like. The
//        weight rule now binds the BROAD strokes only, and the contrast between the two is
//        named as the thing that must be dramatic.
//      · Nothing ever told the model what NOT to look like. «NOT a computer font, NOT a
//        typeface» is now stated outright, because that is the failure being reported.
//    The 09-14 finding still stands and is NOT undone: pen pressure is what stopped the first
//    no-harakat sheet coming back thin and wiry, and a hairline stroke gives the digitizer
//    nothing to fill. It is kept and scoped, never dropped.
//
// ⚠️ ORDER IS LOAD-BEARING. The artistry comes first and runs longest; every prohibition sits
// behind it. A prompt that is mostly prohibitions renders like a font however good the first
// sentence is — that is the mechanism behind both of the days above.
const BASE = [
  'A masterpiece of classical Arabic THULUTH calligraphy, hand-written by a master calligrapher',
  'with a wide broad-nib reed pen. This is fine-art calligraphy — NOT a computer font, NOT a',
  'typeface, NOT plain typed or printed Arabic text.',
  'Sweeping curved strokes with dramatic thick-to-thin modulation, deep confident curves, elegant',
  'tapered stroke endings, generous kashida connections, and letters that lean, stack and',
  'interlock in the classical Thuluth manner.',
  'The broad strokes are pressed HEAVY and full of ink — substantial enough to embroider, never a',
  'faint, weak or wiry line — while the fine strokes the nib makes as it turns stay sharp and',
  'crisp. The contrast between the two is what must be dramatic. Never a flat, mechanical or',
  'evenly-weighted stroke. Balanced spacing.',
  'Pure black ink on a PURE FLAT WHITE (#FFFFFF) background. The background must be plain solid',
  'white only — no paper texture, no grain, no cream or beige tint, no gradient, no shadow,',
  'no off-white.',
  'Write every word BARE with NO diacritics at all — no harakat, no fatha, no damma, no kasra,',
  'no sukun, no shadda, no tanwin, no small marks above or below any letter. Only the letters',
  'themselves and their own required dots.',
].join(' ');

const NEG = 'No underlines, no quotation marks, no frames, no borders, no boxes, no numbering, no Latin text, no watermark.';

// Owner decision 2026-08-26: the sash FRONT is now as plain as the back. It used to carry
// «add small floated decorative ornaments» while the back was told to use less than half of
// that — two panels of one sash that did not look like a set. They now share ONE string, so
// they cannot drift apart again, and the back's old wording (which described itself relative
// to «the front») is gone: once both are minimal, a comparison to the other panel means
// nothing and would only give the model something to over-read.
//
// ⚠️ `cap` deliberately KEEPS the ornaments — the cap is a separate garment, not the other
// half of the sash. `cap_side` never reaches this table: calligraphyEngine.js:16 maps it to
// `cap` first. So front/back/cap are the only three keys that can ever be looked up here.
//
// ⚠️ THIS CLAUSE BINDS THE ORNAMENTS, NEVER THE LETTERFORMS, and the distinction is the
// owner's 09-15 report (2026-09-15). It used to end «keep it mostly clean plain letters»,
// which is a sentence about the WRITING, not about the floated motifs the 08-26 decision was
// actually taken about — and it landed in the same prompt as BASE's own «only the letters
// themselves», right after the artistry wording was removed. Three clauses agreeing that the
// letters should be plain is how a Thuluth prompt renders as a typeface. The owner's decision
// is unchanged and restated below; only its reach is corrected. Never re-word this back into
// anything that describes the letters.
const MINIMAL =
  'Use minimal ornamentation — at most one or two tiny floated ornaments total, and no ' +
  'decorative filler around the words. This limits the ORNAMENTS only: the letterforms ' +
  'themselves stay full, flowing, master-quality Thuluth calligraphy.';

const ORNAMENT = {
  front: MINIMAL,
  back:  MINIMAL,
  cap:   'Add small floated decorative ornaments around the words.',
};

// The style knob (lib/calligraphyStyles.js) is a SHEET-level clause, not a per-name one: the
// batcher groups pending plates by (variant, style) so one sheet is always one style. Mixing
// several styles inside one image makes the model drift and ruins all ten names — and a ruined
// sheet is a $0.10 re-run, not a free retry.
function styleFor(variant, style = null) {
  const extra = styleClause(style);
  return [BASE, ORNAMENT[variant] || ORNAMENT.front, extra, NEG].filter(Boolean).join(' ');
}

// buildSheetPrompt accepts items as plain strings OR { text, element } objects.
// element is an optional decorative motif word drawn beside the name on the SAME line.
function buildSheetPrompt(items, variant = 'front', style = null) {
  // Normalize: plain string → { text, element: null }
  const normalized = items.map((it) =>
    typeof it === 'string'
      ? { text: it, element: null }
      : { text: it.text, element: it.element || null }
  );

  const list = normalized.map(({ text, element }) => {
    if (element) {
      return `- ${text}   ⟨draw a small, simple, solid black-ink motif of «${element}» right beside this name, on the SAME line and close to the letters — do NOT put it on its own separate line⟩`;
    }
    return `- ${text}`;
  }).join('\n');

  return [
    styleFor(variant, style),
    `Write each of the following ${normalized.length} Arabic names as its own separate centered line,`,
    'stacked vertically top to bottom, and SPREAD THEM OUT to fill the whole height of the image.',
    'CRITICAL — line separation: leave a VERY LARGE empty white gap between every consecutive line,',
    'at least TWICE the height of the text itself. Each name (including all its dots and',
    'tall letters) must sit completely alone with wide empty margins above and below it — no part of',
    'any name may come near, touch or overlap the line above or below it. The vertical gap BETWEEN',
    'names must be clearly much bigger than the gaps inside a single name, so every line can be cleanly',
    'cropped out on its own. Distribute the lines evenly with big equal gaps. Spell each name EXACTLY',
    'as written, do not add or remove any letters, words, numbers or digits:',
    list,
  ].join('\n');
}

function buildSinglePrompt(name, variant = 'front', element = null, style = null) {
  const parts = [
    styleFor(variant, style),
    'Write the following single Arabic name as one centered line. Spell it EXACTLY as written,',
    `do not add or remove any letters or words: ${name}`,
  ];
  if (element) {
    parts.push(`Also draw a small simple solid black-ink motif of «${element}» right beside the name on the same line.`);
  }
  return parts.join('\n');
}

function buildElementPrompt(word) {
  return [
    'A single small, simple, BOLD solid black-ink line-art drawing of «' + word + '»,',
    'centered, on a PURE FLAT WHITE (#FFFFFF) background. Just the one clean motif —',
    'no text, no letters, no numbers, no border, no frame, no shadow, no extra objects,',
    'no background texture or tint.',
  ].join(' ');
}

module.exports = { buildSheetPrompt, buildSinglePrompt, buildElementPrompt };
