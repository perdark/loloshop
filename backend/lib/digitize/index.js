// backend/lib/digitize/index.js
// «صورة الاسم» -> ملف تطريز DST.  Turns a calligraphy plate PNG into a Tajima .DST the
// embroidery machine can run, in about a second, with no model call and no new dependency.
//
// WHY THIS EXISTS. The plate is a picture; the machine only reads needle coordinates.
// Bridging the two by hand in Wilcom is 15–20 minutes per name, and the resulting files
// were being saved under keypad names («44444441000.DST») with nothing tying them to a
// student. This module does the mechanical part and names the output after the order.
//
// WHAT IT DOES NOT DO. It does not replace the operator's judgement — it produces a first
// pass to correct, not a file to run blind. `coverage` is reported on every result for
// exactly that reason: it is the honest measure of how much of the artwork actually
// received thread, and a low number means "open this one before stitching it".
//
// The satin/fill parameters are measured from the shop's own library — see stitches.js.

const sharp = require('sharp');
const { Mask, dilate, erode, close, removeSmall, distanceTransform, skeletonize, label } = require('./grid');
const { tracePaths, pruneSpurs, extendEnds, mergeAtJunctions } = require('./trace');
const { DEFAULTS, satinColumn, centreRun, travelStitches, fillRegion, orderRuns } = require('./stitches');
const { writeDst, readDst } = require('./dst');

const PIPELINE_DEFAULTS = {
  heightMm: 70,          // finished height of the name on the sash
  pxPerMm: 12,           // working resolution — 12 keeps a 0.2 mm stitch well inside a pixel
  threshold: 128,
  despeckleMm2: 0.6,     // ink islands smaller than this are scanner noise, not letters
  // ⚠️ minPatchMm2 IS A QUALITY DIAL, NOT A TOLERANCE. At 0.8 the completion pass patched
  // every speck the satin missed with tatami, and on a broken satin generator that meant
  // ~50% of the file was hatch — a "99.6% covered" file that reads as scribble. Now that
  // satin actually covers, this only has to catch genuine holes.
  // Measured on the ten test plates: 3.0/2 leaves coverage at 98.6%, 1.0/5 takes it to
  // 99.5% and costs 0.05 points of satin ratio and 0.9% more spill. That trade is only
  // available BECAUSE a patch is satin now — at 0.8/4 with a tatami patch the same dial
  // cost ~50% of the satin ratio and made the file hatch.
  minPatchMm2: 1.0,
  completionRounds: 5,
  underlay: true,
  underlayStepMm: 2.2,
  travelMaxMm: 9.0,      // a shorter gap than this is walked, not jumped
  maxPixels: 40_000_000, // same guard calligraphyController already applies to uploads
};

/**
 * Decode the plate and reduce it to a clean binary mask at a known scale.
 * Handles both "black ink on white" and "white ink on dark", and flattens alpha —
 * an AI-generated plate may arrive transparent, and an un-flattened alpha channel
 * silently reads as black ink covering the whole canvas.
 */
