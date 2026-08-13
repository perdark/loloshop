#!/usr/bin/env node
// backend/scripts/calligraphy-photo-recovery.js
//
// READ-ONLY. Proposes which upload file was the reference photo a calligraphy plate deleted.
//
// WHAT HAPPENED. `order_items.customer_image_url` held both the student's uploaded photo and
// the generated plate, and lib/calligraphyEngine.autoLinkPlate overwrote it unconditionally, so
// every generate / reroll / compose destroyed the photo and saved the old URL nowhere. Measured
// on prod 2026-08-13: 459 order lines, 628 link events, 27 of them carrying text that referred
// to the photo being deleted («نفس الصوره»). Migration 080 stopped the bleeding by giving the
// plate its own column; it could not undo the writes, because the old value is simply gone.
//
// WHAT SURVIVED. The FILES. Nothing ever deleted them from disk — only the pointer was lost.
// 5,240 files in /var/www/loloshop/uploads/images, of which ~3,365 are referenced by nothing.
// One of those is the photo for each damaged line, and the only evidence left tying them
// together is when each file was written.
//
// SO THIS SCRIPT MATCHES BY TIME and refuses to pretend that is proof. A student uploads their
// photo while filling the form, so the file's mtime should sit near the order line's created_at.
// That is a strong hint and not an identification: cohorts sign up in bursts, and a hundred
// students of the same rep can upload inside the same hour. Every candidate is printed with its
// time distance so a HUMAN decides. Nothing is written, and no file is ever deleted.
//
//   node scripts/calligraphy-photo-recovery.js [--uploads <dir>] [--window <minutes>] [--json]
//
// Defaults: --uploads /var/www/loloshop/uploads/images (override for a local dump), --window 120.
// Run it on the box that has BOTH the database and the uploads directory — matching against a
// laptop copy of the files gives mtimes from the day they were rsynced, which are meaningless.

const fs = require('fs');
const path = require('path');
const { query } = require('../lib/db');

// Every column that can legitimately point at an upload. A file referenced by ANY of them is
// still in use and is not a recovery candidate. Enumerated rather than discovered so a new
// column added later shows up as a missing entry here instead of silently widening "orphan".
const REFERENCING_COLUMNS = [
  ['order_items', 'customer_image_url'], ['order_items', 'plate_image_url'],
  ['orders', 'final_design_url'],
  ['calligraphy_plates', 'plate_path'], ['calligraphy_plates', 'sheet_path'],
  ['designs', 'logo_url'], ['designs', 'extra_image_url'],
  ['design_templates', 'preview_url'],
  ['products', 'image_url'], ['product_images', 'url'], ['product_variants', 'image_url'],
  ['product_preset_options', 'customer_image_url'],
  ['options', 'image_url'], ['option_groups', 'image_url'],
  ['packages', 'image_url'], ['packages', 'story_image_url'],
  ['hero_slides', 'image_url'],
];

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const UPLOADS_DIR = arg('uploads', '/var/www/loloshop/uploads/images');
const WINDOW_MIN = Number(arg('window', '120'));
const AS_JSON = process.argv.includes('--json');

const basename = (url) => (url ? String(url).split('/').pop() : null);

async function referencedFiles() {
  const seen = new Set();
  for (const [table, column] of REFERENCING_COLUMNS) {
    let rows;
    try {
      ({ rows } = await query(
        `SELECT DISTINCT ${column} AS v FROM ${table} WHERE ${column} IS NOT NULL AND ${column} <> ''`));
    } catch (err) {
      // A column that does not exist in this database is worth SAYING, not swallowing —
      // silently skipping it would quietly turn live files into "orphans".
      console.error(`⚠ could not read ${table}.${column}: ${err.message}`);
      continue;
    }
    for (const r of rows) { const b = basename(r.v); if (b) seen.add(b); }
  }
  return seen;
}

/**
 * The damaged lines: a plate is attached and the customer's column is empty. Migration 080
 * produced exactly this state by moving the plate out of customer_image_url — so a row here is
 * one where a plate was written over whatever the column held. Note it does NOT prove a photo
 * existed: plenty of students type a name and upload nothing. The `text_refers_to_photo` flag
 * marks the subset where the student's own words say there WAS one, and those are the rows to
 * work through first.
 */
