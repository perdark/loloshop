// backend/lib/calligraphyPrompt.js — the tested calligraphy prompt builders.
const STYLE = [
  'Elegant Arabic Thuluth calligraphy, pure black ink on a clean solid white background.',
  'Broad-nib pen with strong thick/thin contrast, masterful diacritics, balanced spacing.',
  'Small floated decorative ornaments around the words. No underlines, no quotation marks,',
  'no frames, no borders, no boxes, no numbering, no Latin text, no watermark.',
].join(' ');

function buildSheetPrompt(names) {
  const list = names.map((n) => `- ${n}`).join('\n');
  return [
    STYLE,
    `Write each of the following ${names.length} Arabic names as its own separate centered line,`,
    'stacked vertically top to bottom. Leave a GENEROUS amount of empty white vertical space',
    'between every line — at least the height of one full line of text — so the names are clearly',
    'separated and never touch or overlap, and each can be cropped out individually. Keep the lines',
    'evenly spaced. Spell each name EXACTLY as written, do not add or remove any letters or words:',
    list,
  ].join('\n');
}

function buildSinglePrompt(name) {
  return [
    STYLE,
    'Write the following single Arabic name as one centered line. Spell it EXACTLY as written,',
    `do not add or remove any letters or words: ${name}`,
  ].join('\n');
}

module.exports = { buildSheetPrompt, buildSinglePrompt };
