'use strict';
// The engine half of the batching hold: `processNextBatch` must REPORT the hold and spend
// NOTHING. Runs against the LAPTOP-LOCAL dev PG (:5433). Self-cleaning. Never point at prod.
//
// The pure policy is covered in calligraphyBatching.test.js. What is worth a separate red
// test here is the wiring, because getting it wrong costs real money in one of two directions:
//   · the hold not reaching the engine → the shop keeps buying $0.09 single-name sheets;
//   · the engine holding but not SAYING so → worker.js reads `processed === 0` with work
//     remaining as a stall, throws, burns its two pg-boss retries in ~90 seconds and then
//     abandons the plates. That is why `held` is an explicit field and not an inference.
//
// No network: a held batch returns before `checkBudget` and before `generateImage`, so this
// test can assert "nothing was bought" simply by still being pending afterwards.
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { query } = require('../lib/db');
const { processNextBatch } = require('../lib/calligraphyEngine');

const jobId = crypto.randomUUID();
const made = [];

async function addPlate({ minutesAgo = 0, variant = 'front' } = {}) {
  const { rows } = await query(
    `INSERT INTO calligraphy_plates (job_id, source, render_text, status, variant, created_at)
     VALUES ($1, 'typed', $2, 'pending', $3, now() - ($4 || ' minutes')::interval)
     RETURNING id`,
    [jobId, `اختبار ${made.length}`, variant, String(minutesAgo)]);
  made.push(rows[0].id);
  return rows[0].id;
}

test.before(() => { delete process.env.CALLIG_HOLD_MINUTES; });
test.after(async () => { await query(`DELETE FROM calligraphy_plates WHERE job_id = $1`, [jobId]); });

test('a lone fresh name is HELD — reported as held, still pending, nothing bought', async () => {
  const id = await addPlate({ minutesAgo: 0 });
  const out = await processNextBatch(jobId, null);

  assert.ok(!out.error, JSON.stringify(out.error));
  assert.equal(out.data.held, true, 'the hold never reached the engine — single-name sheets are back');
  assert.equal(out.data.processed, 0);
  assert.ok(out.data.held_seconds > 0 && out.data.held_seconds <= 600, out.data.held_seconds);
  assert.equal(out.data.held_count, 1);
  assert.ok(out.data.remaining > 0, 'a held plate is still work to do');

  const { rows } = await query(
    `SELECT status::text AS status, cost_usd, sheet_path FROM calligraphy_plates WHERE id = $1`, [id]);
  assert.equal(rows[0].status, 'pending', 'a hold must never change a plate');
  assert.equal(Number(rows[0].cost_usd), 0, 'money left the shop for a held sheet');
  assert.equal(rows[0].sheet_path, null);
});

// ⚠️ DO NOT ADD A "CALLIG_HOLD_MINUTES=0" CASE HERE. It was written and then removed the same
// day: with holding off, `processNextBatch` falls straight through to `generateImage` and
// BUYS A REAL SHEET — the run cost $0.067 and took 11 seconds, in a test suite that exists to
// stop the shop buying single-name sheets. The kill switch is covered where it costs nothing,
// in calligraphyBatching.test.js. Anything in this file must stay on a path that returns
// BEFORE the network call.

test('a job with nothing pending is not a hold', async () => {
  const empty = crypto.randomUUID();
  const out = await processNextBatch(empty, null);
  assert.ok(!out.error);
  assert.notEqual(out.data.held, true);
  assert.equal(out.data.processed, 0);
});