async function damagedLines() {
  const { rows } = await query(
    `SELECT oi.id AS order_item_id, oi.label_snapshot, oi.customer_text, oi.plate_image_url,
            o.id AS order_id, o.created_at AS order_created_at,
            u.name AS student_name, s.university_name,
            wu.name AS wholesaler_name,
            cp.linked_at, cp.created_at AS plate_created_at
       FROM order_items oi
       JOIN orders o    ON o.id = oi.order_id
       JOIN students s  ON s.id = o.student_id
       JOIN users u     ON u.id = s.user_id
       LEFT JOIN wholesalers w ON w.id = s.wholesaler_id
       LEFT JOIN users wu ON wu.id = w.user_id
       LEFT JOIN LATERAL (
            SELECT linked_at, created_at FROM calligraphy_plates c
             WHERE c.order_item_id = oi.id AND c.plate_path = oi.plate_image_url
             ORDER BY c.created_at DESC LIMIT 1
       ) cp ON TRUE
      WHERE oi.plate_image_url IS NOT NULL AND oi.customer_image_url IS NULL
      ORDER BY o.created_at`);
  // The student's words naming a photo — the same signal lib/calligraphyText.js uses.
  const { looksLikeInstruction } = require('../lib/calligraphyText');
  return rows.map((r) => ({ ...r, text_refers_to_photo: looksLikeInstruction(r.customer_text) }));
}

function orphanFiles(referenced) {
  if (!fs.existsSync(UPLOADS_DIR)) {
    console.error(`✗ uploads directory not found: ${UPLOADS_DIR}`);
    console.error('  Pass --uploads <dir>, and run this where the real files live — mtimes on a');
    console.error('  copied tree are the copy date and match nothing.');
    process.exit(1);
  }
  const out = [];
  for (const name of fs.readdirSync(UPLOADS_DIR)) {
    if (referenced.has(name)) continue;
    let st;
    try { st = fs.statSync(path.join(UPLOADS_DIR, name)); } catch { continue; }
    if (!st.isFile()) continue;
    out.push({ name, mtime: st.mtime });
  }
  return out.sort((a, b) => a.mtime - b.mtime);
}

async function main() {
  const referenced = await referencedFiles();
  const damaged = await damagedLines();
  const orphans = orphanFiles(referenced);
  const windowMs = WINDOW_MIN * 60_000;

  const report = damaged.map((line) => {
    const anchor = new Date(line.order_created_at).getTime();
    const candidates = orphans
      .map((f) => ({ ...f, deltaMin: Math.round((f.mtime.getTime() - anchor) / 60_000) }))
      .filter((f) => Math.abs(f.deltaMin) * 60_000 <= windowMs)
      .sort((a, b) => Math.abs(a.deltaMin) - Math.abs(b.deltaMin))
      .slice(0, 5);
    return { line, candidates };
  });

  if (AS_JSON) {
    console.log(JSON.stringify({
      uploads_dir: UPLOADS_DIR,
      window_minutes: WINDOW_MIN,
      damaged_lines: damaged.length,
      unreferenced_files: orphans.length,
      report,
    }, null, 2));
    return;
  }

  console.log(`\nCalligraphy photo recovery — READ-ONLY, nothing is written or deleted`);
  console.log(`uploads: ${UPLOADS_DIR}   ·   window: ±${WINDOW_MIN} min`);
  console.log(`damaged order lines: ${damaged.length}`);
  console.log(`files referenced by nothing: ${orphans.length}`);
  const priority = report.filter((r) => r.line.text_refers_to_photo);
  console.log(`lines whose TEXT names a photo (do these first): ${priority.length}\n`);

  const withNone = report.filter((r) => !r.candidates.length).length;
  const withOne = report.filter((r) => r.candidates.length === 1).length;
  console.log(`  ${withOne} line(s) have exactly ONE candidate in the window — the only near-certain matches.`);
  console.log(`  ${withNone} line(s) have NONE — widen --window or accept the photo is unrecoverable.`);
  console.log(`  the rest are ambiguous by construction and need the owner's eye.\n`);

  for (const { line, candidates } of [...priority, ...report.filter((r) => !r.line.text_refers_to_photo)]) {
    const flag = line.text_refers_to_photo ? '★' : ' ';
    console.log(`${flag} ${line.student_name} · ${line.wholesaler_name || 'تجزئة'} · ${line.label_snapshot}`);
    console.log(`   order ${line.order_id}  line ${line.order_item_id}  created ${new Date(line.order_created_at).toISOString()}`);
    if (line.customer_text) console.log(`   text: «${line.customer_text}»`);
    if (!candidates.length) {
      console.log('   candidates: none in window\n');
      continue;
    }
    for (const c of candidates) {
      const sign = c.deltaMin >= 0 ? '+' : '';
      console.log(`   · ${c.name}   (${sign}${c.deltaMin} min)`);
    }
    console.log('');
  }

  console.log('Restore a confirmed match by hand, one line at a time:');
  console.log("  UPDATE order_items SET customer_image_url = '/uploads/images/<file>' WHERE id = '<line>';");
  console.log('Never bulk-apply the nearest candidate — the timestamps do not carry that much certainty.\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('✗', err.message); process.exit(1); });
