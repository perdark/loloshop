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

// Drop noise runs by min height, then merge the smallest-gap pairs down to `expected`.
// Good on loose, clean sheets. May land BELOW `expected` when a genuine short line is
// filtered as noise — the other methods recover that case.
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

// The page has `expected` names, so the `expected - 1` LARGEST vertical gaps between ink
// runs ARE the line separators. Group the runs at those gaps. Filters out small specks
// FIRST (textured/cream backgrounds throw off many tiny runs) so a speck can't steal a
// line slot. Returns null when there aren't even `expected` real runs to split.
function gapSegment(rowDark, height, thr, expected) {
  let runs = inkRuns(rowDark, height, thr);
  // Drop specks (background texture, stray dots) — keep only real name-body-sized runs.
  const minH = Math.max(2, Math.round(height * 0.012));
  runs = runs.filter(([a, b]) => b - a + 1 >= minH);
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

// LAST-RESORT for bold/tight sheets where ink never returns near the background between
// lines → too few runs to gap-segment. The model is prompted to space names EVENLY, so
// place the `expected - 1` cuts at the lowest-density (smoothed) row near each evenly-
// spaced boundary. `marginLo` strips the page margins (background-relative, so it works
// on cream sheets where a maxD-relative threshold would set top=0).
function valleySegment(rowDark, height, expected, marginLo) {
  let top = 0; while (top < height && rowDark[top] <= marginLo) top++;
  let bot = height - 1; while (bot > top && rowDark[bot] <= marginLo) bot--;
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

// Slice the sheet into one plate per band. To avoid bleeding a neighbouring line into a
// plate (the tight-spacing failure), we DON'T just crop band±fixed-pad:
//   1) the boundary between two lines is the DEEPEST row valley in the gap between them —
//      cut there, so each plate is bounded by the cleanest rows available;
//   2) inside that segment, trim back to this band's own ink (drops the page margin /
//      inter-line whitespace and any sub-threshold sliver of a neighbour near the valley),
//      then add a small symmetric pad.
async function extractBands(buffer, bands, width, height, rowDark, trimThr) {
  const sorted = bands.slice().sort((x, y) => x[0] - y[0]);
  const n = sorted.length;
  if (!n) return [];

  // inter-line cut rows = deepest valley in each between-band gap
  const cuts = [];
  for (let i = 0; i < n - 1; i++) {
    const gs = sorted[i][1] + 1;
    const ge = sorted[i + 1][0] - 1;
    let by = Math.floor((gs + ge) / 2), bv = Infinity;
    for (let y = gs; y <= ge; y++) if (rowDark[y] < bv) { bv = rowDark[y]; by = y; }
    cuts.push(by);
  }

  const pad = Math.max(2, Math.round(height * 0.008)); // small breathing room
  const plates = [];
  for (let i = 0; i < n; i++) {
    const segTop = i === 0 ? 0 : cuts[i - 1] + 1;
    const segBot = i === n - 1 ? height - 1 : cuts[i];
    // trim the segment down to its own ink span (rows above the background threshold)
    let t = segTop; while (t < segBot && rowDark[t] <= trimThr) t++;
    let b = segBot; while (b > t && rowDark[b] <= trimThr) b--;
    const top = Math.max(segTop, t - pad);
    const bot = Math.min(segBot, b + pad);
    const h = bot - top + 1;
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

  // Background baseline from a low percentile (= page margins + inter-line gaps). Generated
  // sheets are sometimes cream/textured rather than pure white, so a maxD-only threshold
  // reads the whole page as ink and the valleys vanish. Make every threshold RELATIVE to
  // the background so off-white/textured sheets segment as cleanly as white ones.
  const srt = Float64Array.from(rowDark).sort();
  const base = srt[Math.floor(0.10 * (srt.length - 1))] || 0;
  const maxD = srt[srt.length - 1] || 1;
  const span = Math.max(1, maxD - base);
  const thr = base + span * 0.18;      // ink-row threshold
  const trimThr = base + span * 0.10;  // a row counts as content (for trimming) above this
  const marginLo = base + span * 0.06; // margin/background for valley top/bot detection

  // Segmentation (only ever adopt an EXACTLY `expected` result — never mis-slice, spec §11):
  //   1) gapSegment — largest inter-run gaps are the separators; with the background-relative
  //      threshold + speck filter this is robust on textured AND clean sheets.
  //   2) valleySegment — for bold/tight sheets with too few runs (cut at even-boundary valleys).
  //   3) primaryBands — smallest-gap merge (loose, clean sheets).
  let bands = null;
  if (expected > 1) {
    const gap = gapSegment(rowDark, height, thr, expected);
    if (gap && gap.length === expected) bands = gap;
  }
  if (!bands && expected > 0) {
    const valley = valleySegment(rowDark, height, expected, marginLo);
    if (valley && valley.length === expected) bands = valley;
  }
  if (!bands) {
    const prim = primaryBands(rowDark, height, thr, expected);
    if (expected === 0 || prim.length === expected) bands = prim;
  }
  if (!bands) bands = primaryBands(rowDark, height, thr, expected); // mismatch → caller flags review

  const plates = await extractBands(buffer, bands, width, height, rowDark, trimThr);
  return { plates, count: plates.length, expected };
}

module.exports = { cropSheet };
