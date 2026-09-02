// backend/lib/digitize/dst.js
// Tajima DST reader/writer. No dependencies — the whole format is a 512-byte ASCII
// header, then 3-byte stitch records, then 0x00 0x00 0xF3.
//
// ⚠️ EACH RECORD CARRIES A *BALANCED TERNARY* MOVE, NOT A SUM OF FLAGS. The five
// magnitudes 1·3·9·27·81 each appear once as a plus bit and once as a minus bit, so a
// move is +/-121 units and every value has exactly ONE encoding. Writing it as a greedy
// "subtract the biggest magnitude while it fits" loop silently sets the same bit twice
// (OR is idempotent) and loses the remainder — the design comes out as disconnected
// fragments. That bug is easy to ship because the file still parses and still previews
// as *something*. `test/digitizeDst.test.js` round-trips all 243·243 moves against it.
//
// Units: 1 = 0.1 mm.

const UNITS_PER_MM = 10;

// magnitude -> [byte index, plus bit, minus bit]
const X_BITS = { 1: [0, 0x01, 0x02], 3: [1, 0x01, 0x02], 9: [0, 0x04, 0x08], 27: [1, 0x04, 0x08], 81: [2, 0x04, 0x08] };
const Y_BITS = { 1: [0, 0x40, 0x80], 3: [1, 0x40, 0x80], 9: [0, 0x10, 0x20], 27: [1, 0x10, 0x20], 81: [2, 0x10, 0x20] };

const MAX_MOVE = 121; // 1+3+9+27+81

function balancedTernary(v) {
  const out = [];
  let x = v;
  for (let i = 0; i < 5; i++) {
    let r = ((x % 3) + 3) % 3;
    if (r === 2) r = -1;
    x = (x - r) / 3;
    out.push(r);
  }
  if (x !== 0) throw new Error(`move out of range: ${v}`);
  return out; // index i has weight 3**i
}

/** Encode one stitch record. kind: 'normal' | 'jump' | 'stop' */
function encodeStitch(dx, dy, kind = 'normal') {
  const b = [0, 0, 0x03];
  for (const [val, table] of [[dx, X_BITS], [dy, Y_BITS]]) {
    const digits = balancedTernary(val);
    for (let i = 0; i < 5; i++) {
      const d = digits[i];
      if (!d) continue;
      const [idx, pos, neg] = table[3 ** i];
      b[idx] |= d > 0 ? pos : neg;
    }
  }
  if (kind === 'jump') b[2] |= 0x80;
  if (kind === 'stop') b[2] |= 0xc3;
  return Buffer.from(b);
}

function decodeStitch(b0, b1, b2) {
  let dx = 0, dy = 0;
  if (b0 & 0x01) dx += 1;
  if (b0 & 0x02) dx -= 1;
  if (b0 & 0x04) dx += 9;
  if (b0 & 0x08) dx -= 9;
  if (b0 & 0x40) dy += 1;
  if (b0 & 0x80) dy -= 1;
  if (b0 & 0x10) dy += 9;
  if (b0 & 0x20) dy -= 9;
  if (b1 & 0x01) dx += 3;
  if (b1 & 0x02) dx -= 3;
  if (b1 & 0x04) dx += 27;
  if (b1 & 0x08) dx -= 27;
  if (b1 & 0x40) dy += 3;
  if (b1 & 0x80) dy -= 3;
  if (b1 & 0x10) dy += 27;
  if (b1 & 0x20) dy -= 27;
  if (b2 & 0x04) dx += 81;
  if (b2 & 0x08) dx -= 81;
  if (b2 & 0x10) dy += 81;
  if (b2 & 0x20) dy -= 81;
  let kind = 'normal';
  if ((b2 & 0xc3) === 0xc3) kind = 'color';
  else if ((b2 & 0xc3) === 0x83) kind = 'jump';
  return { dx, dy, kind };
}

function pad(n, width) {
  const s = String(Math.abs(Math.round(n)));
  return (n < 0 ? '-' : '+') + s.padStart(width, '0');
}

/**
 * Build the 512-byte header. The machine reads ST (stitch count) and the extents;
 * everything else is metadata the shop floor reads on the panel.
 */
/**
 * ⚠️ THE DST HEADER IS ASCII. There is no encoding field and no machine reads UTF-8 here,
 * so an Arabic label written straight into it renders on the machine panel as mojibake
 * («المترجمة زهراء» came out as `'DE*1,E) 2G1'!`). Strip to printable ASCII and fall back
 * to a stable id rather than shipping 16 bytes of noise — the Arabic name lives in the
 * FILENAME, which is where a person actually reads it.
 */
function asciiLabel(label, fallback = 'LOLOSHOP') {
  const cleaned = String(label == null ? '' : label)
    .replace(/[^\x20-\x7E]/g, '')      // drop anything the panel cannot render
    .replace(/[\r\n\x1a:]/g, ' ')      // ':' would forge a header field
    .trim();
  return (cleaned || fallback).slice(0, 16);
}

