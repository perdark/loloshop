'use strict';
// The retail "configure" endpoints must NOT destroy the designer's calligraphy plate, and
// must NOT resurrect a cancelled order — 2026-08-15.
//
// `lib/platePreservation.js` (2026-08-14, commit 465b2ef) already closed the plate-loss half
// of this for `configureOrder` / `configurePackage` / `configureFullSet`: every rebuild
// captures `order_items.plate_image_url` before the `DELETE FROM order_items` and restores it
// by label on the re-INSERT. `plateSurvivesReconfigure.test.js` guards that STRUCTURALLY (every
// INSERT after a full DELETE must carry the column) and `fullSetPlateSurvival.test.js` proves it
// BEHAVIOURALLY for `lib/fullSetOrder.js`'s rep-linked طقم path. Neither drives the actual
// `orderController.configureOrder` / `configureFullSet` functions used by a RETAIL (no-rep)
// student against a real database — this file is that missing behavioural coverage.
//
// The second half is the STATUS guard `configurePackage` and `configureFullSet` already carry
// on their "find the existing order to update" query (`AND status <> 'cancelled'`), matching
// `uq_orders_student_product_nodesign`'s own partial-index definition. `configureOrder`'s
// equivalent query had NO such filter — with no ORDER BY/LIMIT either — so if a student's piece
// for a product had been cancelled (by staff, or a prior duplicate cleanup) and the student
// reconfigured that SAME product, the code could silently match the CANCELLED row and revive it
// instead of starting a fresh order the way every sibling "configure" endpoint does. Fixed in
// the same commit as this test by adding the identical `status <> 'cancelled'` guard.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { configureOrder, configureFullSet } = require('../controllers/orderController');
const { query } = require('../lib/db');

const TAG = `ZZTEST-plateguard-${crypto.randomUUID().slice(0, 8)}`;
const fx = { products: [], users: [], students: [], groups: [], packages: [] };
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

const newPhone = () => `079${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

async function insertProduct({ name, type, price = 30000 }) {
  const { rows } = await query(
    `INSERT INTO products (name_ar, type, base_price, sort) VALUES ($1, $2::product_type, $3, 0) RETURNING id`,
    [`${TAG} ${name}`, type, price]
  );
  fx.products.push(rows[0].id);
  await query(
    `INSERT INTO product_price_roles (product_id, role, base_price) VALUES ($1, 'retail', $2)`,
    [rows[0].id, price]
  );
  return rows[0].id;
}

async function insertRetailStudent(name) {
  const u = await query(
    `INSERT INTO users (name, phone, password_hash, role) VALUES ($1, $2, 'x', 'retail') RETURNING id`,
    [`${TAG} ${name}`, newPhone()]
  );
  fx.users.push(u.rows[0].id);
  const s = await query(
    `INSERT INTO students (user_id, full_name_third, status, wholesaler_id, gender)
     VALUES ($1, $2, 'approved', NULL, 'male') RETURNING id`,
    [u.rows[0].id, `${TAG} ${name}`]
  );
  fx.students.push(s.rows[0].id);
  return { studentId: s.rows[0].id, userId: u.rows[0].id };
}

test.before(async () => {
  ctx.sash = await insertProduct({ name: 'وشاح', type: 'sash', price: 30000 });

  const g = await query(
    `INSERT INTO option_groups (product_id, name_ar, required, requires_customer_image)
     VALUES ($1, $2, FALSE, TRUE) RETURNING id`,
    [ctx.sash, `${TAG} صورة مرجعية`]
  );
  ctx.group = g.rows[0].id;
  fx.groups.push(ctx.group);
  const o = await query(
    `INSERT INTO options (group_id, label_ar, price_delta, requires_customer_image)
     VALUES ($1, 'مثلث', 5000, TRUE) RETURNING id`,
    [ctx.group]
  );
  ctx.option = o.rows[0].id;

  const retail = await insertRetailStudent('طالب تجزئة');
  ctx.studentId = retail.studentId;
  ctx.userId = retail.userId;
  ctx.req = { id: ctx.userId, role: 'retail' };
});

test.after(async () => {
  const cg = await query(
    `SELECT DISTINCT checkout_group_id AS id FROM orders
      WHERE student_id = ANY($1::uuid[]) AND checkout_group_id IS NOT NULL`,
    [fx.students]
  );
  await query(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE student_id = ANY($1::uuid[]))`, [fx.students]);
  await query(`DELETE FROM orders WHERE student_id = ANY($1::uuid[])`, [fx.students]);
  if (cg.rows.length) {
    await query(`DELETE FROM checkout_groups WHERE id = ANY($1::uuid[])`, [cg.rows.map((r) => r.id)]);
  }
  await query(`DELETE FROM students WHERE id = ANY($1::uuid[])`, [fx.students]);
  await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [fx.users]);
  await query(`DELETE FROM options WHERE group_id = ANY($1::uuid[])`, [fx.groups]);
  await query(`DELETE FROM option_groups WHERE id = ANY($1::uuid[])`, [fx.groups]);
  await query(`DELETE FROM package_products WHERE package_id = ANY($1::uuid[])`, [fx.packages]);
  await query(`DELETE FROM packages WHERE id = ANY($1::uuid[])`, [fx.packages]);
  await query(`DELETE FROM product_price_roles WHERE product_id = ANY($1::uuid[])`, [fx.products]);
  await query(`DELETE FROM products WHERE id = ANY($1::uuid[])`, [fx.products]);

  const left = await query(`SELECT count(*)::int n FROM students WHERE full_name_third LIKE $1`, [`${TAG}%`]);
  assert.strictEqual(left.rows[0].n, 0, 'fixture rows left behind');
});

