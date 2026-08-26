'use strict';
// Migration 092 — «إضافة إطار»: an option GROUP restricted to one price audience.
//
// Owner request 2026-08-26: a 5,000 IQD toggle on the sash offered to a plain retail student
// and NEVER to a student who joined through a ممثل. The mechanism is that a rep-linked
// student's PRICE role is 'wholesaler' (catalogController.priceRoleForUser resolves a
// `students` row carrying a `wholesaler_id` to 'wholesaler'), so `price_role_restriction =
// 'retail'` is literally «الطلاب العاديين فقط».
//
// Two enforcement points, and this file exists because ONE of them is not enough:
//   · catalogController.buildProductFull  — hides the group from the configurator payload
//   · orderController.priceSelections     — refuses the group on the order path
// Hiding alone still accepts a hand-posted `group_id`, which is the whole class of bug the
// project's phase-10 rule is about: the server, not the screen, decides what may be bought.
//
// The order-path half is proved with the MIRROR case — a retail student against a
// wholesaler-only group — because `configureOrder` 403s a rep-linked student outright
// (ERR_REP_ORDER_FLOW, orderController.js), so the rep direction cannot reach the pricing
// code at all. The gate under test is symmetric: one query, one bind, both directions.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { getProductFull } = require('../controllers/catalogController');
const { configureOrder } = require('../controllers/orderController');
const { query } = require('../lib/db');

const TAG = `ZZTEST-audience-${crypto.randomUUID().slice(0, 8)}`;
const fx = { products: [], users: [], students: [], groups: [], wholesalers: [] };
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

async function insertUser(name, role) {
  const { rows } = await query(
    `INSERT INTO users (name, phone, password_hash, role) VALUES ($1, $2, 'x', $3::user_role) RETURNING id`,
    [`${TAG} ${name}`, newPhone(), role]
  );
  fx.users.push(rows[0].id);
  return rows[0].id;
}

async function insertStudent(name, wholesalerId) {
  const userId = await insertUser(name, 'retail');
  const s = await query(
    `INSERT INTO students (user_id, full_name_third, status, wholesaler_id, gender)
     VALUES ($1, $2, 'approved', $3, 'male') RETURNING id`,
    [userId, `${TAG} ${name}`, wholesalerId]
  );
  fx.students.push(s.rows[0].id);
  return { studentId: s.rows[0].id, userId };
}

async function insertGroup(nameAr, restriction, priceDelta) {
  const g = await query(
    `INSERT INTO option_groups (product_id, name_ar, input_type, required, price_role_restriction)
     VALUES ($1, $2, 'toggle', FALSE, $3::price_role) RETURNING id`,
    [ctx.sash, `${TAG} ${nameAr}`, restriction]
  );
  fx.groups.push(g.rows[0].id);
  const o = await query(
    `INSERT INTO options (group_id, label_ar, price_delta) VALUES ($1, $2, $3) RETURNING id`,
    [g.rows[0].id, nameAr, priceDelta]
  );
  return { groupId: g.rows[0].id, optionId: o.rows[0].id };
}

test.before(async () => {
  const p = await query(
    `INSERT INTO products (name_ar, type, base_price, sort) VALUES ($1, 'sash', 30000, 0) RETURNING id`,
    [`${TAG} وشاح`]
  );
  ctx.sash = p.rows[0].id;
  fx.products.push(ctx.sash);
  // Both audiences priced, so a missing price role can never be what makes a case pass.
  await query(
    `INSERT INTO product_price_roles (product_id, role, base_price)
     VALUES ($1,'retail',30000), ($1,'wholesaler',30000)`,
    [ctx.sash]
  );

  // The real thing the owner asked for.
  const frame = await insertGroup('إضافة إطار', 'retail', 5000);
  ctx.frameGroup = frame.groupId;
  ctx.frameOption = frame.optionId;
  // Its mirror — used to prove the order path refuses, in the only direction that can reach it.
  const repOnly = await insertGroup('خيار الممثلين', 'wholesaler', 7000);
  ctx.repGroup = repOnly.groupId;
  ctx.repOption = repOnly.optionId;
  // An unrestricted group: the control. Everyone must keep seeing this one.
  const open = await insertGroup('لون الوشاح', null, 0);
  ctx.openGroup = open.groupId;

  const repUserId = await insertUser('ممثل', 'wholesaler');
  const w = await query(
    `INSERT INTO wholesalers (user_id, referral_code) VALUES ($1, $2) RETURNING id`,
    [repUserId, `${TAG}-code`]
  );
  fx.wholesalers.push(w.rows[0].id);

  const retail = await insertStudent('طالب عادي', null);
  ctx.retailUser = { id: retail.userId, role: 'retail' };
  ctx.retailStudentId = retail.studentId;

  const linked = await insertStudent('طالب ممثل', w.rows[0].id);
  ctx.linkedUser = { id: linked.userId, role: 'retail' };

  ctx.adminUser = { id: await insertUser('مدير', 'admin'), role: 'admin' };
});

