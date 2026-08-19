#!/usr/bin/env node
// backend/scripts/calligraphy-blank-plates.js
//
// READ-ONLY by default. Finds calligraphy plates that are marked «تم» but whose image file has
// NOTHING on it — the white photos the design team has been downloading.
//
// WHAT HAPPENED. lib/sheetCrop.js slices one N-name sheet into N bands, and the engine accepted
// any slice whose BAND COUNT matched what it asked for. That check is not sufficient: when the
// model draws fewer names than the sheet asked for (routine — ask for 10, get 8), the segmenter
// still manufactures 10 bands, and the ones that land in the empty gaps trim down to pure white
// slivers ~9px tall. Count matched, so nothing was flagged: those bands were saved `done`,
// auto-linked onto the order line, and shipped. Two smaller paths did the same — a reroll whose
// generation had no usable band, and an iPad compositor export that came back as a blank canvas.
// All three are guarded now (lib/imageFx.hasInk), but the guard only protects NEW plates. The
// rows already written are still there, and this is how you find them.
//
//   node scripts/calligraphy-blank-plates.js [--uploads <dir>] [--json] [--mark]
//
// Default is a report and nothing else. `--mark` is the only writing mode: it sets the affected
// plates to status='failed' with an Arabic reason, so they show up in the workbench as needing
// «إعادة التوليد» instead of looking finished. It also clears the blank artwork off the order
// line (order_items.plate_image_url) — an empty plate on the line is worse than none, because
// every station downstream reads it as "the artwork is ready".
//
// ⚠️ `--mark` NEVER TOUCHES order_items.customer_image_url. That column is the student's own
// uploaded photo and has its own history of being destroyed by this pipeline (migration 080).
// ⚠️ Run it on the box that has BOTH the database and the uploads directory.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { query } = require('../lib/db');
const { hasInk } = require('../lib/imageFx');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const UPLOADS_DIR = arg('uploads', '/var/www/loloshop/uploads');
const AS_JSON = process.argv.includes('--json');
const MARK = process.argv.includes('--mark');

// A plate URL is /uploads/calligraphy/plates/<file>. Resolve it against the uploads ROOT the
// same way lib/upload.absFromUrl does, but against a directory the operator can override —
// this script also has to run against a restored dump on another machine.
function absPathOf(url) {
  if (!url) return null;
  const marker = '/uploads/';
  const i = String(url).indexOf(marker);
  if (i < 0) return null;
  const rel = String(url).slice(i + marker.length);
  const resolved = path.resolve(UPLOADS_DIR, rel);
  if (!resolved.startsWith(`${path.resolve(UPLOADS_DIR)}${path.sep}`)) return null;
  return resolved;
}

async function donePlates() {
  const { rows } = await query(
    `SELECT cp.id, cp.render_text, cp.variant, cp.plate_path, cp.created_at, cp.reroll_count,
            cp.order_item_id, oi.plate_image_url,
            o.id AS order_id, u.name AS student_name, wu.name AS wholesaler_name
       FROM calligraphy_plates cp
       LEFT JOIN order_items oi ON oi.id = cp.order_item_id
       LEFT JOIN orders o       ON o.id = oi.order_id
       LEFT JOIN students s     ON s.id = o.student_id
       LEFT JOIN users u        ON u.id = s.user_id
       LEFT JOIN wholesalers w  ON w.id = s.wholesaler_id
       LEFT JOIN users wu       ON wu.id = w.user_id
      WHERE cp.status = 'done' AND cp.plate_path IS NOT NULL
      ORDER BY cp.created_at`);
  return rows;
}

async function main() {
  const plates = await donePlates();
  const blank = [];
  const missing = [];
  for (const p of plates) {
    const abs = absPathOf(p.plate_path);
    if (!abs || !fs.existsSync(abs)) { missing.push(p); continue; }
    let empty;
    try {
      empty = !(await hasInk(await fs.promises.readFile(abs)));
    } catch (err) {
      console.error(`⚠ could not read ${abs}: ${err.message}`);
      continue;
    }
    if (!empty) continue;
    let meta = {};
    try { meta = await sharp(abs).metadata(); } catch { /* size is a nicety */ }
    blank.push({ ...p, file: abs, width: meta.width, height: meta.height });
  }

  if (AS_JSON) {
    console.log(JSON.stringify({ checked: plates.length, blank, missing_files: missing.length }, null, 2));
  } else {
    console.log(`\ncalligraphy plates marked «تم»: ${plates.length}`);
    console.log(`plate files missing from disk:  ${missing.length}`);
    console.log(`BLANK plates (no ink at all):   ${blank.length}\n`);
    for (const b of blank) {
      console.log(`· ${b.render_text || '—'} · ${b.student_name || 'بدون طالب'} · ${b.wholesaler_name || 'تجزئة'} · ${b.variant}`);
      console.log(`   plate ${b.id}  ${b.width || '?'}x${b.height || '?'}  ${b.plate_path}`);
      if (b.order_item_id) {
        console.log(`   order ${b.order_id || '—'}  line ${b.order_item_id}` +
          `${b.plate_image_url === b.plate_path ? '  ⚠ this blank image IS the line artwork' : ''}`);
      }
    }
    if (blank.length) console.log('');
  }

  if (!MARK) {
    if (blank.length) {
      console.log('Nothing was written. Re-run with --mark to send these back to the workbench as');
      console.log('failed so the designer regenerates them, and to clear the blank artwork off the');
      console.log('order lines. Each one then costs a normal reroll.\n');
    }
    return;
  }
  if (!blank.length) { console.log('nothing to mark.\n'); return; }

  const ids = blank.map((b) => b.id);
  await query(
    `UPDATE calligraphy_plates SET status='failed', error=$2 WHERE id = ANY($1)`,
    [ids, 'خرجت اللوحة فارغة — أعد التوليد']);
  // Only unlink the lines whose artwork IS this blank file. A line that has since been given a
  // different plate must keep it.
  const lineIds = blank.filter((b) => b.order_item_id && b.plate_image_url === b.plate_path)
    .map((b) => b.order_item_id);
  if (lineIds.length) {
    await query(
      `UPDATE order_items SET plate_image_url = NULL WHERE id = ANY($1)`, [lineIds]);
  }
  console.log(`✓ marked ${ids.length} plate(s) failed; cleared blank artwork off ${lineIds.length} order line(s).\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('✗', err.message); process.exit(1); });