const IMAGE_URL = 'http://localhost:4000/uploads/images/zztest-customer-photo.jpg';
const PLATE_URL = 'http://localhost:4000/uploads/calligraphy/plates/zztest-plate.png';
const ITEM_LABEL = `${TAG} صورة مرجعية: مثلث`;

function selectionsBody() {
  return {
    product_id: ctx.sash,
    selections: [{ group_id: ctx.group, option_id: ctx.option, customer_image_url: IMAGE_URL }],
  };
}

// ────────────────── configureOrder: plate + customer image survive a re-save ──────────────

test('configureOrder: a re-save preserves BOTH the generated plate and the customer photo', async () => {
  const created = await call(configureOrder, { body: selectionsBody(), user: ctx.req });
  assert.strictEqual(created.statusCode, 201, JSON.stringify(created.body));
  ctx.orderId = created.body.data.order_id;

  // The calligraphy generator links a plate onto the image line — server-side, never in the payload.
  const linked = await query(
    `UPDATE order_items SET plate_image_url = $1 WHERE order_id = $2 AND label_snapshot = $3`,
    [PLATE_URL, ctx.orderId, ITEM_LABEL]
  );
  assert.strictEqual(linked.rowCount, 1, 'fixture: exactly one line should take the plate');

  // The student resubmits the SAME configuration (a no-op re-save — the weakest possible edit).
  const resaved = await call(configureOrder, { body: selectionsBody(), user: ctx.req });
  assert.strictEqual(resaved.statusCode, 201, JSON.stringify(resaved.body));
  assert.strictEqual(resaved.body.data.order_id, ctx.orderId, 'the SAME order must be updated, not a new one');

  const after = await query(
    `SELECT plate_image_url, customer_image_url FROM order_items WHERE order_id = $1 AND label_snapshot = $2`,
    [ctx.orderId, ITEM_LABEL]
  );
  assert.strictEqual(after.rows.length, 1);
  assert.strictEqual(after.rows[0].plate_image_url, PLATE_URL, 'the plate was destroyed by the re-save');
  assert.strictEqual(after.rows[0].customer_image_url, IMAGE_URL, 'the customer photo was destroyed by the re-save');
});

test('configureOrder: the plate does not leak onto a sibling line', async () => {
  const rows = await query(
    `SELECT count(*)::int n FROM order_items
      WHERE order_id = $1 AND plate_image_url IS NOT NULL AND label_snapshot <> $2`,
    [ctx.orderId, ITEM_LABEL]
  );
  assert.strictEqual(rows.rows[0].n, 0, 'a plate leaked onto a line that never had one');
});

// ────────────────── configureOrder: the missing status guard ──────────────────────────────

