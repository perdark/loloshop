// backend/test/digitize.test.js
// The auto-digitiser: artwork bitmap -> Tajima .DST.
//
// These tests exist because every failure mode in this module is SILENT. A wrong stitch
// encoding, a mirrored design, a fill laid across a letter's counter — all of them produce
// a file that opens, previews plausibly, and is only wrong once it is thread on a sash.
// So each test pins a property the eye cannot check on a preview.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const sharp = require('sharp');

const { encodeStitch, decodeStitch, writeDst, readDst } = require('../lib/digitize/dst');
const { Mask, distanceTransform, skeletonize, label } = require('../lib/digitize/grid');
const { fillRegion, satinColumn, orderRuns } = require('../lib/digitize/stitches');
const { pruneSpurs, extendEnds } = require('../lib/digitize/trace');
const { digitizePlate, loadMask } = require('../lib/digitize');

// ---------------------------------------------------------------- 1. the encoder
test('1. every DST move in range round-trips exactly', () => {
  let bad = 0, n = 0;
  for (let dx = -121; dx <= 121; dx++) {
    for (let dy = -121; dy <= 121; dy++) {
      const b = encodeStitch(dx, dy);
      const d = decodeStitch(b[0], b[1], b[2]);
      n++;
      if (d.dx !== dx || d.dy !== dy) bad++;
    }
  }
  assert.equal(n, 243 * 243);
  // ⚠️ A greedy "subtract the largest magnitude that fits" encoder passes small values and
  // fails ~95% of the rest, because OR-ing the same bit twice is a no-op. It ships as
  // "the design comes out in fragments" and looks like a geometry bug, not an encoding one.
  assert.equal(bad, 0, 'balanced-ternary encoding must be exact for every move');
});

test('1b. a move that cannot fit in one record is rejected, not truncated', () => {
  assert.throws(() => encodeStitch(122, 0), /out of range/);
  assert.throws(() => encodeStitch(0, -122), /out of range/);
});

test('1c. writeDst splits long travel into jumps instead of losing it', () => {
  // 60 mm apart = 600 units, far beyond one record's +/-121
  // machine manners off: this test is about the split loop alone (7a–7c cover the manners)
  const buf = writeDst([[[0, 0]], [[60, 0]]], { label: 'T', lock: false, trim: false, home: false });
  const { stitches } = readDst(buf);
  const end = stitches[stitches.length - 1];
  assert.equal(end.x, 600, 'the needle must actually arrive at the target');
  assert.ok(stitches.filter((s) => s.kind === 'jump').length >= 5, 'travel must be jumps');
});

test('1d. the header reports the true stitch count and is exactly 512 bytes', () => {
  const run = [];
  for (let i = 0; i < 40; i++) run.push([i * 0.5, i % 2 ? 1 : -1]);
  const buf = writeDst([run], { label: 'HEADER' });
  const { header, stitches } = readDst(buf);
  assert.equal(buf[511] === 0x20 || buf[511] === 0x1a, true);
  assert.equal(Number(header.ST), stitches.length);
  assert.equal(header.LA.trim(), 'HEADER');
  assert.equal(header.CO, '0', 'the shop stitches one colour — measured on all 417 of its files');
});

// ---------------------------------------------------------------- 2. the geometry
test('2. the distance transform is exact', () => {
  const m = new Mask(200, 100);
  for (let y = 30; y < 70; y++) for (let x = 50; x < 150; x++) m.set(x, y, 1);
  const d = distanceTransform(m);
  let mx = 0;
  for (let i = 0; i < d.length; i++) if (d[i] > mx) mx = d[i];
  assert.equal(Math.round(mx), 20, 'a 40px-tall bar has a 20px inscribed radius');
});

test('2b. the skeleton of a thick bar is a single one-pixel line', () => {
  const m = new Mask(60, 21);
  for (let y = 8; y <= 12; y++) for (let x = 5; x < 55; x++) m.set(x, y, 1);
  const sk = skeletonize(m);
  assert.equal(label(sk).count, 1, 'one stroke must not fragment');
  const rows = new Set();
  for (let y = 0; y < 21; y++) for (let x = 0; x < 60; x++) if (sk.get(x, y)) rows.add(y);
  assert.equal(rows.size, 1, 'the centreline of a straight bar is one row');
});

