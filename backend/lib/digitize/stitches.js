// backend/lib/digitize/stitches.js
// Turning geometry into thread: satin columns along a centreline, tatami fill for
// anything too wide to satin, and a travel order that keeps the jumps short.
//
// The numbers here are not taste — they were MEASURED off the shop's own 417 files
// (4.06M stitches, «مفرد جاهز 7»): 92.3% of consecutive stitch pairs are an opposite-
// direction zigzag (i.e. satin), column advance is 0.20 mm (p10 0.14 / p90 0.32), median
// column width 4.67 mm with p90 8.2 mm, and every single file uses ONE colour. Change a
// default here and you are no longer matching what the machine and the operator expect.

const DEFAULTS = {
  spacingMm: 0.20,     // advance along the stroke per stitch  (shop measured)
  pullMm: 0.22,        // pull compensation — stitch wider than the artwork («التثخين»)
  minWidthMm: 1.2,
  // ⚠️ 8.0 HERE WAS NOT THE SHOP'S NUMBER. Measured across all 417 files, the widest
  // satin column per file has a median of 10.3 mm and a p90 of 11.35 mm — they satin
  // almost everything and hardly ever fill. At 8.0 every letter bowl was being carved
  // out of the satin mask and handed to tatami, which is what made an auto file read as
  // hatch-scribble next to a shop file.
  maxSatinMm: 11.5,
  capMm: 0.7,          // taper only inside this much of a stroke end
  smoothWinMm: 1.4,
  recenterMm: 1.8,
  hwGrowMax: 1.3,      // re-centring may correct a width, not invent one
  widthSmoothMm: 1.6,  // window for smoothing the column's half width along the stroke
  centreSmoothMm: 0.9, // window for smoothing the re-centred position
  fillSpacingMm: 0.40,
  fillMaxStitchMm: 4.0,
};

// ------------------------------------------------------------------ helpers
function resample(path, step) {
  if (path.length < 2) return path.slice();
  const out = [path[0]];
  let cur = { ...path[0] };
  let acc = 0, i = 1;
  while (i < path.length) {
    const dx = path[i].x - cur.x, dy = path[i].y - cur.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-9) { i++; continue; }
    if (acc + d >= step) {
      const t = (step - acc) / d;
      cur = { x: cur.x + dx * t, y: cur.y + dy * t, hw: path[i].hw };
      out.push({ ...cur });
      acc = 0;
    } else {
      acc += d;
      cur = { ...path[i] };
      i++;
    }
  }
  out.push({ ...path[path.length - 1] });
  return out;
}

function smooth(pts, winMm, step) {
  const k = Math.max(3, (Math.round(winMm / step) | 1));
  if (pts.length < k) return pts;
  const half = k >> 1;
  const out = pts.map((p, i) => {
    const lo = Math.max(0, i - half), hi = Math.min(pts.length, i + half + 1);
    let sx = 0, sy = 0, sh = 0, n = 0;
    for (let j = lo; j < hi; j++) { sx += pts[j].x; sy += pts[j].y; sh += pts[j].hw; n++; }
    return { x: sx / n, y: sy / n, hw: sh / n };
  });
  out[0] = pts[0];
  out[out.length - 1] = pts[pts.length - 1];
  return out;
}

const sampleDist = (dist, w, h, pxPerMm, x, y) => {
  const j = Math.round(x * pxPerMm), i = Math.round(y * pxPerMm);
  if (i < 0 || j < 0 || i >= h || j >= w) return 0;
  return dist[i * w + j] / pxPerMm;
};

/**
 * One satin column along a skeleton branch.
 *
 * ⚠️ Smoothing the centreline is REQUIRED (a raw skeleton is a staircase, and its normals
 * jitter by 45° pixel to pixel) but smoothing cuts the corner on a curve and drags the
 * column off the stroke — on «رفعة» that alone cost ~5% coverage and put thread outside
 * the letter. So each point is pushed back onto the medial axis afterwards by walking its
 * own normal to the local maximum of the distance transform. That re-centring also yields
 * the TRUE half width at that point instead of a smoothed-down one.
 */
