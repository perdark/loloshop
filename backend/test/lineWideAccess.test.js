'use strict';
// Owner decision 2026-08-31: «give access for all staff to all stages except the design
// stage», and staff must be able to MOVE an order at a stage that is not their own — the
// point being the 197 retail شال امريكي that sat at التطريز for two months because the only
// embroiderer's `order_scope` is wholesaler-only and nobody else was allowed to touch them.
//
// THE TWO CONCEPTS THIS SPLIT APART, which is the whole risk of the change:
//   · QUEUE_STAGES     — a person's OWN station. It is what «مرحلتي» means, and it is what
//                        viewerStages must keep answering, or the rep console re-opens on
//                        402 rows of other stations' finished work (the 2026-08-13 bug 2).
//   · LINE_VIEW_STAGES — what they may LOOK AT and move: the whole line, minus التصميم.
// Before this change the two were the same list, and viewerStages derived itself from
// STAGE_AUTHZ on the strength of that. Widening STAGE_AUTHZ alone would silently have made
// every stage "mine" for everyone — which is why viewerStages now reads QUEUE_STAGES.
//
// التصميم stays closed: design_complete→embroidery / →converting / →designing remain
// designer-only, and so does every edge that moves an order BACK into the design desk.
// Pure function, no DB.
const test = require('node:test');
const assert = require('node:assert/strict');
const { canStaffTransition } = require('../controllers/orderController');
const { QUEUE_STAGES, LINE_VIEW_STAGES } = require('../controllers/productionController');
const { viewerStages } = require('../controllers/staffController');

const staff = (...types) => ({ role: 'staff', staff_types: types });
const sorted = (a) => [...a].sort();
const LINE = ['designer', 'digitizer', 'embroiderer', 'presser', 'preparer'];

test('التصميم is NOT in the line-wide view', () => {
  assert.ok(!LINE_VIEW_STAGES.includes('design_complete'));
  assert.ok(!LINE_VIEW_STAGES.includes('designing'));
});

test('every line staff type may advance every non-design edge', () => {
  const edges = [
    ['converting', 'embroidery'],
    ['embroidery', 'pressing'],
    ['embroidery', 'preparing'],
    ['pressing', 'preparing'],
    ['preparing', 'ready'],
    ['ready', 'delivered'],
  ];
  for (const type of LINE) {
    for (const [from, to] of edges) {
      assert.ok(canStaffTransition(staff(type), from, to), `${type} must move ${from}→${to}`);
    }
  }
});

test('THE CASE THIS WAS FOR — المكوجي can push a shawl out of التطريز', () => {
  assert.ok(canStaffTransition(staff('presser'), 'embroidery', 'pressing'));
  assert.ok(canStaffTransition(staff('presser'), 'embroidery', 'preparing'));
});

test('التصميم stays closed to everyone but the designer', () => {
  for (const type of ['digitizer', 'embroiderer', 'presser', 'preparer']) {
    assert.ok(!canStaffTransition(staff(type), 'design_complete', 'embroidery'), `${type} must NOT leave التصميم`);
    assert.ok(!canStaffTransition(staff(type), 'design_complete', 'designing'), `${type} must NOT reopen التصميم`);
  }
  assert.ok(canStaffTransition(staff('designer'), 'design_complete', 'embroidery'));
});

test('edges that move an order BACK into the design desk stay restricted', () => {
  assert.ok(!canStaffTransition(staff('presser'), 'embroidery', 'design_complete'));
  assert.ok(!canStaffTransition(staff('preparer'), 'converting', 'design_complete'));
  assert.ok(canStaffTransition(staff('embroiderer'), 'embroidery', 'design_complete'));
  assert.ok(canStaffTransition(staff('designer'), 'embroidery', 'design_complete'));
});

test('cancelling is still manager/admin only', () => {
  for (const type of LINE) {
    assert.ok(!canStaffTransition(staff(type), 'preparing', 'cancelled'), `${type} must not cancel`);
  }
});

test('«مرحلتي» still means MY station, not the whole line', () => {
  for (const [type, own] of Object.entries(QUEUE_STAGES)) {
    if (type === 'tailor') continue; // read-only viewer, deliberately owns nothing
    assert.deepStrictEqual(sorted(viewerStages(staff(type))), sorted(own), `${type}`);
  }
  assert.deepStrictEqual(viewerStages({ role: 'admin' }), []);
  assert.deepStrictEqual(viewerStages(staff('manager')), []);
  assert.deepStrictEqual(viewerStages(staff('tailor')), []);
});

test('multi-role staff still union their own stations', () => {
  assert.deepStrictEqual(
    sorted(viewerStages(staff('presser', 'preparer'))),
    sorted(['pressing', 'preparing', 'ready', 'delivered'])
  );
});