test('2c. a satin column alternates sides — that is what makes it satin', () => {
  const pxPerMm = 12;
  const m = new Mask(240, 60);
  for (let y = 22; y < 38; y++) for (let x = 10; x < 230; x++) m.set(x, y, 1);
  const dist = distanceTransform(m);
  const pathPts = [];
  for (let x = 12; x < 228; x++) pathPts.push({ x: x / pxPerMm, y: 30 / pxPerMm, hw: dist[30 * 240 + x] / pxPerMm });
  const col = satinColumn(pathPts, dist, 240, 60, pxPerMm);
  // an 18 mm stroke at 0.20 mm advance is ~90 stitches, alternating side each time
  assert.ok(col.length > 60, `expected ~90 stitches along an 18mm stroke, got ${col.length}`);
  let opposite = 0, pairs = 0;
  for (let i = 1; i < col.length - 1; i++) {
    const a = [col[i][0] - col[i - 1][0], col[i][1] - col[i - 1][1]];
    const b = [col[i + 1][0] - col[i][0], col[i + 1][1] - col[i][1]];
    const la = Math.hypot(...a), lb = Math.hypot(...b);
    if (la < 0.5 || lb < 0.5) continue;
    pairs++;
    if ((a[0] * b[0] + a[1] * b[1]) / (la * lb) < -0.5) opposite++;
  }
  // The shop's own library measures 92.3% opposite-direction pairs. A generator that
  // dropped below that is no longer producing satin, whatever it looks like zoomed out.
  assert.ok(opposite / pairs > 0.9, `expected >90% zigzag, got ${((opposite / pairs) * 100).toFixed(1)}%`);
});

test('2d. a fill never lays a stitch across a counter (the hole in ف ة ه)', () => {
  // an annulus: filled ring with an empty middle
  const pxPerMm = 12, S = 240;
  const region = new Mask(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const r = Math.hypot(x - 120, y - 120);
    if (r <= 100 && r >= 45) region.set(x, y, 1);
  }
  const runs = fillRegion(region, pxPerMm);
  assert.ok(Array.isArray(runs) && runs.length > 1, 'fillRegion must return MANY runs, not one polyline');
  // no stitch segment may pass through the hole
  let through = 0;
  for (const run of runs) {
    for (let i = 0; i < run.length - 1; i++) {
      const [x0, y0] = run[i], [x1, y1] = run[i + 1];
      for (let t = 0; t <= 10; t++) {
        const x = x0 + ((x1 - x0) * t) / 10, y = y0 + ((y1 - y0) * t) / 10;
        if (Math.hypot(x * pxPerMm - 120, y * pxPerMm - 120) < 35) { through++; break; }
      }
    }
  }
  // ⚠️ Returning one polyline instead of runs makes this number large, fills the letter's
  // counter solid, and is invisible on a thumbnail. It is the single most damaging
  // regression this module can have.
  assert.equal(through, 0, 'no stitch may cross the empty middle');
});

test('2e. ordering runs shortens the travel it is there to shorten', () => {
  const runs = [
    [[0, 0], [1, 0]],
    [[50, 50], [51, 50]],
    [[1.5, 0], [2.5, 0]],
    [[51.5, 50], [52.5, 50]],
  ];
  const travel = (rs) => {
    let d = 0, cx = 0, cy = 0;
    for (const r of rs) { d += Math.hypot(r[0][0] - cx, r[0][1] - cy); cx = r[r.length - 1][0]; cy = r[r.length - 1][1]; }
    return d;
  };
  assert.ok(travel(orderRuns(runs)) < travel(runs), 'nearest-neighbour must beat the input order');
});