async function loadMask(input, opts = {}) {
  const o = { ...PIPELINE_DEFAULTS, ...opts };
  const img = sharp(input, { limitInputPixels: o.maxPixels }).flatten({ background: '#ffffff' }).greyscale();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  // ⚠️ NEVER assume one byte per pixel. sharp returns whatever channel count the
  // pipeline ended on, and `.greyscale()` does not guarantee 1 — read info.channels
  // and stride by it. Reading a 3-channel buffer as 1-channel does not throw: it
  // yields a squashed, shuffled mask that still looks like *a* shape, which is far
  // more expensive to debug than a crash. Same trap on the resize below.
  const chan = info.channels || 1;

  let sum = 0;
  for (let i = 0; i < w * h; i++) sum += data[i * chan];
  const mean = sum / (w * h);
  const inkIsDark = mean > 127;

  let m = new Mask(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = data[i * chan];
    m.data[i] = (inkIsDark ? 255 - v : v) > o.threshold ? 1 : 0;
  }
  const bb = m.bbox();
  if (!bb) throw Object.assign(new Error('الصورة فارغة'), { code: 'ERR_EMPTY_PLATE' });

  // scale so the design is exactly heightMm tall, then re-rasterise through sharp
  const srcH = bb.maxY - bb.minY + 1;
  const scale = (o.heightMm * o.pxPerMm) / srcH;
  const cropW = bb.maxX - bb.minX + 1;
  const outW = Math.max(1, Math.round(cropW * scale));
  const outH = Math.max(1, Math.round(srcH * scale));

  const bin = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) bin[i] = m.data[i] ? 255 : 0;
  const scaledOut = await sharp(bin, { raw: { width: w, height: h, channels: 1 } })
    .extract({ left: bb.minX, top: bb.minY, width: cropW, height: srcH })
    .resize(outW, outH, { kernel: 'lanczos3' })
    .raw().toBuffer({ resolveWithObject: true });
  const scaled = scaledOut.data;
  const sChan = scaledOut.info.channels || 1;

  // pad by 2 px of background: the distance transform measures distance to the nearest
  // OFF pixel, so a stroke touching the border would otherwise read as infinitely thick.
  const pad = 2;
  const W = outW + pad * 2, H = outH + pad * 2;
  let mask = new Mask(W, H);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      if (scaled[(y * outW + x) * sChan] > 128) mask.data[(y + pad) * W + (x + pad)] = 1;
    }
  }
  mask = removeSmall(mask, Math.round(o.despeckleMm2 * o.pxPerMm * o.pxPerMm));
  mask = close(mask, 1);
  if (!mask.bbox()) throw Object.assign(new Error('لم يتبق شيء بعد التنظيف'), { code: 'ERR_EMPTY_PLATE' });
  return { mask, pxPerMm: o.pxPerMm };
}

/**
 * Lift out the parts too wide for satin. A satin stitch over ~8 mm snags and loops on a
 * real machine, which is why the shop's own files never span a bowl with one column —
 * measured on a typical name, only ~3% of the area is affected but it is the letter
 * BODIES (ف ع ه ص), so leaving it to satin is what makes an auto file look broken.
 */
function splitWide(mask, dist, pxPerMm, { maxSatinMm = DEFAULTS.maxSatinMm, minBlobMm2 = 8 } = {}) {
  const { width: w, height: h } = mask;
  const core = new Mask(w, h);
  for (let i = 0; i < w * h; i++) if (mask.data[i] && (2 * dist[i]) / pxPerMm > maxSatinMm) core.data[i] = 1;

  const kept = removeSmall(core, Math.round(minBlobMm2 * pxPerMm * pxPerMm));
  if (!kept.count()) return { satinMask: mask, regions: [] };

  const grown = new Mask(w, h);
  const g = dilate(kept, Math.max(1, Math.round((maxSatinMm / 2) * pxPerMm)));
  for (let i = 0; i < w * h; i++) grown.data[i] = g.data[i] && mask.data[i] ? 1 : 0;

  // keep only the grown pieces that actually contain a core pixel
  const { labels, count } = label(grown);
  const touching = new Set();
  for (let i = 0; i < w * h; i++) if (kept.data[i] && labels[i]) touching.add(labels[i]);
  const fillMask = new Mask(w, h);
  for (let i = 0; i < w * h; i++) if (labels[i] && touching.has(labels[i])) fillMask.data[i] = 1;

  const shrunk = erode(fillMask, Math.max(1, Math.round(0.35 * pxPerMm)));
  const satinMask = new Mask(w, h);
  for (let i = 0; i < w * h; i++) satinMask.data[i] = mask.data[i] && !shrunk.data[i] ? 1 : 0;

  const regions = [];
  const rl = label(fillMask);
  for (let id = 1; id <= rl.count; id++) {
    if (rl.sizes[id] / (pxPerMm * pxPerMm) < minBlobMm2) continue;
    const r = new Mask(w, h);
    for (let i = 0; i < w * h; i++) if (rl.labels[i] === id) r.data[i] = 1;
    regions.push(r);
  }
  return { satinMask, regions };
}

