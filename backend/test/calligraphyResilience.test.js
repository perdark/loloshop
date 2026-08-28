'use strict';
// What happens when the GENERATOR fails, and what a batch of one is allowed to cost.
// Written 2026-08-28, the day both gaps showed up together on prod:
//
//   · 17:49 — OpenRouter answered 402 (out of credit). Nine real students' plates were
//     retired to `failed`, the shop was told nothing, and the owner found out by asking.
//   · The same 10 days of ledger showed 110 of 175 paid images carrying ONE name at the full
//     2K sheet price ($0.101) — 63% of all sheet money at ten times the per-name price of a
//     full sheet. A batch of one now buys what a reroll buys.
//
// Everything drives the real engine/controller against the dev DB with global.fetch stubbed —
// nothing here spends money.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const sharp = require('sharp');
const { processNextBatch } = require('../lib/calligraphyEngine');
const { generateImage, MODELS } = require('../lib/openrouter');
const { query } = require('../lib/db');

const TAG = `ZZTEST-calres-${crypto.randomUUID().slice(0, 8)}`;
// A style id outside the closed list: it clauses to '' (calligraphyStyles.styleClause) so the
// artwork is unchanged, but it isolates these plates from any other pending row in the dev DB
// that would otherwise ride along as a hitchhiker and turn a batch of one into a batch of two.
const SOLO_STYLE = `${TAG}-style`;
const fx = { plates: [], startedAt: new Date() };

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

/**
 * Stub global.fetch with a SCRIPT of replies, one per call, so a test can say "fail, then
 * succeed". `{ status, body }` is an upstream error; `{ png, cost }` is a paid image. Running
 * past the end of the script is itself the assertion that no extra call was made.
 */
function stubFetchScript(script) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, opts) => {
    const step = script[calls.length];
    calls.push({ url, body: JSON.parse(opts.body) });
    if (!step) throw new Error(`unscripted OpenRouter call #${calls.length}`);
    if (step.status) {
      return { ok: false, status: step.status, json: async () => step.body };
    }
    return {
      ok: true,
      json: async () => ({ data: [{ b64_json: step.png.toString('base64') }], usage: { cost: step.cost ?? 0.067 } }),
    };
  };
  return { calls, restore: () => { global.fetch = original; } };
}

const CREDIT_402 = {
  status: 402,
  body: { error: { message: 'Insufficient credits. Add more using https://openrouter.ai/settings/credits', code: 402 } },
};
const NO_IMAGE_400 = {
  status: 400,
  body: { error: { message: 'Gemini could not generate an image (STOP)', code: 400, metadata: { finish_reason: 'STOP' } } },
};

async function insertPending(overrides = {}) {
  const { rows } = await query(
    `INSERT INTO calligraphy_plates (job_id, source, render_text, variant, status, style)
     VALUES ($1, 'typed', $2, $3, 'pending', $4) RETURNING *`,
    [overrides.job_id || crypto.randomUUID(),
     overrides.render_text || `${TAG} محمد كريم`,
     overrides.variant || 'front',
     overrides.style === undefined ? SOLO_STYLE : overrides.style]);
  fx.plates.push(rows[0].id);
  return rows[0];
}

const statusOf = async (id) => (await query(`SELECT status, error FROM calligraphy_plates WHERE id=$1`, [id])).rows[0];

test.after(async () => {
  if (fx.plates.length) await query(`DELETE FROM calligraphy_plates WHERE id = ANY($1)`, [fx.plates]);
  await query(`DELETE FROM calligraphy_spend_log WHERE created_at >= $1`, [fx.startedAt]);
  await query(`DELETE FROM notifications WHERE type = 'calligraphy_credit_exhausted' AND created_at >= $1`,
    [fx.startedAt]);
});

// ---------------------------------------------------------------------------------------
// 1. A batch of one must not buy the ten-name canvas.
// ---------------------------------------------------------------------------------------
test('a batch of ONE name buys a 1K 1:1 image with the single-name prompt, not a 2K sheet', async () => {
  const job = crypto.randomUUID();
  const plate = await insertPending({ job_id: job });

  const { calls, restore } = stubFetchScript([{ png: await bandPng(), cost: 0.067 }]);
  let out;
  try { out = await processNextBatch(job, null); } finally { restore(); }

  assert.ok(!out.error, JSON.stringify(out.error || {}));
  assert.equal(calls.length, 1, 'exactly one paid generation');
  assert.equal(calls[0].body.resolution, '1K', 'a lone name must not buy the 2K sheet canvas');
  assert.equal(calls[0].body.aspect_ratio, '1:1');
  assert.ok(!/following \d+ Arabic names/.test(calls[0].body.prompt),
    'a lone name must use the single-name prompt, not the "spread them out" sheet prompt');
  assert.equal((await statusOf(plate.id)).status, 'done');
});

