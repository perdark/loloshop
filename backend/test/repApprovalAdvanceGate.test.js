'use strict';
// «تحويل للتطريز» must not be able to push a rep order past التصميم while its ممثل has
// not approved it — measured on prod 2026-08-31, three orders reached التطريز that way and
// then existed in no queue at all.
//
// THE ASYMMETRY THAT CAUSED IT. Two surfaces move an order out of design_complete:
//   · productionController.getQueue — filters `wholesaler_approval = 'approved'`, so a
//     station's list can never OFFER an unapproved rep order.
//   · calligraphyController.zoneBuckets / sendOrder — filters neither approval nor
//     returned_to_customer, so the الخط العربي workbench offers it AND sends it.
// The transition itself (performAdvance) checked nothing, so the workbench's «تحويل للتطريز»
// was a side door around the approval gate. The order advanced cleanly and then vanished:
// it IS at التطريز, and every queue that could show التطريز hides it.
//
// The gate therefore belongs on the TRANSITION, not on a list — the same rule
// optionGroupAudience.test.js proves for pricing: the server, not the screen, decides.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { sendOrder } = require('../controllers/calligraphyController');
const { advance, advanceBulk } = require('../controllers/productionController');
const { query } = require('../lib/db');

const TAG = `ZZTEST-repgate-${crypto.randomUUID().slice(0, 8)}`;
const fx = { users: [], students: [], wholesalers: [], orders: [], products: [] };
const ctx = {};

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { res.statusCode = code; return res; },
    json(body) { res.body = body; return res; },
  };
  return res;
}
async function call(handler, req) {
  const res = mockRes();
  await handler(req, res);
  return res;
}

test('setup', async () => {
  const p = await query(
    `INSERT INTO products (name_ar, type, base_price, active) VALUES ($1,'sash',1000,TRUE) RETURNING id`,
    [`${TAG}-sash`]
  );
  ctx.productId = p.rows[0].id;
  fx.products.push(ctx.productId);

  const repUser = await query(
    `INSERT INTO users (name, phone, password_hash, role) VALUES ($1,$2,'x','wholesaler') RETURNING id`,
    [`${TAG}-rep`, `0777${Date.now() % 10000000}`]
  );
  fx.users.push(repUser.rows[0].id);
  const w = await query(
    `INSERT INTO wholesalers (user_id, university_name, referral_code) VALUES ($1,$2,$3) RETURNING id`,
    [repUser.rows[0].id, `${TAG}-uni`, `${TAG}`.slice(0, 20)]
  );
  ctx.wholesalerId = w.rows[0].id;
  fx.wholesalers.push(ctx.wholesalerId);

  const stuUser = await query(
    `INSERT INTO users (name, phone, password_hash, role) VALUES ($1,$2,'x','retail') RETURNING id`,
    [`${TAG}-student`, `0788${Date.now() % 10000000}`]
  );
  fx.users.push(stuUser.rows[0].id);
  const s = await query(
    `INSERT INTO students (user_id, wholesaler_id, full_name_third, status)
     VALUES ($1,$2,$3,'approved') RETURNING id`,
    [stuUser.rows[0].id, ctx.wholesalerId, `${TAG}-student`]
  );
  ctx.studentId = s.rows[0].id;
  fx.students.push(ctx.studentId);

  // The designer who presses «تحويل للتطريز» — scope 'both' so nothing else can explain a skip.
  ctx.designer = { id: fx.users[0], role: 'staff', staff_type: 'designer', staff_types: ['designer'], order_scope: 'both' };
});

// A fresh product per order: uq_orders_student_product_nodesign is a partial unique index on
// (student, product) for design-less live orders, so one student cannot hold two test orders
// of the same product. Cheaper than a student per case and keeps the rep/approval axis single.
let seq = 0;
/** Delete an order and everything that points at it, so it stops being counted. */
async function retire(id) {
  await query(`DELETE FROM order_items WHERE order_id = $1`, [id]);
  await query(`DELETE FROM staff_activity_log WHERE order_id = $1`, [id]);
  await query(`DELETE FROM audit_log WHERE entity_id = $1`, [id]);
  await query(`DELETE FROM orders WHERE id = $1`, [id]);
  const i = fx.orders.indexOf(id);
  if (i >= 0) fx.orders.splice(i, 1);
}

