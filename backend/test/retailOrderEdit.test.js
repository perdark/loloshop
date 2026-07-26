'use strict';
// Retail order editor — pure-logic tests + live-DB tests for the product swap, the
// keyed order_items reconciliation (calligraphy-plate survival) and the تجزئة
// «طلب مخصص» creation path.
//
// The DB half runs against the LAPTOP-LOCAL dev PG (:5433) and is fully self-cleaning:
// every row it creates is removed in `after`, which then asserts 0 leftovers.
// It builds its OWN products/students instead of reading the catalog, so nothing here
// depends on data that exists only in this drifted snapshot.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const {
  normalizeRetailMeasurements,
  comparableSelections,
  comparableStoredSelections,
  familyKey,
  editContext,
  saveRetailConfiguration,
  studentsSearch,
  getStudentFullSet,
  createRetailOrder,
  createRetailOrders,
} = require('../controllers/orderEditController');
const { validateRobeMeasurements } = require('../controllers/orderController');
const { query } = require('../lib/db');

// ─────────────────────────── pure logic (no DB) ────────────────────────────

test('retail robe editor uses the same required measurement rules as checkout', () => {
  assert.match(validateRobeMeasurements('robe', {}), /قياسات الروب/);
  assert.strictEqual(validateRobeMeasurements('robe', {
    shoulder_cm: 45,
    robe_length_cm: 120,
    sleeve_length_cm: 60,
  }), null);
  assert.match(validateRobeMeasurements('robe', {
    shoulder_cm: 45,
    chest_cm: 40,
    robe_length_cm: 120,
    sleeve_length_cm: 60,
  }), /60 و 180/);
  assert.strictEqual(validateRobeMeasurements('cap', null), null);
});

test('normalises optional robe fields without turning blank chest into zero', () => {
  assert.deepStrictEqual(normalizeRetailMeasurements('robe', {
    shoulder_cm: '45',
    chest_cm: '',
    robe_length_cm: '120',
    sleeve_length_cm: '60',
    tailor_notes: '  توسيع الصدر  ',
    receipt_image_url: ' /uploads/images/a.jpg ',
  }), {
    shoulder_cm: 45,
    chest_cm: null,
    robe_length_cm: 120,
    sleeve_length_cm: 60,
    tailor_notes: 'توسيع الصدر',
    receipt_image_url: '/uploads/images/a.jpg',
  });
  assert.strictEqual(normalizeRetailMeasurements('cap', {}), null);
});

test('selection comparison includes option, quantity, text and replacement image', () => {
  const normalized = comparableSelections([
    {
      group_id: 'b',
      option_id: '2',
      qty: 2,
      customer_text: '  اسم  ',
      customer_image_url: ' /new.jpg ',
    },
    { group_id: 'a', option_id: '1', qty: 1 },
  ]);
  assert.deepStrictEqual(normalized, [
    {
      group_id: 'a',
      option_id: '1',
      qty: 1,
      customer_text: null,
      customer_image_url: null,
    },
    {
      group_id: 'b',
      option_id: '2',
      qty: 2,
      customer_text: 'اسم',
      customer_image_url: '/new.jpg',
    },
  ]);
});

test('saved cart quantities are compared at their per-piece value', () => {
  assert.deepStrictEqual(comparableStoredSelections([
    { group_id: 'a', option_id: '1', qty: 3 },
    { group_id: 'b', option_id: '2', qty: 6 },
  ], 3), [
    {
      group_id: 'a',
      option_id: '1',
      qty: 1,
      customer_text: null,
      customer_image_url: null,
    },
    {
      group_id: 'b',
      option_id: '2',
      qty: 2,
      customer_text: null,
      customer_image_url: null,
    },
  ]);
});

test('family key folds a child onto its parent and leaves a root alone', () => {
  assert.strictEqual(familyKey({ id: 'child', parent_id: 'root' }), 'root');
  assert.strictEqual(familyKey({ id: 'root', parent_id: null }), 'root');
});

// ─────────────────────── live-DB fixture (self-cleaning) ───────────────────

const TAG = `ZZTEST-${crypto.randomUUID().slice(0, 8)}`;
const fx = { products: [], users: [], students: [], wholesalers: [], plates: [], groups: [] };

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    headersSent: false,
    status(code) { res.statusCode = code; return res; },
    json(body) { res.body = body; res.headersSent = true; return res; },
  };
  return res;
}

async function call(handler, req) {
  const res = mockRes();
  await handler(req, res);
  return res;
}

async function insertProduct({ name, type, parentId = null, active = true, price, retailPrice }) {
  const { rows } = await query(
    `INSERT INTO products (name_ar, type, parent_id, active, base_price, sort)
     VALUES ($1, $2::product_type, $3, $4, $5, 0) RETURNING id`,
    [`${TAG} ${name}`, type, parentId, active, price]
  );
  const id = rows[0].id;
  fx.products.push(id);
  if (retailPrice != null) {
    await query(
      `INSERT INTO product_price_roles (product_id, role, base_price)
       VALUES ($1, 'retail', $2)`,
      [id, retailPrice]
    );
  }
  return id;
}

async function insertStudent({ name, phone, wholesalerId = null }) {
  const u = await query(
    `INSERT INTO users (name, phone, password_hash, role)
     VALUES ($1, $2, 'x', 'retail') RETURNING id`,
    [`${TAG} ${name}`, phone]
  );
  fx.users.push(u.rows[0].id);
  const s = await query(
    `INSERT INTO students (user_id, full_name_third, status, wholesaler_id)
     VALUES ($1, $2, 'approved', $3) RETURNING id`,
    [u.rows[0].id, `${TAG} ${name}`, wholesalerId]
  );
  fx.students.push(s.rows[0].id);
  return { studentId: s.rows[0].id, userId: u.rows[0].id };
}

