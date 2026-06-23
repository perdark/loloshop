// backend/lib/sheetCrop.js — slice a vertical N-up calligraphy sheet into N plates
// by horizontal ink-density valleys. Pure function of the image bytes.
const sharp = require('sharp');

async function cropSheet(buffer, expected) {
  const { data, info } = await sharp(buffer).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info; // 1 channel (greyscale)

  // Per-row average darkness (0..255); ink is dark on white.
  const rowDark = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    let sum = 0; const base = y * width;
    for (let x = 0; x < width; x++) sum += 255 - data[base + x];
    rowDark[y] = sum / width;
  }
  const maxD = rowDark.reduce((m, v) => (v > m ? v : m), 0) || 1;
  const thr = maxD * 0.06; // ink-row threshold (tuned at live checkpoint)

  // Contiguous ink bands.
  let bands = [];
  let start = -1;
  for (let y = 0; y < height; y++) {
    const ink = rowDark[y] > thr;
    if (ink && start < 0) start = y;
    else if (!ink && start >= 0) { bands.push([start, y - 1]); start = -1; }
  }
  if (start >= 0) bands.push([start, height - 1]);

  // Drop noise bands shorter than 1.5% of height.
  const minH = Math.max(2, Math.round(height * 0.015));
  bands = bands.filter(([a, b]) => b - a + 1 >= minH);

  // If more bands than expected, merge the pairs separated by the smallest gaps
  // (handles floated ornaments / diacritics that split a line).
  while (expected > 0 && bands.length > expected) {
    let gi = -1, gmin = Infinity;
    for (let i = 0; i < bands.length - 1; i++) {
      const gap = bands[i + 1][0] - bands[i][1];
      if (gap < gmin) { gmin = gap; gi = i; }
    }
    if (gi < 0) break;
    bands[gi] = [bands[gi][0], bands[gi + 1][1]];
    bands.splice(gi + 1, 1);
  }

  // Extract each band with small vertical padding.
  const pad = Math.round(height * 0.012);
  const plates = [];
  for (const [a, b] of bands) {
    const top = Math.max(0, a - pad);
    const bot = Math.min(height, b + 1 + pad);
    const h = bot - top;
    if (h <= 0) continue;
    const out = await sharp(buffer).extract({ left: 0, top, width, height: h })
      .png().toBuffer();
    plates.push(out);
  }
  return { plates, count: plates.length, expected };
}

module.exports = { cropSheet };
