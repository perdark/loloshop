// backend/lib/plateOrnaments.js — pass 2 of a SmartAPI plate, done by a script instead of the model.
//
// WHY. Pass 2 only scatters small pen marks into the white space around a finished name; it must
// never touch a letter. On SmartAPI it cost ~40 s per draw and up to three draws (the density
// retry), so it was most of the wait for a plate — measured 2026-10-12: pass 1 ≈ 25 s,
// pass 2 ≈ 40 s per try. This module does the same job in well under a second, with marks CUT FROM
// THE SHOP'S OWN REFERENCE PLATES (assets/calligraphy/marks/, curated by eye: slants, ticks,
// strokes, v-marks, small loops, damma, sin-marks — nothing that reads as a letter), and it is
// pixel-safe by construction: the letters are composited UNDER, never redrawn.
//
// HOW. Greedy void-filling, the way a calligrapher fills a تزيين: repeatedly take the emptiest
// point inside the name's block (distance transform of the ink), drop a mark there if it fits
// with clearance, repeat until the target density. Three placement rules carry over from the AI
// prompt because they were measured there (2026-09-29): never directly above/below an alif-like
// tall stroke (reads as a hamza), nothing at the two far ends of the line, marks stay inside the
// letters' own band.
//
// CALLIG_ORNAMENTS = script (default) | ai  — lib/smartapi.js reads it, and maps the ornament
// level to a density (marks per plate-height of width, lib/plateMarks.js's unit).
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const MARKS_DIR = path.join(__dirname, '..', 'assets', 'calligraphy', 'marks');
const ANALYSIS_W = 1000;
// «loop» is the small ه-shaped mark: kept rare, because beside a letter it can read as one.
const KIND_WEIGHT = { slant: 30, tick: 22, stroke: 12, vee: 14, loop: 3, damma: 12, sin: 7 };


let library = null;
async function loadLibrary() {
  if (library) return library;
  const index = JSON.parse(fs.readFileSync(path.join(MARKS_DIR, 'index.json'), 'utf8'));
  const byKind = {};
  for (const m of index) {
    // Tiles are stored as ink-darkness (white = ink). Force ONE channel: sharp may write them as RGB.
    const { data, info } = await sharp(path.join(MARKS_DIR, m.file)).removeAlpha().extractChannel(0).raw().toBuffer({ resolveWithObject: true });
    (byKind[m.kind] ||= []).push({ ...m, alpha: data, w: info.width, h: info.height });
  }
  library = byKind;
  return library;
}

function pickKind(rand) {
  const total = Object.values(KIND_WEIGHT).reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (const [k, w] of Object.entries(KIND_WEIGHT)) { r -= w; if (r <= 0) return k; }
  return 'slant';
}

// Small deterministic PRNG so a test (or a reroll with a seed) can reproduce a plate.
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1e9) / 1e9; };
}

function components(dark, W, H) {
  const seen = new Uint8Array(W * H); const out = []; const st = [];
  for (let s = 0; s < dark.length; s++) {
    if (!dark[s] || seen[s]) continue;
    let x0 = W; let x1 = 0; let y0 = H; let y1 = 0; let area = 0;
    st.push(s); seen[s] = 1;
    while (st.length) {
      const p = st.pop(); area++;
      const x = p % W; const y = (p - x) / W;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx; const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (dark[q] && !seen[q]) { seen[q] = 1; st.push(q); }
      }
    }
    out.push({ x0, x1, y0, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, area });
  }
  return out;
}

// Chamfer (3-4) distance to the nearest blocked pixel, in pixels.
function distance(blocked, W, H) {
  const INF = 1e9; const d = new Float32Array(W * H);
  for (let i = 0; i < d.length; i++) d[i] = blocked[i] ? 0 : INF;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + 3);
    if (y > 0) {
      v = Math.min(v, d[i - W] + 3);
      if (x > 0) v = Math.min(v, d[i - W - 1] + 4);
      if (x < W - 1) v = Math.min(v, d[i - W + 1] + 4);
    }
    d[i] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x; let v = d[i];
    if (x < W - 1) v = Math.min(v, d[i + 1] + 3);
    if (y < H - 1) {
      v = Math.min(v, d[i + W] + 3);
      if (x < W - 1) v = Math.min(v, d[i + W + 1] + 4);
      if (x > 0) v = Math.min(v, d[i + W - 1] + 4);
    }
    d[i] = v;
  }
  for (let i = 0; i < d.length; i++) d[i] /= 3;
  return d;
}

/**
 * Adds ornament marks to a finished pass-1 plate. Returns `{ buffer, marks }`.
 * `buffer` is a PNG on white, same trim/pad convention as lib/smartapi.js editImage.
 */