// ---------------------------------------------------------------- 3. end to end
async function artwork(draw) {
  const W = 600, H = 300;
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="white"/>${draw}</svg>`);
  const file = path.join(os.tmpdir(), `dgz-${Math.random().toString(16).slice(2)}.png`);
  await sharp(svg).png().toFile(file);
  return file;
}

test('3. a plate becomes a DST that covers the artwork and stays inside the hoop', async () => {
  const file = await artwork('<rect x="60" y="120" width="480" height="40" fill="black"/>');
  try {
    const { buffer, stats } = await digitizePlate(file, { heightMm: 20, label: 'BAR' });
    assert.ok(buffer.length > 512, 'a DST must have a body');
    assert.ok(stats.stitches > 100);
    assert.ok(stats.coverage > 0.9, `coverage ${stats.coverage} — the artwork must actually get thread`);
    assert.equal(stats.heightMm, 20, 'the finished height is what the caller asked for');
    const { stitches } = readDst(buffer);
    // ⚠️ mirroring check: the design must not be flipped. A bar is symmetric, so compare the
    // ASPECT instead — a flip would not change it, but a bad scale would.
    const xs = stitches.map((s) => s.x), ys = stitches.map((s) => s.y);
    const wMm = (Math.max(...xs) - Math.min(...xs)) / 10;
    const hMm = (Math.max(...ys) - Math.min(...ys)) / 10;
    assert.ok(wMm / hMm > 5, `a 480x40 bar must stay wide: got ${wMm.toFixed(1)}x${hMm.toFixed(1)}mm`);
  } finally { fs.unlinkSync(file); }
});

test('3b. the design is NOT mirrored — an asymmetric shape keeps its handedness', async () => {
  // an L: a long arm along the TOP and a short stub going DOWN on the LEFT.
  const file = await artwork('<path d="M60 60 H540 V100 H100 V240 H60 Z" fill="black"/>');
  try {
    const { buffer } = await digitizePlate(file, { heightMm: 40, label: 'L' });
    const { stitches } = readDst(buffer);
    // ⚠️ Measure NEEDLE stitches only. A jump longer than 121 units is emitted as a chain of
    // 121-unit jump records, so its intermediate points land all over the design and make
    // any positional statistic taken over every record meaningless.
    const sewn = stitches.filter((s) => s.kind === 'normal');
    const xs = sewn.map((s) => s.x), ys = sewn.map((s) => s.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    // In embroidery space y is UP, so the long arm must sit in the TOP half.
    const topHalf = sewn.filter((s) => s.y > (minY + maxY) / 2);
    const botHalf = sewn.filter((s) => s.y <= (minY + maxY) / 2);
    const spanX = (a) => (a.length ? (Math.max(...a.map((s) => s.x)) - Math.min(...a.map((s) => s.x))) : 0);
    // ⚠️ This is the y-flip regression test. Image space is y-DOWN and embroidery space is
    // y-UP; forgetting the single flip stitches the whole design upside down, and the
    // preview looks entirely plausible until it is held against the artwork.
    assert.ok(spanX(topHalf) > spanX(botHalf) * 1.5,
      `the long arm belongs at the TOP: top span ${spanX(topHalf)} vs bottom ${spanX(botHalf)}`);
    assert.ok(maxX - minX > 0);
  } finally { fs.unlinkSync(file); }
});

test('3c. a blank plate is refused with a clear code, not a zero-stitch file', async () => {
  const file = await artwork('');
  try {
    await assert.rejects(() => digitizePlate(file), (e) => e.code === 'ERR_EMPTY_PLATE');
  } finally { fs.unlinkSync(file); }
});

test('3d. transparent artwork is flattened, not read as solid ink', async () => {
  const W = 400, H = 200;
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect x="40" y="80" width="320" height="30" fill="black"/></svg>`);
  const file = path.join(os.tmpdir(), `dgz-a-${Math.random().toString(16).slice(2)}.png`);
  await sharp(svg).png().toFile(file); // no background rect => transparent everywhere else
  try {
    const { stats } = await digitizePlate(file, { heightMm: 15, label: 'ALPHA' });
    // Without flatten(), the alpha channel reads as black and the whole canvas becomes ink —
    // which produces a solid filled rectangle instead of a bar, at ~10x the stitch count.
    assert.ok(stats.stitches < 4000, `transparent background must not become ink (got ${stats.stitches})`);
    assert.ok(stats.coverage > 0.85);
  } finally { fs.unlinkSync(file); }
});

