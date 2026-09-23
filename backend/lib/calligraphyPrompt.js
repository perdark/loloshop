// backend/lib/calligraphyPrompt.js — variant- and style-aware calligraphy prompt builders.
//
// ⚠️ Nothing a STUDENT typed ever reaches these strings. A style arrives as an id from the
// closed list in lib/calligraphyStyles.js and `element` is a single motif word the designer
// approved. The student's own sentence stays on the order line where it belongs.
const { styleClause } = require('./calligraphyStyles');

// ⚠️ DO NOT ADD A DIACRITICS CLAUSE HERE. IN EITHER DIRECTION. This line has now been
// written three ways and measured each time, and the version that works is the one that does
// not mention harakat at all:
//
//   2026-09-14  «masterful diacritics»  → every name vocalised at LETTER weight, dragging
//               stray glyphs in with the marks (a floating ص under مصطفى, a ء inside علي).
//               0 of 5 lines clean.
//   2026-09-15  «no diacritics at all» (9 stacked prohibitions) → clean, but the prompt was
//               then mostly prohibitions and the model drew a TYPEFACE. Owner: «يولد صور
//               بخطوط عادية وليس مزخرفة». Reverted the same day; he chose the vocalised sheet.
//   2026-09-17  «a FEW light marks, most letters bare» — the middle ground nobody had tried.
//               Owner, on a real generated plate: «الحركات تراجعت بيهن كانوا افضل».
//   2026-09-17  THIS VERSION — say nothing. The owner wrote this prompt himself and it is the
//               only one that produced marks he accepted: asking for a named CALLIGRAPHIC HAND
//               makes the model draw the harakat that hand actually uses, at their own weight.
//               Every explicit instruction — praise or ban — pulls them off that natural weight.
//
// Verified live on google/gemini-3.1-flash-image, 2026-09-17: a 10-name sheet came back 10/10,
// spelling exact, marks natural, and cropped 10/10 through lib/sheetCrop.js.
//
// ⚠️ AND NEVER DESCRIBE THE CANVAS AS A PHYSICAL SHEET OF PAPER. The owner's draft opened with
// «clean white A4 sheet, portrait» and the model obeyed it literally: it PHOTOGRAPHED a page
// lying on a desk. Measured on that image — corner pixels 96/49/119/49, **0.0%** pure white,
// 85.9% grey. The trap is that it does not look like a failure to the pipeline: cropSheet()
// still reported 10 bands, so nothing throws and nothing is flagged — but band 1 of 10 was a
// patch of blurred desk, and that is what would reach order_items.plate_image_url and the
// embroiderer. Describe a flat digital canvas, never an object that can be photographed.
const BASE = [
  // The HAND, named and specific. This is what carries the artistry — and the harakat.
  'Elegant Iraqi-school Thuluth calligraphy hand, pure black ink, high thick-and-thin broad-nib',
  'pen contrast, balanced spacing.',
  // The CANVAS, explicitly not an object.
  'Pure black ink on a PURE FLAT WHITE (#FFFFFF) digital background — a flat vector-like scan,',
  'NOT a photograph. No paper sheet, no paper texture, no grain, no page edges, no desk, no hand,',
  'no shadow, no perspective, no vignette, no cream or beige tint, no gradient, no off-white.',
  'The background must be uniform #FFFFFF from corner to corner.',
  // The EMBROIDERY rule. Owner's wording, and it does the job the 09-17 «letters must not
  // interlock» experiment was reaching for WITHOUT flattening the script: it constrains where
  // a stroke may travel, not how the letters relate to each other. Measured: that experiment
  // produced a readable but plain line the owner rejected; this keeps the Thuluth intact.
  'Each name stays on one line with NO stroke dropping below its line.',
].join(' ');

// ⚠️ THE GUILLEMET BAN IS LOAD-BEARING, not decoration. `element_text` reaches the model
// wrapped in «…» (buildSheetPrompt below), and the ornament styles are described in Arabic
// prose that uses them too — so the character is IN the prompt and the model will happily
// draw it around a name. The owner's own draft banned it explicitly; it is kept.
const NEG = 'No underlines, no quotation marks, no guillemets, no arrows, no frames, no borders, no boxes, no numbering, no Latin text, no watermark.';

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
// ⚠️ MINIMAL BINDS THE ORNAMENTS, NEVER THE LETTERFORMS (HANDOFF landmine, 2026-09-15). The old
// wording «keep it mostly clean plain letters» reached the WRITING and told the model to draw
// plain letters on every sash front/back — which is most ممثل work (owner 2026-09-23: «بدون
// زخرفة»). Say what the space AROUND the name holds, and let BASE own the hand.
const MINIMAL =
  'Use minimal ornamentation — at most one or two tiny floated ornaments total, with no ' +
  'decorative filler around the words. The letters themselves stay fully calligraphic.';

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
    'at least TWICE the height of the text itself. Each name (including all its diacritics, dots and',
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
