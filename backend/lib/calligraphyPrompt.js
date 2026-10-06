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

// The ornament DIAL (2026-09-26, owner: «قليل متوسط عالي»). Chosen per plate by
// lib/calligraphyUnderstand.js from what the student wrote, or by the designer; null keeps the
// zone default in ORNAMENT above, so every pre-existing plate renders exactly as it did.
//
// ⚠️ Every level binds the SPACE AROUND the name, never the letterforms (the MINIMAL landmine
// above), and every level keeps ornaments inside the name's own line band. The sheet is cut by
// horizontal white valleys between names (lib/sheetCrop.js); an ornament that drifts into the
// gap between two lines is exactly how a sheet crops to the wrong band count and is re-bought.
const ORNAMENT_LEVEL = {
  none:
    'NO decorative ornaments at all: nothing floated around the words, no flourishes, no stars. '
    + 'The letters themselves stay fully calligraphic.',
  light:
    'Very light ornamentation: at most one or two tiny floated ornaments beside each name, '
    + 'nothing else. The letters themselves stay fully calligraphic.',
  medium:
    'Moderate ornamentation: a few small, elegant floated ornaments and delicate flourishes around '
    + 'each name, balanced and clearly secondary to the writing. The letters themselves stay fully '
    + 'calligraphic.',
  rich:
    'Rich, lavish ornamentation in the classical Thuluth tradition: generous floated flourishes, '
    + 'small florets and decorative marks around and between the words, filling the space around '
    + 'each name — but never touching, overlapping or hiding any letter. The letters themselves '
    + 'stay fully calligraphic and perfectly legible.',
};
// ⚠️ THE ONE-LINE HALF IS MEASURED, NOT BELT-AND-BRACES. The first real «عالي» sheet
// (2026-09-26, two names) came back with every name WRAPPED — «الأستاذة والمترجمة» above,
// «مهاباد فهد حسن» below — and still cropped to the right band count, so nothing flagged it. A
// wrapped name is not a sash line. BASE already says «one line»; ornament language outweighed it.
const BAND_RULE =
  'Every ornament stays on the SAME horizontal line as its own name, within that line\'s height — '
  + 'nothing floats above or below into the space between names. Each name is written as ONE '
  + 'single horizontal line — never break a name, a title or a word onto a second line.';
const ORNAMENT_LEVELS = Object.keys(ORNAMENT_LEVEL);

function normalizeOrnament(value) {
  const v = typeof value === 'string' ? value.trim() : '';
  return ORNAMENT_LEVELS.includes(v) ? v : null;
}

function ornamentClause(variant, ornament) {
  const level = normalizeOrnament(ornament);
  if (!level) return ORNAMENT[variant] || ORNAMENT.front;
  return level === 'none' ? ORNAMENT_LEVEL.none : `${ORNAMENT_LEVEL[level]} ${BAND_RULE}`;
}

// The style knob (lib/calligraphyStyles.js) is a SHEET-level clause, not a per-name one: the
// batcher groups pending plates by (variant, style) so one sheet is always one style. Mixing
// several styles inside one image makes the model drift and ruins all ten names — and a ruined
// sheet is a $0.10 re-run, not a free retry.
function styleFor(variant, style = null, ornament = null) {
  const extra = styleClause(style);
  return [BASE, ornamentClause(variant, ornament), extra, NEG].filter(Boolean).join(' ');
}

