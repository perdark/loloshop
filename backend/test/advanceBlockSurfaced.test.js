'use strict';
// «إنهاء الكوي» يظهر ثم يُرفض — the button that could never work.
//
// REPORTED 2026-09-08 as «when complete الكوي it shows [the order needs reviewing] — and it
// is on retail students». MEASURED ON PROD the same day, which is what identified it:
//
//     retail | pressing  | returned_to_customer = t |  11
//     retail | preparing | returned_to_customer = t |   3
//     ...and ZERO rep orders carry the flag at any production stage.
//
// `advanceBlockReason` refuses such an order with «الطلب مُرجَع للطالب», but
// `available_actions.advance` asked only `canStaffTransition` — which knows about ROLES and
// nothing about the row — so the page rendered «إنهاء الكوي، نقل للتجهيز», the press came
// back 409, and the worker could do nothing about it because only the STUDENT can resubmit.
// The queue hides these rows; the DETAIL page (a link from /admin/orders, a stale tab) did not.
//
// Exactly the shape `embroideryChecklistBlocks`' own header already describes one gate over:
// a grant computed from the role and a refusal computed from the row, disagreeing.
//
// ⚠️ WHAT THIS FILE MUST KEEP PINNING: suppressing the button is NOT the gate. The POST still
// refuses. Hiding a control never stops a hand-posted id — the «بانتظار موافقة الممثل»
// landmine says so in as many words — so both halves are asserted together, deliberately.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { query } = require('../lib/db');
const { getOrder, advance } = require('../controllers/productionController');

const TAG = `ZZTEST-block-${crypto.randomUUID().slice(0, 8)}`;
const fx = { users: [], students: [], wholesalers: [], orders: [], products: [] };
const ctx = {};

function mockRes() {
  const res = {
    statusCode: 200, body: null,
    status(c) { res.statusCode = c; return res; },
    json(b) { res.body = b; return res; },
  };
  return res;
}
const call = async (handler, req) => { const res = mockRes(); await handler(req, res); return res; };

test('setup', async () => {
  // deleted_at-stamped: files run concurrently and pushBroadcast.test.js counts live users.
  const mk = async (role) => {
    const r = await query(
      `INSERT INTO users (name, phone, password_hash, role, deleted_at)
       VALUES ($1,$2,'x',$3,NOW()) RETURNING id`,
      [`${TAG}-${role}`, `077${String(crypto.randomInt(0, 1e8)).padStart(8, '0')}`, role]
    );
    fx.users.push(r.rows[0].id);
    return r.rows[0].id;
  };

  const repUser = await mk('wholesaler');
  const w = await query(
    `INSERT INTO wholesalers (user_id, university_name, referral_code) VALUES ($1,$2,$3) RETURNING id`,
    [repUser, `${TAG}-uni`, `${TAG}`.slice(0, 20)]
  );
  ctx.wholesalerId = w.rows[0].id;
  fx.wholesalers.push(ctx.wholesalerId);

  // Two students: one retail (wholesaler_id NULL), one rep-linked.
  const retailUser = await mk('retail');
  const rs = await query(
    `INSERT INTO students (user_id, full_name_third, status) VALUES ($1,$2,'approved') RETURNING id`,
    [retailUser, `${TAG}-retail`]
  );
  ctx.retailStudent = rs.rows[0].id;
  fx.students.push(ctx.retailStudent);

  const repStuUser = await mk('retail');
  const ws = await query(
    `INSERT INTO students (user_id, wholesaler_id, full_name_third, status)
     VALUES ($1,$2,$3,'approved') RETURNING id`,
    [repStuUser, ctx.wholesalerId, `${TAG}-repstudent`]
  );
  ctx.repStudent = ws.rows[0].id;
  fx.students.push(ctx.repStudent);

  const p = await query(
    `INSERT INTO products (name_ar, type, base_price, active) VALUES ($1,'sash',1000,TRUE) RETURNING id`,
    [`${TAG}-sash`]
  );
  ctx.productId = p.rows[0].id;
  fx.products.push(ctx.productId);

  ctx.presser = {
    id: fx.users[0], role: 'staff', staff_type: 'presser',
    staff_types: ['presser'], order_scope: 'both',
  };
});