async function addOrnaments(plateBuffer, { seed = Date.now(), targetDensity = 4.5 } = {}) {
  const lib = await loadLibrary();
  const rand = rng(seed);
  const src = sharp(plateBuffer).flatten({ background: '#ffffff' }).greyscale();
  const meta = await src.metadata();
  const fullW = meta.width; const fullH = meta.height;
  const k = Math.min(1, ANALYSIS_W / fullW);
  const W = Math.round(fullW * k); const H = Math.round(fullH * k);
  const { data } = await sharp(plateBuffer).flatten({ background: '#ffffff' }).greyscale()
    .resize(W, H, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });

  const ink = new Uint8Array(W * H);
  for (let i = 0; i < ink.length; i++) ink[i] = data[i] < 140 ? 1 : 0;
  const comps = components(ink, W, H).filter((c) => c.area >= 8);
  if (!comps.length) return { buffer: plateBuffer, marks: 0 };
  const bx0 = Math.min(...comps.map((c) => c.x0)); const bx1 = Math.max(...comps.map((c) => c.x1));
  const by0 = Math.min(...comps.map((c) => c.y0)); const by1 = Math.max(...comps.map((c) => c.y1));
  const blockH = by1 - by0 + 1; const blockW = bx1 - bx0 + 1;

  // Where a mark may NOT go (beyond the ink itself).
  const blocked = new Uint8Array(W * H);
  for (let i = 0; i < blocked.length; i++) blocked[i] = ink[i];
  const endMargin = Math.round(Math.max(0.05 * blockW, 0.12 * blockH));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (y < by0 || y > by1 || x < bx0 + endMargin || x > bx1 - endMargin) blocked[y * W + x] = 1;
  }
  // Alif-like tall thin strokes: keep the column above and below them clear (hamza misreading).
  for (const c of comps) {
    if (c.h < 0.5 * blockH || c.w > 0.35 * c.h) continue;
    const m = Math.round(0.04 * blockH);
    for (let y = by0; y <= by1; y++) {
      if (y >= c.y0 && y <= c.y1) continue;
      for (let x = Math.max(0, c.x0 - m); x <= Math.min(W - 1, c.x1 + m); x++) blocked[y * W + x] = 1;
    }
  }

  const target = Math.max(1, Math.round(targetDensity * (W / H)));
  const clearance = Math.max(2, Math.round(0.035 * blockH));
  const placed = [];
  let dist = distance(blocked, W, H);
  let misses = 0;

  while (placed.length < target && misses < 60) {
    // Blue-noise pick (Mitchell's best candidate): a few random roomy points, keep the emptiest.
    // Always taking the global emptiest point lined the marks up in rows along the block's top and
    // bottom edges; a small k keeps the spread even without the grid.
    let best = null;
    for (let tries = 0, found = 0; tries < 400 && found < 3; tries++) {
      const x = bx0 + Math.floor(rand() * blockW); const y = by0 + Math.floor(rand() * blockH);
      const v = dist[y * W + x];
      if (v < clearance + 2) continue;
      found++;
      if (!best || v > best[0]) best = [v, y * W + x];
    }
    if (!best) { misses += 10; continue; }
    const [room, at] = best;
    const cx = at % W; const cy = (at - cx) / W;

    const kind = pickKind(rand);
    const choices = lib[kind]; const m = choices[Math.floor(rand() * choices.length)];
    // Size from the reference ratio (mark height ÷ letter-block height), shrunk to the room there.
    let mh = m.relH * blockH * (0.8 + 0.25 * rand());
    const fit = (room - clearance) * 2;
    const scale0 = mh / m.h;
    const diag = Math.hypot(m.w, m.h) * scale0;
    if (diag > fit) mh *= fit / diag;
    if (mh < 0.06 * blockH) { misses++; markUsed(blocked, W, H, cx, cy, clearance * 2); dist = distance(blocked, W, H); continue; }
    const s = mh / m.h; const mw = Math.max(1, Math.round(m.w * s)); const mhh = Math.max(1, Math.round(m.h * s));
    const ox = Math.round(cx - mw / 2); const oy = Math.round(cy - mhh / 2);

    // Collision check on the scaled mark against blocked (with clearance via dist field).
    let ok = true;
    for (let y = 0; y < mhh && ok; y++) for (let x = 0; x < mw; x++) {
      const a = m.alpha[Math.min(m.h - 1, Math.floor(y / s)) * m.w + Math.min(m.w - 1, Math.floor(x / s))];
      if (a < 100) continue;
      const px = ox + x; const py = oy + y;
      if (px < 0 || py < 0 || px >= W || py >= H || dist[py * W + px] < clearance) { ok = false; break; }
    }
    if (!ok) { misses++; markUsed(blocked, W, H, cx, cy, Math.max(2, Math.round(clearance / 2))); dist = distance(blocked, W, H); continue; }

    placed.push({ m, x: ox / k, y: oy / k, w: mw / k, h: mhh / k });
    for (let y = 0; y < mhh; y++) for (let x = 0; x < mw; x++) {
      const a = m.alpha[Math.min(m.h - 1, Math.floor(y / s)) * m.w + Math.min(m.w - 1, Math.floor(x / s))];
      if (a >= 60) blocked[(oy + y) * W + (ox + x)] = 1;
    }
    // Spacing between marks: treat each placed mark's box as ink for the next search.
    markUsed(blocked, W, H, cx, cy, Math.round(Math.min(mw, mhh) / 2));
    dist = distance(blocked, W, H);
  }

  const overlays = await Promise.all(placed.map(async (p) => {
    const w = Math.max(1, Math.round(p.w)); const h = Math.max(1, Math.round(p.h));
    const alpha = await sharp(p.m.alpha, { raw: { width: p.m.w, height: p.m.h, channels: 1 } })
      .resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).extractChannel(0).raw().toBuffer();
    const rgba = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) rgba[i * 4 + 3] = alpha[i]; // black ink, alpha = darkness
    return { input: await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer(), left: Math.round(p.x), top: Math.round(p.y) };
  }));
  const buffer = await sharp(plateBuffer).flatten({ background: '#ffffff' }).composite(overlays).png().toBuffer();
  return { buffer, marks: placed.length };
}

function markUsed(blocked, W, H, cx, cy, r) {
  for (let y = Math.max(0, cy - r); y <= Math.min(H - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(W - 1, cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) blocked[y * W + x] = 1;
    }
  }
}

module.exports = { addOrnaments, _internals: { loadLibrary, distance, components } };