// buildSheetPrompt accepts items as plain strings OR { text, element } objects.
// element is an optional decorative motif word drawn beside the name on the SAME line.
function buildSheetPrompt(items, variant = 'front', style = null, ornament = null) {
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
    styleFor(variant, style, ornament),
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

function buildSinglePrompt(name, variant = 'front', element = null, style = null, ornament = null) {
  const parts = [
    styleFor(variant, style, ornament),
    'Write the following single Arabic name as one centered line. Spell it EXACTLY as written,',
    `do not add or remove any letters or words: ${name}`,
  ];
  if (element) {
    parts.push(`Also draw a small simple solid black-ink motif of «${element}» right beside the name on the same line.`);
  }
  return parts.join('\n');
}

// A student who writes «بنفس الخط الي بالصورة» gets their OWN photo sent with the prompt
// (lib/openrouter.js generateImageWithReference). Measured on SmartAPI 2026-09-26: a reference
// image carries the hand and the ornament far better than words do — but the model also COPIES
// words out of it (the extra-alif defect was copied from the reference plate). So the prompt
// says, in as many ways as it takes, that the photo is a style and never a text.
//
// ⚠️ THE PHOTO MAY CARRY SOMEBODY ELSE'S NAME. Students upload another student's sash as a
// style reference (owner ruling, 2026-09-22). Rendering what is IN the photo would stitch a
// stranger's name; the only text on the plate is the one the understanding layer verified.
function buildReferencePrompt(name, variant = 'front', element = null, ornament = null) {
  const parts = [
    'The attached image is a STYLE REFERENCE ONLY, photographed by a customer. Match its calligraphic',
    'hand: the letter shapes, stroke weight, thick-and-thin contrast, and the amount and kind of',
    'ornament around the writing. Do NOT copy ANY words, letters, numbers or names from it, and do',
    'NOT reproduce its background, fabric, colours, lighting or photo framing.',
    [BASE, normalizeOrnament(ornament) ? ornamentClause(variant, ornament) : '', NEG].filter(Boolean).join(' '),
    'Write ONLY the following single Arabic name as ONE centered horizontal line — never split it onto',
    'two lines, whatever the layout in the photo. Spell it EXACTLY as written, do not add or remove',
    `any letters or words: ${name}`,
  ];
  if (element) {
    parts.push(`Also draw a small simple solid black-ink motif of «${element}» right beside the name on the same line.`);
  }
  return parts.join('\n');
}

// SmartAPI (gpt-6-sol) plate — ONE name per image, and the name arrives as a TYPESET IMAGE
// (lib/smartapi.js textImage), never as words for the model to spell. IMAGE 2 is the style: the
// shop's own plate, or the student's photo when they asked for «نفس الخط الي بالصورة».
//
// ⚠️ The «no extra alif» sentence is measured, not decoration: with the shop plate as reference
// and the name only in text, gpt-6-sol prefixed words with an alif copied from the plate
// (امحمد · انور · احوراء). Giving it the letters as an image and saying «nothing added» took
// that defect to zero on the same ten names (2026-09-26).
// ─── SmartAPI: two passes, letters THEN ornaments (owner, 2026-09-29) ───────────────────────
// Measured 2026-09-29 on 14 real names, half of them the hard تبارك/الإشعاعية set:
//   · «re-letter IMAGE 1 in the style of IMAGE 2» (the 09-26 prompt)   → 5/14 spelled right
//   · «transform into stacked, interlaced Thuluth like IMAGE 2»         → 4/14, prettiest
//   · «re-ink IMAGE 1 in place with IMAGE 2's pen, keep its layout»     → 11/14  ← THIS ONE
//   · then «only ADD marks into the empty gaps, touch no letter»        → 0 new errors
// ⚠️ EVERY WORD THAT ASKS THE MODEL TO RESHAPE, STACK OR INTERLACE THE LETTERS COSTS SPELLING.
// The model "improves" a rare name into a common word (العباسي → العجمي, مهاباد → مهارات) the
// moment it is allowed to redraw the letterforms. So pass 1 is an EDIT of the typeset name that
// keeps its layout, and all the art the owner wants lives in pass 2, which may only add.
const SMART_KEEP =
  'Keep EXACTLY the same letters, dots, words and word order as IMAGE 1, in the same positions and '
  + 'the same reading order — do not add, remove, merge, stack or substitute any letter; no extra '
  + 'alif before any word; every dot stays on its own letter.';

function buildSmartApiPrompt({ style = null, studentReference = false } = {}) {
  return [
    'Edit IMAGE 1: it is a correct Arabic name typeset in a plain font.',
    studentReference
      ? 'Re-ink it as Arabic calligraphy using the pen and stroke weight of IMAGE 2, a photo a customer '
        + 'sent as a STYLE REFERENCE only — ignore every word, name, background, fabric and colour in it, '
        + 'and do NOT copy its layout.'
      : 'Re-ink it as Arabic Thuluth calligraphy using the pen and stroke weight of IMAGE 2 (IMAGE 2 is a '
        + 'style reference only — ignore its words and do NOT copy its layout).',
    'Strong thick/thin broad-nib contrast, tapered stroke ends.',
    SMART_KEEP,
    "Keep IMAGE 1's layout: the words stay on ONE line, side by side.",
    styleClause(style),
    'Black ink on pure white, no ornaments, no border, no other text.',
  ].filter(Boolean).join(' ');
}

// How much pass 2 adds. null = the zone default (front/back plain like the shop plate, the cap a
// little more — same split as ORNAMENT above).
// ⚠️ 2026-10-06: the shop references are now three cleaned «besto» plates (the Gemini-era look the
// owner wants back) and pass 2 asks for THEIR manner: a mixed FAMILY of hand-placed marks, some
// large, in loose clusters above the letters AND below the baseline, no two alike. «Small marks into
// the gaps» came back as a sparse, regular, font-like dusting; ONE reference with the same words
// came back uniform and stamped. Measured on 4 hard names, 3 references + NO_REPEAT: 3/4 spelled
// right (the miss was pass 1, not pass 2). Letters and ornaments in ONE pass spelled 10/14 against
// 13/14 for two passes — it invented «الجميلة» for المترجمة — so keep the passes separate.
// Medium is the base text itself; light/rich only scale it.
const SMART_ORNAMENT = {
  light: 'Use only about a third as many marks as IMAGES 2, 3 and 4 do — sparse.',
  medium: '',
  // ⚠️ «rich» may only mean MORE of the same marks. Measured 2026-09-29: «generously through every
  // gap» put a mark under the first alif (المترجمة → «إلمترجمة») and once redrew letters
  // («التارجمة»); a floral flourish at the line's ends ATE the first alif twice in three names
  // (الاستاذة → «لاستاذة», الصيدلانية → «لصيدلانية»). Nothing may sit at the ends of the line.
  rich: 'Use them a little more densely than IMAGES 2, 3 and 4 — but nothing at the two ends of the line.',
};
// A mark right above or below an alif reads as a hamza (ا → أ/إ), so it is a spelling change.
const SMART_MARK_RULE = 'Never place a mark directly above or below an alif, and never where it could be read '
  + 'as a dot, a hamza or a letter.';

// ⚠️ 2026-10-05, owner: «there is a lot of repeated shapes». With two references the model stamped
// the same hooked tick all along the line; three references plus this sentence gave visibly more
// variety (curls, long slashes, commas, rings) on the same names — improved, not eliminated.
const NO_REPEAT = 'EVERY mark is drawn individually by hand, like a real pen: NO two marks may have the same shape, size, '
  + 'slant or stroke weight, and the same tick must never be repeated in a row — vary the shape from mark to mark '
  + '(hooked tick, long slash, curl, comma, cap, loop, tiny ring), include a few rare shapes copied from the references, '
  + 'and leave uneven gaps so it does not look stamped or patterned.';

/**
 * Pass 2: decorate a finished plate WITHOUT touching its letters. Returns null when there is
 * nothing to add (ornament «none» and no motif), so the caller skips the second paid call.
 * `shopRefs` = IMAGES 2-4 are the shop's three besto plates; false when a customer's photo is the
 * single style reference (then the wording must not promise images that are not there).
 */
function buildSmartApiOrnamentPrompt({ variant = 'front', ornament = null, element = null, shopRefs = true } = {}) {
  const level = normalizeOrnament(ornament) || 'medium';
  if (level === 'none' && !element) return null;
  const refs = shopRefs ? 'IMAGES 2, 3 and 4 (they are style references only — ignore their words)' : 'IMAGE 2';
  const family = shopRefs
    ? 'Use the same MIXED FAMILY of marks they use: tall thin hooked ticks like a small v with a tail, long slanted '
      + 'fatha-like strokes, curled damma-like commas, tiny hamza-like and shadda-like caps, short slanted kasra-like '
      + 'strokes, and tiny curls — in many different sizes and angles, some marks LARGE (about twice the size of a plain '
      + 'dot-tick) and some small. Group them in loose clusters of three to five that follow the rhythm of the letters, '
      + 'filling the space ABOVE the tall letters and ALSO below the baseline between and under the letters, so the whole '
      + `name looks lavishly decorated like ${refs}. ${NO_REPEAT}`
    : 'Use a varied scatter of tiny hand-drawn marks — small v-shaped ticks, short slanted harakat strokes, tiny curls — '
      + 'above the letters and in the gaps below the baseline, at different sizes and angles.';
  return [
    'Edit IMAGE 1: it is a finished Arabic calligraphy name. Do NOT change, move, redraw or thicken ANY',
    'letter or dot — the lettering must stay identical.',
    level === 'none' ? '' : `ADD a rich, hand-placed scatter of pen-stroke ornaments EXACTLY in the manner of ${refs}. ${family} `
      + 'Thin pen strokes, much lighter than the letters, never touching a letter. '
      + `${SMART_ORNAMENT[level]} ${SMART_MARK_RULE}`,
    element ? `Also add a small simple solid black-ink motif of «${element}» right beside the text, on the same line, touching no letter.` : '',
    'Everything stays on the one line. Black ink on pure white.',
  ].filter(Boolean).join(' ');
}

function buildElementPrompt(word) {
  return [
    'A single small, simple, BOLD solid black-ink line-art drawing of «' + word + '»,',
    'centered, on a PURE FLAT WHITE (#FFFFFF) background. Just the one clean motif —',
    'no text, no letters, no numbers, no border, no frame, no shadow, no extra objects,',
    'no background texture or tint.',
  ].join(' ');
}

module.exports = {
  buildSheetPrompt, buildSinglePrompt, buildReferencePrompt, buildSmartApiPrompt, buildSmartApiOrnamentPrompt, buildElementPrompt,
  normalizeOrnament, ORNAMENT_LEVELS,
};
