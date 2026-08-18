'use strict';
// The calligraphy cost fixes (2026-08-18). Measured on prod before writing any of this:
// $59.43 lifetime, 47% of it names that got a whole 2K image to themselves. These tests pin
// the four cost behaviours so they cannot silently regress:
//   1. A reroll is ONE name — it must buy a 1K 1:1 image, not the 2K 9:16 sheet canvas
//      (~$0.067 vs ~$0.101, and a 1024px-wide canvas fits long teacher names).
//   2. The geometry RATCHET: rerolls must anchor on original_plate_path (the first generated
//      band, migration 082), never on the plate being replaced — otherwise ink height is
//      monotone non-increasing across presses and designers pay to chase quality that cannot
//      recover.
//   3. SHEET-FILLING: a short job tops its paid sheet up with pending same-variant plates
//      from other jobs instead of buying a near-empty image.
//   4. THE DAILY CEILING (lib/calligraphySpend.js + calligraphy_spend_log): every paid image
//      is ledgered, the 24h sum refuses the next generation past CALLIG_DAILY_USD_MAX, and
//      crossing CALLIG_DAILY_USD_WARN writes the admins one notification — the feature had no
//      daily bound at all while burning $40.53 in 17 days.
// All of them drive the real controller/engine against the dev DB with global.fetch stubbed —
// nothing here spends money.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { reroll } = require('../controllers/calligraphyController');
const { processNextBatch } = require('../lib/calligraphyEngine');
const { absFromUrl } = require('../lib/upload');
const { query } = require('../lib/db');

const TAG = `ZZTEST-calcost-${crypto.randomUUID().slice(0, 8)}`;
const fx = { plates: [], files: [], startedAt: new Date() };

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { res.statusCode = code; return res; },
    json(body) { res.body = body; return res; },
  };
  return res;
}

/** A white canvas with one centred black band — crops cleanly to a single plate. */
async function bandPng(w = 640, h = 640) {
  const ink = await sharp({
    create: { width: Math.round(w * 0.6), height: Math.round(h * 0.15), channels: 3, background: { r: 0, g: 0, b: 0 } },
  }).png().toBuffer();
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite([{ input: ink, gravity: 'center' }])
    .png()
    .toBuffer();
}

/** Stub global.fetch; records request bodies. `png` is a Buffer or an async (body) => Buffer. */
function stubFetch(png, cost = 0.067) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url, body });
    const buf = typeof png === 'function' ? await png(body) : png;
    return {
      ok: true,
      json: async () => ({ data: [{ b64_json: buf.toString('base64') }], usage: { cost } }),
    };
  };
  return { calls, restore: () => { global.fetch = original; } };
}