// A saved retail piece, written exactly the way the retail creation path writes one.
async function insertOrder({ studentId, productId, status, price, items }) {
  const o = await query(
    `INSERT INTO orders (student_id, product_id, price, status, has_embroidery, needs_pressing)
     VALUES ($1, $2, $3, $4::order_status, TRUE, TRUE) RETURNING id`,
    [studentId, productId, price, status]
  );
  const orderId = o.rows[0].id;
  const ids = [];
  for (const it of items) {
    const r = await query(
      `INSERT INTO order_items
         (order_id, group_id, option_id, label_snapshot, price_snapshot, admin_price_snapshot,
          qty, customer_text)
       VALUES ($1, $2, $3, $4, $5, 0, 1, $6) RETURNING id`,
      [orderId, it.group_id || null, it.option_id || null, it.label, it.price, it.text || null]
    );
    ids.push(r.rows[0].id);
  }
  return { orderId, itemIds: ids };
}

const ctx = {};

test.before(async () => {
  // Catalog family: parent + two live siblings, one inactive sibling, one cross-type
  // child (same parent, different `type` — isolates the type guard from the family guard)
  // and a completely separate family.
  ctx.parentSash = await insertProduct({ name: 'وشاح', type: 'sash', price: 30000, retailPrice: 30000 });
  ctx.childA = await insertProduct({ name: 'وشاح الفراشة', type: 'sash', parentId: ctx.parentSash, price: 30000, retailPrice: 30000 });
  ctx.childB = await insertProduct({ name: 'وشاح ملكي', type: 'sash', parentId: ctx.parentSash, price: 28000, retailPrice: 25000 });
  ctx.childInactive = await insertProduct({ name: 'وشاح موقوف', type: 'sash', parentId: ctx.parentSash, active: false, price: 30000 });
  ctx.childCap = await insertProduct({ name: 'قبعة داخل عائلة الوشاح', type: 'cap', parentId: ctx.parentSash, price: 20000, retailPrice: 20000 });
  ctx.otherParent = await insertProduct({ name: 'وشاح عائلة ثانية', type: 'sash', price: 40000, retailPrice: 40000 });
  ctx.otherChild = await insertProduct({ name: 'وشاح عائلة ثانية ٢', type: 'sash', parentId: ctx.otherParent, price: 40000, retailPrice: 40000 });

  // Option groups live on the PARENT only — that is exactly why a same-family swap is safe.
  const gColor = await query(
    `INSERT INTO option_groups (product_id, name_ar, required) VALUES ($1, $2, FALSE) RETURNING id`,
    [ctx.parentSash, `${TAG} لون التطريز`]
  );
  ctx.groupColor = gColor.rows[0].id;
  fx.groups.push(ctx.groupColor);
  const gText = await query(
    `INSERT INTO option_groups (product_id, name_ar, required, requires_customer_text)
     VALUES ($1, $2, FALSE, TRUE) RETURNING id`,
    [ctx.parentSash, `${TAG} تطريز يمين`]
  );
  ctx.groupText = gText.rows[0].id;
  fx.groups.push(ctx.groupText);

  const oGold = await query(
    `INSERT INTO options (group_id, label_ar, price_delta) VALUES ($1, 'ذهبي', 5000) RETURNING id`,
    [ctx.groupColor]
  );
  ctx.optGold = oGold.rows[0].id;
  const oText = await query(
    `INSERT INTO options (group_id, label_ar, price_delta) VALUES ($1, 'كتابة', 0) RETURNING id`,
    [ctx.groupText]
  );
  ctx.optText = oText.rows[0].id;

  // People.
  const admin = await query(
    `INSERT INTO users (name, phone, password_hash, role) VALUES ($1, $2, 'x', 'admin') RETURNING id`,
    [`${TAG} مدير`, `0770${Math.floor(Math.random() * 10000000)}`]
  );
  ctx.actorId = admin.rows[0].id;
  fx.users.push(ctx.actorId);

  const retail = await insertStudent({ name: 'طالب تجزئة', phone: '07999000001' });
  ctx.retailStudentId = retail.studentId;

  const nameOnly = await insertStudent({ name: 'طالب بالاسم فقط', phone: null });
  ctx.nameOnlyStudentId = nameOnly.studentId;

  const repUser = await query(
    `INSERT INTO users (name, phone, password_hash, role) VALUES ($1, $2, 'x', 'wholesaler') RETURNING id`,
    [`${TAG} ممثل`, `0771${Math.floor(Math.random() * 10000000)}`]
  );
  fx.users.push(repUser.rows[0].id);
  const w = await query(
    `INSERT INTO wholesalers (user_id, referral_code) VALUES ($1, $2) RETURNING id`,
    [repUser.rows[0].id, `${TAG}-REF`]
  );
  ctx.wholesalerId = w.rows[0].id;
  fx.wholesalers.push(ctx.wholesalerId);
  const repStudent = await insertStudent({ name: 'طالب ممثل', phone: '07999000002', wholesalerId: ctx.wholesalerId });
  ctx.repStudentId = repStudent.studentId;

  // The piece under test: 30,000 base + 5,000 ذهبي = 35,000, already at التطريز so the
  // «a swap must not force rework» rule is actually exercised.
  const order = await insertOrder({
    studentId: ctx.retailStudentId,
    productId: ctx.childA,
    status: 'embroidery',
    price: 35000,
    items: [
      { label: 'السعر الأساسي', price: 30000 },
      { group_id: ctx.groupColor, option_id: ctx.optGold, label: 'لون التطريز: ذهبي', price: 5000 },
      { group_id: ctx.groupText, option_id: ctx.optText, label: 'تطريز يمين: كتابة', price: 0, text: 'اسم الخريج' },
    ],
  });
  ctx.orderId = order.orderId;
  ctx.itemIds = order.itemIds;
  ctx.textItemId = order.itemIds[2];

  // A generated calligraphy plate pinned to the typed line — the row today's DELETE-ALL
  // save silently orphans.
  const plate = await query(
    `INSERT INTO calligraphy_plates (job_id, source, render_text, order_item_id, student_id, status)
     VALUES ($1, 'retail', 'اسم الخريج', $2, $3, 'done') RETURNING id`,
    [crypto.randomUUID(), ctx.textItemId, ctx.retailStudentId]
  );
  ctx.plateId = plate.rows[0].id;
  fx.plates.push(ctx.plateId);

  // A rep-linked piece, to prove the retail editor keeps 403ing on bundles.
  const repOrder = await insertOrder({
    studentId: ctx.repStudentId,
    productId: ctx.childA,
    status: 'embroidery',
    price: 35000,
    items: [{ label: 'السعر الأساسي', price: 30000 }],
  });
  ctx.repOrderId = repOrder.orderId;
});

