'use strict';
// THE ZONE CHECKLIST BELONGS TO THE EMBROIDERER — it must not be able to dam the line.
//
// Reported from the floor 2026-08-31: «there is an order قيد التطريز and برزان (المجهز) can't
// move it to the next stage — and I think it is for all staff». It was, and the shape of the
// failure is the reason this file exists:
//
//   · `can_advance` on the queue row asks canStaffTransition, which since 2026-08-31 passes
//     every line staff member on every non-design edge. So the button RENDERS.
//   · advance() then ran a second, older gate — «a non-manager may not leave التطريز while a
//     detected zone is unticked» — written when التطريز was visible only to the embroiderer,
//     where «!isManager» and «the embroiderer» were the same sentence.
//   · Only an embroiderer or a manager may TICK a zone (markEmbroideryZone), so the pressed-on
//     worker was handed a 409 with no way to satisfy it.
//
// That is precisely the dam the 2026-08-31 decision was taken to prevent (197 retail شال
// امريكي stuck at التطريز for two months). The gate now applies to the role it was written
// for, and to nobody else. Both halves are pinned below, because deleting either one is a
// plausible «simplification»: drop the first and the line jams again, drop the second and the
// embroiderer regains the «نقل للكوي» bypass around his own per-zone tracking.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { advance, advanceBulk } = require('../controllers/productionController');
const { query } = require('../lib/db');

const TAG = `ZZTEST-zonegate-${crypto.randomUUID().slice(0, 8)}`;
const fx = { users: [], students: [], orders: [], products: [] };
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
  // ⚠️ BORN `deleted_at`-STAMPED — same reason repApprovalAdvanceGate.test.js gives:
  // `node --test` runs files concurrently and pushBroadcast.test.js counts the live audience.
  const stuUser = await query(
    `INSERT INTO users (name, phone, password_hash, role, deleted_at)
     VALUES ($1,$2,'x','retail',NOW()) RETURNING id`,
    [`${TAG}-student`, `0789${Date.now() % 10000000}`]
  );
  fx.users.push(stuUser.rows[0].id);
  const s = await query(
    `INSERT INTO students (user_id, full_name_third, status)
     VALUES ($1,$2,'approved') RETURNING id`,
    [stuUser.rows[0].id, `${TAG}-student`]
  );
  ctx.studentId = s.rows[0].id;
  fx.students.push(ctx.studentId);

  // Retail (no wholesaler) so nothing but the checklist can explain a refusal, and scope
  // 'both' on every actor for the same reason.
  const st = (type) => ({
    id: fx.users[0], role: 'staff', staff_type: type, staff_types: [type], order_scope: 'both',
  });
  ctx.preparer = st('preparer');
  ctx.presser = st('presser');
  ctx.embroiderer = st('embroiderer');
});

// A fresh product per order: uq_orders_student_product_nodesign is a partial unique index on
// (student, product) for design-less live orders, so one student cannot hold two test orders
// of the same product.
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

/**
 * An order sitting at التطريز carrying ONE detected embroidery zone, unticked.
 * «تطريز الوشاح من الأمام» + customer_text is what ZONE_DEFS' sash_front matches — a label
 * with no content is not a zone at all, and the whole gate would be vacuous.
 */
async function makeEmbroideryOrder() {
  const p = await query(
    `INSERT INTO products (name_ar, type, base_price, active) VALUES ($1,'sash',1000,TRUE) RETURNING id`,
    [`${TAG}-sash-${++seq}`]
  );
  fx.products.push(p.rows[0].id);
  const o = await query(
    `INSERT INTO orders (student_id, product_id, price, status, has_embroidery, needs_pressing)
     VALUES ($1,$2,1000,'embroidery',TRUE,TRUE) RETURNING id`,
    [ctx.studentId, p.rows[0].id]
  );
  const id = o.rows[0].id;
  fx.orders.push(id);
  await query(
    `INSERT INTO order_items (order_id, label_snapshot, customer_text)
     VALUES ($1,'تطريز الوشاح من الأمام',$2)`,
    [id, `${TAG}`]
  );
  return id;
}