test('a full sheet still buys the 2K 9:16 canvas', async () => {
  // The guard on the other side of the same branch: nothing about the solo path may change
  // what a real multi-name sheet buys.
  const job = crypto.randomUUID();
  for (let i = 0; i < 3; i++) await insertPending({ job_id: job, render_text: `${TAG} اسم-${i}` });

  const band = await sharp({ create: { width: 500, height: 36, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .png().toBuffer();
  const sheet = await sharp({ create: { width: 640, height: 3 * 160, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite([0, 1, 2].map((i) => ({ input: band, left: 70, top: i * 160 + 62 })))
    .png().toBuffer();

  const { calls, restore } = stubFetchScript([{ png: sheet, cost: 0.101 }]);
  let out;
  try { out = await processNextBatch(job, null); } finally { restore(); }

  assert.ok(!out.error, JSON.stringify(out.error || {}));
  assert.equal(calls[0].body.resolution, '2K');
  assert.equal(calls[0].body.aspect_ratio, '9:16');
  assert.equal(out.data.processed, 3);
});

// ---------------------------------------------------------------------------------------
// 2. An outage must not retire the work — and must reach a human.
// ---------------------------------------------------------------------------------------
test('running out of credit leaves the plates PENDING and notifies the admins', async () => {
  const job = crypto.randomUUID();
  const a = await insertPending({ job_id: job, render_text: `${TAG} اسم-أ` });
  const b = await insertPending({ job_id: job, render_text: `${TAG} اسم-ب` });

  const { calls, restore } = stubFetchScript([CREDIT_402]);
  let out;
  try { out = await processNextBatch(job, null); } finally { restore(); }

  assert.equal(out.error.code, 'ERR_OPENROUTER_CREDIT', 'a 402 must be its own code, not the generic failure');
  assert.equal(calls.length, 1, 'a 402 is not retried — retrying only fails twice');
  for (const p of [a, b]) {
    assert.equal((await statusOf(p.id)).status, 'pending',
      'an outage is not the plate\'s fault — it must survive to generate when credit returns');
  }

  const { rows } = await query(
    `SELECT count(*)::int n FROM notifications
      WHERE type = 'calligraphy_credit_exhausted' AND created_at >= $1`, [fx.startedAt]);
  assert.ok(rows[0].n > 0, 'the admins must be told the shop is out of credit');
});

test('a generation failure that IS about the names still fails them', async () => {
  // The other side of the same branch: ERR_OPENROUTER_SHAPE is not an outage, and leaving such
  // a plate pending forever would hide a broken name behind an infinite retry.
  const job = crypto.randomUUID();
  const plate = await insertPending({ job_id: job, render_text: `${TAG} اسم-فاشل` });

  const { restore } = stubFetchScript([{ status: 500, body: { error: { message: 'boom' } } }]);
  let out;
  try { out = await processNextBatch(job, null); } finally { restore(); }

  assert.equal(out.error.code, 'ERR_OPENROUTER');
  assert.equal((await statusOf(plate.id)).status, 'failed');
});

// ---------------------------------------------------------------------------------------
// 3. The model returning no image is the one failure worth retrying.
// ---------------------------------------------------------------------------------------
test('Gemini returning no image is retried once, and the retry lands', async () => {
  const job = crypto.randomUUID();
  const plate = await insertPending({ job_id: job, render_text: `${TAG} اسم-معاد` });

  const { calls, restore } = stubFetchScript([NO_IMAGE_400, { png: await bandPng(), cost: 0.067 }]);
  let out;
  try { out = await processNextBatch(job, null); } finally { restore(); }

  assert.ok(!out.error, JSON.stringify(out.error || {}));
  assert.equal(calls.length, 2, 'the no-image reply must be retried exactly once');
  assert.equal((await statusOf(plate.id)).status, 'done');
});

test('the no-image retry is bounded at one — a model that keeps refusing fails the plate', async () => {
  const job = crypto.randomUUID();
  const plate = await insertPending({ job_id: job, render_text: `${TAG} اسم-مرفوض` });

  const { calls, restore } = stubFetchScript([NO_IMAGE_400, NO_IMAGE_400]);
  let out;
  try { out = await processNextBatch(job, null); } finally { restore(); }

  assert.equal(calls.length, 2, 'exactly two attempts, never an unbounded loop');
  assert.equal(out.error.code, 'ERR_OPENROUTER_NO_IMAGE');
  assert.equal((await statusOf(plate.id)).status, 'failed');
});

test('generateImage classifies the three upstream failures apart', async () => {
  for (const [step, code] of [[CREDIT_402, 'ERR_OPENROUTER_CREDIT'],
                              [{ status: 500, body: { error: { message: 'boom' } } }, 'ERR_OPENROUTER']]) {
    const { restore } = stubFetchScript([step, step]);
    try {
      await assert.rejects(
        () => generateImage({ model: MODELS.standard, prompt: 'x' }),
        (err) => err.code === code);
    } finally { restore(); }
  }
});