test.after(async () => {
  // Collect every checkout_group the code under test created before the orders go.
  const cg = await query(
    `SELECT DISTINCT checkout_group_id AS id FROM orders
      WHERE student_id = ANY($1::uuid[]) AND checkout_group_id IS NOT NULL`,
    [fx.students]
  );
  await query(`DELETE FROM calligraphy_plates WHERE id = ANY($1::uuid[])`, [fx.plates]);
  await query(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [fx.users]);
  await query(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE student_id = ANY($1::uuid[]))`, [fx.students]);
  await query(`DELETE FROM orders WHERE student_id = ANY($1::uuid[])`, [fx.students]);
  await query(`DELETE FROM checkout_groups WHERE id = ANY($1::uuid[])`, [cg.rows.map((r) => r.id)]);
  await query(`DELETE FROM students WHERE id = ANY($1::uuid[])`, [fx.students]);
  await query(`DELETE FROM wholesalers WHERE id = ANY($1::uuid[])`, [fx.wholesalers]);
  await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [fx.users]);
  await query(`DELETE FROM options WHERE group_id = ANY($1::uuid[])`, [fx.groups]);
  await query(`DELETE FROM option_groups WHERE id = ANY($1::uuid[])`, [fx.groups]);
  await query(`DELETE FROM product_price_roles WHERE product_id = ANY($1::uuid[])`, [fx.products]);
  await query(`DELETE FROM products WHERE id = ANY($1::uuid[])`, [fx.products]);

  // 0 leftovers, or the run is not clean.
  const leftovers = await query(
    `SELECT
       (SELECT COUNT(*) FROM products WHERE name_ar LIKE $1) AS products,
       (SELECT COUNT(*) FROM users WHERE name LIKE $1) AS users,
       (SELECT COUNT(*) FROM students WHERE full_name_third LIKE $1) AS students,
       (SELECT COUNT(*) FROM option_groups WHERE name_ar LIKE $1) AS groups,
       (SELECT COUNT(*) FROM orders WHERE student_id = ANY($2::uuid[])) AS orders,
       (SELECT COUNT(*) FROM calligraphy_plates WHERE id = ANY($3::uuid[])) AS plates,
       (SELECT COUNT(*) FROM audit_log WHERE actor_id = ANY($4::uuid[])) AS audits`,
    [`${TAG}%`, fx.students, fx.plates, fx.users]
  );
  for (const [k, v] of Object.entries(leftovers.rows[0])) {
    assert.strictEqual(Number(v), 0, `left ${v} ${k} rows behind`);
  }
});

const baseSelections = () => [
  { group_id: ctx.groupColor, option_id: ctx.optGold },
  { group_id: ctx.groupText, option_id: ctx.optText, customer_text: 'اسم الخريج' },
];

const saveReq = (body) => ({
  params: { id: ctx.orderId },
  body: { selections: baseSelections(), ...body },
  user: { id: ctx.actorId },
});

// ─────────────────────────── FEATURE 1: product swap ───────────────────────

test('edit-context offers only live same-family siblings as swap candidates', async () => {
  const res = await call(editContext, { params: { id: ctx.orderId }, user: { id: ctx.actorId } });
  assert.strictEqual(res.statusCode, 200);
  const retail = res.body.data.retail_order;
  assert.ok(retail, 'retail snapshot missing');
  const ids = retail.swap_candidates.map((c) => c.id);
  assert.ok(ids.includes(ctx.childB), 'live sibling missing');
  assert.ok(ids.includes(ctx.parentSash), 'family root is a valid target');
  assert.ok(!ids.includes(ctx.childA), 'current product must not be offered');
  assert.ok(!ids.includes(ctx.childInactive), 'inactive sibling must not be offered');
  assert.ok(!ids.includes(ctx.otherChild), 'other family must not be offered');
  assert.ok(!ids.includes(ctx.childCap), 'other type must not be offered');
  const royal = retail.swap_candidates.find((c) => c.id === ctx.childB);
  assert.strictEqual(royal.retail_price, 25000, 'retail role price must win over products.base_price');
});

test('same-family swap carries the selections across and moves the price', async () => {
  const before = await query(
    `SELECT id, group_id, option_id, customer_text FROM order_items WHERE order_id = $1 ORDER BY id`,
    [ctx.orderId]
  );
  const res = await call(saveRetailConfiguration, saveReq({ product_id: ctx.childB }));
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  const d = res.body.data;
  assert.strictEqual(d.product_changed, true);
  assert.strictEqual(d.product_id, ctx.childB);
  assert.strictEqual(d.old_price, 35000);
  assert.strictEqual(d.new_price, 30000); // 25,000 ملكي + 5,000 ذهبي
  assert.strictEqual(d.price_difference, -5000);
  assert.strictEqual(d.price_applied, 30000);
  assert.strictEqual(d.price_kept, false);
  // A swap alone must NEVER force design rework.
  assert.strictEqual(d.design_rework, false);
  assert.strictEqual(d.status, 'embroidery');

  const o = await query(`SELECT product_id, price, status::text AS status FROM orders WHERE id = $1`, [ctx.orderId]);
  assert.strictEqual(o.rows[0].product_id, ctx.childB);
  assert.strictEqual(Number(o.rows[0].price), 30000);
  assert.strictEqual(o.rows[0].status, 'embroidery');

  // The student's saved selections (and their row identities) survived verbatim.
  const after = await query(
    `SELECT id, group_id, option_id, customer_text FROM order_items WHERE order_id = $1 ORDER BY id`,
    [ctx.orderId]
  );
  assert.deepStrictEqual(after.rows, before.rows);
});

test('keep_price freezes orders.price while still reporting the difference', async () => {
  const res = await call(saveRetailConfiguration, saveReq({ product_id: ctx.childA, keep_price: true }));
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  const d = res.body.data;
  assert.strictEqual(d.product_changed, true);
  assert.strictEqual(d.old_price, 30000);
  assert.strictEqual(d.new_price, 35000);
  assert.strictEqual(d.price_difference, 5000);
  assert.strictEqual(d.price_applied, 30000);
  assert.strictEqual(d.price_kept, true);

  const o = await query(`SELECT product_id, price FROM orders WHERE id = $1`, [ctx.orderId]);
  assert.strictEqual(o.rows[0].product_id, ctx.childA, 'the product still moves');
  assert.strictEqual(Number(o.rows[0].price), 30000, 'the money did not');
});

test('a swap to a different family is refused', async () => {
  const res = await call(saveRetailConfiguration, saveReq({ product_id: ctx.otherChild }));
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.code, 'ERR_PRODUCT_FAMILY_MISMATCH');
  assert.match(res.body.error, /نفس العائلة/);
});

test('a swap to a different product type is refused', async () => {
  const res = await call(saveRetailConfiguration, saveReq({ product_id: ctx.childCap }));
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.code, 'ERR_PRODUCT_TYPE_MISMATCH');
});

test('a swap to an inactive product is refused', async () => {
  const res = await call(saveRetailConfiguration, saveReq({ product_id: ctx.childInactive }));
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.code, 'ERR_PRODUCT_INACTIVE');
});

test('a swap to a product that does not exist is refused', async () => {
  const res = await call(saveRetailConfiguration, saveReq({ product_id: crypto.randomUUID() }));
  assert.strictEqual(res.statusCode, 404);
  assert.strictEqual(res.body.code, 'ERR_NOT_FOUND');
});

test('none of the refused swaps touched the order', async () => {
  const o = await query(`SELECT product_id, price FROM orders WHERE id = $1`, [ctx.orderId]);
  assert.strictEqual(o.rows[0].product_id, ctx.childA);
  assert.strictEqual(Number(o.rows[0].price), 30000);
});

test('the retail editor still 403s on a rep-linked order', async () => {
  const res = await call(saveRetailConfiguration, {
    params: { id: ctx.repOrderId },
    body: { selections: [], product_id: ctx.childB },
    user: { id: ctx.actorId },
  });
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.code, 'ERR_FORBIDDEN');
  const o = await query(`SELECT product_id FROM orders WHERE id = $1`, [ctx.repOrderId]);
  assert.strictEqual(o.rows[0].product_id, ctx.childA, 'rep bundle untouched');
});

// ────────── the data-loss bug: plates must survive an order_items save ─────

test('a calligraphy plate linked to an order item SURVIVES a save', async () => {
  // Three saves have already run above (two swaps + the refused ones). On the old
  // DELETE-ALL + re-INSERT code order_item_id would be NULL by now, unrecoverably.
  const p = await query(`SELECT order_item_id FROM calligraphy_plates WHERE id = $1`, [ctx.plateId]);
  assert.strictEqual(p.rows[0].order_item_id, ctx.textItemId, 'plate was orphaned by the save');
  const it = await query(`SELECT order_id, customer_text FROM order_items WHERE id = $1`, [ctx.textItemId]);
  assert.strictEqual(it.rows[0].order_id, ctx.orderId);
  assert.strictEqual(it.rows[0].customer_text, 'اسم الخريج');
});

test('removed selections are deleted and new ones inserted, without touching the rest', async () => {
  const before = await query(
    `SELECT id FROM order_items WHERE order_id = $1 AND group_id = $2`,
    [ctx.orderId, ctx.groupText]
  );
  // Drop the colour line only.
  const res = await call(saveRetailConfiguration, saveReq({
    selections: [{ group_id: ctx.groupText, option_id: ctx.optText, customer_text: 'اسم الخريج' }],
  }));
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  const rows = await query(
    `SELECT group_id FROM order_items WHERE order_id = $1`, [ctx.orderId]
  );
  assert.strictEqual(rows.rows.filter((r) => r.group_id === ctx.groupColor).length, 0, 'colour line removed');
  const after = await query(
    `SELECT id FROM order_items WHERE order_id = $1 AND group_id = $2`,
    [ctx.orderId, ctx.groupText]
  );
  assert.deepStrictEqual(after.rows, before.rows, 'kept line kept its identity');
  const p = await query(`SELECT order_item_id FROM calligraphy_plates WHERE id = $1`, [ctx.plateId]);
  assert.strictEqual(p.rows[0].order_item_id, ctx.textItemId);

  // Put the colour back for the remaining tests.
  const restore = await call(saveRetailConfiguration, saveReq({}));
  assert.strictEqual(restore.statusCode, 200, JSON.stringify(restore.body));
});

test('force_design_rework is the ONLY way a save sends the piece back to بانتظار التصميم', async () => {
  await query(
    `UPDATE orders SET status = 'embroidery', final_design_url = '/uploads/images/x.png',
            embroidery_zones = '{"right": true}'::jsonb WHERE id = $1`,
    [ctx.orderId]
  );
  const res = await call(saveRetailConfiguration, saveReq({ force_design_rework: true }));
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.data.design_rework, true);
  assert.strictEqual(res.body.data.status, 'design_complete');
  const o = await query(
    `SELECT status::text AS status, final_design_url, embroidery_zones FROM orders WHERE id = $1`,
    [ctx.orderId]
  );
  assert.strictEqual(o.rows[0].status, 'design_complete');
  assert.strictEqual(o.rows[0].final_design_url, null);
  assert.deepStrictEqual(o.rows[0].embroidery_zones, {});
});

// ──────────────── FEATURE 2: تجزئة students in the custom-order flow ───────

test('retail students are now visible in students-search, flagged not full-set-eligible', async () => {
  const res = await call(studentsSearch, { query: { q: TAG }, user: { id: ctx.actorId } });
  assert.strictEqual(res.statusCode, 200);
  const rows = res.body.data;
  const retail = rows.find((r) => r.id === ctx.retailStudentId);
  assert.ok(retail, 'تجزئة student is invisible in search');
  assert.strictEqual(retail.full_set_eligible, false);
  const nameOnly = rows.find((r) => r.id === ctx.nameOnlyStudentId);
  assert.ok(nameOnly, 'name-only student missing');
  assert.strictEqual(nameOnly.full_set_eligible, true);
  const rep = rows.find((r) => r.id === ctx.repStudentId);
  assert.ok(rep);
  assert.strictEqual(rep.full_set_eligible, true);
});

test('the طقم read-back still 403s for a تجزئة student (the load-bearing guard is untouched)', async () => {
  const res = await call(getStudentFullSet, {
    params: { studentId: ctx.retailStudentId }, user: { id: ctx.actorId },
  });
  assert.strictEqual(res.statusCode, 403);
  assert.match(res.body.error, /تجزئة/);
});

test('the retail-order endpoint is the exact complement: 403 for a full-set-eligible student', async () => {
  for (const studentId of [ctx.nameOnlyStudentId, ctx.repStudentId]) {
    const res = await call(createRetailOrder, {
      params: { studentId },
      body: { product_id: ctx.childA, selections: [] },
      user: { id: ctx.actorId },
    });
    assert.strictEqual(res.statusCode, 403, `student ${studentId} should be طقم-only`);
    assert.strictEqual(res.body.code, 'ERR_FORBIDDEN');
  }
});

test('creating a retail order makes its OWN checkout_group and leaves existing orders byte-identical', async () => {
  const snapshot = await query(
    `SELECT id, product_id, price, cost, status::text AS status, checkout_group_id, updated_at
       FROM orders WHERE student_id = $1 ORDER BY id`,
    [ctx.retailStudentId]
  );
  assert.ok(snapshot.rows.length >= 1, 'fixture must have a pre-existing order');

  const res = await call(createRetailOrder, {
    params: { studentId: ctx.retailStudentId },
    body: {
      product_id: ctx.childB,
      selections: [{ group_id: ctx.groupText, option_id: ctx.optText, customer_text: 'اسم ثانٍ' }],
      group: { notes: 'طلب مخصص من الإدارة' },
    },
    user: { id: ctx.actorId },
  });
  assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));
  const d = res.body.data;
  assert.ok(d.order_id && d.checkout_group_id);
  assert.strictEqual(d.price, 25000, 'priced at the RETAIL role, never the rep addon table');
  assert.strictEqual(d.status, 'design_complete', 'typed embroidery routes to بانتظار التصميم');

  // Its own, brand-new bundle.
  assert.ok(
    !snapshot.rows.some((r) => r.checkout_group_id === d.checkout_group_id),
    'must never reuse an existing checkout_group'
  );
  const cg = await query(`SELECT customer_name, notes FROM checkout_groups WHERE id = $1`, [d.checkout_group_id]);
  assert.strictEqual(cg.rows.length, 1);
  assert.strictEqual(cg.rows[0].notes, 'طلب مخصص من الإدارة');

  // A direct admin order never enters the rep approval flow.
  const created = await query(
    `SELECT wholesaler_approval, has_embroidery, needs_pressing, product_id, price
       FROM orders WHERE id = $1`,
    [d.order_id]
  );
  assert.strictEqual(created.rows[0].wholesaler_approval, null);
  assert.strictEqual(created.rows[0].has_embroidery, true);
  assert.strictEqual(created.rows[0].needs_pressing, true);
  assert.strictEqual(created.rows[0].product_id, ctx.childB);
  assert.strictEqual(Number(created.rows[0].price), 25000);

  // Nothing else moved.
  const after = await query(
    `SELECT id, product_id, price, cost, status::text AS status, checkout_group_id, updated_at
       FROM orders WHERE student_id = $1 AND id <> $2 ORDER BY id`,
    [ctx.retailStudentId, d.order_id]
  );
  assert.deepStrictEqual(after.rows, snapshot.rows, 'pre-existing orders must be byte-identical');

  // ...including the plate.
  const p = await query(`SELECT order_item_id FROM calligraphy_plates WHERE id = $1`, [ctx.plateId]);
  assert.strictEqual(p.rows[0].order_item_id, ctx.textItemId);
});

// NB `otherChild`, not `childA` — the student already holds a live childA piece, and one
// live design-less order per (student, product) is a DB invariant (uq_orders_student_product
// _nodesign). The refusal that produces is asserted on its own two tests below.
test('a plain (no-text) retail order routes to الكوي, and a plain cap to التجهيز', async () => {
  const sash = await call(createRetailOrder, {
    params: { studentId: ctx.retailStudentId },
    body: { product_id: ctx.otherChild, selections: [] },
    user: { id: ctx.actorId },
  });
  assert.strictEqual(sash.statusCode, 201, JSON.stringify(sash.body));
  assert.strictEqual(sash.body.data.status, 'pressing');

  const cap = await call(createRetailOrder, {
    params: { studentId: ctx.retailStudentId },
    body: { product_id: ctx.childCap, selections: [] },
    user: { id: ctx.actorId },
  });
  assert.strictEqual(cap.statusCode, 201, JSON.stringify(cap.body));
  assert.strictEqual(cap.body.data.status, 'preparing');
  const o = await query(`SELECT needs_pressing FROM orders WHERE id = $1`, [cap.body.data.order_id]);
  assert.strictEqual(o.rows[0].needs_pressing, false);
});

test('the retail-order endpoint refuses an unknown or inactive product', async () => {
  for (const pid of [crypto.randomUUID(), ctx.childInactive]) {
    const res = await call(createRetailOrder, {
      params: { studentId: ctx.retailStudentId },
      body: { product_id: pid, selections: [] },
      user: { id: ctx.actorId },
    });
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.code, 'ERR_NOT_FOUND');
  }
});

// ── The (student, product) invariant, on both write paths ───────────────────
// uq_orders_student_product_nodesign allows ONE live design-less piece per pair. Unguarded,
// both paths below hand the admin a raw 23505 → 500. Each must name the clashing order.

test('a second piece of a product the student already holds is refused, not a 500', async () => {
  const before = await query(
    `SELECT COUNT(*)::int AS n FROM orders WHERE student_id = $1`, [ctx.retailStudentId]
  );
  const res = await call(createRetailOrder, {
    params: { studentId: ctx.retailStudentId },
    body: { product_id: ctx.childA, selections: [] },
    user: { id: ctx.actorId },
  });
  assert.strictEqual(res.statusCode, 409, JSON.stringify(res.body));
  assert.strictEqual(res.body.code, 'ERR_DUPLICATE_PIECE');
  assert.strictEqual(res.body.existing_order_id, ctx.orderId, 'must name the order to edit instead');
  const after = await query(
    `SELECT COUNT(*)::int AS n FROM orders WHERE student_id = $1`, [ctx.retailStudentId]
  );
  assert.strictEqual(after.rows[0].n, before.rows[0].n, 'nothing may be created on a refusal');
});

test('a swap onto a product the student already holds is refused, and the piece stays put', async () => {
  // The «creating a retail order» test above gave this student a live childB piece.
  const existing = await query(
    `SELECT id FROM orders
      WHERE student_id = $1 AND product_id = $2 AND design_id IS NULL AND status <> 'cancelled'`,
    [ctx.retailStudentId, ctx.childB]
  );
  assert.strictEqual(existing.rows.length, 1, 'fixture: student must already hold childB');

  const res = await call(saveRetailConfiguration, saveReq({ product_id: ctx.childB }));
  assert.strictEqual(res.statusCode, 409, JSON.stringify(res.body));
  assert.strictEqual(res.body.code, 'ERR_DUPLICATE_PIECE');
  assert.strictEqual(res.body.existing_order_id, existing.rows[0].id);

  const o = await query(`SELECT product_id, price FROM orders WHERE id = $1`, [ctx.orderId]);
  assert.strictEqual(o.rows[0].product_id, ctx.childA, 'the refused swap must not move the piece');
});

test('a sibling the student already holds is no longer offered as a swap candidate', async () => {
  const res = await call(editContext, { params: { id: ctx.orderId }, user: { id: ctx.actorId } });
  assert.strictEqual(res.statusCode, 200);
  const ids = res.body.data.retail_order.swap_candidates.map((c) => c.id);
  assert.ok(!ids.includes(ctx.childB), 'a target that would 409 must not be offered');
  assert.ok(ids.includes(ctx.parentSash), 'still-free family members are still offered');
});

// ───────────── «طلب مستقل بدون ممثل» — multi-piece retail creation ──────────
// The independent path used to render the REP طقم form priced from the default rep addon
// table. These tests pin the replacement: one bundle, N pieces, retail pricing, and — the
// load-bearing part — a student the RETAIL edit path owns for life.

const newPhone = () => `079${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

// Register whatever the endpoint created so `after` still reaches 0 leftovers.
async function trackCreatedStudent(studentId) {
  const r = await query(`SELECT user_id FROM students WHERE id = $1`, [studentId]);
  if (r.rows.length) {
    fx.students.push(studentId);
    fx.users.push(r.rows[0].user_id);
  }
}

test('a new independent student gets ONE bundle with every piece priced at the retail book', async () => {
  const phone = newPhone();
  const res = await call(createRetailOrders, {
    body: {
      student: {
        name: `${TAG} طالبة مستقلة`,
        phone,
        gender: 'female',
        instagram: undefined,
        instagram_username: '@lolo.test',
        university_name: 'جامعة الاختبار',
        department: 'الحاسبات',
        study_type: 'evening',
      },
      pieces: [
        // typed embroidery → بانتظار التصميم
        { product_id: ctx.childB, selections: [{ group_id: ctx.groupText, option_id: ctx.optText, customer_text: 'اسم الخريجة' }] },
        // plain cap → التجهيز
        { product_id: ctx.childCap, selections: [] },
      ],
      group: { governorate: 'ديالى', notes: 'طلب مستقل' },
    },
    user: { id: ctx.actorId },
  });
  assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));
  const d = res.body.data;
  await trackCreatedStudent(d.student_id);
  ctx.independentStudentId = d.student_id;
  ctx.independentPhone = phone;
  ctx.independentOrders = d.orders;

  assert.strictEqual(d.orders.length, 2);
  assert.strictEqual(d.total, 45000, '25,000 retail sash + 20,000 retail cap');

  // ONE bundle for the whole order.
  const rows = await query(
    `SELECT checkout_group_id, product_id, price, status::text AS status,
            wholesaler_approval, needs_pressing
       FROM orders WHERE student_id = $1 ORDER BY price DESC`,
    [d.student_id]
  );
  assert.strictEqual(rows.rows.length, 2);
  assert.strictEqual(rows.rows[0].checkout_group_id, d.checkout_group_id);
  assert.strictEqual(rows.rows[1].checkout_group_id, d.checkout_group_id);

  // Retail prices, not the 30,000/28,000 rep base_price the products carry.
  assert.strictEqual(Number(rows.rows[0].price), 25000);
  assert.strictEqual(Number(rows.rows[1].price), 20000);

  // Per-piece routing, and a direct admin order never enters the rep approval flow.
  const byProduct = Object.fromEntries(rows.rows.map((r) => [r.product_id, r]));
  assert.strictEqual(byProduct[ctx.childB].status, 'design_complete');
  assert.strictEqual(byProduct[ctx.childCap].status, 'preparing', 'a plain cap goes straight to التجهيز');
  assert.strictEqual(byProduct[ctx.childCap].needs_pressing, false, 'caps skip المكوجي');
  for (const r of rows.rows) assert.strictEqual(r.wholesaler_approval, null);

  const cg = await query(`SELECT governorate, notes, phone_primary FROM checkout_groups WHERE id = $1`, [d.checkout_group_id]);
  assert.strictEqual(cg.rows[0].governorate, 'ديالى');
  assert.strictEqual(cg.rows[0].phone_primary, phone, 'delivery phone defaults to the student phone');
});

test('THE INVARIANT: that student is owned by the RETAIL edit path, not the طقم one', async () => {
  // This is the whole point of requiring a phone. A name-only student would come back
  // edit_mode='full_set' and the طقم editor would re-price these retail pieces rep-style.
  const s = await query(
    `SELECT u.phone, s.wholesaler_id, s.gender::text AS gender, s.study_type::text AS study_type,
            s.instagram_username, s.university_name
       FROM students s JOIN users u ON u.id = s.user_id WHERE s.id = $1`,
    [ctx.independentStudentId]
  );
  assert.strictEqual(s.rows[0].phone, ctx.independentPhone);
  assert.strictEqual(s.rows[0].wholesaler_id, null);
  assert.strictEqual(s.rows[0].gender, 'female');
  assert.strictEqual(s.rows[0].study_type, 'evening');
  assert.strictEqual(s.rows[0].instagram_username, 'lolo.test', 'the @ is stripped');

  const res = await call(editContext, {
    params: { id: ctx.independentOrders[0].id },
    user: { id: ctx.actorId },
  });
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.data.edit_mode, 'retail', 'MUST be the retail editor, never full_set');
  assert.ok(res.body.data.retail_order, 'and it must carry a retail snapshot');

  // The طقم read-back refuses them, exactly like a self-registered تجزئة student.
  const full = await call(getStudentFullSet, {
    params: { studentId: ctx.independentStudentId },
    user: { id: ctx.actorId },
  });
  assert.strictEqual(full.statusCode, 403);
});