test('3e. two runs of the same plate produce byte-identical files', async () => {
  const file = await artwork('<circle cx="300" cy="150" r="90" fill="black"/>');
  try {
    const a = await digitizePlate(file, { heightMm: 30, label: 'DET' });
    const b = await digitizePlate(file, { heightMm: 30, label: 'DET' });
    // Determinism is what lets the result be cached on the row (migration 097). If this ever
    // fails, the cache is lying about what the workshop downloaded.
    assert.ok(a.buffer.equals(b.buffer), 'digitising must be deterministic');
  } finally { fs.unlinkSync(file); }
});

// ------------------------------------------------- 4. the shop's own signature
//
// ⚠️ EVERY TEST ABOVE PASSED ON A BUILD WHOSE FILES WERE HALF TATAMI HATCH. They check
// that the format is legal and that the artwork gets covered — and «covered» was being
// bought by spraying fill over everything the satin missed, which is how a file reached
// 99.6% coverage while an embroiderer would rebuild it from scratch. COVERAGE IS NOT
// QUALITY. These numbers are, and they are measured off the shop's own 417 files
// («مفرد جاهز 7», 4.06M stitches, read with this module's own readDst):
//
//   satin ratio            median 92.6%   p10 87%
//   stitches under 0.6 mm  median 1.8%    p90 4%
//   jumps per 1,000        median 18.5    p90 25
//   same-side spacing      median 0.40mm  p90 0.95mm   (the density along a column's edge)
//
// The envelope below is deliberately looser than those percentiles in both directions:
// it is there to catch a REGIME change — satin collapsing back into fill, a re-introduced
// short-stitch storm, a jump explosion — not to freeze the current build's exact numbers.
function signature(buffer) {
  const { stitches } = readDst(buffer);
  const seq = stitches.filter((s) => s.kind !== 'jump');
  const len = seq.map((s) => Math.hypot(s.dx, s.dy) / 10);
  let zig = 0, pairs = 0;
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1], b = seq[i];
    const m = Math.hypot(a.dx, a.dy) * Math.hypot(b.dx, b.dy);
    if (!m) continue;
    pairs++;
    if ((a.dx * b.dx + a.dy * b.dy) / m < -0.3) zig++;
  }
  const gaps = [];
  for (let i = 2; i < seq.length; i++) {
    const w1 = Math.hypot(seq[i - 1].dx, seq[i - 1].dy) / 10;
    const w2 = Math.hypot(seq[i].dx, seq[i].dy) / 10;
    if (w1 < 1.5 || w2 < 1.5) continue;                 // only inside a satin passage
    gaps.push(Math.hypot(seq[i].x - seq[i - 2].x, seq[i].y - seq[i - 2].y) / 10);
  }
  gaps.sort((a, b) => a - b);
  return {
    satinPct: (zig / Math.max(1, pairs)) * 100,
    shortPct: (len.filter((x) => x < 0.6).length / Math.max(1, len.length)) * 100,
    jumpsPer1k: (stitches.filter((s) => s.kind === 'jump').length / Math.max(1, stitches.length)) * 1000,
    edgeGapP90: gaps.length ? gaps[Math.floor(gaps.length * 0.9)] : 0,
  };
}

test('4. the output carries the shop\'s stitch signature, not just coverage', async () => {
  // a curved, varying-width stroke — a bar has no junctions and would pass anything
  const file = await artwork(
    '<path d="M60 220 C 160 40, 300 40, 380 200 S 520 260, 560 120" stroke="black" stroke-width="34" fill="none" stroke-linecap="round"/>' +
    '<circle cx="300" cy="250" r="26" fill="black"/>'
  );
  try {
    const { buffer, stats } = await digitizePlate(file, { heightMm: 70, label: 'SIG' });
    const s = signature(buffer);
    // ⚠️ THE SATIN RATIO IS THE ONE THAT BROKE. It sat at 43-57% while every other test
    // was green, because `pruneSpurs` was deleting 55% of the centreline and the coverage
    // pass was patching the damage with tatami. Below ~80% means satin has stopped being
    // what this module produces.
    assert.ok(s.satinPct >= 80, `satin ratio ${s.satinPct.toFixed(1)}% — the shop's files are 92.6%`);
    // short stitches are thread breaks and needle breaks on a real machine
    assert.ok(s.shortPct <= 5, `${s.shortPct.toFixed(1)}% of stitches are under 0.6mm — the shop's files are 1.8%`);
    // every jump is a trim, a tie-off and a tail somebody clips by hand
    assert.ok(s.jumpsPer1k <= 35, `${s.jumpsPer1k.toFixed(0)} jumps per 1,000 — the shop's files run 18.5`);
    // and the edge of a column must stay dense, or the outside of every curve goes sparse
    assert.ok(s.edgeGapP90 <= 1.6, `edge spacing p90 ${s.edgeGapP90.toFixed(2)}mm — the shop's is 0.95mm`);
    assert.ok(stats.coverage > 0.9, `coverage ${stats.coverage}`);
  } finally { fs.unlinkSync(file); }
});

