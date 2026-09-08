'use strict';
// المكوجي يشوف الطلب كامل ما عدا الفلوس — owner ruling 2026-09-08.
//
// WHY THIS CHANGED. `getOrder` gave a sole-role presser a deliberately thin projection:
// name + product photo + sizes + a colour-only design stub, with contact, the full-set
// intake, the delivery details, the artwork and the package siblings all stripped. That was
// a 2026-07-15 decision and it is now overruled — محمد عادل is the only presser on the floor,
// he is the person who physically handles the whole طقم, and «show all details for order»
// was the owner's own words. MONEY IS THE ONE THING THAT DOES NOT MOVE: `canSeeMoney` stays
// front-desk/manager only, on the order, on `intake.deposit`, and on every line's
// `price_snapshot`.
//
// ⚠️ This does NOT loosen the tailor or the embroiderer. Both keep their allow-list
// projections, and `test/batchASecurity.test.js` still pins that no production role reads the
// wholesale price book. What is asserted here is exactly one role's blast radius.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { query } = require('../lib/db');
const { getOrder } = require('../controllers/productionController');

const TAG = `ZZTEST-presser-${crypto.randomUUID().slice(0, 8)}`;
const fx = { users: [], students: [], orders: [], products: [], designs: [], groups: [] };
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
  // ⚠️ Born `deleted_at`-stamped: `node --test` runs files concurrently and
  // pushBroadcast.test.js counts the live audience — an extra live user fails ITS assertion.
  // Nothing read here looks at the flag. (Same note as shawlPiece.test.js.)
  const stu = await query(
    `INSERT INTO users (name, phone, password_hash, role, deleted_at)
     VALUES ($1,$2,'x','retail',NOW()) RETURNING id`,
    [`${TAG}-student`, `0788${(Date.now() + 3) % 10000000}`]
  );
  fx.users.push(stu.rows[0].id);
  ctx.studentPhone = (await query(`SELECT phone FROM users WHERE id=$1`, [stu.rows[0].id])).rows[0].phone;

  // wholesaler_id NULL → retail, which is the audience the owner named.
  const s = await query(
    `INSERT INTO students (user_id, full_name_third, status, university_name, department, instagram_username)
     VALUES ($1,$2,'approved',$3,'صيدلة',$4) RETURNING id`,
    [stu.rows[0].id, `${TAG}-student`, `${TAG}-uni`, `${TAG}_insta`]
  );
  ctx.studentId = s.rows[0].id;
  fx.students.push(ctx.studentId);

  const p = await query(
    `INSERT INTO products (name_ar, type, base_price, active) VALUES ($1,'sash',1000,TRUE) RETURNING id`,
    [`${TAG}-sash`]
  );
  ctx.productId = p.rows[0].id;
  fx.products.push(ctx.productId);

  const d = await query(
    `INSERT INTO designs (student_id, sash_color, left_canvas, right_canvas, approval_status, completed)
     VALUES ($1,'ماروني','{"objects":["left"]}','{"objects":["right"]}','approved',TRUE) RETURNING id`,
    [ctx.studentId]
  );
  ctx.designId = d.rows[0].id;
  fx.designs.push(ctx.designId);

  // A full-set intake carries the contact/delivery block the presser could not see.
  const cg = await query(
    `INSERT INTO checkout_groups (customer_name, phone_primary, governorate, deposit, notes)
     VALUES ($1,'07701112233','بغداد',5000,'ملاحظة') RETURNING id`,
    [`${TAG}-customer`]
  );
  ctx.groupId = cg.rows[0].id;
  fx.groups.push(ctx.groupId);

  // Two pieces in one checkout group, so «bundle» has a sibling to find.
  for (const which of ['a', 'b']) {
    const o = await query(
      `INSERT INTO orders (student_id, product_id, price, status, has_embroidery, needs_pressing,
                           design_id, checkout_group_id, delivery_phone, delivery_address, recipient_name)
       VALUES ($1,$2,7000,'pressing',TRUE,TRUE,$3,$4,'07709998877','الكرادة، محلة 1','مستلم') RETURNING id`,
      [ctx.studentId, ctx.productId, ctx.designId, ctx.groupId]
    );
    fx.orders.push(o.rows[0].id);
    if (which === 'a') ctx.orderId = o.rows[0].id;
    await query(
      `INSERT INTO order_items (order_id, label_snapshot, price_snapshot, qty, customer_text)
       VALUES ($1,'تطريز يمين',3000,1,'اسم الطالبة')`,
      [o.rows[0].id]
    );
  }

  ctx.presser = {
    id: fx.users[0], role: 'staff', staff_type: 'presser',
    staff_types: ['presser'], order_scope: 'both',
  };
});

test('the presser sees the whole order — contact, artwork, intake, delivery, siblings', async () => {
  const res = await call(getOrder, { params: { id: ctx.orderId }, user: ctx.presser, query: {} });
  assert.equal(res.statusCode, 200);
  const d = res.body.data;

  assert.equal(d.can_see_design, true, 'he presses the artwork — he must be able to look at it');
  assert.ok(d.design, 'the design row is fetched, not skipped');
  assert.ok(d.design.left_canvas, 'the FULL canvas, not the colour-only stub');
  assert.ok(d.design.right_canvas);

  assert.equal(d.order.student_phone, ctx.studentPhone, 'contact is visible');
  assert.match(String(d.order.instagram_username), new RegExp(TAG));

  assert.ok(d.order.intake, 'the full-set intake card is no longer reduced to event_date');
  assert.equal(d.order.intake.phone_primary, '07701112233');
  assert.equal(d.order.intake.governorate, 'بغداد');

  assert.equal(d.order.delivery_phone, '07709998877', 'delivery block is visible');
  assert.equal(d.order.delivery_address, 'الكرادة، محلة 1');
  assert.equal(d.order.recipient_name, 'مستلم');

  assert.ok(d.bundle, 'he handles the whole طقم — the siblings must be reachable');
  assert.ok(d.bundle.length >= 1, 'the other piece of this checkout group is listed');

  assert.ok(d.order.measurements !== undefined, 'sizes stay visible (they always were)');
});

test('MONEY IS THE LINE — the presser still sees no price anywhere', async () => {
  const res = await call(getOrder, { params: { id: ctx.orderId }, user: ctx.presser, query: {} });
  const d = res.body.data;

  assert.equal(d.can_see_money, undefined === d.can_see_money ? undefined : false);
  assert.equal(d.order.price, undefined, 'the order price is stripped');
  assert.equal(d.order.intake.deposit, undefined, 'the deposit is money too');
  for (const it of d.items) {
    assert.equal(it.price_snapshot, null, 'every line price is nulled — defence in depth');
  }
  if (d.bundle) {
    for (const b of d.bundle) {
      assert.ok(b.price == null, 'a sibling must not leak the price the order itself hides');
    }
  }
});

test.after(async () => {
  if (fx.orders.length) await query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [fx.orders]);
  if (fx.designs.length) await query(`DELETE FROM designs WHERE id = ANY($1::uuid[])`, [fx.designs]);
  if (fx.groups.length) await query(`DELETE FROM checkout_groups WHERE id = ANY($1::uuid[])`, [fx.groups]);
  if (fx.students.length) await query(`DELETE FROM students WHERE id = ANY($1::uuid[])`, [fx.students]);
  if (fx.products.length) await query(`DELETE FROM products WHERE id = ANY($1::uuid[])`, [fx.products]);
  if (fx.users.length) await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [fx.users]);
});
