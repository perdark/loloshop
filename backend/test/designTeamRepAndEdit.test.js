'use strict';
// Owner 2026-10-13: «ايادي التصميم خليهم يكدرون يعدون عالطلب وانطيهم صلاحية على الدفعات».
// Two widenings of the desk, both pinned here:
//
//  1. DUFAAT — the desk now reaches REP orders, but ONLY rep-APPROVED ones. A rep order still
//     «بانتظار موافقة الممثل» is a dispute the shop stays out of (HANDOFF landmine), and
//     approveJob moves an order to التطريز — so a pending one must be invisible to the list
//     AND unreachable by a hand-posted id. Both halves are asserted.
//  2. EDIT — «النص والصور بس»: editLine writes customer_text / customer_image_url and nothing
//     else; a priced option line (no text, no photo) is not editable; a line can never be left
//     with neither; the old value lands in audit_log so any edit is undoable.
//
// Fixture rules are the same as designTeamFinish.test.js (all users in test.before, all
// dropped in test.after) for the same cross-file COUNT reasons. Nothing here MOVES an order.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { query } = require('../lib/db');
const c = require('../controllers/designTeamController');

const TAG = `ZZTEST-deskrep-${crypto.randomUUID().slice(0, 8)}`;
const fx = { products: [], users: [], students: [], orders: [], wholesalers: [], batches: [] };
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
  for (let attempt = 0; ; attempt += 1) {
    try {
      const { rows } = await query(
        `INSERT INTO users (name, phone, password_hash, role, phone_verified)
         VALUES ($1, $2, 'x', $3::user_role, TRUE) RETURNING id, name, role`,
        [`${TAG} ${name}`, newPhone(), role]
      );
      fx.users.push(rows[0].id);
      return rows[0];
    } catch (err) {
      if (err?.code !== '23505' || attempt >= 4) throw err;
    }
  }
}

async function reqFor(user, params = {}, body = {}) {
  const req = { user: { id: user.id, name: user.name, role: user.role }, params, body };
  await new Promise((resolve, reject) => {
    c.attachTeamMember(req, mockRes(), (err) => (err ? reject(err) : resolve()));
  });
  return req;
}

async function insertJob(label, { wholesalerId = null, approval = null, batchId = null } = {}) {
  const user = await insertUser(label, 'retail');
  const s = await query(
    `INSERT INTO students (user_id, full_name_third, status, wholesaler_id, gender)
     VALUES ($1, $2, 'approved', $3, 'female') RETURNING id`,
    [user.id, `${TAG} ${label}`, wholesalerId]
  );
  fx.students.push(s.rows[0].id);
  const o = await query(
    `INSERT INTO orders (student_id, product_id, price, status, has_embroidery, returned_to_customer,
                         wholesaler_approval, batch_id)
     VALUES ($1, $2, 25000, 'design_complete', TRUE, FALSE, $3, $4) RETURNING id`,
    [s.rows[0].id, ctx.product, approval, batchId]
  );
  fx.orders.push(o.rows[0].id);
  return o.rows[0].id;
}