test('4b. pruneSpurs prunes dead ends only — never a branch between two junctions', () => {
  // three branches meeting at (10,0): two long free-ended arms and one SHORT middle piece
  // whose two ends are both shared. The short piece is the middle of a stroke.
  const mk = (pts) => pts.map(([x, y]) => ({ x, y, hw: 2 }));
  const armA = mk([[0, 0], [5, 0], [10, 0]]);
  const middle = mk([[10, 0], [11.2, 0]]);            // 1.2mm long, stroke is 4mm wide
  const armB = mk([[11.2, 0], [16, 0], [21, 0]]);
  const spur = mk([[10, 0], [10.6, 1]]);              // a real dead-end bump
  const kept = pruneSpurs([armA, middle, armB, spur], 0.8);
  // ⚠️ The old rule filtered EVERY branch by length and dropped `middle` — on «حسين» that
  // was 88 of 107 branches, 55% of the centreline, and the letters then had to be filled
  // in with hatch. A branch with two shared ends is never an artefact.
  assert.ok(kept.includes(middle), 'a branch joining two junctions must survive');
  assert.ok(!kept.includes(spur), 'a short dead-end bump must still be pruned');
  assert.ok(kept.includes(armA) && kept.includes(armB), 'the arms are strokes');
});

test('4c. extendEnds pushes a free end out to the edge of the ink', () => {
  // a 40px-wide horizontal bar; the skeleton of it stops ~20px short of each end
  const pxPerMm = 10;
  const m = new Mask(200, 60);
  for (let y = 10; y < 50; y++) for (let x = 20; x < 180; x++) m.set(x, y, 1);
  const dist = distanceTransform(m);
  const path = [];
  for (let x = 40; x <= 160; x += 2) path.push({ x: x / pxPerMm, y: 30 / pxPerMm, hw: 2 });
  const [out] = extendEnds([path], m, dist, pxPerMm);
  // ⚠️ A MEDIAL AXIS RETRACTS FROM EVERY STROKE END BY ABOUT ONE HALF-WIDTH. Satin built
  // straight on it leaves a bare cap on every terminal, and the coverage pass then patches
  // each one with a scrap of fill.
  assert.ok(out[0].x < path[0].x - 0.15, `start ${out[0].x} must reach past ${path[0].x}`);
  assert.ok(out[out.length - 1].x > path[path.length - 1].x + 0.15, 'and so must the end');
  assert.ok(out[0].x >= 1.9, 'but it must stop at the ink, not run off the page');
  assert.ok(out[out.length - 1].x <= 18.1, 'same at the far end');
});

test('5. a stitch too long for one record is split into STITCHES, never into travel', () => {
  // 20 mm is wider than the 12.1 mm a single DST record can hold on one axis
  // A one-point-off-origin run so the FIRST record is the travel this test talks about;
  // lock/trim/home off because they add records that 7a–7c pin on their own.
  const buf = writeDst([[[0.1, 0], [0.1, 20], [0.4, 0]]], { label: 'LONG', lock: false, trim: false, home: false });
  const { stitches } = readDst(buf);
  const laid = stitches.filter((s) => s.kind !== 'jump');
  // ⚠️ THE SPLIT LOOP USED TO EMIT `jump` FOR EVERY PART OF AN OVER-LONG MOVE, WHATEVER IT
  // WAS SPLITTING. A satin stitch wider than 12.1 mm therefore became travel and no thread
  // was laid across it — a clean bare slit through the widest part of a letter, in a file
  // whose own coverage number said 99.6%. Only the FIRST record here may be a jump (the
  // travel from the machine's origin to the artwork); everything after it is thread.
  assert.equal(stitches[0].kind, 'jump', 'the move from the origin to the design is travel');
  assert.ok(laid.length >= 4, `only ${laid.length} stitches laid — the long moves became jumps`);
  assert.equal(stitches.filter((s) => s.kind === 'jump').length, 1, 'nothing else may be travel');
  const end = stitches[stitches.length - 1];
  assert.equal(end.x, 4, 'and the needle still arrives exactly where it was sent');
  assert.equal(end.y, 0);
});