let seq = 0;
/**
 * An order parked at الكوي. Stays there for the life of this file (adminNumbers.test.js
 * compares two live COUNT queries and a row that MOVES between them fails it by one).
 *
 * ⚠️ A FRESH PRODUCT EVERY TIME. `uq_orders_student_product_nodesign` is a partial unique
 * index on (student, product) for orders with no design — two fixtures for one student and
 * one product collide on the second INSERT, which is not the thing under test.
 */
async function makeOrder({ studentId, returned = false, approval = 'approved' }) {
  const p = await query(
    `INSERT INTO products (name_ar, type, base_price, active) VALUES ($1,'sash',1000,TRUE) RETURNING id`,
    [`${TAG}-sash-${++seq}`]
  );
  fx.products.push(p.rows[0].id);
  ctx.productId = p.rows[0].id;
  const o = await query(
    `INSERT INTO orders (student_id, product_id, price, status, has_embroidery, needs_pressing,
                         returned_to_customer, wholesaler_approval)
     VALUES ($1,$2,1000,'pressing',TRUE,TRUE,$3,$4) RETURNING id`,
    [studentId, ctx.productId, returned, approval]
  );
  fx.orders.push(o.rows[0].id);
  return o.rows[0].id;
}

test('a RETAIL order returned to the student offers no advance, and says why', async () => {
  const id = await makeOrder({ studentId: ctx.retailStudent, returned: true });
  const res = await call(getOrder, { params: { id }, user: ctx.presser, query: {} });
  assert.equal(res.statusCode, 200);
  const a = res.body.data.available_actions;

  assert.equal(a.advance, null, 'the button that would 409 must not be offered');
  assert.ok(a.advance_block, 'and the screen has to be able to say WHY');
  assert.equal(a.advance_block.code, 'ERR_ORDER_RETURNED');
  assert.equal(a.advance_block.message, 'الطلب مُرجَع للطالب');
});

test('the POST still refuses it — hiding the button is not the gate', async () => {
  const id = await makeOrder({ studentId: ctx.retailStudent, returned: true });
  const res = await call(advance, { params: { id }, user: ctx.presser, body: {} });
  assert.equal(res.statusCode, 409, 'a hand-posted id must still be refused');
  assert.equal(res.body.code, 'ERR_ORDER_RETURNED');
});

test('a REP order still awaiting its ممثل is blocked the same way', async () => {
  const id = await makeOrder({ studentId: ctx.repStudent, approval: 'pending' });
  const res = await call(getOrder, { params: { id }, user: ctx.presser, query: {} });
  const a = res.body.data.available_actions;
  assert.equal(a.advance, null);
  assert.equal(a.advance_block.code, 'ERR_REP_APPROVAL_PENDING');
  assert.equal(a.advance_block.message, 'الطلب بانتظار موافقة الممثل');
});

test('⚠️ the rep half survives the wholesaler_id strip — it is read BEFORE the delete', async () => {
  // getOrder deletes `order.wholesaler_id` from the payload. advanceBlockReason reads
  // `order.wholesaler_id != null`, so deleting it one line too early makes the rep branch
  // silently pass and this file is the only thing that would notice.
  const id = await makeOrder({ studentId: ctx.repStudent, approval: 'pending' });
  const res = await call(getOrder, { params: { id }, user: ctx.presser, query: {} });
  assert.equal(res.body.data.order.wholesaler_id, undefined, 'the raw id stays internal');
  assert.equal(res.body.data.available_actions.advance_block.reason, 'rep_approval_pending');
});

test('a normal order is untouched — the button is offered and no reason is given', async () => {
  const id = await makeOrder({ studentId: ctx.retailStudent });
  const res = await call(getOrder, { params: { id }, user: ctx.presser, query: {} });
  const a = res.body.data.available_actions;
  assert.ok(a.advance, 'the ordinary path must not regress');
  assert.equal(a.advance.to, 'preparing');
  assert.equal(a.advance_block, null);
});

test.after(async () => {
  if (fx.orders.length) await query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [fx.orders]);
  if (fx.students.length) await query(`DELETE FROM students WHERE id = ANY($1::uuid[])`, [fx.students]);
  if (fx.wholesalers.length) await query(`DELETE FROM wholesalers WHERE id = ANY($1::uuid[])`, [fx.wholesalers]);
  if (fx.products.length) await query(`DELETE FROM products WHERE id = ANY($1::uuid[])`, [fx.products]);
  if (fx.users.length) await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [fx.users]);
});