test.after(async () => {
  await query(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE student_id = ANY($1::uuid[]))`, [fx.students]);
  await query(`DELETE FROM orders WHERE student_id = ANY($1::uuid[])`, [fx.students]);
  await query(`DELETE FROM students WHERE id = ANY($1::uuid[])`, [fx.students]);
  await query(`DELETE FROM wholesalers WHERE id = ANY($1::uuid[])`, [fx.wholesalers]);
  await query(`DELETE FROM options WHERE group_id = ANY($1::uuid[])`, [fx.groups]);
  await query(`DELETE FROM option_groups WHERE id = ANY($1::uuid[])`, [fx.groups]);
  await query(`DELETE FROM product_price_roles WHERE product_id = ANY($1::uuid[])`, [fx.products]);
  await query(`DELETE FROM products WHERE id = ANY($1::uuid[])`, [fx.products]);
  await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [fx.users]);
  const left = await query(`SELECT count(*)::int n FROM option_groups WHERE name_ar LIKE $1`, [`${TAG}%`]);
  assert.strictEqual(left.rows[0].n, 0, 'fixture rows left behind');
});

const groupIds = (res) => (res.body.data.groups || []).map((g) => g.id);

// ───────────────────────── visibility ─────────────────────────

test('the configurator shows «إضافة إطار» to a plain retail student', async () => {
  const res = await call(getProductFull, { params: { id: ctx.sash }, query: {}, user: ctx.retailUser });
  assert.strictEqual(res.statusCode, 200);
  const ids = groupIds(res);
  assert.ok(ids.includes(ctx.frameGroup), 'retail student must see the retail-only group');
  assert.ok(ids.includes(ctx.openGroup), 'the unrestricted control group must still be there');
  assert.ok(!ids.includes(ctx.repGroup), 'retail student must NOT see the wholesaler-only group');
});

test('the configurator hides «إضافة إطار» from a REP-LINKED student', async () => {
  const res = await call(getProductFull, { params: { id: ctx.sash }, query: {}, user: ctx.linkedUser });
  assert.strictEqual(res.statusCode, 200);
  const ids = groupIds(res);
  assert.ok(!ids.includes(ctx.frameGroup), 'a student who joined through a ممثل must not see it');
  assert.ok(ids.includes(ctx.openGroup), 'but the unrestricted group is still theirs');
  assert.ok(ids.includes(ctx.repGroup), 'and the wholesaler-only group IS theirs');
});

test('an anonymous visitor is treated as retail and sees it', async () => {
  const res = await call(getProductFull, { params: { id: ctx.sash }, query: {}, user: null });
  assert.strictEqual(res.statusCode, 200);
  assert.ok(groupIds(res).includes(ctx.frameGroup));
});

test('the ADMIN sees every group — the product editor reads this same endpoint', async () => {
  const res = await call(getProductFull, { params: { id: ctx.sash }, query: {}, user: ctx.adminUser });
  assert.strictEqual(res.statusCode, 200);
  const ids = groupIds(res);
  assert.ok(ids.includes(ctx.frameGroup), 'admin must see the retail-only group to configure it');
  assert.ok(ids.includes(ctx.repGroup), 'admin must see the wholesaler-only group too');
});

// ───────────────────────── enforcement ─────────────────────────

test('the ORDER path refuses a restricted group even when the id is posted by hand', async () => {
  // The retail student never saw «خيار الممثلين» — post its ids anyway, the way a copied
  // request would. Hiding it in the payload must not be the only thing standing here.
  const res = await call(configureOrder, {
    body: {
      product_id: ctx.sash,
      selections: [{ group_id: ctx.repGroup, option_id: ctx.repOption }],
    },
    user: ctx.retailUser,
  });
  assert.strictEqual(res.statusCode, 400, 'a hand-posted restricted group must be rejected');
  assert.strictEqual(res.body.code, 'ERR_VALIDATION');
});

test('the same student CAN order the group meant for them, at its price', async () => {
  const res = await call(configureOrder, {
    body: {
      product_id: ctx.sash,
      selections: [{ group_id: ctx.frameGroup, option_id: ctx.frameOption }],
    },
    user: ctx.retailUser,
  });
  assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));
  assert.strictEqual(res.body.data.total, 35000, 'base 30,000 + إطار 5,000');
  const { rows } = await query(
    `SELECT price FROM orders WHERE student_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [ctx.retailStudentId]
  );
  assert.strictEqual(Number(rows[0].price), 35000, 'base 30,000 + إطار 5,000');
});
