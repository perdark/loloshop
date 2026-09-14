// backend/lib/calligraphyPrompt.js — variant- and style-aware calligraphy prompt builders.
//
// ⚠️ Nothing a STUDENT typed ever reaches these strings. A style arrives as an id from the
// closed list in lib/calligraphyStyles.js and `element` is a single motif word the designer
// approved. The student's own sentence stays on the order line where it belongs.
const { styleClause } = require('./calligraphyStyles');

// ⚠️ NEVER ASK THIS MODEL FOR DIACRITICS. «masterful diacritics» used to sit in the line
// below, and it is the whole of the owner's «الخط زين بس مو زين» (2026-09-14). Measured live
// against `google/gemini-3.1-flash-image` with the same five names on the same day:
//   · WITH the old wording — 0 of 5 lines clean. Every name came back vocalised
//     («مُصَطَفَى عَلِي», «دِيَّالَى» with a shadda that does not belong in the word at all),
//     and the harakat dragged STRAY GLYPHS in with them: a floating «ص» under مصطفى, a «ء»
//     dropped inside علي, an extra «مُ» beside حوم, a second «س» under قسم. The model draws
//     marks at letter weight, so on a sash those become stitched specks nobody ordered.
//   · WITHOUT it — 5 of 5 clean, correctly spelled, bare. Same model, same price, same
//     ~16s. The sheet still cropped 5/5 through lib/sheetCrop.js.
// A student's name on a graduation sash is never vocalised. Asking for «masterful» anything
// invites the model to decorate, and decoration here means wrong letters.
//
// ⚠️ AND THE NIB CLAUSE IS LOAD-BEARING WITH IT. Removing the diacritics ask alone also
// removed the model's cue to press the pen — the first no-harakat sheet came back thin and
// wiry, which is worse for embroidery than it looks on screen (a hairline stroke has nothing
// for the digitizer to fill). The explicit "heavy pressure / never thin" wording below is
// what puts the weight back; the two changes ship together and should be reverted together.
const BASE = [
  'Elegant Arabic Thuluth calligraphy, pure black ink on a PURE FLAT WHITE (#FFFFFF) background.',
  'The background must be plain solid white only — no paper texture, no grain, no cream or beige tint,',
  'no gradient, no shadow, no off-white. Written with a WIDE broad-nib reed pen held with heavy',
  'pressure — THICK, BOLD, confident strokes with strong thick/thin contrast. The letters must be',
  'substantial and heavy, never thin, faint, wiry or hairline. Balanced spacing.',
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
const MINIMAL =
  'Use minimal ornamentation — at most one or two tiny floated ornaments total; keep it mostly ' +
  'clean plain letters with no decorative filler around the words.';

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
