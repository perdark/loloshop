// backend/lib/calligraphyPhoto.js — look at the student's photo, say what KIND of reference it is.
//
// Half the calligraphy lines carry a photo (121 of the last 300), and «بنفس الخط الي بالصورة» is
// the single most common request. The pipeline sends that photo to the image model as a style
// reference (lib/openrouter.js generateImageWithReference) — which is only right when the photo
// actually IS writing. A university logo, a garment shot or a screenshot of a chat would be
// copied as "style" and ruin the plate, so this module answers one question first: what is in
// the picture?
//
// ⚠️ IT NEVER READS THE TEXT IN THE PHOTO, on purpose, for two measured reasons:
//   1. AI readers of Thuluth are not trustworthy — on 2026-09-26 a blind transcription of shop
//      plates came back as Quran verses, and a reader told the expected name missed 3–4 of 5
//      errors (docs/HANDOFF-archive.md, SmartAPI entry).
//   2. A name in a photo is not the student's name — they upload other people's sashes as a style
//      reference (owner ruling, 2026-09-22).
// What gets WRITTEN always comes from lib/calligraphyUnderstand.js, checked against the
// student's own typed words. This module only decides whether the photo may steer the STYLE.
//
// COST: one text-model call with an image, ~$0.0003, ledgered with the rest of the calligraphy
// spend (kind 'photo') so it rides the same daily ceiling.
const sharp = require('sharp');
const { completeText: complete } = require('./calligraphyProvider');

const CONTENTS = ['calligraphy', 'embroidered_text', 'logo', 'drawing', 'garment', 'screenshot', 'other'];
// Which of those may be handed to the generator as a style reference.
const STYLE_REFERENCE = new Set(['calligraphy', 'embroidered_text']);
const ORNAMENTS = ['none', 'light', 'medium', 'rich'];

const SYSTEM = [
  'You look at ONE photo a customer attached to a graduation-sash calligraphy order.',
  'Answer ONLY JSON: {"content": one of ' + CONTENTS.map((c) => `"${c}"`).join('|') + ',',
  ' "ornament": one of "none"|"light"|"medium"|"rich" (decoration AROUND the writing, if any),',
  ' "motifs": [short English words for drawn motifs, e.g. "butterfly","star"; [] if none],',
  ' "note": a short Arabic phrase (under 8 words) describing the photo}',
  'content: "calligraphy" = Arabic calligraphy on paper/screen; "embroidered_text" = writing',
  'embroidered on fabric (a sash, a cap); "logo" = an emblem or university logo; "drawing" =',
  'a picture with no writing; "garment" = a sash/cap/robe where the point is the garment, not',
  'the writing; "screenshot" = a chat or app screenshot; else "other".',
  'Do NOT transcribe any words. Do not guess names.',
].join('\n');

async function toDataUrl(buffer) {
  const jpg = await sharp(buffer, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 80 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpg.toString('base64')}`;
}

/** Everything the model said, forced back inside the closed lists. Never throws. */
function cleanDescription(raw) {
  const it = raw && typeof raw === 'object' ? raw : {};
  const content = CONTENTS.includes(it.content) ? it.content : 'other';
  return {
    content,
    style_reference: STYLE_REFERENCE.has(content),
    ornament: ORNAMENTS.includes(it.ornament) ? it.ornament : null,
    motifs: Array.isArray(it.motifs) ? it.motifs.filter((m) => typeof m === 'string').slice(0, 4) : [],
    note: typeof it.note === 'string' ? it.note.slice(0, 80) : '',
  };
}

/** Describe one photo buffer. Returns `{ description, costUsd }`. */
async function describePhoto(buffer) {
  const url = await toDataUrl(buffer);
  const { text, costUsd } = await complete({
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: [
        { type: 'text', text: 'Describe this photo.' },
        { type: 'image_url', image_url: { url } },
      ] },
    ],
    maxTokens: 200,
    maxOutputCap: 200,
    temperature: 0,
    jsonMode: true,
  });
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  return { description: cleanDescription(parsed), costUsd: Number(costUsd || 0) };
}

module.exports = { describePhoto, _internals: { cleanDescription, CONTENTS, STYLE_REFERENCE } };
