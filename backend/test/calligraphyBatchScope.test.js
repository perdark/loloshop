'use strict';
// The workbench grid is fed from TWO places at once and must be able to tell them apart.
//
// THE BUG (owner, 2026-09-06): «when designer download a batch there is names of another
// students». `GET /calligraphy/recent?limit=60` returns the newest done plates SHOP-WIDE — it
// exists so the page survives a refresh — and CalligraphyTool merges them into the same
// `plates` array the current job's rows live in. «تنزيل إلى مجلد…» then wrote every VISIBLE
// done plate to the folder, so a designer who generated 8 names for one ممثل got those 8 plus
// up to 60 unrelated students' plates, with nothing on screen hinting at it.
//
// The frontend fix scopes the grid to the current batch, and the ONLY thing it can scope on is
// `job_id` — which `toPlate` did not expose. That is what this file pins: drop the field and
// the grid silently goes back to mixing batches, `tsc` says nothing (it is optional on
// CalPlate), and the folder fills with strangers again.
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert');
const { toPlate, attachOrderContext } = require('../lib/calligraphyEngine');

test('toPlate exposes job_id — the only handle the workbench has on «this batch»', () => {
  const row = {
    id: 'p1', job_id: 'JOB-A', render_text: 'أحمد', status: 'done',
    variant: 'front', element_text: null, style: null,
    plate_path: '/uploads/a.png', sheet_path: null,
    student_id: 'S1', order_item_id: null, linked_at: null, cost_usd: 0.01,
    error: null, reroll_count: 0,
  };
  assert.strictEqual(toPlate(row).job_id, 'JOB-A');
});

test('attachOrderContext keeps job_id on a plate with no order line', async () => {
  // The orphan branch (`order_item_id` null) returns a fresh object, so it is the one that
  // would drop the field if anyone rebuilt it field-by-field instead of spreading.
  const [out] = await attachOrderContext([
    { id: 'p1', job_id: 'JOB-A', order_item_id: null, render_text: 'أحمد' },
  ]);
  assert.strictEqual(out.job_id, 'JOB-A');
  assert.strictEqual(out.order_id, null);
});

test('a plate from another job is distinguishable from this batch', () => {
  // The exact predicate the grid filters on (`p.job_id === jobId`). Asserted here so the
  // contract lives on the server side too, where the field is produced.
  const mine = toPlate({ id: 'a', job_id: 'JOB-A', render_text: 'أحمد', status: 'done', variant: 'front' });
  const theirs = toPlate({ id: 'b', job_id: 'JOB-B', render_text: 'سجى', status: 'done', variant: 'front' });
  const jobId = 'JOB-A';
  assert.deepStrictEqual(
    [mine, theirs].filter((p) => p.job_id === jobId).map((p) => p.id),
    ['a'],
    'a hitchhiker or an older plate must not pass as part of this batch'
  );
});
