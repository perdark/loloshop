'use strict';
// lib/queueView.js — /staff/queue's page + counts, computed on the server (2026-10-16).
// Pure: no DB. The equivalence with the old client-side computation was checked against a
// prod restore (every filter combination returned the same ids in the same order); these
// tests pin the rules so a later edit cannot quietly change what a count means.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildQueueView, normalizeArabic, PER_PAGE } = require('../lib/queueView');

const past = new Date(Date.now() - 86_400_000).toISOString();
const future = new Date(Date.now() + 86_400_000).toISOString();

function row(id, over = {}) {
  return {
    id, status: 'pressing', source: 'retail', product_type: 'sash', deadline: null,
    student_name: 'طالب', product_name: 'وشاح', wholesaler_name: null, batch_name: null,
    design_id: null, has_embroidery: false, final_design_url: null, has_design_images: false,
    ...over,
  };
}

test('«الكل» hides delivered; a stage shows only that stage', () => {
  const rows = [row('a'), row('b', { status: 'delivered' }), row('c', { status: 'ready' })];
  assert.deepEqual(buildQueueView(rows).data.map((r) => r.id), ['a', 'c']);
  assert.deepEqual(buildQueueView(rows, { stage: 'delivered' }).data.map((r) => r.id), ['b']);
});

test('stage stats + KPI count the WHOLE line, whatever the filter', () => {
  const rows = [
    row('a', { deadline: past }),
    row('b', { status: 'ready', deadline: past }),
    row('c', { status: 'delivered', deadline: past }), // delivered is never overdue
    row('d', { status: 'embroidery', has_embroidery: true }), // missing design
  ];
  const v = buildQueueView(rows, { stage: 'ready' });
  assert.equal(v.stage_stats.pressing.count, 1);
  assert.equal(v.stage_stats.pressing.overdue, 1);
  assert.equal(v.stage_stats.delivered.overdue, 0);
  assert.equal(v.stage_stats.embroidery.missing, 1);
  assert.deepEqual(v.kpi, { in_production: 2, ready: 1, delivered: 1, overdue: 2, missing: 1 });
});

test('source tabs count the chosen stage; rep cards count every stage', () => {
  const rows = [
    row('a', { source: 'wholesaler', wholesaler_name: 'علي', batch_name: 'د1' }),
    row('b', { source: 'wholesaler', wholesaler_name: 'علي', status: 'ready', batch_name: 'د2' }),
    row('c'),
  ];
  const v = buildQueueView(rows, { stage: 'pressing' });
  assert.deepEqual(v.source_counts, { all: 2, retail: 1, wholesaler: 1 });
  assert.deepEqual(v.reps, [{ name: 'علي', batches: ['د1', 'د2'], orderCount: 2, readyCount: 1 }]);
});

test('rep + batch narrow the list; an unknown rep is reported, not silently empty', () => {
  const rows = [
    row('a', { source: 'wholesaler', wholesaler_name: 'علي', batch_name: 'د1' }),
    row('b', { source: 'wholesaler', wholesaler_name: 'علي', batch_name: 'د2' }),
    row('c', { source: 'wholesaler', wholesaler_name: 'زيد' }),
  ];
  const v = buildQueueView(rows, { source: 'wholesaler', rep: 'علي', batch: 'د2' });
  assert.deepEqual(v.data.map((r) => r.id), ['b']);
  assert.equal(v.rep_exists, true);
  assert.deepEqual(v.rep_batches, ['د1', 'د2']);
  assert.equal(buildQueueView(rows, { source: 'wholesaler', rep: 'مافي' }).rep_exists, false);
  // rep without source=wholesaler is ignored, exactly as the page always did
  assert.equal(buildQueueView(rows, { rep: 'علي' }).total, 3);
});

test('garment chips count BEFORE the garment filter, so a pressed chip keeps its count', () => {
  const rows = [row('a'), row('b', { product_type: 'robe' }), row('c', { product_type: 'robe' })];
  const v = buildQueueView(rows, { garment: 'robe' });
  assert.equal(v.total, 2);
  assert.deepEqual(v.garments, { sash: 1, robe: 2 });
});

test('search folds Arabic spelling and needs every word, in any field', () => {
  assert.equal(normalizeArabic('أحمَد  مدرسة'), 'احمد مدرسه');
  const rows = [
    row('a', { student_name: 'أحمد علي', department: 'الطب' }),
    row('b', { student_name: 'احمد', department: 'هندسة' }),
    row('c', { student_name: 'زيد', search_text: 'إحسان' }),
  ];
  assert.deepEqual(buildQueueView(rows, { q: 'احمد طب' }).data.map((r) => r.id), ['a']);
  assert.deepEqual(buildQueueView(rows, { q: 'احسان' }).data.map((r) => r.id), ['c']);
});

test('pages are PER_PAGE rows; a page past the end falls back to 1; ids window spans ±2 pages', () => {
  const rows = Array.from({ length: PER_PAGE * 6 + 5 }, (_, i) => row(`r${i}`));
  const p4 = buildQueueView(rows, { page: '4' });
  assert.equal(p4.page, 4);
  assert.equal(p4.data[0].id, `r${PER_PAGE * 3}`);
  assert.equal(p4.ids_offset, PER_PAGE);
  assert.equal(p4.ids_window.length, PER_PAGE * 5);
  assert.equal(buildQueueView(rows, { page: '99' }).page, 1);
  assert.equal(buildQueueView(rows, { page: 'x' }).page, 1);
  const last = buildQueueView(rows, { page: '7' });
  assert.equal(last.data.length, 5);
});