/** Rasterise generated runs back onto the grid, to see what is still bare. */
function rasterRuns(runs, w, h, pxPerMm, threadMm = 0.42) {
  const m = new Mask(w, h);
  const r = Math.max(1, Math.round((threadMm * pxPerMm) / 2));
  const plot = (x, y) => {
    const px = Math.round(x * pxPerMm), py = Math.round(y * pxPerMm);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const nx = px + dx, ny = py + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) m.data[ny * w + nx] = 1;
    }
  };
  for (const run of runs) {
    for (let i = 0; i < run.length - 1; i++) {
      const [x0, y0] = run[i], [x1, y1] = run[i + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * pxPerMm));
      for (let s = 0; s <= steps; s++) plot(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps);
    }
  }
  return m;
}

/**
 * Join runs into as few continuous shapes as possible, by travelling THROUGH the ink.
 *
 * ⚠️ A LETTER IS ONE SHAPE. THAT IS THE OWNER'S RULE AND IT IS ALSO THE MACHINE'S.
 * Every break between shapes is a stop, a trim, a re-start and a thread tail somebody
 * clips by hand — and a machine that starts and stops 40 times across one name takes the
 * wear a machine that starts 12 times does not. Measured against the shop's own files:
 * their mean shape is 231–309 stitches and their longest is 2,357 (a whole word, unbroken);
 * ours were 78–100 and 368, i.e. **3–4x more separate pieces per dm²**. That is what an
 * embroiderer means by «الحرف صار أكثر من شكل».
 *
 * The fix is not to jump less bravely — it is to notice that ink is CONNECTED. Two points
 * inside the same letter can almost always be joined by a path that never leaves the
 * artwork, and a running stitch along that path disappears under the satin that covers it.
 * So: try the straight line first (cheapest), then a route found through the ink, and only
 * jump when the two points are in genuinely different pieces of artwork — a separate
 * letter, a dot, a hamza. That is exactly where the shop's files jump too.
 */