async function insertLine(orderId, label, { text = null, image = null, price = 0 } = {}) {
  const { rows } = await query(
    `INSERT INTO order_items (order_id, label_snapshot, price_snapshot, customer_text, customer_image_url)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [orderId, label, price, text, image]
  );
  return rows[0].id;
}

const line = async (id) =>
  (await query(`SELECT customer_text, customer_image_url, price_snapshot FROM order_items WHERE id = $1`, [id])).rows[0];

test.before(async () => {
  const p = await query(
    `INSERT INTO products (name_ar, type, base_price, sort) VALUES ($1, 'sash', 25000, 0) RETURNING id`,
    [`${TAG} وشاح`]
  );
  ctx.product = p.rows[0].id;
  fx.products.push(ctx.product);

  ctx.helper = await insertUser('عضو', 'design_helper');
  await query(
    `INSERT INTO design_team_members (team_id, user_id, member_role, active)
     VALUES (TRUE, $1, 'helper'::design_team_member_role, TRUE)`,
    [ctx.helper.id]
  );

  ctx.repUser = await insertUser('ممثل', 'wholesaler');
  const w = await query(
    `INSERT INTO wholesalers (user_id, referral_code) VALUES ($1, $2) RETURNING id`,
    [ctx.repUser.id, `${TAG}-ref`]
  );
  ctx.wholesaler = w.rows[0].id;
  fx.wholesalers.push(ctx.wholesaler);
  const b = await query(
    `INSERT INTO batches (name_ar, wholesaler_id) VALUES ($1, $2) RETURNING id`,
    [`${TAG} دفعة`, ctx.wholesaler]
  );
  ctx.batch = b.rows[0].id;
  fx.batches.push(ctx.batch);

  ctx.retail = await insertJob('تجزئة');
  ctx.repApproved = await insertJob('ممثل موافق', { wholesalerId: ctx.wholesaler, approval: 'approved', batchId: ctx.batch });
  ctx.repPending = await insertJob('ممثل معلق', { wholesalerId: ctx.wholesaler, approval: 'pending', batchId: ctx.batch });

  ctx.textLine = await insertLine(ctx.retail, 'الجهة اليمنى', { text: 'اسم قديم', image: '/uploads/images/old.jpg' });
  ctx.photoOnly = await insertLine(ctx.retail, 'صورة', { image: '/uploads/images/only.jpg' });
  ctx.pricedLine = await insertLine(ctx.retail, 'اللون', { price: 5000 });
  ctx.pendingLine = await insertLine(ctx.repPending, 'الاسم', { text: 'لا تلمس' });
});

test.after(async () => {
  await query(`DELETE FROM audit_log WHERE entity = 'order' AND entity_id = ANY($1::uuid[])`, [fx.orders]);
  await query(`DELETE FROM design_team_tasks WHERE order_id = ANY($1::uuid[])`, [fx.orders]);
  await query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [fx.orders]);
  await query(`DELETE FROM students WHERE id = ANY($1::uuid[])`, [fx.students]);
  await query(`DELETE FROM batches WHERE id = ANY($1::uuid[])`, [fx.batches]);
  await query(`DELETE FROM wholesalers WHERE id = ANY($1::uuid[])`, [fx.wholesalers]);
  await query(`DELETE FROM products WHERE id = ANY($1::uuid[])`, [fx.products]);
  await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [fx.users]);
  const left = await query(`SELECT count(*)::int AS n FROM users WHERE name LIKE $1`, [`${TAG}%`]);
  assert.strictEqual(left.rows[0].n, 0, 'fixture rows left behind');
});

test('1 — the list carries a rep-APPROVED order with its ممثل + دفعة, and never a pending one', async () => {
  const res = await call(c.listJobs, await reqFor(ctx.helper));
  const ids = res.body.data.map((j) => j.order_id);
  assert.ok(ids.includes(ctx.retail), 'retail still listed');
  assert.ok(ids.includes(ctx.repApproved), 'approved rep order listed');
  assert.ok(!ids.includes(ctx.repPending), '«بانتظار موافقة الممثل» must never reach the desk');
  const rep = res.body.data.find((j) => j.order_id === ctx.repApproved);
  assert.strictEqual(rep.source, 'wholesaler');
  assert.strictEqual(rep.rep.name, `${TAG} ممثل`);
  assert.strictEqual(rep.batch.name, `${TAG} دفعة`);
  const retail = res.body.data.find((j) => j.order_id === ctx.retail);
  assert.strictEqual(retail.source, 'retail');
  assert.strictEqual(retail.rep, null);
});

test('2 — a hand-posted PENDING rep order id is unreachable: finish 404s and nothing moves', async () => {
  const res = await call(c.approveJob, await reqFor(ctx.helper, { orderId: ctx.repPending }));
  assert.strictEqual(res.statusCode, 404, JSON.stringify(res.body));
  const s = await query(`SELECT status::text AS s FROM orders WHERE id = $1`, [ctx.repPending]);
  assert.strictEqual(s.rows[0].s, 'design_complete');

  const edit = await call(c.editLine, await reqFor(ctx.helper, { orderId: ctx.repPending, itemId: ctx.pendingLine }, { text: 'x' }));
  assert.strictEqual(edit.statusCode, 404);
  assert.strictEqual((await line(ctx.pendingLine)).customer_text, 'لا تلمس');
});

test('3 — a member edits a line’s TEXT; the photo + price stay, and the old text is audited', async () => {
  const res = await call(c.editLine, await reqFor(ctx.helper, { orderId: ctx.retail, itemId: ctx.textLine }, { text: '  اسم جديد  ' }));
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  const after = await line(ctx.textLine);
  assert.strictEqual(after.customer_text, 'اسم جديد');
  assert.strictEqual(after.customer_image_url, '/uploads/images/old.jpg');
  const spec = res.body.data.spec_lines.find((l) => l.item_id === ctx.textLine);
  assert.strictEqual(spec.text, 'اسم جديد');
  const a = await query(
    `SELECT details FROM audit_log WHERE action = 'design_team_edit_line' AND entity_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [ctx.retail]
  );
  assert.strictEqual(a.rows[0].details.old_text, 'اسم قديم');
  assert.strictEqual(a.rows[0].details.new_text, 'اسم جديد');
});

test('4 — a priced option line (no text, no photo) is NOT editable', async () => {
  const res = await call(c.editLine, await reqFor(ctx.helper, { orderId: ctx.retail, itemId: ctx.pricedLine }, { text: 'حقن' }));
  assert.strictEqual(res.statusCode, 400);
  const after = await line(ctx.pricedLine);
  assert.strictEqual(after.customer_text, null);
  assert.strictEqual(Number(after.price_snapshot), 5000);
});

test('5 — a line can never be left with neither text nor photo; removing one of two is fine', async () => {
  const empty = await call(c.editLine, await reqFor(ctx.helper, { orderId: ctx.retail, itemId: ctx.photoOnly }, { remove_image: true }));
  assert.strictEqual(empty.statusCode, 400);
  assert.strictEqual((await line(ctx.photoOnly)).customer_image_url, '/uploads/images/only.jpg');

  const ok = await call(c.editLine, await reqFor(ctx.helper, { orderId: ctx.retail, itemId: ctx.textLine }, { remove_image: true }));
  assert.strictEqual(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.strictEqual((await line(ctx.textLine)).customer_image_url, null);
});

test('6 — an outsider (not on the roster) is refused by the route guard', async () => {
  const outsider = { ...ctx.repUser };
  const req = await reqFor(outsider, { orderId: ctx.retail, itemId: ctx.textLine }, { text: 'x' });
  const res = mockRes();
  let passed = false;
  c.requireTeamAccess(req, res, () => { passed = true; });
  assert.strictEqual(passed, false);
  assert.strictEqual(res.statusCode, 403);
});