/** A sheet of `n` clearly separated black bands — crops to exactly `n` plates. */
async function sheetPng(n) {
  const band = await sharp({
    create: { width: 500, height: 36, channels: 3, background: { r: 0, g: 0, b: 0 } },
  }).png().toBuffer();
  const composites = [];
  for (let i = 0; i < n; i++) composites.push({ input: band, left: 70, top: i * 160 + 62 });
  return sharp({ create: { width: 640, height: n * 160, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite(composites)
    .png()
    .toBuffer();
}

/** How many names the sheet prompt asked for. */
function promptNameCount(body) {
  const m = /following (\d+) Arabic names/.exec(body.prompt || '');
  return m ? Number(m[1]) : null;
}

async function insertPlate(overrides = {}) {
  const { rows } = await query(
    `INSERT INTO calligraphy_plates (job_id, source, render_text, variant, status, cost_usd,
                                     plate_path, original_plate_path)
     VALUES ($1, 'typed', $2, $3, $4, $5, $6, $7) RETURNING *`,
    [overrides.job_id || crypto.randomUUID(),
     overrides.render_text || `${TAG} محمد كريم`,
     overrides.variant || 'front',
     overrides.status || 'done',
     overrides.cost_usd || 0,
     overrides.plate_path || null,
     overrides.original_plate_path || null]
  );
  fx.plates.push(rows[0].id);
  return rows[0];
}

test.after(async () => {
  if (fx.plates.length) {
    await query(`DELETE FROM calligraphy_plates WHERE id = ANY($1)`, [fx.plates]);
  }
  for (const f of fx.files) { try { fs.unlinkSync(f); } catch { /* already gone */ } }
  // Ledger rows this run created via the real logSpend path (stub costs, but keep dev clean).
  await query(`DELETE FROM calligraphy_spend_log WHERE created_at >= $1`, [fx.startedAt]);
});

/** Write a band plate (white w×h canvas, centred black ink iw×ih) into /uploads, return its URL path. */
async function bandFile(name, w, h, iw, ih) {
  const ink = await sharp({
    create: { width: iw, height: ih, channels: 3, background: { r: 0, g: 0, b: 0 } },
  }).png().toBuffer();
  const buf = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite([{ input: ink, gravity: 'center' }])
    .png()
    .toBuffer();
  const url = `/uploads/calligraphy/plates/${TAG}-${name}.png`;
  const abs = absFromUrl(url);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  fx.files.push(abs);
  return url;
}

/** Ink height after trimming white margins — the thing the ratchet was eating. */
async function inkHeight(buffer) {
  const { info } = await sharp(buffer)
    .trim({ background: '#ffffff', threshold: 10 })
    .toBuffer({ resolveWithObject: true });
  return info.height;
}

test('a reroll buys a 1K 1:1 image, not the 2K 9:16 sheet canvas', async () => {
  const plate = await insertPlate();
  const png = await bandPng();
  const { calls, restore } = stubFetch(png, 0.067);
  try {
    const res = mockRes();
    // req shaped like the worker's: null-ish for publicUrl, params/body for the controller
    await reroll({ params: { id: plate.id }, body: {}, protocol: 'http', get: () => 'localhost:4000' }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(calls.length, 1, 'exactly one paid generation');
    assert.equal(calls[0].body.resolution, '1K');
    assert.equal(calls[0].body.aspect_ratio, '1:1');
  } finally {
    restore();
  }
});

test('a reroll anchors on the ORIGINAL plate geometry, not the ratcheted current one', async () => {
  // The original band had 40px of ink; rerolls have ratcheted the current plate down to 20px.
  const original = await bandFile('original', 800, 100, 400, 40);
  const degraded = await bandFile('degraded', 800, 100, 200, 20);
  const plate = await insertPlate({ plate_path: degraded, original_plate_path: original });

  const { restore } = stubFetch(await bandPng(), 0.067);
  let rerolled;
  try {
    const res = mockRes();
    await reroll({ params: { id: plate.id }, body: {}, protocol: 'http', get: () => 'localhost:4000' }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    rerolled = res.body.data;
  } finally {
    restore();
  }

  const abs = absFromUrl(rerolled.plate_path);
  fx.files.push(abs);
  const h = await inkHeight(fs.readFileSync(abs));
  assert.ok(h >= 35, `ink height ${h}px — anchored on the degraded 20px plate instead of the 40px original`);
});

test('a short job fills its paid sheet with pending same-variant plates from other jobs', async () => {
  // 47% of lifetime spend was under-filled sheets (34 sheets carried ONE name). A 3-name job
  // must not buy a 3-band image while 4 same-variant names sit pending in another job.
  const jobA = crypto.randomUUID();
  const jobB = crypto.randomUUID();
  for (let i = 0; i < 3; i++) await insertPlate({ job_id: jobA, status: 'pending', render_text: `${TAG} اسم-أ-${i}` });
  for (let i = 0; i < 4; i++) await insertPlate({ job_id: jobB, status: 'pending', render_text: `${TAG} اسم-ب-${i}` });

  const { calls, restore } = stubFetch((body) => sheetPng(promptNameCount(body)), 0.07);
  let out;
  try {
    out = await processNextBatch(jobA, null);
  } finally {
    restore();
  }
  assert.ok(!out.error, JSON.stringify(out.error || {}));
  assert.equal(calls.length, 1, 'one paid sheet for both jobs');
  assert.equal(promptNameCount(calls[0].body), 7, 'all 7 pending names ride the one sheet');

  // The response stays scoped to the requested job — the workbench view does not change.
  assert.equal(out.data.processed, 3);
  assert.equal(out.data.plates.length, 3);
  assert.equal(out.data.remaining, 0);

  // The hitchhikers are done in the DB, each carrying a 1/7 share of the sheet.
  const { rows: bPlates } = await query(
    `SELECT status, cost_usd, plate_path FROM calligraphy_plates WHERE job_id=$1`, [jobB]);
  assert.equal(bPlates.length, 4);
  for (const p of bPlates) {
    assert.equal(p.status, 'done');
    assert.ok(Math.abs(Number(p.cost_usd) - 0.07 / 7) < 0.0005, `cost share ${p.cost_usd}`);
    fx.files.push(absFromUrl(p.plate_path));
  }
  const { rows: aPlates } = await query(
    `SELECT plate_path, sheet_path FROM calligraphy_plates WHERE job_id=$1`, [jobA]);
  for (const p of aPlates) { fx.files.push(absFromUrl(p.plate_path)); fx.files.push(absFromUrl(p.sheet_path)); }
});

// ---- daily ceiling ------------------------------------------------------------------------
// These run LAST: they shrink CALLIG_DAILY_USD_MAX and stuff the ledger, and restore both.

test('a reroll writes its cost into the spend ledger', async () => {
  const plate = await insertPlate();
  const { restore } = stubFetch(await bandPng(), 0.067);
  try {
    const res = mockRes();
    await reroll({ params: { id: plate.id }, body: {}, protocol: 'http', get: () => 'localhost:4000' }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  } finally {
    restore();
  }
  const { rows } = await query(
    `SELECT kind, cost_usd FROM calligraphy_spend_log
      WHERE created_at >= $1 AND kind='reroll' ORDER BY id DESC LIMIT 1`, [fx.startedAt]);
  assert.equal(rows.length, 1, 'the paid reroll must appear in calligraphy_spend_log');
  assert.ok(Math.abs(Number(rows[0].cost_usd) - 0.067) < 0.0005);
});

test('the daily ceiling refuses a reroll before any money is spent', async () => {
  const plate = await insertPlate();
  process.env.CALLIG_DAILY_USD_MAX = '0.50';
  const { rows: seeded } = await query(
    `INSERT INTO calligraphy_spend_log (kind, cost_usd) VALUES ('sheet', 0.60) RETURNING id`);
  const { calls, restore } = stubFetch(await bandPng(), 0.067);
  try {
    const res = mockRes();
    await reroll({ params: { id: plate.id }, body: {}, protocol: 'http', get: () => 'localhost:4000' }, res);
    assert.equal(res.statusCode, 429, JSON.stringify(res.body));
    assert.equal(res.body.code, 'ERR_CALLIG_BUDGET');
    assert.equal(calls.length, 0, 'a blocked reroll must not reach OpenRouter');
    const { rows } = await query(`SELECT reroll_count FROM calligraphy_plates WHERE id=$1`, [plate.id]);
    assert.equal(Number(rows[0].reroll_count), 0);
  } finally {
    restore();
    delete process.env.CALLIG_DAILY_USD_MAX;
    await query(`DELETE FROM calligraphy_spend_log WHERE id=$1`, [seeded[0].id]);
  }
});

test('the daily ceiling leaves batch plates PENDING (pg-boss retries after the window)', async () => {
  const jobId = crypto.randomUUID();
  await insertPlate({ job_id: jobId, status: 'pending' });
  process.env.CALLIG_DAILY_USD_MAX = '0.50';
  const { rows: seeded } = await query(
    `INSERT INTO calligraphy_spend_log (kind, cost_usd) VALUES ('sheet', 0.60) RETURNING id`);
  const { calls, restore } = stubFetch(await bandPng(), 0.07);
  let out;
  try {
    out = await processNextBatch(jobId, null);
  } finally {
    restore();
    delete process.env.CALLIG_DAILY_USD_MAX;
    await query(`DELETE FROM calligraphy_spend_log WHERE id=$1`, [seeded[0].id]);
  }
  assert.ok(out.error, 'the engine must refuse to generate');
  assert.equal(out.error.status, 429);
  assert.equal(out.error.code, 'ERR_CALLIG_BUDGET');
  assert.equal(calls.length, 0);
  const { rows } = await query(`SELECT status FROM calligraphy_plates WHERE job_id=$1`, [jobId]);
  assert.equal(rows[0].status, 'pending', 'no money was spent, so the plate must stay retryable');
});

test('crossing the warn threshold writes the admins ONE notification', async () => {
  const { maybeWarnSpend } = require('../lib/calligraphySpend');
  await query(`DELETE FROM notifications WHERE type='calligraphy_budget_warning'`);
  await maybeWarnSpend(6.5, { warnUsd: 5, maxUsd: 10 });
  await maybeWarnSpend(7.0, { warnUsd: 5, maxUsd: 10 }); // second crossing, same 24h — no dupe
  const { rows } = await query(
    `SELECT COUNT(DISTINCT user_id)::int AS admins, COUNT(*)::int AS total
       FROM notifications WHERE type='calligraphy_budget_warning'`);
  assert.ok(rows[0].total >= 1, 'at least one admin notification row');
  assert.equal(rows[0].total, rows[0].admins, 'exactly one row per admin — no duplicates');
  await query(`DELETE FROM notifications WHERE type='calligraphy_budget_warning'`);
});
