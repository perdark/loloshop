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
  // ⚠️ NAME THE HAND AND NAME WHAT IT IS NOT (2026-09-24). Named once and alone, «Thuluth» lost
  // to the model's default: measured on prod, ممثل plates came back Thuluth one line, heavy
  // Naskh the next, thin Naskh the one after, and the مفرد (solo) plates came back Naskh every
  // time. Describing what makes it Thuluth — the tall hooked alifs, the letters stacked into a
  // composition, the long sweeping tails — gives the model something to draw instead of a word.
  'It must be genuine classical THULUTH (خط الثلث) as an Iraqi master would write it — NOT Naskh,',
  'NOT Ruq\'ah, NOT Diwani, NOT a printed or typed font. Tall alifs and lams with the hooked Thuluth',
  'head, long sweeping tails and elongated curves, with only light Thuluth overlaps inside the line.',
  // The CANVAS, explicitly not an object.
  'Pure black ink on a PURE FLAT WHITE (#FFFFFF) digital background — a flat vector-like scan,',
  'NOT a photograph. No paper sheet, no paper texture, no grain, no page edges, no desk, no hand,',
  'no shadow, no perspective, no vignette, no cream or beige tint, no gradient, no off-white.',
  'The background must be uniform #FFFFFF from corner to corner.',
  // ⚠️ THE EMBROIDERY RULE, RELAXED ON THE OWNER'S ORDER (2026-09-24). It used to read «Each name
  // stays on one line with NO stroke dropping below its line», which forbids the two things that
  // make Thuluth Thuluth — descending tails and stacked letters — so the model obeyed it by
  // drawing Naskh on a flat baseline. What the pipeline actually needs is that each name stays
  // inside its OWN band (lib/sheetCrop.js cuts on the white gaps), not that it stays flat.
  // «ONE row» and «every letter readable» came from the first live trial of the relaxed rule:
  // a solo plate wrapped المحامية onto its own line and dropped the ع of اسماعيل into a stack.
  // ⚠️ AND NEVER ASK FOR STACKING (2026-09-24, measured on prod the same day it shipped).
  // «letters stacked and composed over each other» folded names into a square block: plates
  // went from a median width/height of 5.6 (330 مفرد) to 2.2, and 2 of the first 4 put the title
  // on its own row. A sash carries a LONG strip. The width ratio is the number to check.
  'Each name is written as ONE long horizontal line reading right to left — never two rows, and a',
  'title such as الأستاذ or المهندسة is never placed above the rest of the name. The finished name',
  'is a wide strip, at least four times wider than it is tall. Its tails stay inside that name\'s',
  'own band and never reach into the name above or below it, and every letter stays present and',
  'readable.',
].join(' ');

// ⚠️ THE GUILLEMET BAN IS LOAD-BEARING, not decoration. `element_text` reaches the model
// wrapped in «…» (buildSheetPrompt below), and the ornament styles are described in Arabic
// prose that uses them too — so the character is IN the prompt and the model will happily
// draw it around a name. The owner's own draft banned it explicitly; it is kept.
const NEG = 'Draw only the letters of each name — no dash, hyphen, bullet or punctuation before or after it. No signature, no calligrapher\'s mark, stamp or date. No underlines, no quotation marks, no guillemets, no arrows, no frames, no borders, no boxes, no numbering, no Latin text, no watermark.';

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

  // ⚠️ NO «- » BULLET IN FRONT OF A NAME (2026-09-24). The model drew it: «- الاقتصادي حيدر هاشم»
  // and «-الدكتور حسين عباس-» both reached order_items as plates with a dash stitched beside the
  // name. One name per line is all the separation the list needs.
  const list = normalized.map(({ text, element }) => {
    if (element) {
      return `${text}   ⟨draw a small, simple, solid black-ink motif of «${element}» right beside this name, on the SAME line and close to the letters — do NOT put it on its own separate line⟩`;
    }
    return text;
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
