// backend/lib/digitize/trace.js
// Skeleton raster -> ordered centreline branches, in millimetres, each point carrying
// the local half-width read off the distance transform.

/**
 * Walk the skeleton into branches. A branch runs from one node (an endpoint or a
 * junction) to the next, through degree-2 pixels only.
 * @returns Array of [{x,y,hw}] in mm, y still image-down.
 */
function tracePaths(skel, dist, pxPerMm, { minLenMm = 0.8 } = {}) {
  const { width: w, height: h } = skel;
  const idx = (x, y) => y * w + x;
  const on = (x, y) => (x >= 0 && y >= 0 && x < w && y < h && skel.data[idx(x, y)]);

  const neighbours = new Map();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!skel.data[idx(x, y)]) continue;
      const n = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        if (on(x + dx, y + dy)) n.push(idx(x + dx, y + dy));
      }
      neighbours.set(idx(x, y), n);
    }
  }
  const deg = (p) => (neighbours.get(p) || []).length;
  const usedEdge = new Set();
  const edgeKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

  const walk = (start, first) => {
    const path = [start, first];
    usedEdge.add(edgeKey(start, first));
    let prev = start, cur = first;
    while (deg(cur) === 2) {
      const nxt = (neighbours.get(cur) || []).find((p) => p !== prev);
      if (nxt === undefined) break;
      const k = edgeKey(cur, nxt);
      if (usedEdge.has(k)) break;
      usedEdge.add(k);
      path.push(nxt);
      prev = cur; cur = nxt;
    }
    return path;
  };

  const raw = [];
  for (const p of neighbours.keys()) {
    if (deg(p) === 2) continue;                       // handle nodes first
    for (const q of neighbours.get(p)) {
      if (usedEdge.has(edgeKey(p, q))) continue;
      raw.push(walk(p, q));
    }
  }
  for (const p of neighbours.keys()) {                // whatever is left is a closed loop
    for (const q of neighbours.get(p)) {
      if (usedEdge.has(edgeKey(p, q))) continue;
      raw.push(walk(p, q));
    }
  }

  const out = [];
  for (const path of raw) {
    const pts = path.map((p) => {
      const x = p % w, y = (p - (p % w)) / w;
      return { x: x / pxPerMm, y: y / pxPerMm, hw: dist[p] / pxPerMm };
    });
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (len >= minLenMm) out.push(pts);
  }
  return out;
}

const pathLength = (p) => {
  let l = 0;
  for (let i = 1; i < p.length; i++) l += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
  return l;
};

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/**
 * Drop skeleton spurs.
 *
 * ⚠️ A SPUR IS A BRANCH WITH A FREE END. THIS USED TO FILTER *EVERY* BRANCH BY LENGTH,
 * which is a different rule wearing the same name, and it is what made the whole module
 * look broken: on «حسين» it deleted 88 of 107 branches — 55% of the centreline — so the
 * satin could only ever cover ~30% of the artwork and the coverage pass then sprayed
 * tatami over the other 70% to reach a "99.6% covered" number. Measured, keeping the
 * branches that join two junctions lifts satin-only coverage from 30% to 67%.
 *
 * A branch between two junctions is the MIDDLE of a stroke: it is short in curvy Arabic
 * script precisely because junctions are close together, and it is never an artefact.
 * Only a dead end can be an outline bump, so only a dead end may be pruned.
 */
function pruneSpurs(paths, frac = 0.8) {
  const key = (q) => `${Math.round(q.x * 50)}:${Math.round(q.y * 50)}`;
  const seen = new Map();
  for (const p of paths) {
    for (const q of [p[0], p[p.length - 1]]) seen.set(key(q), (seen.get(key(q)) || 0) + 1);
  }
  const free = (q) => (seen.get(key(q)) || 0) <= 1;
  return paths.filter((p) => {
    const a = free(p[0]), b = free(p[p.length - 1]);
    if (!a && !b) return true;                       // joins two junctions => real stroke
    const w = 2 * median(p.map((q) => q.hw));
    if (a && b) return pathLength(p) >= 0.35 * w;    // an island stroke: keep unless tiny
    return pathLength(p) >= frac * w;                // one free end: the classic spur test
  });
}

/**
 * Push each free end outward to the edge of the ink.
 *
 * ⚠️ A SKELETON RETRACTS FROM A STROKE END BY ABOUT ONE HALF-WIDTH — that is a property
 * of the medial axis, not a bug in the thinning — so satin built straight on it stops
 * short of every terminal and leaves a bare cap on every stroke. Walking the terminal
 * tangent until the point leaves the mask puts those caps back. Capped at 1.5x the local
 * half width so a tangent pointing along a curve cannot run off down the page.
 */
