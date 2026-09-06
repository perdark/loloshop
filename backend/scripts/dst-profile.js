#!/usr/bin/env node
// backend/scripts/dst-profile.js — «هل هذا الملف يشبه ملفات المحل؟»
// Usage: node scripts/dst-profile.js file.DST [more.DST ...]      (from backend/)
//
// Reads any Tajima DST with the digitiser's own readDst and measures the things a preview
// cannot show — the machine-level manners of the shop's 417 Wilcom files («مفرد جاهز 7»,
// medians measured 2026-09-06): start point = design centre and the needle returns to it
// (start_off 0, +X == -X) · tie-in/tie-off on ≥50% of shapes · EVERY travel between shapes
// is a group of ≥3 jumps, each ≤ 9 mm, 0 single jumps · satin 0.93 · 1.8% stitches < 0.6 mm
// · 17 jumps per 1,000. With >3 files it prints the median; otherwise a table plus one
// PASS/FAIL line per file against the band below. Owner's rule still stands: a file is
// «100% right» only after a scrap sew-out on the FEIFAN 12-needle — this is the gate BEFORE
// that, not instead of it.
const fs = require('fs'); const path = require('path');
const { readDst } = require('../lib/digitize/dst');
function median(a) { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[(s.length - 1) >> 1]; }
function profile(buf) {
  const { header, stitches } = readDst(buf);
  const xs = stitches.map(s => s.x), ys = stitches.map(s => s.y);
  const minX = Math.min(0, ...xs), maxX = Math.max(0, ...xs), minY = Math.min(0, ...ys), maxY = Math.max(0, ...ys);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const startOff = Math.hypot(cx, cy) / 10;
  const last = stitches[stitches.length - 1];
  const endOff = Math.hypot(last.x, last.y) / 10;
  // shapes = maximal runs of normal stitches separated by jump groups
  const shapes = []; let cur = []; let jumpGroups = []; let jg = 0; let maxJump = 0;
  for (const s of stitches) {
    if (s.kind === 'jump') { jg++; maxJump = Math.max(maxJump, Math.hypot(s.dx, s.dy) / 10); if (cur.length) { shapes.push(cur); cur = []; } }
    else { if (jg) { jumpGroups.push(jg); jg = 0; } cur.push(s); }
  }
  if (cur.length) shapes.push(cur);
  const tie = (arr) => {
    // lock = ≥3 consecutive stitches each ≤1.0 mm
    let n = 0; for (const s of arr) { if (Math.hypot(s.dx, s.dy) <= 10) n++; else break; } return n >= 3;
  };
  let tieIn = 0, tieOut = 0, big = 0;
  for (const sh of shapes) { if (sh.length < 8) continue; big++; if (tie(sh.slice(1, 6))) tieIn++; if (tie(sh.slice(-5).reverse())) tieOut++; }
  let satin = 0, short = 0, pairs = 0, lens = [];
  for (let i = 1; i < stitches.length; i++) {
    const a = stitches[i - 1], b = stitches[i]; if (a.kind !== 'normal' || b.kind !== 'normal') continue;
    pairs++; const L = Math.hypot(b.dx, b.dy) / 10; lens.push(L); if (L < 0.6) short++;
    if (a.dx * b.dx + a.dy * b.dy < 0) satin++;
  }
  const groups = jumpGroups.filter(g => g > 0);
  return {
    stitches: stitches.length, shapes: shapes.length,
    start_off_mm: +startOff.toFixed(1), end_off_mm: +endOff.toFixed(1), hdr_sym: header['+X'] === header['-X'] && header['+Y'] === header['-Y'],
    tie_in: big ? +(tieIn / big).toFixed(2) : null, tie_out: big ? +(tieOut / big).toFixed(2) : null,
    jump_groups: groups.length, groups_ge3: groups.length ? +(groups.filter(g => g >= 3).length / groups.length).toFixed(2) : null,
    single_jumps: groups.filter(g => g === 1).length, max_jump_mm: +maxJump.toFixed(1),
    satin_ratio: pairs ? +(satin / pairs).toFixed(3) : null, short_ratio: pairs ? +(short / pairs).toFixed(3) : null,
    stitch_med_mm: +median(lens).toFixed(2), jumps_per_1k: +(1000 * stitches.filter(s => s.kind === 'jump').length / stitches.length).toFixed(1),
    w_mm: +((maxX - minX) / 10).toFixed(0), h_mm: +((maxY - minY) / 10).toFixed(0),
  };
}
module.exports = { profile };
if (require.main === module) {
  const files = process.argv.slice(2);
  const rows = files.map(f => ({ file: path.basename(f), ...profile(fs.readFileSync(f)) }));
  if (rows.length > 3) {
    const keys = Object.keys(rows[0]).filter(k => k !== 'file' && k !== 'hdr_sym');
    const med = {}; for (const k of keys) med[k] = median(rows.map(r => r[k]).filter(v => typeof v === 'number' && !isNaN(v)));
    med.hdr_sym = rows.filter(r => r.hdr_sym).length / rows.length;
    console.log('MEDIAN over', rows.length, JSON.stringify(med));
  } else {
    console.table(rows);
    for (const r of rows) {
      const fails = [];
      if (r.start_off_mm > 1) fails.push(`start ${r.start_off_mm} mm off centre`);
      if (r.end_off_mm > 1) fails.push(`does not return home (${r.end_off_mm} mm)`);
      if (r.tie_in !== null && r.tie_in < 0.5) fails.push(`tie-in ${r.tie_in}`);
      if (r.tie_out !== null && r.tie_out < 0.5) fails.push(`tie-off ${r.tie_out}`);
      // the shop's own files carry a FEW deliberate single hops (≤ ~10% of travels); ours write none
      if (r.single_jumps > Math.max(1, 0.1 * r.jump_groups)) fails.push(`${r.single_jumps} single-jump hops (no trim)`);
      if (r.max_jump_mm > 9.5) fails.push(`jump ${r.max_jump_mm} mm > 9`);
      if (r.satin_ratio !== null && r.satin_ratio < 0.8) fails.push(`satin ${r.satin_ratio} < 0.80`);
      if (r.short_ratio !== null && r.short_ratio > 0.04) fails.push(`short stitches ${r.short_ratio} > 0.04`);
      console.log(fails.length ? `FAIL ${r.file}: ${fails.join(' · ')}` : `PASS ${r.file}`);
    }
  }
}