test('THE BUG — المجهز may push a piece out of التطريز even with an unticked zone', async () => {
  const id = await makeEmbroideryOrder();
  const res = await call(advance, { params: { id }, user: ctx.preparer });
  assert.equal(res.statusCode, 200, 'برزان must not be blocked by someone else’s checklist');
  const after = await query(`SELECT status::text AS s FROM orders WHERE id=$1`, [id]);
  assert.equal(after.rows[0].s, 'pressing');
  // ⚠️ Retired HERE, not in cleanup — this is the row that MOVES, and adminNumbers.test.js
  // compares two live COUNT queries that a moving fixture straddles. Same rule (and same
  // measurement) as repApprovalAdvanceGate.test.js.
  await retire(id);
});

test('…and so may المكوجي — the gate is not «anyone but a manager»', async () => {
  const id = await makeEmbroideryOrder();
  const res = await call(advance, { params: { id }, user: ctx.presser });
  assert.equal(res.statusCode, 200);
  await retire(id);
});

test('the EMBROIDERER is still held to his own checklist', async () => {
  const id = await makeEmbroideryOrder();
  const res = await call(advance, { params: { id }, user: ctx.embroiderer });
  assert.equal(res.statusCode, 409, 'the «نقل للكوي» bypass must stay closed for him');
  assert.equal(res.body.code, 'ERR_EMBROIDERY_ZONES_INCOMPLETE');
  const after = await query(`SELECT status::text AS s FROM orders WHERE id=$1`, [id]);
  assert.equal(after.rows[0].s, 'embroidery');
  await retire(id);
});

test('the embroiderer advances normally once every zone is ticked', async () => {
  const id = await makeEmbroideryOrder();
  await query(
    `UPDATE orders SET embroidery_zones = '{"sash_front":true}'::jsonb WHERE id = $1`,
    [id]
  );
  const res = await call(advance, { params: { id }, user: ctx.embroiderer });
  assert.equal(res.statusCode, 200);
  await retire(id);
});

test('advanceBulk carries the SAME split — one door, not two', async () => {
  const forPreparer = await makeEmbroideryOrder();
  const r1 = await call(advanceBulk, { body: { ids: [forPreparer] }, user: ctx.preparer });
  assert.equal(r1.body.data.advanced, 1, 'المجهز must not be silently skipped in bulk either');
  await retire(forPreparer);

  const forEmbroiderer = await makeEmbroideryOrder();
  const r2 = await call(advanceBulk, { body: { ids: [forEmbroiderer] }, user: ctx.embroiderer });
  assert.equal(r2.body.data.advanced, 0);
  assert.equal(r2.body.data.results[0].reason, 'embroidery_zones_incomplete');
  await retire(forEmbroiderer);
});

test('cleanup', async () => {
  if (fx.orders.length) {
    await query(`DELETE FROM order_items WHERE order_id = ANY($1)`, [fx.orders]);
    await query(`DELETE FROM staff_activity_log WHERE order_id = ANY($1)`, [fx.orders]);
    await query(`DELETE FROM audit_log WHERE entity_id = ANY($1)`, [fx.orders]);
    await query(`DELETE FROM orders WHERE id = ANY($1)`, [fx.orders]);
  }
  if (fx.users.length) await query(`DELETE FROM notifications WHERE user_id = ANY($1)`, [fx.users]);
  if (fx.students.length) await query(`DELETE FROM students WHERE id = ANY($1)`, [fx.students]);
  if (fx.users.length) await query(`DELETE FROM users WHERE id = ANY($1)`, [fx.users]);
  if (fx.products.length) await query(`DELETE FROM products WHERE id = ANY($1)`, [fx.products]);
});