function extendEnds(paths, mask, dist, pxPerMm, { look = 6 } = {}) {
  const { width: w, height: h } = mask;
  const inside = (x, y) => {
    const j = Math.round(x * pxPerMm), i = Math.round(y * pxPerMm);
    return i >= 0 && j >= 0 && i < h && j < w && mask.data[i * w + j];
  };
  const hwAt = (x, y) => {
    const j = Math.round(x * pxPerMm), i = Math.round(y * pxPerMm);
    if (i < 0 || j < 0 || i >= h || j >= w) return 0;
    return dist[i * w + j] / pxPerMm;
  };
  const step = 0.5 / pxPerMm;
  return paths.map((p) => {
    if (p.length < 2) return p;
    const out = p.slice();
    for (const atStart of [true, false]) {
      const [tx, ty] = tangent(out, atStart, look);
      const a = atStart ? out[0] : out[out.length - 1];
      const limit = Math.max(0.4, 1.5 * a.hw);
      const add = [];
      let x = a.x, y = a.y, travelled = 0;
      // tangent() points INTO the path, so walking outward is the negative direction
      while (travelled < limit) {
        const nx = x - tx * step, ny = y - ty * step;
        if (!inside(nx, ny)) break;
        x = nx; y = ny; travelled += step;
        add.push({ x, y, hw: hwAt(x, y) || a.hw });
      }
      if (!add.length) continue;
      if (atStart) out.unshift(...add.reverse());
      else out.push(...add);
    }
    return out;
  });
}

function tangent(path, atStart, look = 6) {
  const a = atStart ? path[0] : path[path.length - 1];
  const b = atStart ? path[Math.min(look, path.length - 1)] : path[Math.max(0, path.length - 1 - look)];
  const vx = b.x - a.x, vy = b.y - a.y;
  const n = Math.hypot(vx, vy);
  return n > 1e-9 ? [vx / n, vy / n] : [1, 0];
}

/**
 * Two branches that meet at a junction and keep going in nearly the same direction are ONE
 * stroke to a human eye — and the admin draws them as one satin column. Pair the free ends
 * by tangent continuity, then chain. Without this, every letter breaks into fragments at
 * each junction and the preview looks like confetti.
 */
function mergeAtJunctions(paths, { tolMm = 1.4, minCos = 0.3, lookMm = 1.5 } = {}) {
  // ⚠️ THE TANGENT NEEDS A REAL BASELINE. `tangent`'s default looks 6 POINTS ahead, and a
  // skeleton point is one pixel — at 12 px/mm that is a half-millimetre baseline on a
  // staircase, so the direction it reports is mostly quantisation noise and two halves of
  // one stroke fail the continuity test. Measured on «فاطمة»: with the short baseline the
  // merge left 38 fragments, each satined at its own angle, and every fragment END fanned
  // its stitches past the letter's edge — that sunburst IS this bug, seen from the outside.
  const lookOf = (p) => {
    const span = pathLength(p) / Math.max(1, p.length - 1);
    return Math.max(4, Math.min(p.length - 1, Math.round(lookMm / Math.max(span, 1e-6))));
  };
  const ends = [];
  paths.forEach((p, i) => {
    const ts = tangent(p, true, lookOf(p)), te = tangent(p, false, lookOf(p));
    ends.push({ i, start: true, x: p[0].x, y: p[0].y, tx: -ts[0], ty: -ts[1] });
    ends.push({ i, start: false, x: p[p.length - 1].x, y: p[p.length - 1].y, tx: -te[0], ty: -te[1] });
  });

  const cand = [];
  for (let a = 0; a < ends.length; a++) {
    for (let b = a + 1; b < ends.length; b++) {
      const A = ends[a], B = ends[b];
      if (A.i === B.i) continue;
      const d = Math.hypot(A.x - B.x, A.y - B.y);
      if (d > tolMm) continue;
      const cos = -(A.tx * B.tx + A.ty * B.ty); // outward vs outward: continuation => opposite
      if (cos < minCos) continue;
      cand.push({ cos, d, a, b });
    }
  }
  cand.sort((p, q) => (q.cos - p.cos) || (p.d - q.d));

  const link = new Map();
  const taken = new Set();
  for (const c of cand) {
    if (taken.has(c.a) || taken.has(c.b)) continue;
    taken.add(c.a); taken.add(c.b);
    link.set(c.a, c.b); link.set(c.b, c.a);
  }

  const key = (i, start) => 2 * i + (start ? 0 : 1);
  const seen = new Set();
  const out = [];
  for (let i = 0; i < paths.length; i++) {
    for (const start of [true, false]) {
      if (seen.has(i)) continue;
      if (link.has(key(i, start))) continue;          // not a free end => not a chain start
      let ci = i, cs = start;
      let chain = [];
      for (;;) {
        seen.add(ci);
        let seg = cs ? paths[ci] : [...paths[ci]].reverse();
        if (chain.length) seg = seg.slice(1);
        chain = chain.concat(seg);
        const nxt = link.get(key(ci, !cs));
        if (nxt === undefined) break;
        const ni = Math.floor(nxt / 2);
        const ns = nxt % 2 === 0;
        if (seen.has(ni)) break;
        ci = ni; cs = ns;
      }
      out.push(chain);
    }
  }
  for (let i = 0; i < paths.length; i++) if (!seen.has(i)) { out.push(paths[i]); seen.add(i); }
  return out;
}

module.exports = { tracePaths, pruneSpurs, extendEnds, mergeAtJunctions, pathLength };
