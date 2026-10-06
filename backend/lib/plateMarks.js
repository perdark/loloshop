// backend/lib/plateMarks.js — how richly a finished calligraphy plate is ornamented.
//
// Pass 2 of lib/smartapi.js asks the image model for a hand-placed scatter of pen marks, and the
// model's answer varies a lot between runs on an IDENTICAL prompt: measured 2026-10-06, the same
// recipe on the same name came back with 17 marks and with 42. The owner wants the dense look
// every time, so the plate is counted and a thin one is re-drawn once (see generatePlate).
//
// A «mark» is a small thin connected component — a tick, a slash, a curl. Letter bodies are big
// and letter dots are small but SOLID, so a size cap plus a fill-ratio cap tells them apart.
const sharp = require('sharp');

const WIDTH = 700; // analysis width; plates are ~2000px, marks stay several pixels thick here

/** Number of ornament marks on a plate image, normalised per plate-HEIGHT of width so a long
 *  three-word name and a short two-word one are comparable (a long strip simply has more marks). */
async function countMarks(buffer) {
  const { data, info } = await sharp(buffer).flatten({ background: '#ffffff' }).greyscale()
    .resize({ width: WIDTH }).raw().toBuffer({ resolveWithObject: true });
  const W = info.width; const H = info.height;
  const dark = new Uint8Array(W * H);
  for (let i = 0; i < dark.length; i++) dark[i] = data[i] < 128 ? 1 : 0;
  const seen = new Uint8Array(W * H);
  const stack = [];
  let marks = 0;
  for (let start = 0; start < dark.length; start++) {
    if (!dark[start] || seen[start]) continue;
    let area = 0; let minX = W; let maxX = 0; let minY = H; let maxY = 0;
    stack.push(start); seen[start] = 1;
    while (stack.length) {
      const p = stack.pop(); area++;
      const x = p % W; const y = (p - x) / W;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx; const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const q = ny * W + nx;
          if (dark[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
        }
      }
    }
    const w = maxX - minX + 1; const h = maxY - minY + 1;
    if (area < 6 || h > 0.2 * H || w > 0.2 * W) continue; // dust, or a letter / word
    if (area / (w * h) > 0.5) continue; // solid blob: a letter dot, not a pen mark
    marks++;
  }
  return { marks, perHeight: marks / (W / H) };
}

module.exports = { countMarks };
