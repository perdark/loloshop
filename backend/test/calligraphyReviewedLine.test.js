'use strict';
// PER-LINE review (2026-08-21). مضر reported that a ممثل's students type instructions into
// the embroidery-name field exactly like retail students do — «خلي التطريز محمد مع حرف N» —
// and the generator embroidered the sentence. The designer can now correct the line in the
// grab list BEFORE the paid generation, and a corrected line carries `reviewed: true` ITSELF.
//
// What must hold, and what these tests pin:
//   · the flag travels per ITEM, so the corrected line generates while the untouched
//     instruction sitting in the same batch is still dropped — flagging the whole job would
//     wave through every line nobody looked at, which is the failure the guard exists for;
//   · the job-level flag keeps working (the held-line button uses it);
//   · with no flag at all, both instruction lines are still refused.
//
// Drives the real controller against the dev DB. Generation is never enqueued (the queue is
// stubbed before the controller loads) and nothing here spends money.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');

const queueLib = require('../lib/queue');
// Patch BEFORE requiring the controller: it destructures `enqueueGeneration` at load time.
queueLib.enqueueGeneration = async () => {};

const { createJob } = require('../controllers/calligraphyController');
const { query } = require('../lib/db');

const INSTRUCTION_A = 'خلي التطريز محمد مع حرف N';
const INSTRUCTION_B = 'خلي التطريز سجى مع حرف N';
const CLEAN_NAME = 'مريم الزهراء';

const createdJobIds = [];

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { res.statusCode = code; return res; },
    json(body) { res.body = body; return res; },
  };
  return res;
}

async function adminId() {
  const { rows } = await query(`SELECT id FROM users WHERE role='admin' ORDER BY created_at LIMIT 1`);
  assert.ok(rows.length, 'dev DB needs at least one admin user');
  return rows[0].id;
}

async function run(items, extra = {}) {
  const res = mockRes();
  await createJob(
    { user: { id: await adminId() }, body: { source: 'wholesaler', items, ...extra } },
    res
  );
  if (res.statusCode === 201 && res.body?.data?.job_id) createdJobIds.push(res.body.data.job_id);
  return res;
}

test.after(async () => {
  if (createdJobIds.length) {
    await query(`DELETE FROM calligraphy_plates WHERE job_id = ANY($1)`, [createdJobIds]);
  }
});

test('a corrected line generates while the untouched instruction beside it is dropped', async () => {
  const res = await run([
    { render_text: INSTRUCTION_A, variant: 'front' },
    { render_text: INSTRUCTION_B, variant: 'front', reviewed: true },
    { render_text: CLEAN_NAME, variant: 'front' },
  ]);

  assert.equal(res.statusCode, 201);
  const { dropped, warned, total } = res.body.data;
  assert.deepEqual(dropped, [INSTRUCTION_A], 'the line nobody touched must still be refused');
  assert.deepEqual(warned, [INSTRUCTION_B], 'the corrected line is generated, and flagged');
  assert.equal(total, 2, 'two plates: the corrected line and the clean name');

  const { rows } = await query(
    `SELECT render_text FROM calligraphy_plates WHERE job_id=$1 ORDER BY render_text`,
    [res.body.data.job_id]
  );
  assert.deepEqual(rows.map((r) => r.render_text).sort(), [INSTRUCTION_B, CLEAN_NAME].sort());
});

test('with no review flag at all, every instruction line is refused', async () => {
  const res = await run([
    { render_text: INSTRUCTION_A, variant: 'front' },
    { render_text: INSTRUCTION_B, variant: 'front' },
    { render_text: CLEAN_NAME, variant: 'front' },
  ]);

  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body.data.dropped.sort(), [INSTRUCTION_A, INSTRUCTION_B].sort());
  assert.deepEqual(res.body.data.warned, []);
  assert.equal(res.body.data.total, 1);
});

test('the job-level flag still reviews the whole batch (the held-line button)', async () => {
  const res = await run(
    [
      { render_text: INSTRUCTION_A, variant: 'front' },
      { render_text: INSTRUCTION_B, variant: 'front' },
    ],
    { reviewed: true }
  );

  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body.data.dropped, []);
  assert.deepEqual(res.body.data.warned.sort(), [INSTRUCTION_A, INSTRUCTION_B].sort());
  assert.equal(res.body.data.total, 2);
});

test('a per-item flag cannot rescue junk — it only downgrades the instruction guard', async () => {
  const res = await run([
    { render_text: '123', variant: 'front', reviewed: true },
    { render_text: CLEAN_NAME, variant: 'front' },
  ]);

  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body.data.dropped, ['123']);
  assert.equal(res.body.data.total, 1);
});