async function makeOrder(approval) {
  const p = await query(
    `INSERT INTO products (name_ar, type, base_price, active) VALUES ($1,'sash',1000,TRUE) RETURNING id`,
    [`${TAG}-sash-${++seq}`]
  );
  fx.products.push(p.rows[0].id);
  const o = await query(
    `INSERT INTO orders (student_id, product_id, price, status, has_embroidery, needs_pressing, wholesaler_approval)
     VALUES ($1,$2,1000,'design_complete',TRUE,TRUE,$3) RETURNING id`,
    [ctx.studentId, p.rows[0].id, approval]
  );
  fx.orders.push(o.rows[0].id);
  return o.rows[0].id;
}

test('sendOrder REFUSES a rep order whose ممثل has not approved it', async () => {
  for (const approval of ['pending', 'rejected']) {
    const id = await makeOrder(approval);
    const res = await call(sendOrder, { params: { orderId: id }, user: ctx.designer });
    assert.equal(res.statusCode, 409, `${approval} must be refused, not advanced`);
    assert.equal(res.body.code, 'ERR_REP_APPROVAL_PENDING');
    const after = await query(`SELECT status::text AS s FROM orders WHERE id=$1`, [id]);
    assert.equal(after.rows[0].s, 'design_complete', `${approval} must stay at التصميم`);
  }
});

test('sendOrder still ALLOWS an approved rep order', async () => {
  const id = await makeOrder('approved');
  const res = await call(sendOrder, { params: { orderId: id }, user: ctx.designer });
  assert.equal(res.statusCode, 200);
  const after = await query(`SELECT status::text AS s FROM orders WHERE id=$1`, [id]);
  assert.equal(after.rows[0].s, 'embroidery');
  // ⚠️ Retired HERE, not in cleanup. `node --test` runs files concurrently, and
  // adminNumbers.test.js compares two live COUNT queries over `orders` — a fixture that sits
  // at التطريز for the rest of the suite straddles them and fails that test by exactly one
  // (measured: «dashboard says 964 workable, the queue's own filter says 965»). Every other
  // fixture in this file stays at design_complete and is therefore counted identically by
  // both queries; this is the only one that MOVES, so it is the only one that can race.
  await retire(id);
});

test('sendOrder REFUSES an order returned to the student', async () => {
  const id = await makeOrder('approved');
  await query(`UPDATE orders SET returned_to_customer = TRUE WHERE id = $1`, [id]);
  const res = await call(sendOrder, { params: { orderId: id }, user: ctx.designer });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'ERR_ORDER_RETURNED');
  const after = await query(`SELECT status::text AS s FROM orders WHERE id=$1`, [id]);
  assert.equal(after.rows[0].s, 'design_complete');
});

test('the production advance + bulk advance carry the SAME gate', async () => {
  const single = await makeOrder('pending');
  const r1 = await call(advance, { params: { id: single }, user: ctx.designer });
  assert.equal(r1.statusCode, 409);
  assert.equal(r1.body.code, 'ERR_REP_APPROVAL_PENDING');

  const bulkPending = await makeOrder('pending');
  const bulkOk = await makeOrder('approved');
  const r2 = await call(advanceBulk, { body: { ids: [bulkPending, bulkOk] }, user: ctx.designer });
  assert.equal(r2.statusCode, 200);
  assert.equal(r2.body.data.advanced, 1, 'only the approved one moves');
  const skipped = r2.body.data.results.find((x) => x.id === bulkPending);
  assert.equal(skipped.ok, false);
  assert.equal(skipped.reason, 'rep_approval_pending');
});

test('cleanup', async () => {
  if (fx.orders.length) await query(`DELETE FROM order_items WHERE order_id = ANY($1)`, [fx.orders]);
  if (fx.orders.length) await query(`DELETE FROM notifications WHERE user_id = ANY($1)`, [fx.users]);
  if (fx.orders.length) await query(`DELETE FROM staff_activity_log WHERE order_id = ANY($1)`, [fx.orders]);
  if (fx.orders.length) await query(`DELETE FROM audit_log WHERE entity_id = ANY($1)`, [fx.orders]);
  if (fx.orders.length) await query(`DELETE FROM orders WHERE id = ANY($1)`, [fx.orders]);
  if (fx.students.length) await query(`DELETE FROM students WHERE id = ANY($1)`, [fx.students]);
  if (fx.wholesalers.length) await query(`DELETE FROM wholesalers WHERE id = ANY($1)`, [fx.wholesalers]);
  if (fx.users.length) await query(`DELETE FROM users WHERE id = ANY($1)`, [fx.users]);
  if (fx.products.length) await query(`DELETE FROM products WHERE id = ANY($1)`, [fx.products]);
});