test('configureOrder: a cancelled order is NOT revived — a fresh order is created instead', async () => {
  const cancelledOrderId = ctx.orderId;
  await query(`UPDATE orders SET status = 'cancelled' WHERE id = $1`, [cancelledOrderId]);

  const res = await call(configureOrder, { body: selectionsBody(), user: ctx.req });
  assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));
  const newOrderId = res.body.data.order_id;

  assert.notStrictEqual(
    newOrderId, cancelledOrderId,
    'reconfiguring must not resurrect a cancelled order — it must start a fresh one, like configurePackage/configureFullSet do'
  );

  const old = await query(`SELECT status::text AS status FROM orders WHERE id = $1`, [cancelledOrderId]);
  assert.strictEqual(old.rows[0].status, 'cancelled', 'the cancelled order must stay cancelled, untouched');

  // The plate the fixture set earlier belongs to the OLD, now-abandoned order — it must NOT be
  // resurrected onto the fresh order (that would be attaching someone else's artwork).
  const oldItem = await query(
    `SELECT plate_image_url FROM order_items WHERE order_id = $1 AND label_snapshot = $2`,
    [cancelledOrderId, ITEM_LABEL]
  );
  assert.strictEqual(oldItem.rows[0].plate_image_url, PLATE_URL, 'the old order keeps its own history untouched');

  const newItem = await query(
    `SELECT plate_image_url, customer_image_url FROM order_items WHERE order_id = $1 AND label_snapshot = $2`,
    [newOrderId, ITEM_LABEL]
  );
  assert.strictEqual(newItem.rows[0].plate_image_url, null, 'a fresh order must not inherit a stale plate');
  assert.strictEqual(newItem.rows[0].customer_image_url, IMAGE_URL, 'the fresh order still carries what the client sent');

  ctx.liveOrderId = newOrderId;
});

test('configureOrder: reconfiguring again updates the NEW live order, not the cancelled one', async () => {
  const res = await call(configureOrder, { body: selectionsBody(), user: ctx.req });
  assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));
  assert.strictEqual(res.body.data.order_id, ctx.liveOrderId, 'must keep updating the live order');
});

// ────────────────── configureFullSet: plate survives a full-set re-save ───────────────────

async function insertFullSetProducts() {
  ctx.fsSash = await insertProduct({ name: 'طقم وشاح', type: 'sash', price: 0 });
  ctx.fsRobe = await insertProduct({ name: 'طقم روب', type: 'robe', price: 0 });
  ctx.fsCap = await insertProduct({ name: 'طقم قبعة', type: 'cap', price: 0 });
  const pkg = await query(
    `INSERT INTO packages (name_ar, role, price, is_full_set, active)
     VALUES ($1, 'retail', 60000, TRUE, TRUE) RETURNING id`,
    [`${TAG} طقم كامل`]
  );
  ctx.packageId = pkg.rows[0].id;
  fx.packages.push(ctx.packageId);
  for (const pid of [ctx.fsSash, ctx.fsRobe, ctx.fsCap]) {
    await query(`INSERT INTO package_products (package_id, product_id) VALUES ($1, $2)`, [ctx.packageId, pid]);
  }
}

function fullSetBody() {
  return {
    package_id: ctx.packageId,
    delivery: {
      customer_name: `${TAG} خريج`,
      phone_primary: newPhone(),
      governorate: 'ديالى',
    },
    robe: { measurements: { shoulder_cm: 45, robe_length_cm: 120, sleeve_length_cm: 60 }, selections: [] },
    cap: { selections: [] },
    sash: { zones: { right_text: 'محمد باقر' }, selections: [] },
  };
}

const ZONE_LABEL = 'الجهة اليمنى — اسم الخريج';

test('configureFullSet: a re-save preserves the generated calligraphy plate', async () => {
  await insertFullSetProducts();

  const created = await call(configureFullSet, { body: fullSetBody(), user: ctx.req });
  assert.strictEqual(created.statusCode, 201, JSON.stringify(created.body));
  ctx.sashOrderId = created.body.data.orders.sash;

  const linked = await query(
    `UPDATE order_items SET plate_image_url = $1 WHERE order_id = $2 AND label_snapshot = $3`,
    [PLATE_URL, ctx.sashOrderId, ZONE_LABEL]
  );
  assert.strictEqual(linked.rowCount, 1, 'fixture: exactly one zone line should take the plate');

  const resaved = await call(configureFullSet, { body: fullSetBody(), user: ctx.req });
  assert.strictEqual(resaved.statusCode, 201, JSON.stringify(resaved.body));
  assert.strictEqual(resaved.body.data.orders.sash, ctx.sashOrderId, 'the SAME sash order must be reused');

  const after = await query(
    `SELECT plate_image_url FROM order_items WHERE order_id = $1 AND label_snapshot = $2`,
    [ctx.sashOrderId, ZONE_LABEL]
  );
  assert.strictEqual(after.rows.length, 1);
  assert.strictEqual(after.rows[0].plate_image_url, PLATE_URL, 'the plate was destroyed by the طقم re-save');
});