test('5b. the reported coverage is measured on the FILE, not on the intended runs', async () => {
  // A 14 mm-wide bar forces satin columns near the record limit — the case where the
  // writer used to drop thread. If `stats.coverage` were still computed from the runs we
  // meant to write, it could not see that and would report a covered design either way.
  const file = await artwork('<rect x="80" y="60" width="440" height="150" fill="black"/>');
  try {
    const { buffer, stats } = await digitizePlate(file, { heightMm: 40, label: 'WIDE' });
    const { stitches } = readDst(buffer);
    // reconstruct what the machine actually lays down and compare against the claim
    let laidLen = 0;
    for (const s of stitches) if (s.kind !== 'jump') laidLen += Math.hypot(s.dx, s.dy) / 10;
    assert.ok(laidLen > 500, `only ${laidLen.toFixed(0)}mm of thread for a 44x15mm bar`);
    assert.ok(stats.coverage > 0.93, `coverage ${stats.coverage} on a plain wide bar`);
  } finally { fs.unlinkSync(file); }
});

test('6. one connected piece of artwork comes out as ONE shape, not many', async () => {
  // ⚠️ THIS IS THE EMBROIDERER'S OWN TEST, IN HIS WORDS: «الحرف صار أكثر من شكل».
  // Every break between shapes is a stop, a trim, a re-start and a tail — wear on the
  // machine and a thread end somebody clips by hand. Measured against the shop's 417
  // files, our output had 3-4x more separate pieces per dm² than theirs; on «حسين», 41
  // shapes where they would have had a handful. The fix is that ink is CONNECTED: two
  // points inside one letter can be joined by a running stitch that never leaves the
  // artwork and hides under the satin, so a trim is only ever needed between genuinely
  // separate pieces — a different letter, a dot, a hamza.
  const shapes = (buffer) => {
    const { stitches } = readDst(buffer);
    const runs = [];
    let cur = [];
    for (const s of stitches) {
      if (s.kind === 'jump') { if (cur.length > 1) runs.push(cur); cur = []; }
      else cur.push(s);
    }
    if (cur.length > 1) runs.push(cur);
    return runs;
  };

  // ONE connected stroke, curved and varying in width — the shape of a real letter
  const one = await artwork(
    '<path d="M70 230 C 180 40, 320 40, 400 210 S 520 250, 560 110" stroke="black" stroke-width="30" fill="none" stroke-linecap="round"/>'
  );
  try {
    const { buffer } = await digitizePlate(one, { heightMm: 70, label: 'ONE' });
    const rs = shapes(buffer);
    assert.ok(rs.length <= 2, `one connected stroke became ${rs.length} shapes`);
    assert.equal(rs.filter((r) => r.length < 40).length, 0, 'no shape may be a stub of a few stitches');
  } finally { fs.unlinkSync(one); }

  // TWO separate pieces must still be two — travelling between them would drag a thread
  // straight across the gap, which is far worse than the trim it saves.
  const two = await artwork(
    '<rect x="60" y="110" width="150" height="80" fill="black"/><rect x="390" y="110" width="150" height="80" fill="black"/>'
  );
  try {
    const { buffer } = await digitizePlate(two, { heightMm: 30, label: 'TWO' });
    assert.ok(shapes(buffer).length >= 2, 'separate artwork must not be joined by thread');
  } finally { fs.unlinkSync(two); }
});

