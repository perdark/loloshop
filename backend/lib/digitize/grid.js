// backend/lib/digitize/grid.js
// Binary-image primitives on a flat Uint8Array: morphology, connected components,
// an exact Euclidean distance transform and Zhang–Suen thinning.
//
// Everything here is plain JS on typed arrays. It is deliberately dependency-free:
// this runs on the same box as RevoArt, and `scripts/deploy.sh` gates on
// `npm audit --omit=dev`, so a native imaging package would put a permanent new
// advisory surface inside the deploy gate for code that is ~200 lines of arithmetic.

/** A binary raster. `data[i] = 0|1`, row-major, origin top-left (y grows DOWN). */
class Mask {
  constructor(width, height, data) {
    this.width = width;
    this.height = height;
    this.data = data || new Uint8Array(width * height);
  }
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.data[y * this.width + x];
  }
  set(x, y, v) { this.data[y * this.width + x] = v; }
  clone() { return new Mask(this.width, this.height, Uint8Array.from(this.data)); }
  count() { let n = 0; for (let i = 0; i < this.data.length; i++) if (this.data[i]) n++; return n; }
  bbox() {
    let minX = this.width, minY = this.height, maxX = -1, maxY = -1;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (!this.data[y * this.width + x]) continue;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    return maxX < 0 ? null : { minX, minY, maxX, maxY };
  }
}

// ---------------------------------------------------------------- morphology
function dilate(mask, iterations = 1) {
  let cur = mask;
  for (let it = 0; it < iterations; it++) {
    const out = new Mask(cur.width, cur.height);
    for (let y = 0; y < cur.height; y++) {
      for (let x = 0; x < cur.width; x++) {
        let on = 0;
        for (let dy = -1; dy <= 1 && !on; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (cur.get(x + dx, y + dy)) { on = 1; break; }
        }
        out.data[y * cur.width + x] = on;
      }
    }
    cur = out;
  }
  return cur;
}

function erode(mask, iterations = 1) {
  let cur = mask;
  for (let it = 0; it < iterations; it++) {
    const out = new Mask(cur.width, cur.height);
    for (let y = 0; y < cur.height; y++) {
      for (let x = 0; x < cur.width; x++) {
        let on = 1;
        for (let dy = -1; dy <= 1 && on; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!cur.get(x + dx, y + dy)) { on = 0; break; }
        }
        out.data[y * cur.width + x] = on;
      }
    }
    cur = out;
  }
  return cur;
}

const close = (m, n = 1) => erode(dilate(m, n), n);
const open = (m, n = 1) => dilate(erode(m, n), n);

// ------------------------------------------------- connected components (8-way)
function label(mask) {
  const { width: w, height: h } = mask;
  const lab = new Int32Array(w * h).fill(0);
  const sizes = [0];
  let next = 1;
  const stack = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!mask.data[i] || lab[i]) continue;
    const id = next++;
    let sp = 0, size = 0;
    stack[sp++] = i;
    lab[i] = id;
    while (sp > 0) {
      const p = stack[--sp];
      size++;
      const px = p % w, py = (p - px) / w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (mask.data[q] && !lab[q]) { lab[q] = id; stack[sp++] = q; }
      }
    }
    sizes.push(size);
  }
  return { labels: lab, count: next - 1, sizes };
}

/** Drop components smaller than `minPixels` — the despeckle half of «قص الخلفية». */
function removeSmall(mask, minPixels) {
  const { labels, count, sizes } = label(mask);
  if (!count) return mask;
  const out = new Mask(mask.width, mask.height);
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    if (l && sizes[l] >= minPixels) out.data[i] = 1;
  }
  return out;
}

// ------------------------------------------- exact Euclidean distance transform
// Felzenszwalb & Huttenlocher: two passes of a 1-D squared-distance lower envelope.
function distanceTransform(mask) {
  const { width: w, height: h } = mask;
  const INF = 1e20;
  const f = new Float64Array(Math.max(w, h));
  const d = new Float64Array(w * h);
  const v = new Int32Array(Math.max(w, h));
  const z = new Float64Array(Math.max(w, h) + 1);

  const edt1d = (n, out) => {
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      const dq = q - v[k];
      out[q] = dq * dq + f[v[k]];
    }
  };

  const col = new Float64Array(Math.max(w, h));
  // distance to the nearest ZERO pixel, measured inside the shape
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = mask.data[y * w + x] ? INF : 0;
    edt1d(h, col);
    for (let y = 0; y < h; y++) d[y * w + x] = col[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = d[y * w + x];
    edt1d(w, col);
    for (let x = 0; x < w; x++) d[y * w + x] = Math.sqrt(col[x]);
  }
  return d; // Float64Array, pixels
}

// -------------------------------------------------- Zhang–Suen thinning (skeleton)
function skeletonize(mask) {
  const { width: w, height: h } = mask;
  const img = Uint8Array.from(mask.data);
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : img[y * w + x]);
  let changed = true;
  const marks = [];
  while (changed) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      marks.length = 0;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          if (!img[y * w + x]) continue;
          const p2 = at(x, y - 1), p3 = at(x + 1, y - 1), p4 = at(x + 1, y),
                p5 = at(x + 1, y + 1), p6 = at(x, y + 1), p7 = at(x - 1, y + 1),
                p8 = at(x - 1, y), p9 = at(x - 1, y - 1);
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let A = 0;
          for (let i = 0; i < 8; i++) if (seq[i] === 0 && seq[i + 1] === 1) A++;
          if (A !== 1) continue;
          if (step === 0) {
            if (p2 * p4 * p6 !== 0) continue;
            if (p4 * p6 * p8 !== 0) continue;
          } else {
            if (p2 * p4 * p8 !== 0) continue;
            if (p2 * p6 * p8 !== 0) continue;
          }
          marks.push(y * w + x);
        }
      }
      if (marks.length) {
        changed = true;
        for (const i of marks) img[i] = 0;
      }
    }
  }
  return new Mask(w, h, img);
}

module.exports = { Mask, dilate, erode, close, open, label, removeSmall, distanceTransform, skeletonize };