// ⚠️ routeMaxMm WAS 45 AND THAT IS WHAT MADE A 60 mm BAR TWO SHAPES. Every refused join
// on «الباحث محمد علي» was 40–64 mm apart with both ends on the same ink: the satin walks to
// one end of a stroke and the next run starts at the other, so the hidden travel back is as
// long as the stroke. That run costs ~25 stitches nobody sees; the trim it replaces costs a
// stop, a cut and a tail. The same went for the "3.5× the straight line" detour gate — going
// AROUND a bowl under the satin is exactly the travel Wilcom lays, and refusing it is a trim
// across the bowl's opening instead. A route is now refused only when it is genuinely long
// (past a whole ligature) or when the search window would be unreasonable.
function connectTravel(runs, mask, dist, pxPerMm, Hmm, maxMm = 9, routeMaxMm = 150) {
  const { width: w, height: h } = mask;
  const toPx = (p) => [Math.round(p[0] * pxPerMm), Math.round((Hmm - p[1]) * pxPerMm)];
  const toMm = (j, i) => [j / pxPerMm, Hmm - i / pxPerMm];
  const ink = (j, i) => i >= 0 && j >= 0 && i < h && j < w && mask.data[i * w + j];
  // ⚠️ TRAVEL DOWN THE MIDDLE OF THE STROKE, NOT ALONG ITS EDGE. A plain shortest path hugs
  // the outline — corners and rims — which is the one place a running stitch is not hidden
  // by the satin lying over it, so the travel shows as a thin line along the letter's edge.
  // Routing only through pixels at least `coreMm` inside the ink puts the thread under the
  // thickest part of the column, where it disappears. Endpoints are exempt: they are the
  // column's own corners and are always near the edge by construction.
  const coreMm = 0.45;
  const core = (j, i) => ink(j, i) && dist[i * w + j] / pxPerMm >= coreMm;

  // ⚠️ SNAP TO THE INK BEFORE ROUTING. A satin column's endpoints sit at +/- the half width
  // PLUS pull compensation, so the last point of a run is normally a few tenths of a
  // millimetre OUTSIDE the artwork. Testing `ink()` on it directly answers "no" for almost
  // every run, the router refuses to start, and every connection falls back to a jump —
  // which is the whole bug this function exists to fix, silently reintroduced.
  const snap = (p) => {
    const [j0, i0] = toPx(p);
    if (ink(j0, i0)) return [j0, i0];
    const r = Math.max(2, Math.round(1.2 * pxPerMm));
    let best = null, bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const j = j0 + dx, i = i0 + dy;
        if (!ink(j, i)) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = [j, i]; }
      }
    }
    return best;
  };

  const clear = (a, b) => {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d > maxMm) return false;
    const n = Math.max(2, Math.ceil(d * pxPerMm));
    // the ends are allowed to sit just outside — they always do; the MIDDLE must be ink
    for (let k = 1; k < n; k++) {
      const [j, i] = toPx([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
      if (!ink(j, i)) return false;
    }
    return true;
  };

  // Breadth-first walk over ink pixels, inside a window around the two points so the cost
  // stays proportional to the gap and not to the whole plate.
  const route = (a, b, coreOnly) => {
    const sa = snap(a), sb = snap(b);
    if (!sa || !sb) return null;
    const [aj, ai] = sa, [bj, bi] = sb;
    // the window is the box around the two points plus room for one detour around a bowl —
    // not routeMaxMm, which at 12 px/mm would make every search a 3,600-px-wide flood
    const pad = Math.ceil(25 * pxPerMm);
    const x0 = Math.max(0, Math.min(aj, bj) - pad), x1 = Math.min(w - 1, Math.max(aj, bj) + pad);
    const y0 = Math.max(0, Math.min(ai, bi) - pad), y1 = Math.min(h - 1, Math.max(ai, bi) + pad);
    const ww = x1 - x0 + 1, hh = y1 - y0 + 1;
    if (ww * hh > 6_000_000) return null;
    const prev = new Int32Array(ww * hh).fill(-1);
    const seen = new Uint8Array(ww * hh);
    const q = new Int32Array(ww * hh);
    let head = 0, tail = 0;
    const startIdx = (ai - y0) * ww + (aj - x0);
    const goalIdx = (bi - y0) * ww + (bj - x0);
    seen[startIdx] = 1; q[tail++] = startIdx;
    let found = false;
    while (head < tail) {
      const cur = q[head++];
      if (cur === goalIdx) { found = true; break; }
      const cx = cur % ww, cy = (cur - cx) / ww;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= ww || ny >= hh) continue;
          const ni = ny * ww + nx;
          const ok = coreOnly ? (core(nx + x0, ny + y0) || ni === goalIdx) : ink(nx + x0, ny + y0);
          if (seen[ni] || !ok) continue;
          seen[ni] = 1; prev[ni] = cur; q[tail++] = ni;
        }
      }
    }
    if (!found) return null;
    const px = [];
    for (let cur = goalIdx; cur !== -1 && cur !== startIdx; cur = prev[cur]) {
      const cx = cur % ww, cy = (cur - cx) / ww;
      px.push(toMm(cx + x0, cy + y0));
    }
    px.reverse();
    // length gate: a route that wanders far further than the straight line is not a
    // travel, it is a detour around the outside of a bowl — jump instead.
    const len = px.length / pxPerMm;
    if (len > routeMaxMm) return null;
    // sample it down to running stitches
    const out = [];
    const step = Math.max(1, Math.round(2.2 * pxPerMm));
    for (let k = step; k < px.length; k += step) out.push(px[k]);
    out.push(b);
    return out;
  };

  const out = [];
  let cur = null;
  for (const run of runs) {
    if (cur) {
      const from = cur[cur.length - 1];
      if (clear(from, run[0])) {
        cur.push(...travelStitches(from, run[0]), ...run.slice(1));
        continue;
      }
      // ⚠️ THE CORE-ONLY ROUTE IS A PREFERENCE, NOT A CONDITION. Requiring it outright looks
      // like the tidier rule and costs you the whole feature: a thin stroke has no core, so
      // the route fails, the connection falls back to a jump, and the shape count goes
      // straight back up (measured: 7 shapes -> 35 on «حسين»). Try the hidden path first,
      // then any path through the ink, and only then give up and trim.
      const r = route(from, run[0], true) || route(from, run[0], false);
      if (r) { cur.push(...r, ...run.slice(1)); continue; }
      if (process.env.DGZ_DEBUG) {
        const sa = snap(from), sb = snap(run[0]);
        console.log('JOIN FAIL', 'from', from.map((v) => v.toFixed(1)), 'to', run[0].map((v) => v.toFixed(1)), 'straight', Math.hypot(run[0][0] - from[0], run[0][1] - from[1]).toFixed(1), 'snapA', !!sa, 'snapB', !!sb, 'curLen', cur.length, 'runLen', run.length);
      }
      out.push(cur);
    }
    cur = run.slice();
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Sew one piece of ink at a time, right to left.
 *
 * ⚠️ THE ORDER IS WHAT DECIDES THE SHAPE COUNT, MORE THAN THE ROUTER DOES. A plain
 * nearest-neighbour walk hops from a letter to the dot beside it and back, and every such
 * detour is two trims and two tails — measured on «الباحث محمد علي» at 111 mm: 28 of the 58
 * shapes were pieces of a letter that had been interrupted, against 32 shapes in the
 * embroiderer's own file. So runs are grouped by the connected piece of ink they lie on,
 * the pieces are taken in READING ORDER (rightmost first — 86% of the shop's files start on
 * the right and 84% run right-to-left), and inside a piece the walk starts at its right edge.
 * `connectTravel` then only ever has to join runs that really share ink.
 */
function orderByComponent(runs, mask, pxPerMm, Hmm) {
  const { width: w, height: h } = mask;
  const { labels } = label(mask);
  const at = (x, y) => {
    const j0 = Math.round(x * pxPerMm), i0 = Math.round((Hmm - y) * pxPerMm);
    const r = Math.max(2, Math.round(1.5 * pxPerMm));
    let best = 0, bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const j = j0 + dx, i = i0 + dy;
      if (i < 0 || j < 0 || i >= h || j >= w || !labels[i * w + j]) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = labels[i * w + j]; }
    }
    return best;
  };
  const groups = new Map();
  for (const run of runs) {
    const mid = run[Math.floor(run.length / 2)];
    const id = at(mid[0], mid[1]) || at(run[0][0], run[0][1]);
    if (!groups.has(id)) groups.set(id, { runs: [], maxX: -Infinity, sumY: 0, n: 0 });
    const g = groups.get(id);
    g.runs.push(run);
    for (const [x, y] of run) { if (x > g.maxX) g.maxX = x; g.sumY += y; g.n++; }
  }
  const order = [...groups.values()].sort((a, b) => b.maxX - a.maxX);
  const out = [];
  for (const g of order) out.push(...orderRuns(g.runs, [g.maxX + 5, g.sumY / g.n]));
  return out;
}