function satinColumn(path, dist, gridW, gridH, pxPerMm, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  let pts = resample(path, o.spacingMm);
  pts = smooth(pts, o.smoothWinMm, o.spacingMm);
  const n = pts.length;
  if (n < 4) return [];
  const look = Math.max(2, Math.round(0.8 / o.spacingMm));
  const steps = Math.round(o.recenterMm / 0.1);

  // ---- pass 1: re-centre onto the medial axis and read the true half width there
  const frame = [];
  for (let i = 0; i < n; i++) {
    const j0 = Math.max(0, i - look), j1 = Math.min(n - 1, i + look);
    let tx = pts[j1].x - pts[j0].x, ty = pts[j1].y - pts[j0].y;
    const L = Math.hypot(tx, ty);
    if (L < 1e-9) continue;
    tx /= L; ty /= L;
    const nx = -ty, ny = tx;

    let cx = pts[i].x, cy = pts[i].y, hw = pts[i].hw;
    if (dist) {
      let bestV = sampleDist(dist, gridW, gridH, pxPerMm, cx, cy), bestK = 0;
      for (let k = -steps; k <= steps; k++) {
        const v = sampleDist(dist, gridW, gridH, pxPerMm, cx + nx * k * 0.1, cy + ny * k * 0.1);
        if (v > bestV) { bestV = v; bestK = k * 0.1; }
      }
      // ⚠️ CLAMP THE RE-CENTRED WIDTH. The search takes the LOCAL MAXIMUM of the distance
      // transform along the normal, and at a junction that maximum belongs to the OTHER
      // stroke — so one point would report a much larger half width and fire a single
      // stitch out past the letter's edge. Re-centring may correct a width, not invent one.
      cx += nx * bestK; cy += ny * bestK;
      hw = Math.min(bestV, pts[i].hw * o.hwGrowMax + 0.2);
    }
    frame.push({ cx, cy, nx, ny, hw, i });
  }
  const m = frame.length;
  if (m < 4) return [];

  // ---- pass 2: smooth the half widths ALONG the column
  // ⚠️ THIS IS WHAT MAKES THE EDGE OF A COLUMN A LINE INSTEAD OF A FRINGE. The half width
  // comes from a distance transform on a rasterised mask, so it rattles by a few tenths of
  // a millimetre from one point to the next; each stitch then ends at its own distance and
  // the column edge comes out hairy — the single loudest visual tell of an auto file. The
  // centreline was already smoothed before re-centring; re-centring throws that away by
  // replacing hw with the raw local reading, so the widths have to be smoothed again after.
  const box = (arr, winMm) => {
    const half = Math.max(1, Math.round(winMm / o.spacingMm) | 1) >> 1;
    return arr.map((_, k) => {
      let sum = 0, cnt = 0;
      for (let j = Math.max(0, k - half); j < Math.min(m, k + half + 1); j++) { sum += arr[j]; cnt++; }
      return sum / cnt;
    });
  };
  const hws = box(frame.map((f) => f.hw), o.widthSmoothMm);
  // ⚠️ AND THE RE-CENTRED POSITION HAS TO BE SMOOTHED TOO, for the same reason and with a
  // tighter window. `bestK` is an independent search at every point and may swing by the
  // whole search radius between neighbours, which throws one stitch sideways and reads as
  // a spike off the edge of the letter. A smaller window than the width's, so the column
  // still follows a curve instead of cutting its corner.
  const cxs = box(frame.map((f) => f.cx), o.centreSmoothMm);
  const cys = box(frame.map((f) => f.cy), o.centreSmoothMm);

  const out = [];
  let side = 1;
  for (let k = 0; k < m; k++) {
    const f = frame[k];
    let hw = hws[k] + o.pullMm;

    // Taper the cap so a stroke end does not finish in a blob.
    // ⚠️ THIS USED TO TAPER OVER A WHOLE HALF-WIDTH DOWN TO 45%, which on a 5 mm stroke
    // meant the last 2.5 mm of every terminal was stitched at half width and the artwork
    // showed through. Real files end square. Taper over `capMm` only, and never below 80%.
    const edge = Math.min(k, m - 1 - k) * o.spacingMm;
    if (edge < o.capMm) hw *= 0.8 + 0.2 * (edge / o.capMm);
    // ⚠️ AND THE CAP IS maxSatinMm/2, NOT (maxSatinMm+1)/2. The +1 let a column reach
    // 12.5 mm — past the 12.1 mm a single DST record can hold on one axis.
    hw = Math.max(o.minWidthMm / 2, Math.min(o.maxSatinMm / 2, hw));

    out.push([cxs[k] + f.nx * hw * side, cys[k] + f.ny * hw * side]);
    side = -side;
  }
  return out;
}

