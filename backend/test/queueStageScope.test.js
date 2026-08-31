'use strict';
// «مرحلتي» vs «الكل» ON THE WORK QUEUE — the contract every production screen opens with.
//
// WHY THIS FILE EXISTS. The 2026-08-31 line-wide-access change made /production/queue return
// the WHOLE line to every line staff member (LINE_VIEW_STAGES). That is right for the line —
// it is what un-dammed the 197 retail شال امريكي — but it meant a designer's «مراجعة
// التصاميم» opened on hundreds of قيد التطريز / قيد الكوي rows, and the workers said so.
//
// The fix is a DEFAULT, not a narrowing: the response now carries `my_stages` (open here) and
// `view_stages` (you may step to any of these). Nothing about access changed, and these tests
// pin exactly that:
//   · `my_stages` is the person's own station and NOTHING else — if it ever widens to the
//     whole line, every screen silently opens on «الكل» again and the complaint returns.
//   · `view_stages` stays the full line, so no screen can quietly re-narrow what a worker
//     may reach.
//   · The two must never be the same list for a line staffer.
//
// ⚠️ The frontend reads BOTH from this payload on purpose. A TypeScript copy of QUEUE_STAGES
// would drift the way the viewerStages landmine describes.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  QUEUE_STAGES,
  LINE_VIEW_STAGES,
} = require('../controllers/productionController');
const { viewerStages } = require('../controllers/staffController');

const staff = (...types) => ({ role: 'staff', staff_types: types });
const sorted = (a) => [...a].sort();

// The exact expression getQueue uses to build a line staffer's visible stage set. Written
// out here rather than imported so a change to that union has to be made in two places on
// purpose — this is the assertion, not a mirror of the implementation's own helper.
const LINE_STAFF = ['designer', 'digitizer', 'embroiderer', 'presser', 'preparer'];
function expectedViewStages(types) {
  const set = new Set();
  for (const t of types) {
    if (LINE_STAFF.includes(t)) LINE_VIEW_STAGES.forEach((st) => set.add(st));
    (QUEUE_STAGES[t] || []).forEach((st) => set.add(st));
  }
  return [...set];
}

test('my_stages is the OWN station, never the whole line', () => {
  for (const type of LINE_STAFF) {
    assert.deepStrictEqual(
      sorted(viewerStages(staff(type))),
      sorted(QUEUE_STAGES[type]),
      `${type}: «مرحلتي» must stay their own station`
    );
  }
});

test('view_stages still carries the whole line for every line staffer', () => {
  for (const type of LINE_STAFF) {
    const view = expectedViewStages([type]);
    for (const st of LINE_VIEW_STAGES) {
      assert.ok(view.includes(st), `${type} must still be able to reach ${st}`);
    }
  }
});

test('the two lists are DIFFERENT for a line staffer — that gap is the whole point', () => {
  for (const type of LINE_STAFF) {
    const mine = viewerStages(staff(type));
    const view = expectedViewStages([type]);
    assert.ok(
      view.length > mine.length,
      `${type}: if these ever match, «مرحلتي» stops being a default and becomes a cage`
    );
    for (const st of mine) {
      assert.ok(view.includes(st), `${type}: own station ${st} must be inside view_stages`);
    }
  }
});

test('التصميم stays out of the line-wide set — only the designer opens on it', () => {
  assert.ok(!LINE_VIEW_STAGES.includes('design_complete'));
  assert.deepStrictEqual(viewerStages(staff('designer')), ['design_complete']);
  assert.ok(expectedViewStages(['designer']).includes('design_complete'));
  assert.ok(!expectedViewStages(['embroiderer']).includes('design_complete'));
});

test('a multi-role staffer opens on the union of their own stations', () => {
  assert.deepStrictEqual(
    sorted(viewerStages(staff('presser', 'preparer'))),
    sorted([...QUEUE_STAGES.presser, ...QUEUE_STAGES.preparer])
  );
});

test('manager/admin/مفصل have NO station, so their screens keep opening on «الكل»', () => {
  // [] is the signal every client reads as «no default, show الكل». A manager who suddenly
  // "owned" a stage would land on one column of a console built to watch all of them.
  assert.deepStrictEqual(viewerStages({ role: 'admin' }), []);
  assert.deepStrictEqual(viewerStages(staff('manager')), []);
  assert.deepStrictEqual(viewerStages(staff('tailor')), []);
  assert.deepStrictEqual(viewerStages(staff('designer', 'manager')), []);
});

test('no station is ever «cancelled» — a screen must not open on dead orders', () => {
  for (const type of LINE_STAFF) {
    assert.ok(!viewerStages(staff(type)).includes('cancelled'), type);
  }
});
