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
// The stage/authz assertions are pure functions; the last test touches the DB.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const { canStaffTransition } = require('../controllers/orderController');
const { QUEUE_STAGES, LINE_VIEW_STAGES } = require('../controllers/productionController');
const { viewerStages } = require('../controllers/staffController');

const crypto = require('node:crypto');
const TAG = `ZZTEST-096-${crypto.randomUUID().slice(0, 8)}`;
function mockRes() {
  const res = {
    statusCode: 200, body: null,
    status(c) { res.statusCode = c; return res; },
    json(b) { res.body = b; return res; },
  };
  return res;
}

const staff = (...types) => ({ role: 'staff', staff_types: types });
const sorted = (a) => [...a].sort();
const LINE = ['designer', 'digitizer', 'embroiderer', 'assembler', 'presser', 'preparer'];

test('التصميم is NOT in the line-wide view', () => {
  assert.ok(!LINE_VIEW_STAGES.includes('design_complete'));
  assert.ok(!LINE_VIEW_STAGES.includes('designing'));
});

test('every line staff type may advance every non-design edge', () => {
  const edges = [
    ['converting', 'embroidery'],
    ['embroidery', 'pressing'],
    ['embroidery', 'preparing'],
    ['embroidery', 'assembly'],
    ['assembly', 'pressing'],
    ['assembly', 'preparing'],
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
  for (const type of ['digitizer', 'embroiderer', 'assembler', 'presser', 'preparer']) {
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

// ── Migration 096's flag, round-tripped through the admin editor ──────────────
// The checkbox writes FALSE or NULL and never TRUE, because NULL is «unset = yes» and is what
// every pre-096 group relies on. A stray TRUE would be indistinguishable in behaviour but would
// stop the column meaning «the admin has decided about this group».
const { updateGroup } = require('../controllers/catalogController');
const { query: q } = require('../lib/db');

test('the admin editor can only ever write FALSE or NULL to is_embroidery', async () => {
  const p = await q(
    `INSERT INTO products (name_ar, type, base_price, active) VALUES ($1,'sash',1000,TRUE) RETURNING id`,
    [`${TAG}-096`]
  );
  const g = await q(
    `INSERT INTO option_groups (product_id, name_ar) VALUES ($1,$2) RETURNING id, is_embroidery`,
    [p.rows[0].id, `${TAG}-group`]
  );
  assert.equal(g.rows[0].is_embroidery, null, 'a new group starts unset = embroidery');

  const res = mockRes();
  await updateGroup({ params: { id: g.rows[0].id }, body: { is_embroidery: false } }, res);
  assert.equal(res.statusCode, 200);
  let now = await q(`SELECT is_embroidery FROM option_groups WHERE id=$1`, [g.rows[0].id]);
  assert.equal(now.rows[0].is_embroidery, false, 'unticking routes it away from التصميم');

  // Anything that is not an explicit false goes back to NULL, never TRUE.
  const res2 = mockRes();
  await updateGroup({ params: { id: g.rows[0].id }, body: { is_embroidery: true } }, res2);
  now = await q(`SELECT is_embroidery FROM option_groups WHERE id=$1`, [g.rows[0].id]);
  assert.equal(now.rows[0].is_embroidery, null, 're-ticking returns to unset, not TRUE');

  await q(`DELETE FROM option_groups WHERE id=$1`, [g.rows[0].id]);
  await q(`DELETE FROM products WHERE id=$1`, [p.rows[0].id]);
});