/**
 * Satin a leftover hole on its own medial axis. Returns null when the piece is too small
 * or too blobby to carry a column, in which case the caller falls back to tatami.
 * The distance transform is taken on the PATCH, not the whole plate, so the column is
 * sized to the hole and does not spill over the stitching that already surrounds it.
 */
function satinPatch(region, pxPerMm, w, h, o) {
  const pdist = distanceTransform(region);
  let pp = tracePaths(skeletonize(region), pdist, pxPerMm, { minLenMm: 0.5 });
  if (!pp.length) return null;
  pp = mergeAtJunctions(pruneSpurs(pp, 0.8));
  pp = extendEnds(pp, region, pdist, pxPerMm);
  const cols = pp
    .map((p) => {
      const sat = satinColumn([...p].reverse(), pdist, w, h, pxPerMm, o);
      return sat.length > 5 ? sat : null;
    })
    .filter(Boolean);
  return cols.length ? cols : null;
}

/**
 * Digitise one plate.
 * @returns {{buffer:Buffer, stats:object}}
 */
async function digitizePlate(input, opts = {}) {
  const o = { ...PIPELINE_DEFAULTS, ...opts };
  const t0 = Date.now();
  const { mask, pxPerMm } = await loadMask(input, o);
  const { width: w, height: h } = mask;
  const dist = distanceTransform(mask);

  const { satinMask, regions } = splitWide(mask, dist, pxPerMm, o);
  const skel = skeletonize(satinMask);
  let paths = tracePaths(skel, dist, pxPerMm, { minLenMm: 0.8 });
  paths = pruneSpurs(paths, 0.8);
  paths = mergeAtJunctions(paths);
  paths = extendEnds(paths, satinMask, dist, pxPerMm);

  // Each stroke is ONE run: walk out along the centreline (the underlay), then satin back
  // over it. Two passes, zero extra jumps — and it is the shape the shop's own files have.
  const cols = paths
    .map((p) => {
      const sat = satinColumn([...p].reverse(), dist, w, h, pxPerMm, o);
      if (sat.length <= 5) return null;
      return o.underlay === false ? sat : [...centreRun(p, o.underlayStepMm), ...sat];
    })
    .filter(Boolean);
  // fillRegion returns MANY runs per region (a row broken by a counter is two runs)
  const fills = regions.flatMap((r) => fillRegion(r, pxPerMm, o)).filter((f) => f.length > 4);

  // image space is y-DOWN, embroidery space is y-UP. Flip exactly once, here.
  // (Getting this wrong stitches the whole design mirrored, and it previews so
  // plausibly that it is only obvious when compared against the artwork.)
  const Hmm = h / pxPerMm;
  const flip = (run) => run.map(([x, y]) => [x, Hmm - y]);
  let runs = [...cols.map(flip), ...fills.map(flip)];

  // ---- coverage-driven completion -------------------------------------------------
  // The skeleton is good at strokes and bad at bowls, junctions and short tails. Rather
  // than chase every edge case, generate what we trust, rasterise it, and hand whatever
  // is still bare to a fill pass. Nothing can silently go unstitched — which is the one
  // failure a digitiser must never ship, because it is invisible until it is on fabric.
  let patches = 0;
  for (let round = 0; round < o.completionRounds; round++) {
    const covered = rasterRuns(runs.map(flip), w, h, pxPerMm);
    const bare = new Mask(w, h);
    for (let i = 0; i < w * h; i++) bare.data[i] = mask.data[i] && !covered.data[i] ? 1 : 0;
    const opened = removeSmall(bare, Math.round(o.minPatchMm2 * pxPerMm * pxPerMm));
    if (!opened.count()) break;
    const bl = label(opened);
    const added = [];
    for (let id = 1; id <= bl.count; id++) {
      if (bl.sizes[id] / (pxPerMm * pxPerMm) < o.minPatchMm2) continue;
      const r = new Mask(w, h);
      for (let i = 0; i < w * h; i++) if (bl.labels[i] === id) r.data[i] = 1;
      const grown = dilate(r, Math.max(1, Math.round(0.3 * pxPerMm)));
      for (let i = 0; i < w * h; i++) grown.data[i] = grown.data[i] && mask.data[i] ? 1 : 0;
      // ⚠️ PATCH A HOLE WITH SATIN, NOT TATAMI. Tatami here is what a "99.6% covered" file
      // was made of: measured, the patch pass bought +11 points of coverage and paid 10
      // points of satin ratio and 4% short stitches for it — the file goes from reading like
      // the shop's to reading like hatch-scribble. A hole is a small piece of the same
      // artwork, so it gets the same treatment: its own medial axis, its own satin.
      const fs = satinPatch(grown, pxPerMm, w, h, o)
        || fillRegion(grown, pxPerMm, { ...o, fillSpacingMm: 0.38 }).filter((f) => f.length > 4);
      if (fs.length) { fs.forEach((f) => added.push(flip(f))); patches++; }
    }
    if (!added.length) break;
    runs = runs.concat(added);
  }

  let ordered = orderByComponent(runs, mask, pxPerMm, Hmm);
  ordered = connectTravel(ordered, mask, dist, pxPerMm, Hmm, o.travelMaxMm);

  // ⚠️ THE NEEDLE STARTS AT THE CENTRE OF THE DESIGN, NOT AT ITS CORNER. Every one of the
  // shop's 417 files has its start point (0,0) at the middle of the extents (+X == -X in the
  // header) and returns there at the end; the operator lines the hoop up on that point.
  // Written from the corner, the same file sews 54–111 mm off where the operator placed it.
  // Translate here — writeDst only knows units — and remember the offset for the readback.
  let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
  for (const run of ordered) for (const [x, y] of run) {
    if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
  }
  const ox = (bx0 + bx1) / 2, oy = (by0 + by1) / 2;
  const centred = ordered.map((run) => run.map(([x, y]) => [x - ox, y - oy]));
  const buffer = writeDst(centred, { label: o.label });

  const { stitches } = readDst(buffer);

  // Final honest coverage — READ BACK OUT OF THE FILE, not out of the runs we meant to
  // write. ⚠️ This used to rasterise `ordered`, and that is not the same thing: anything
  // the writer changes on the way out is invisible to it. It was measuring 99.6% coverage
  // on a file with a bare slit through the widest part of a letter, because writeDst was
  // turning any stitch over 12.1 mm into travel. Measure the artefact, not the intent.
  const shipped = [];
  let curRun = [];
  for (const s of stitches) {
    const p = [s.x / 10 + ox, s.y / 10 + oy];
    if (s.kind === 'jump') { if (curRun.length > 1) shipped.push(curRun); curRun = [p]; }
    else curRun.push(p);
  }
  if (curRun.length > 1) shipped.push(curRun);
  const finalCov = rasterRuns(shipped.map(flip), w, h, pxPerMm);
  let inter = 0, inkTotal = 0, spill = 0;
  for (let i = 0; i < w * h; i++) {
    if (mask.data[i]) { inkTotal++; if (finalCov.data[i]) inter++; }
    else if (finalCov.data[i]) spill++;
  }

  const bbox = mask.bbox();
  // Machine-manner counters, so the workbench can say «مو مركّز» / «بلا قفل» instead of
  // finding out on fabric. `shapes` = separately trimmed pieces; the shop's run 25–60.
  let shapes = 0, trims = 0, inGroup = 0;
  for (const s of stitches) {
    if (s.kind === 'jump') { inGroup++; }
    else { if (inGroup) { trims++; shapes++; inGroup = 0; } }
  }
  const last = stitches[stitches.length - 1];
  const stats = {
    stitches: stitches.length,
    jumps: stitches.filter((s) => s.kind === 'jump').length,
    shapes,
    trims,
    startOffsetMm: +Math.hypot(ox - (bx0 + bx1) / 2, oy - (by0 + by1) / 2).toFixed(1),
    returnsHome: !!last && last.x === 0 && last.y === 0,
    satinColumns: cols.length,
    fillRegions: regions.length,
    patches,
    widthMm: +(((bbox.maxX - bbox.minX + 1) / pxPerMm)).toFixed(1),
    heightMm: +(((bbox.maxY - bbox.minY + 1) / pxPerMm)).toFixed(1),
    coverage: +(inter / Math.max(1, inkTotal)).toFixed(3),
    spill: +(spill / Math.max(1, inkTotal)).toFixed(3),
    ms: Date.now() - t0,
  };
  return { buffer, stats };
}

module.exports = { digitizePlate, loadMask, splitWide, rasterRuns, PIPELINE_DEFAULTS };
