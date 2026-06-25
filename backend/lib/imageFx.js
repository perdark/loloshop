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

module.exports = { whiteToTransparent };
