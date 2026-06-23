// backend/lib/sheetCrop.js — slice a vertical N-up calligraphy sheet into N plates
// by horizontal ink-density valleys. Pure function of the image bytes.
const sharp = require('sharp');

// Per-row average darkness (0..255); ink is dark on white.
function rowDarkness(data, width, height) {
  const rowDark = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    let sum = 0; const base = y * width;
    for (let x = 0; x < width; x++) sum += 255 - data[base + x];
    rowDark[y] = sum / width;
  }
  return rowDark;
}

// Contiguous runs of rows whose darkness exceeds `thr`.
function inkRuns(rowDark, height, thr) {
  const runs = []; let start = -1;
  for (let y = 0; y < height; y++) {
    const ink = rowDark[y] > thr;
    if (ink && start < 0) start = y;
    else if (!ink && start >= 0) { runs.push([start, y - 1]); start = -1; }
  }
  if (start >= 0) runs.push([start, height - 1]);
  return runs;
}

// PRIMARY: drop noise runs by min height, then merge the smallest-gap pairs down
// to `expected` (handles floated ornaments / diacritics that split a line into
// several runs). Proven on well-spaced sheets. May land BELOW `expected` when a
// genuine but short line is filtered as noise — the fallback recovers that case.
function primaryBands(rowDark, height, thr, expected) {
  let bands = inkRuns(rowDark, height, thr);
  const minH = Math.max(2, Math.round(height * 0.015));
  bands = bands.filter(([a, b]) => b - a + 1 >= minH);
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
  return bands;
}

// FALLBACK (only when primary != expected): the page has `expected` names, so the
// `expected - 1` LARGEST vertical gaps between ink runs ARE the line separators.
// Group the runs at those gaps. This rescues both failure modes the primary can't:
//   • a short/faint line dropped by the noise filter (too FEW bands), and
//   • lines too close to leave a sub-threshold valley (would otherwise merge).
// Each name's diacritics/ornaments sit a small gap from its body, so they fall in
// the same group. Returns null when there aren't even `expected` runs to split.
function gapSegment(rowDark, height, thr, expected) {
  let runs = inkRuns(rowDark, height, thr);
  // Drop only hairline specks (~5px) — keep short-but-real name bodies (the bug
  // was a 16px line dropped by the 20px primary filter).
  const tiny = Math.max(1, Math.round(height * 0.004));
  runs = runs.filter(([a, b]) => b - a + 1 >= tiny);
  if (runs.length < expected) return null;     // can't form enough groups
  if (runs.length === expected) return runs;

  const gaps = [];
  for (let i = 0; i < runs.length - 1; i++) gaps.push({ i, gap: runs[i + 1][0] - runs[i][1] });
  gaps.sort((x, y) => y.gap - x.gap);
  const cutAfter = new Set(gaps.slice(0, expected - 1).map((g) => g.i));

  const groups = []; let s = 0;
  for (let i = 0; i < runs.length; i++) {
    if (cutAfter.has(i) || i === runs.length - 1) { groups.push([runs[s][0], runs[i][1]]); s = i + 1; }
  }
  return groups;
}

// LAST-RESORT (when the page is bold/tightly-spaced so ink never returns to zero
// between lines → the whole sheet is ONE run and the gap fallback can't split it).
// The model is prompted to space names EVENLY, so place the `expected - 1` cuts at
// the lowest-density (smoothed) row in a window around each evenly-spaced boundary.
// Always returns exactly `expected` bands (or null if there isn't enough content).
function valleySegment(rowDark, height, expected) {
  const maxD = rowDark.reduce((m, v) => (v > m ? v : m), 0) || 1;
  const lo = maxD * 0.04;
  let top = 0; while (top < height && rowDark[top] <= lo) top++;
  let bot = height - 1; while (bot > top && rowDark[bot] <= lo) bot--;
  if (bot - top < expected * 4) return null;

  const H = bot - top + 1;
  const slab = H / expected;
  const win = Math.max(2, Math.round(slab * 0.06));
  const sm = new Float64Array(height); // light moving-average to ignore per-row jitter
  for (let y = top; y <= bot; y++) {
    let s = 0, c = 0;
    for (let k = -win; k <= win; k++) { const yy = y + k; if (yy >= top && yy <= bot) { s += rowDark[yy]; c++; } }
    sm[y] = s / c;
  }

  const cuts = [];
  for (let i = 1; i < expected; i++) {
    const center = Math.round(top + i * slab);
    const r = Math.round(slab * 0.42);
    let by = center, bv = Infinity;
    for (let y = Math.max(top + 1, center - r); y <= Math.min(bot - 1, center + r); y++) {
      if (sm[y] < bv) { bv = sm[y]; by = y; }
    }
    cuts.push(by);
  }

  const bounds = [top - 1, ...cuts, bot];
  const bands = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i] + 1, b = bounds[i + 1];
    if (b >= a) bands.push([a, b]);
  }
  return bands.length === expected ? bands : null;
}

async function extractBands(buffer, bands, width, height) {
  const pad = Math.round(height * 0.012);
  const plates = [];
  for (const [a, b] of bands) {
    const top = Math.max(0, a - pad);
    const bot = Math.min(height, b + 1 + pad);
    const h = bot - top;
    if (h <= 0) continue;
    const out = await sharp(buffer).extract({ left: 0, top, width, height: h }).png().toBuffer();
    plates.push(out);
  }
  return plates;
}

async function cropSheet(buffer, expected) {
  const { data, info } = await sharp(buffer).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info; // 1 channel (greyscale)
  const rowDark = rowDarkness(data, width, height);
  const maxD = rowDark.reduce((m, v) => (v > m ? v : m), 0) || 1;
  const thr = maxD * 0.06; // ink-row threshold (tuned at live checkpoint)

  let bands = primaryBands(rowDark, height, thr, expected);
  // Two-stage fallback when the primary pass misses `expected` — only ever adopt a
  // result that hits EXACTLY `expected` (never mis-slice — spec §11):
  //   1) gapSegment: well-separated lines a short/faint line was dropped from, OR
  //      lines too close to leave a sub-threshold gap (≥ expected ink runs exist).
  //   2) valleySegment: bold/tight sheets where ink never returns to zero between
  //      lines → ONE run, so gapSegment can't split; cut at the inter-line valleys.
  if (expected > 0 && bands.length !== expected) {
    const gap = gapSegment(rowDark, height, thr, expected);
    if (gap && gap.length === expected) {
      bands = gap;
    } else {
      const valley = valleySegment(rowDark, height, expected);
      if (valley && valley.length === expected) bands = valley;
    }
  }

  const plates = await extractBands(buffer, bands, width, height);
  return { plates, count: plates.length, expected };
}

module.exports = { cropSheet };
