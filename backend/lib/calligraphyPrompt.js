// backend/lib/calligraphyPrompt.js — variant-aware calligraphy prompt builders.

const BASE = [
  'Elegant Arabic Thuluth calligraphy, pure black ink on a PURE FLAT WHITE (#FFFFFF) background.',
  'The background must be plain solid white only — no paper texture, no grain, no cream or beige tint,',
  'no gradient, no shadow, no off-white. Broad-nib pen with strong thick/thin contrast, masterful',
  'diacritics, balanced spacing.',
].join(' ');

const NEG = 'No underlines, no quotation marks, no frames, no borders, no boxes, no numbering, no Latin text, no watermark.';

const ORNAMENT = {
  front: 'Add small floated decorative ornaments around the words.',
  back:  'Use minimal ornamentation — at most one or two tiny floated ornaments total, clearly LESS THAN HALF the decoration of the front; keep it mostly clean plain letters. Use the exact same Thuluth letterforms, proportions and pen style as the front (only the amount of decoration is reduced).',
  cap:   'Add small floated decorative ornaments around the words.',
};

function styleFor(variant) {
  return [BASE, ORNAMENT[variant] || ORNAMENT.front, NEG].join(' ');
}

// buildSheetPrompt accepts items as plain strings OR { text, element } objects.
// element is an optional decorative motif word drawn beside the name on the SAME line.
function buildSheetPrompt(items, variant = 'front') {
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
    styleFor(variant),
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

function buildSinglePrompt(name, variant = 'front', element = null) {
  const parts = [
    styleFor(variant),
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
