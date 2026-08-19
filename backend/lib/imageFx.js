// backend/lib/imageFx.js
// Image effects for the calligraphy compositor.
const sharp = require('sharp');

// Turn a white-background motif into black-on-transparent so it composites onto a plate
// without a white box. Pixel alpha scales with darkness; near-white → fully transparent.
async function whiteToTransparent(buffer, whiteThresh = 232) {
  const img = sharp(buffer).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true }); // RGBA
  for (let i = 0; i < data.length; i += 4) {
    const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
    if (lum >= whiteThresh) {
      data[i + 3] = 0;
    } else {
      data[i + 3] = Math.min(255, Math.round(((whiteThresh - lum) / whiteThresh) * 255 * 1.6));
      // darken the kept ink toward solid black for a clean motif
      const k = Math.max(0, Math.min(60, lum));
      data[i] = k; data[i + 1] = k; data[i + 2] = k;
    }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

// ---------------------------------------------------------------------------------------
// Make a regenerated plate DROP INTO THE SLOT the old one occupied.
//
// WHY. A batch plate is not a picture of a name — it is one horizontal band sliced out of a
// 10-name sheet by lib/sheetCrop.js: full sheet width, height ≈ one tenth of the sheet, so the
// letters sit small inside a wide strip. «إعادة التوليد» asked the model for a SINGLE name on
// its own canvas and cropped that to one band, which produces a completely different shape —
// the name fills the frame, the strip is nearly square, and the embroiderer gets one piece at
// a visibly different scale from the nine it was generated beside. Nothing was wrong with the
// calligraphy; the framing was wrong, and the only fix was to reroll until it looked close.
//
// So we don't guess a "correct" scale — we measure the plate being REPLACED and reproduce it:
// same canvas dimensions, same ink height. The reference is the file that is already living
// in the order line, which makes the match exact by construction rather than by tuning.
//
// Falls back to the new image untouched when either buffer can't be measured (a plate from
// before sheet_path was recorded, a missing file) — a mismatched plate is worse than the old
// behaviour only if it also silently fails, so it never throws.
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

// Minimum per-channel contrast (max - min) for an image to count as carrying ink.
// A blank band out of sheetCrop is literally uniform (contrast 0); a real name is 200+.
// 8 leaves room for JPEG-ish noise without ever calling a white strip "a name".
const INK_CONTRAST_MIN = 8;

/**
 * Does this image contain any ink at all, or is it a blank white rectangle?
 *
 * ⚠️ THIS IS THE «WHITE PHOTO» GUARD. Three separate paths can produce a plate with nothing
 * on it, and every one of them used to save it as `status='done'` and auto-link it onto the
 * order line, so the design team downloaded a blank white image and the embroiderer got no
 * artwork at all:
 *   1. sheetCrop forced `expected` bands out of a sheet the model drew fewer names on — the
 *      surplus bands are pure white slivers (see lib/sheetCrop.js).
 *   2. an iPad compositor export came back blank (WebKit drops decoded image buffers under
 *      memory pressure, so canvas.toDataURL() returns the empty canvas).
 *   3. a reroll whose generated image had no usable band.
 * Contrast is the honest test — sharp's `trim` cannot report emptiness, it just hands a
 * uniform image back unchanged, which reads as "the ink fills the whole frame".
 */
async function hasInk(buffer) {
  try {
    const stats = await sharp(buffer).stats();
    return stats.channels.some((c) => c.max - c.min >= INK_CONTRAST_MIN);
  } catch {
    // Undecodable is not the question this function answers; the callers validate format
    // separately. Say "has ink" so a decode quirk can never discard a paid plate.
    return true;
  }
}

/**
 * Ink bounding box of a white-background plate: the buffer trimmed, plus its size.
 * Returns null when there is no ink to measure. sharp's trim CANNOT report that itself — on a
 * uniform image it hands back the full frame unchanged, so a blank plate would otherwise look
 * like one whose ink happens to fill the canvas, and the caller would scale a real name to
 * cover an entire band. Contrast is the honest test.
 */
async function inkBox(buffer) {
  if (!(await hasInk(buffer))) return null;
  const { data, info } = await sharp(buffer)
    .trim({ background: '#ffffff', threshold: 10 })
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height };
}

async function matchPlateGeometry(newBuffer, referenceBuffer) {
  try {
    const ref = await sharp(referenceBuffer).metadata();
    if (!ref.width || !ref.height) return newBuffer;
    const refInk = await inkBox(referenceBuffer);
    const newInk = await inkBox(newBuffer);
    if (!refInk || !newInk || !refInk.height || !newInk.height) return newBuffer;

    // Ink HEIGHT is the anchor, not width: embroidery scale is letter height, and two
    // different names legitimately differ in width.
    const targetHeight = Math.max(1, Math.min(refInk.height, ref.height));
    const scaled = await sharp(newInk.buffer)
      .resize({ width: ref.width, height: targetHeight, fit: 'inside', background: WHITE })
      .toBuffer();

    return await sharp({
      create: { width: ref.width, height: ref.height, channels: 3, background: WHITE },
    })
      .composite([{ input: scaled, gravity: 'center' }])
      .png()
      .toBuffer();
  } catch {
    return newBuffer; // never let framing cosmetics lose a paid generation
  }
}

module.exports = { whiteToTransparent, matchPlateGeometry, hasInk, INK_CONTRAST_MIN };