test('search flags the new student as NOT full-set-eligible so the UI picks the retail form', async () => {
  const res = await call(studentsSearch, {
    query: { q: 'طالبة مستقلة' },
    user: { id: ctx.actorId },
  });
  assert.strictEqual(res.statusCode, 200);
  const hit = res.body.data.find((r) => r.id === ctx.independentStudentId);
  assert.ok(hit, 'the student must be findable');
  assert.strictEqual(hit.full_set_eligible, false);
  assert.strictEqual(hit.gender, 'female', 'the retail form needs it — option groups are gender-scoped');
});

test('a phone that already exists is refused by name instead of binding to the wrong human', async () => {
  const res = await call(createRetailOrders, {
    body: {
      student: { name: `${TAG} منتحلة`, phone: ctx.independentPhone, gender: 'female' },
      pieces: [{ product_id: ctx.childA, selections: [] }],
    },
    user: { id: ctx.actorId },
  });
  assert.strictEqual(res.statusCode, 409, JSON.stringify(res.body));
  assert.strictEqual(res.body.code, 'ERR_PHONE_TAKEN');
  assert.strictEqual(res.body.student_id, ctx.independentStudentId, 'hands back the student to switch to');
  assert.match(res.body.error, /طالبة مستقلة/, 'names the existing owner');
});