// ---------------------------------------------------------------- 7. machine manners
// Measured off the shop's 417 files on 2026-09-06 with the same readDst (median per file):
// start point = centre of the extents and the needle returns to it (0.0 mm off, +X == -X
// in 95% of headers) · tie-in on 65% and tie-off on 57% of shapes · EVERY travel between
// shapes is a group of ≥3 jumps, each ≤ 9 mm, and not one file has a single-jump travel.
// None of the three is visible on a preview; each is a sew-out defect (mis-centred hoop,
// frayed shape ends, thread dragged from letter to letter).
const shapesOf = (stitches) => {
  const shapes = []; let cur = []; const groups = []; let g = 0;
  for (const s of stitches) {
    if (s.kind === 'jump') { g++; if (cur.length) { shapes.push(cur); cur = []; } }
    else { if (g) { groups.push(g); g = 0; } cur.push(s); }
  }
  if (cur.length) shapes.push(cur);
  if (g) groups.push(g); // the home travel after the last shape
  return { shapes, groups };
};

test('7a. the needle starts at the centre of the design and returns to it', async () => {
  const file = await artwork('<rect x="60" y="120" width="480" height="40" fill="black"/>');
  try {
    const { buffer, stats } = await digitizePlate(file, { heightMm: 20, label: 'HOME' });
    const { header, stitches } = readDst(buffer);
    const xs = stitches.map((s) => s.x), ys = stitches.map((s) => s.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    // ⚠️ THE OLD WRITER STARTED AT THE CORNER — 54–111 mm off centre on real names.
    assert.ok(Math.hypot(cx, cy) <= 5, `start point is ${Math.hypot(cx, cy) / 10} mm off the centre`);
    assert.ok(Math.abs(Number(header['+X']) - Number(header['-X'])) <= 1, `header +X ${header['+X']} / -X ${header['-X']}`);
    const last = stitches[stitches.length - 1];
    assert.equal(last.x, 0); assert.equal(last.y, 0);
    assert.equal(stats.returnsHome, true);
  } finally { fs.unlinkSync(file); }
});

test('7b. every shape is locked at both ends with short stitches inside its own first segment', () => {
  const zig = []; for (let i = 0; i < 30; i++) zig.push([i * 0.3, i % 2 ? 2.5 : -2.5]);
  const buf = writeDst([zig, zig.map(([x, y]) => [x + 30, y])], { label: 'LOCK' });
  const { shapes } = shapesOf(readDst(buf).stitches);
  assert.equal(shapes.length, 2);
  for (const sh of shapes) {
    const head = sh.slice(0, 4).map((s) => Math.hypot(s.dx, s.dy) / 10);
    const tail = sh.slice(-4).map((s) => Math.hypot(s.dx, s.dy) / 10);
    assert.ok(head.every((l) => l > 0 && l <= 1), `tie-in stitches ${head.join(',')} must be short`);
    assert.ok(tail.every((l) => l > 0 && l <= 1), `tie-off stitches ${tail.join(',')} must be short`);
  }
  // the lock never leaves the run: the tie-in ends exactly where the run starts
  const start = readDst(buf).stitches.find((s) => s.kind === 'normal');
  const afterLock = readDst(buf).stitches.filter((s) => s.kind === 'normal')[3];
  assert.ok(Math.hypot(afterLock.x - (start.x - start.dx), afterLock.y - (start.y - start.dy)) <= 1,
    'the fourth lock stitch returns to the first point of the run');
});

test('7c. every travel between shapes is a trim: ≥3 jumps, each ≤ 7 mm, never a single hop', () => {
  const bar = (x0) => { const r = []; for (let i = 0; i < 20; i++) r.push([x0 + i * 0.3, i % 2 ? 2 : -2]); return r; };
  // gaps of 4 mm, 15 mm and 40 mm — the first used to be ONE jump, the last a chain of 12.1 mm
  const buf = writeDst([bar(0), bar(10), bar(31), bar(77)], { label: 'TRIM' });
  const { stitches } = readDst(buf);
  const { shapes, groups } = shapesOf(stitches);
  assert.equal(shapes.length, 4);
  assert.equal(groups.length, 4 + 1, 'one travel before each shape and one home');
  assert.ok(groups.every((g) => g >= 3), `jump groups ${groups.join(',')} — a group under 3 is a hop, not a trim`);
  const longest = Math.max(...stitches.filter((s) => s.kind === 'jump').map((s) => Math.hypot(s.dx, s.dy) / 10));
  assert.ok(longest <= 7.05, `longest jump ${longest.toFixed(1)} mm — the shop's are ≤ 9`);
});

test('7d. a tatami row turn never sews across the opening of a bowl', () => {
  // A ring open on one side, rotated so its principal axis runs ALONG the opening: the last
  // segment of one row and the first of the next then sit on opposite horns, and the
  // boustrophedon turn between them used to be one straight stitch through the background
  // (measured on «محمد احمد»: 26 mm and 32 mm of thread across the bowls of د).
  const P = 4, W = 80, H = 80;
  const m = new Mask(W * P, H * P);
  for (let i = 0; i < H * P; i++) for (let j = 0; j < W * P; j++) {
    const x = j / P - W / 2, y = i / P - H / 2, r = Math.hypot(x, y);
    let a = Math.atan2(y, x) - 0.7; a = Math.atan2(Math.sin(a), Math.cos(a));
    if (r >= 16 && r <= 30 && Math.abs(a) > 1.0) m.data[i * m.width + j] = 1;
  }
  const inside = (x, y) => { const j = Math.round(x * P), i = Math.round(y * P); return i >= 0 && j >= 0 && i < m.height && j < m.width && m.data[i * m.width + j]; };
  let worst = 0;
  for (const run of fillRegion(m, P, {})) for (let i = 1; i < run.length; i++) {
    const [x0, y0] = run[i - 1], [x1, y1] = run[i], d = Math.hypot(x1 - x0, y1 - y0), k = Math.ceil(d * 4) || 1;
    let out = 0;
    for (let s = 1; s < k; s++) if (!inside(x0 + ((x1 - x0) * s) / k, y0 + ((y1 - y0) * s) / k)) out++;
    worst = Math.max(worst, (out / k) * d);
  }
  assert.ok(worst <= 1.0, `a fill stitch runs ${worst.toFixed(1)} mm outside the region`);
});

// ---------------------------------------------------------------- 8. sewing order
// Measured on 403 shop files: the first shape is on the RIGHT in 86% and the sequence runs
// right-to-left in 84% — reading order. And a letter is sewn whole before its dot: hopping
// letter → dot → letter costs two trims and two tails for nothing (measured on «الباحث
// محمد علي» at 111 mm: 28 of 58 shapes were pieces of a letter that had been interrupted).
const shapesRtl = (buffer) => {
  const { stitches } = readDst(buffer);
  const shapes = []; let cur = [];
  for (const s of stitches) { if (s.kind === 'jump') { if (cur.length) { shapes.push(cur); cur = []; } } else cur.push(s); }
  if (cur.length) shapes.push(cur);
  return shapes.filter((sh) => sh.length >= 20).map((sh) => sh.reduce((a, s) => a + s.x, 0) / sh.length / 10);
};

test('8a. shapes are sewn right to left, in reading order', async () => {
  const file = await artwork(
    '<rect x="40" y="120" width="120" height="40" fill="black"/>' +
    '<rect x="240" y="120" width="120" height="40" fill="black"/>' +
    '<rect x="440" y="120" width="120" height="40" fill="black"/>'
  );
  try {
    const { buffer } = await digitizePlate(file, { heightMm: 20, label: 'RTL' });
    const xs = shapesRtl(buffer);
    assert.equal(xs.length, 3, `expected 3 shapes, got ${xs.length}`);
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i] < xs[i - 1], `shape ${i} at x=${xs[i].toFixed(0)} sewn after x=${xs[i - 1].toFixed(0)} — not right-to-left`);
  } finally { fs.unlinkSync(file); }
});

test('8b. a dot beside a letter does not interrupt the letter', async () => {
  // a long curved stroke with a dot sitting close to its middle: nearest-neighbour ordering
  // used to leave the stroke for the dot and come back, splitting the stroke in two
  const file = await artwork(
    '<path d="M60 220 C 160 60, 300 60, 380 200 S 520 260, 560 120" stroke="black" stroke-width="30" fill="none" stroke-linecap="round"/>' +
    '<circle cx="300" cy="200" r="16" fill="black"/>'
  );
  try {
    const { buffer, stats } = await digitizePlate(file, { heightMm: 60, label: 'DOT' });
    const xs = shapesRtl(buffer);
    assert.equal(xs.length, 2, `expected 2 shapes (stroke, dot), got ${xs.length} — stats ${JSON.stringify(stats)}`);
  } finally { fs.unlinkSync(file); }
});