/**
 * Tatami fill for a region too wide to satin. Rows run along the region's own principal
 * axis (so a bowl fills the way the stroke travels, not across it) and the needle holes
 * are staggered row to row — without the stagger a visible split line forms down the
 * middle of every filled shape, which is the classic tell of an auto-digitised file.
 *
 * ⚠️ RETURNS AN ARRAY OF RUNS, NOT ONE POLYLINE. A row that crosses a counter — the hole
 * in ف, ة, ه, ص — arrives as two separate segments, and stringing them into one polyline
 * lays a stitch straight across the hole and fills in the letter. The caller jumps between
 * runs, so the break must be preserved here. Any move longer than `breakMm` starts a new run.
 */
function fillRegion(region, pxPerMm, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const { width: w, height: h } = region;
  const xs = [], ys = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (region.data[y * w + x]) { xs.push(x / pxPerMm); ys.push(y / pxPerMm); }
  }
  if (xs.length < 20) return [];
  const n = xs.length;
  const cx = xs.reduce((a, b) => a + b, 0) / n;
  const cy = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - cx, dy = ys[i] - cy;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  sxx /= n; syy /= n; sxy /= n;
  // principal axis of the 2x2 covariance matrix
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ct = Math.cos(-theta), st = Math.sin(-theta);

  const rows = new Map();
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - cx, dy = ys[i] - cy;
    const u = dx * ct - dy * st;
    const v = dx * st + dy * ct;
    const k = Math.round(v / o.fillSpacingMm);
    if (!rows.has(k)) rows.set(k, []);
    rows.get(k).push(u);
  }

  const step = 1 / pxPerMm;
  const keys = [...rows.keys()].sort((a, b) => a - b);
  const runsOut = [];
  let cur = [];
  // A break is decided STRUCTURALLY, not by distance: moving from one segment of a row to
  // the next segment of the SAME row means a counter (a hole) sits between them. Moving
  // from the last segment of a row to the first of the next row is the normal boustrophedon
  // turn at the edge of the shape and stays connected. Using a distance threshold instead
  // looks equivalent and is not — a legitimate 4 mm fill stitch and a 4 mm hole crossing
  // are the same length.
  // ⚠️ AND THE ROW-TO-ROW TURN IS CHECKED AGAINST THE REGION TOO. "The turn at the edge of
  // the shape stays connected" is only true of a convex shape. On a bowl whose principal
  // axis runs along its opening, the last segment of one row and the first of the next sit
  // on opposite horns, and the turn between them is one straight stitch across the opening
  // — measured on «محمد احمد»: 26 mm and 32 mm of thread through the background inside the
  // two د. So a turn that leaves the region for more than `turnOutsideMm` breaks the run;
  // the caller then routes through the ink or trims, exactly as for a counter.
  const turnOutsideMm = 1.0;
  const insideRegion = (x, y) => {
    const j = Math.round(x * pxPerMm), i = Math.round(y * pxPerMm);
    return i >= 0 && j >= 0 && i < h && j < w && region.data[i * w + j];
  };
  const leavesRegion = (x, y) => {
    if (!cur.length) return false;
    const [x0, y0] = cur[cur.length - 1];
    const d = Math.hypot(x - x0, y - y0);
    if (d <= turnOutsideMm) return false;
    const k = Math.ceil(d * pxPerMm);
    let out = 0;
    for (let s = 1; s < k; s++) if (!insideRegion(x0 + ((x - x0) * s) / k, y0 + ((y - y0) * s) / k)) out++;
    return (out / k) * d > turnOutsideMm;
  };
  const push = (x, y, breakFirst) => {
    if ((breakFirst || leavesRegion(x, y)) && cur.length) { if (cur.length > 1) runsOut.push(cur); cur = []; }
    cur.push([x, y]);
  };
  let dir = 1;
  keys.forEach((k, ri) => {
    const us = rows.get(k).sort((a, b) => a - b);
    const runs = [];
    let s = us[0], prev = us[0];
    for (let i = 1; i < us.length; i++) {
      if (us[i] - prev > 2.5 * step) { runs.push([s, prev]); s = us[i]; }
      prev = us[i];
    }
    runs.push([s, prev]);
    const ordered = dir < 0 ? runs.slice().reverse() : runs;
    const v = k * o.fillSpacingMm;
    let segIndex = 0;
    for (const run of ordered) {
      let [a, b] = run;
      if (b - a < 0.6) continue;
      if (dir < 0) { const t = a; a = b; b = t; }
      const segs = Math.max(1, Math.floor(Math.abs(b - a) / o.fillMaxStitchMm));
      const stag = (ri % 2 ? o.fillMaxStitchMm * 0.5 : 0) * (dir > 0 ? 1 : -1);
      const pts = [a];
      for (let i = 0; i < segs; i++) {
        const u = a + (b - a) * ((i + 1) / (segs + 1)) + (i > 0 && i < segs ? stag : 0);
        pts.push(u);
      }
      pts.push(b);
      pts.forEach((u, pi) => {
        push(cx + u * ct + v * st, cy - u * st + v * ct, pi === 0 && segIndex > 0);
      });
      segIndex++;
    }
    dir = -dir;
  });
  if (cur.length > 1) runsOut.push(cur);
  return runsOut;
}

