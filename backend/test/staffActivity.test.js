'use strict';
// One activity builder behind BOTH «النشاط» screens — /staff/team (admin looking at a worker)
// and /staff/me (the worker themself). The reason it exists: staff_activity_log only records
// stage MOVES, but the embroiderer's actual daily work is ticking embroidery ZONES, which are
// written to audit_log (action 'embroidery_zone'), not staff_activity_log. Before this builder,
// an embroiderer's activity log badly under-reported him — he could work all day and show
// almost nothing. activityFor() UNIONs both sources.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { query } = require('../lib/db');
const { activityFor } = require('../lib/staffActivity');

const TAG = `ZZTEST-act-${crypto.randomUUID().slice(0, 8)}`;
const fx = { users: [], students: [], orders: [], products: [] };
const ctx = {};

const newPhone = () => `079${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

test('setup', async () => {
  // ⚠️ BORN `deleted_at`-STAMPED — same reason embroideryChecklistGate.test.js gives:
  // `node --test` runs files concurrently and pushBroadcast.test.js counts the live audience.
  const staffUser = await query(
    `INSERT INTO users (name, phone, password_hash, role, deleted_at)
     VALUES ($1,$2,'x','staff',NOW()) RETURNING id`,
    [`${TAG}-staff`, newPhone()]
  );
  ctx.staffId = staffUser.rows[0].id;
  fx.users.push(ctx.staffId);
  fx.staffId = ctx.staffId;

  const stuUser = await query(
    `INSERT INTO users (name, phone, password_hash, role, deleted_at)
     VALUES ($1,$2,'x','retail',NOW()) RETURNING id`,
    [`${TAG}-student`, newPhone()]
  );
  fx.users.push(stuUser.rows[0].id);
  const s = await query(
    `INSERT INTO students (user_id, full_name_third, status)
     VALUES ($1,$2,'approved') RETURNING id`,
    [stuUser.rows[0].id, `${TAG}-student`]
  );
  ctx.studentId = s.rows[0].id;
  fx.students.push(ctx.studentId);

  const productName = `${TAG}-sash`;
  fx.productName = productName;
  const p = await query(
    `INSERT INTO products (name_ar, type, base_price, active) VALUES ($1,'sash',1000,TRUE) RETURNING id`,
    [productName]
  );
  fx.products.push(p.rows[0].id);

  const o = await query(
    `INSERT INTO orders (student_id, product_id, price, status)
     VALUES ($1,$2,1000,'embroidery') RETURNING id`,
    [ctx.studentId, p.rows[0].id]
  );
  ctx.orderId = o.rows[0].id;
  fx.orders.push(ctx.orderId);

  // The stage move — older, so it must sort SECOND (newest first).
  await query(
    `INSERT INTO staff_activity_log (user_id, action, order_id, from_stage, to_stage, created_at)
     VALUES ($1,'advance',$2,'embroidery','pressing', NOW() - INTERVAL '10 minutes')`,
    [ctx.staffId, ctx.orderId]
  );
  // The zone tick — newer, so it must sort FIRST. Same shape productionController.markEmbroideryZone
  // writes: details = { zone, done }.
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details, created_at)
     VALUES ($1,'embroidery_zone','order',$2,$3, NOW() - INTERVAL '1 minute')`,
    [ctx.staffId, ctx.orderId, JSON.stringify({ zone: 'sash_back', done: true })]
  );
});

test('1. both kinds of work come back, newest first, with names', async () => {
  const rows = await activityFor(fx.staffId, {});
  assert.deepEqual(rows.map((r) => r.action), ['embroidery_zone', 'advance']);
  assert.equal(rows[0].zone, 'sash_back');
  assert.equal(rows[1].product_name, fx.productName);
  assert.equal(rows[1].student_name, `${TAG}-student`);
});

test('2. month filter excludes another month', async () => {
  const rows = await activityFor(fx.staffId, { month: '2020-01' });
  assert.equal(rows.length, 0);
});

test('3. bad month → throws ERR_VALIDATION', async () => {
  // A RegExp validator in assert.rejects tests String(error) ("Error: <message>"), which
  // never contains the .code — so this checks err.code directly instead of matching a regex
  // against the Arabic message.
  await assert.rejects(
    () => activityFor(fx.staffId, { month: '2020-13' }),
    (err) => err.code === 'ERR_VALIDATION'
  );
});

test('cleanup', async () => {
  if (fx.orders.length) {
    await query(`DELETE FROM staff_activity_log WHERE order_id = ANY($1)`, [fx.orders]);
    await query(`DELETE FROM audit_log WHERE entity_id = ANY($1)`, [fx.orders]);
    await query(`DELETE FROM orders WHERE id = ANY($1)`, [fx.orders]);
  }
  if (fx.students.length) await query(`DELETE FROM students WHERE id = ANY($1)`, [fx.students]);
  if (fx.users.length) await query(`DELETE FROM notifications WHERE user_id = ANY($1)`, [fx.users]);
  if (fx.users.length) await query(`DELETE FROM users WHERE id = ANY($1)`, [fx.users]);
  if (fx.products.length) await query(`DELETE FROM products WHERE id = ANY($1)`, [fx.products]);
});