function buildHeader({ label, stitches, minX, maxX, minY, maxY }) {
  const la = asciiLabel(label).padEnd(16, ' ');
  let h = '';
  h += `LA:${la}\r`;
  h += `ST:${String(stitches).padStart(7, ' ')}\r`;
  h += `CO:${String(0).padStart(3, ' ')}\r`;
  h += `+X:${String(Math.round(maxX)).padStart(5, ' ')}\r`;
  h += `-X:${String(Math.round(Math.abs(minX))).padStart(5, ' ')}\r`;
  h += `+Y:${String(Math.round(maxY)).padStart(5, ' ')}\r`;
  h += `-Y:${String(Math.round(Math.abs(minY))).padStart(5, ' ')}\r`;
  h += `AX:${pad(0, 5)}\r`;
  h += `AY:${pad(0, 5)}\r`;
  h += `MX:${pad(0, 5)}\r`;
  h += `MY:${pad(0, 5)}\r`;
  h += `PD:******\r`;
  const buf = Buffer.alloc(512, 0x20);
  buf.write(h, 0, 'latin1');
  buf[h.length] = 0x1a;
  return buf;
}

/**
 * Serialise ordered polylines (mm, y-up) into a DST buffer.
 * The first point of every run after the first is reached by a JUMP; the rest are stitches.
 */
function writeDst(runs, { label = 'LOLOSHOP' } = {}) {
  const recs = [];
  let cx = 0, cy = 0;
  let minX = 0, maxX = 0, minY = 0, maxY = 0;

  const emit = (tx, ty, kind) => {
    let dx = tx - cx, dy = ty - cy;
    // A single record cannot move more than 121 units (12.1 mm) on either axis, so a longer
    // move has to be split.
    // ⚠️ SPLIT A STITCH INTO STITCHES AND A JUMP INTO JUMPS — NEVER A STITCH INTO JUMPS.
    // This loop used to emit `jump` for every part of an over-long move whatever it was
    // splitting, so a satin stitch wider than 12.1 mm silently became travel and NO THREAD
    // WAS LAID THERE. It bites exactly where the design is widest — a clean bare slit
    // through the thickest part of a letter — and it was invisible from inside the pipeline,
    // because coverage was measured on the runs we intended to write rather than on the
    // file we actually wrote. (That is why `digitizePlate` now reads its own output back.)
    const part = kind === 'jump' ? 'jump' : 'normal';
    while (Math.abs(dx) > MAX_MOVE || Math.abs(dy) > MAX_MOVE) {
      const n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / MAX_MOVE);
      const sx = Math.round(dx / n), sy = Math.round(dy / n);
      recs.push(encodeStitch(sx, sy, part));
      cx += sx; cy += sy; dx -= sx; dy -= sy;
    }
    recs.push(encodeStitch(dx, dy, kind));
    cx += dx; cy += dy;
    if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
    if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
  };

  runs.forEach((run, ri) => {
    run.forEach(([x, y], si) => {
      const tx = Math.round(x * UNITS_PER_MM);
      const ty = Math.round(y * UNITS_PER_MM);
      // ⚠️ `ri > 0` HERE LAID A THREAD FROM THE MACHINE ORIGIN INTO THE DESIGN. The needle
      // starts at (0,0); the very first point of the very first run is a TRAVEL to the
      // artwork, exactly like every other run's first point. Calling it 'normal' made the
      // last ≤12.1 mm of that travel a real stitch — a straight line of thread running out
      // of the bottom-left corner of every file this module has ever written. It is easy to
      // miss because the rest of the travel splits into jumps and only the tail shows.
      emit(tx, ty, si === 0 ? 'jump' : 'normal');
    });
  });

  const body = Buffer.concat([...recs, Buffer.from([0x00, 0x00, 0xf3])]);
  const header = buildHeader({ label, stitches: recs.length, minX, maxX, minY, maxY });
  return Buffer.concat([header, body]);
}

/** Parse a DST buffer back into absolute points — used by the tests and the preview. */
function readDst(buf) {
  const header = {};
  const text = buf.slice(0, 512).toString('latin1');
  for (const part of text.split('\r')) {
    const s = part.replace(/[\x1a\x00]/g, '').trim();
    const i = s.indexOf(':');
    if (i > 0) header[s.slice(0, i).trim()] = s.slice(i + 1).trim();
  }
  const stitches = [];
  let x = 0, y = 0;
  for (let i = 512; i + 3 <= buf.length; i += 3) {
    const b0 = buf[i], b1 = buf[i + 1], b2 = buf[i + 2];
    if ((b2 & 0xf3) === 0xf3) break;
    const { dx, dy, kind } = decodeStitch(b0, b1, b2);
    x += dx; y += dy;
    stitches.push({ x, y, kind, dx, dy });
  }
  return { header, stitches };
}

module.exports = { encodeStitch, decodeStitch, writeDst, readDst, balancedTernary, asciiLabel, UNITS_PER_MM, MAX_MOVE };