/**
 * Centre-run underlay along the stroke, walked at `stepMm`.
 *
 * This is not decoration and it is not guesswork: the shop's own files are 92.6% satin
 * and the remaining 8.2% is almost entirely LONG same-direction sequences. A centre run
 * at ~2.2 mm under satin advancing 0.2 mm produces exactly that ratio (0.2/2.2 = 9%),
 * which is how we know the run is there. It also earns its keep mechanically: it anchors
 * the satin to the fabric so the column does not drift, and — because the column is then
 * stitched BACK along the same path — it costs zero extra jumps.
 */
function centreRun(path, stepMm = 2.2) {
  const pts = resample(path, stepMm);
  return pts.map((p) => [p.x, p.y]);
}

/** Chop a straight travel into machine-legal running stitches. */
function travelStitches(from, to, stepMm = 2.2) {
  const d = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const n = Math.max(1, Math.ceil(d / stepMm));
  const out = [];
  for (let i = 1; i <= n; i++) out.push([from[0] + ((to[0] - from[0]) * i) / n, from[1] + ((to[1] - from[1]) * i) / n]);
  return out;
}

/** Greedy nearest-neighbour ordering so the machine does not cross the hoop repeatedly. */
function orderRuns(runs) {
  if (!runs.length) return [];
  const rem = runs.map((r, i) => i);
  const out = [];
  let cx = 0, cy = 0;
  while (rem.length) {
    let best = 0, bestD = Infinity, rev = false;
    for (let k = 0; k < rem.length; k++) {
      const r = runs[rem[k]];
      const a = r[0], b = r[r.length - 1];
      const da = Math.hypot(a[0] - cx, a[1] - cy);
      const db = Math.hypot(b[0] - cx, b[1] - cy);
      if (da < bestD) { bestD = da; best = k; rev = false; }
      if (db < bestD) { bestD = db; best = k; rev = true; }
    }
    const chosen = runs[rem[best]];
    const run = rev ? chosen.slice().reverse() : chosen;
    out.push(run);
    cx = run[run.length - 1][0]; cy = run[run.length - 1][1];
    rem.splice(best, 1);
  }
  return out;
}

module.exports = { DEFAULTS, resample, smooth, satinColumn, centreRun, travelStitches, fillRegion, orderRuns };