test('name, phone and gender are each required, and the phone must be a real Iraqi mobile', async () => {
  const base = { pieces: [{ product_id: ctx.childA, selections: [] }] };
  const cases = [
    [{ name: '', phone: newPhone(), gender: 'female' }, 'name'],
    [{ name: `${TAG} س`, phone: '', gender: 'female' }, 'phone'],
    [{ name: `${TAG} س`, phone: '0300', gender: 'female' }, 'phone'],
    [{ name: `${TAG} س`, phone: newPhone(), gender: '' }, 'gender'],
    [{ name: `${TAG} س`, phone: newPhone(), gender: 'other' }, 'gender'],
    [{ name: `${TAG} س`, phone: newPhone(), gender: 'female', study_type: 'nightshift' }, 'study_type'],
  ];
  for (const [student, field] of cases) {
    const res = await call(createRetailOrders, { body: { ...base, student }, user: { id: ctx.actorId } });
    assert.strictEqual(res.statusCode, 400, `${field}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.field, field);
  }
  // …and none of those attempts created an account.
  const leaked = await query(`SELECT COUNT(*)::int n FROM users WHERE name LIKE $1`, [`${TAG} س%`]);
  assert.strictEqual(leaked.rows[0].n, 0, 'a rejected payload must never leave a user behind');
});

test('the same product twice in one payload is refused before anything is written', async () => {
  const phone = newPhone();
  const res = await call(createRetailOrders, {
    body: {
      student: { name: `${TAG} مكررة`, phone, gender: 'female' },
      pieces: [
        { product_id: ctx.childA, selections: [] },
        { product_id: ctx.childA, selections: [] },
      ],
    },
    user: { id: ctx.actorId },
  });
  assert.strictEqual(res.statusCode, 400, JSON.stringify(res.body));
  assert.strictEqual(res.body.code, 'ERR_DUPLICATE_PIECE');
  const leaked = await query(`SELECT COUNT(*)::int n FROM users WHERE phone = $1`, [phone]);
  assert.strictEqual(leaked.rows[0].n, 0, 'no orphan user from a rejected payload');
});

test('a piece the student already holds is refused, naming the order to edit instead', async () => {
  const existing = await query(
    `SELECT id FROM orders
      WHERE student_id = $1 AND product_id = $2 AND design_id IS NULL AND status <> 'cancelled'`,
    [ctx.independentStudentId, ctx.childCap]
  );
  assert.strictEqual(existing.rows.length, 1, 'fixture: the student holds the cap');

  const res = await call(createRetailOrders, {
    body: {
      student_id: ctx.independentStudentId,
      pieces: [{ product_id: ctx.childCap, selections: [] }],
    },
    user: { id: ctx.actorId },
  });
  assert.strictEqual(res.statusCode, 409, JSON.stringify(res.body));
  assert.strictEqual(res.body.code, 'ERR_DUPLICATE_PIECE');
  assert.strictEqual(res.body.existing_order_id, existing.rows[0].id);
});

test('an invalid LATER piece rolls the whole order back — no partial bundle', async () => {
  const phone = newPhone();
  const before = await query(`SELECT COUNT(*)::int n FROM checkout_groups`);
  const res = await call(createRetailOrders, {
    body: {
      student: { name: `${TAG} جزئية`, phone, gender: 'female' },
      pieces: [
        { product_id: ctx.childA, selections: [] },
        { product_id: ctx.childInactive, selections: [] },   // inactive → the whole thing dies
      ],
    },
    user: { id: ctx.actorId },
  });
  assert.strictEqual(res.statusCode, 404, JSON.stringify(res.body));
  const after = await query(`SELECT COUNT(*)::int n FROM checkout_groups`);
  assert.strictEqual(after.rows[0].n, before.rows[0].n, 'no bundle was left behind');
  const leaked = await query(`SELECT COUNT(*)::int n FROM users WHERE phone = $1`, [phone]);
  assert.strictEqual(leaked.rows[0].n, 0, 'no user was left behind');
});

test('a gender-restricted option is refused for the wrong gender', async () => {
  const g = await query(
    `INSERT INTO option_groups (product_id, name_ar, required, gender_restriction)
     VALUES ($1, $2, FALSE, 'male') RETURNING id`,
    [ctx.parentSash, `${TAG} خيار للذكور`]
  );
  fx.groups.push(g.rows[0].id);
  const o = await query(
    `INSERT INTO options (group_id, label_ar, price_delta) VALUES ($1, 'ذكوري', 1000) RETURNING id`,
    [g.rows[0].id]
  );

  const res = await call(createRetailOrders, {
    body: {
      student: { name: `${TAG} أنثى`, phone: newPhone(), gender: 'female' },
      pieces: [{ product_id: ctx.childA, selections: [{ group_id: g.rows[0].id, option_id: o.rows[0].id }] }],
    },
    user: { id: ctx.actorId },
  });
  assert.strictEqual(res.statusCode, 403, JSON.stringify(res.body));
  assert.strictEqual(res.body.code, 'ERR_GENDER');
});

test('the multi-piece path still refuses a rep-linked student', async () => {
  const res = await call(createRetailOrders, {
    body: { student_id: ctx.repStudentId, pieces: [{ product_id: ctx.childA, selections: [] }] },
    user: { id: ctx.actorId },
  });
  assert.strictEqual(res.statusCode, 403, JSON.stringify(res.body));
  assert.strictEqual(res.body.code, 'ERR_FORBIDDEN');
});

test('an empty or oversized piece list is refused', async () => {
  const mk = (pieces) => call(createRetailOrders, {
    body: { student_id: ctx.independentStudentId, pieces },
    user: { id: ctx.actorId },
  });
  assert.strictEqual((await mk([])).statusCode, 400);
  assert.strictEqual((await mk(undefined)).statusCode, 400);
  const many = Array.from({ length: 11 }, () => ({ product_id: ctx.childA, selections: [] }));
  assert.strictEqual((await mk(many)).statusCode, 400);
});
