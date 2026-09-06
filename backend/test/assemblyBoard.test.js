'use strict';
// «التجميع» end to end, against the DB: a rep sash walks التطريز → التجميع → الكوي and back,
// and برزان's board (GET /production/assembly) shows it «واصلة» from the first ticked zone and
// «جاهزة» from the last. A retail sash with the same ticks goes straight to الكوي and is never
// on the board; an unapproved rep sash is never on the board either (the rep-approval gate is
// inherited by the board's WHERE, not re-implemented).
//
// The board READS status + embroidery_zones. It never derives status from zones (D1) and it
// never writes anything — assert that by advancing through the real `advance`/`revert`.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { advance, revert, markEmbroideryZone, getAssemblyBoard } = require('../controllers/productionController');
const { query } = require('../lib/db');

const TAG = `ZZTEST-assembly-${crypto.randomUUID().slice(0, 8)}`;
const fx = { users: [], students: [], wholesalers: [], orders: [], products: [] };
const ctx = {};

function mockRes() {
  const res = { statusCode: 200, body: null, status(c) { res.statusCode = c; return res; }, json(b) { res.body = b; return res; } };
  return res;
}
async function call(handler, req) { const res = mockRes(); await handler(req, res); return res; }
const board = async (user) => (await call(getAssemblyBoard, { user, query: {} })).body.data;
const onBoard = (b, id) => ({ arriving: b.arriving.find((r) => r.id === id) || null, ready: b.ready.find((r) => r.id === id) || null });
const statusOf = async (id) => (await query(`SELECT status::text AS s FROM orders WHERE id=$1`, [id])).rows[0].s;

let seq = 0;
async function makeStudent(wholesalerId) {
  const u = await query(
    `INSERT INTO users (name, phone, password_hash, role, deleted_at) VALUES ($1,$2,'x','retail',NOW()) RETURNING id`,
    [`${TAG}-student-${++seq}`, `0788${(Date.now() + seq) % 10000000}`]
  );
  fx.users.push(u.rows[0].id);
  const s = await query(
    `INSERT INTO students (user_id, wholesaler_id, full_name_third, status) VALUES ($1,$2,$3,'approved') RETURNING id`,
    [u.rows[0].id, wholesalerId, `${TAG}-student-${seq}`]
  );
  fx.students.push(s.rows[0].id);
  return s.rows[0].id;
}
/** A sash at التطريز with TWO detected zones (خلف + أمام), both unticked. */
async function makeSash(studentId, { approval = 'approved', type = 'sash' } = {}) {
  const p = await query(`INSERT INTO products (name_ar, type, base_price, active) VALUES ($1,$2,1000,TRUE) RETURNING id`, [`${TAG}-${type}-${++seq}`, type]);
  fx.products.push(p.rows[0].id);
  const o = await query(
    `INSERT INTO orders (student_id, product_id, price, status, has_embroidery, needs_pressing, wholesaler_approval)
     VALUES ($1,$2,1000,'embroidery',TRUE,TRUE,$3) RETURNING id`,
    [studentId, p.rows[0].id, approval]
  );
  const id = o.rows[0].id; fx.orders.push(id);
  await query(`INSERT INTO order_items (order_id, label_snapshot, customer_text) VALUES ($1,'تطريز الوشاح من الخلف',$2), ($1,'تطريز الوشاح من الأمام',$2)`, [id, TAG]);
  return id;
}
async function retire(id) {
  await query(`DELETE FROM order_items WHERE order_id = $1`, [id]);
  await query(`DELETE FROM staff_activity_log WHERE order_id = $1`, [id]);
  await query(`DELETE FROM audit_log WHERE entity_id = $1`, [id]);
  await query(`DELETE FROM orders WHERE id = $1`, [id]);
  const i = fx.orders.indexOf(id); if (i >= 0) fx.orders.splice(i, 1);
}

test('setup', async () => {
  const wu = await query(`INSERT INTO users (name, phone, password_hash, role, deleted_at) VALUES ($1,$2,'x','wholesaler',NOW()) RETURNING id`, [`${TAG}-rep`, `0787${Date.now() % 10000000}`]);
  fx.users.push(wu.rows[0].id);
  const w = await query(`INSERT INTO wholesalers (user_id, university_name, referral_code) VALUES ($1,$2,$3) RETURNING id`, [wu.rows[0].id, `${TAG}-uni`, TAG.slice(-12)]);
  ctx.wholesalerId = w.rows[0].id; fx.wholesalers.push(ctx.wholesalerId);
  ctx.repStudent = await makeStudent(ctx.wholesalerId);
  ctx.retailStudent = await makeStudent(null);
  const st = (type) => ({ id: fx.users[0], role: 'staff', staff_type: type, staff_types: [type], order_scope: 'both' });
  ctx.embroiderer = st('embroiderer');
  ctx.assembler = st('assembler');
  ctx.presser = st('presser');
  ctx.tailor = st('tailor');
});

test('a rep sash: arriving from the first tick, ready from the last, then الكوي and back', async () => {
  const id = await makeSash(ctx.repStudent);
  let b = await board(ctx.assembler);
  assert.equal(onBoard(b, id).arriving, null, 'nothing ticked → not on the board yet');

  let r = await call(markEmbroideryZone, { params: { id }, body: { zone: 'sash_back', done: true }, user: ctx.embroiderer });
  assert.equal(r.statusCode, 200);
  assert.equal(await statusOf(id), 'embroidery', 'one of two zones → still التطريز (D1)');
  b = await board(ctx.assembler);
  const arr = onBoard(b, id).arriving;
  assert.ok(arr, 'first tick → «واصلة»');
  assert.equal(arr.done_count, 1); assert.equal(arr.total_count, 2);
  assert.equal(arr.can_advance, false); assert.equal(arr.advance_label, null);
  assert.deepEqual(arr.zones.map((z) => [z.key, z.done]), [['sash_back', true], ['sash_front', false]]);

  r = await call(markEmbroideryZone, { params: { id }, body: { zone: 'sash_front', done: true }, user: ctx.embroiderer });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.data.advanced, true);
  assert.equal(await statusOf(id), 'assembly', 'last tick auto-advances into التجميع');
  b = await board(ctx.assembler);
  const rd = onBoard(b, id).ready;
  assert.ok(rd, 'status assembly → «جاهزة»');
  assert.equal(onBoard(b, id).arriving, null);
  assert.equal(rd.can_advance, true);
  assert.equal(rd.advance_label, 'إنهاء التجميع، نقل للكوي');
  assert.equal(rd.done_count, 2);

  r = await call(advance, { params: { id }, user: ctx.assembler });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(await statusOf(id), 'pressing');
  b = await board(ctx.assembler);
  assert.equal(onBoard(b, id).ready, null, 'gone from the board once at الكوي');

  r = await call(revert, { params: { id }, user: ctx.presser });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(await statusOf(id), 'assembly', 'المكوجي’s revert lands on التجميع, not التطريز');
  b = await board(ctx.presser);
  assert.ok(onBoard(b, id).ready, 'and it is back on the board — a presser may look too');
  await retire(id);
});

test('a retail sash with the same two ticks goes to الكوي and is never on the board', async () => {
  const id = await makeSash(ctx.retailStudent);
  await call(markEmbroideryZone, { params: { id }, body: { zone: 'sash_back', done: true }, user: ctx.embroiderer });
  let b = await board(ctx.assembler);
  assert.deepEqual(onBoard(b, id), { arriving: null, ready: null });
  const r = await call(markEmbroideryZone, { params: { id }, body: { zone: 'sash_front', done: true }, user: ctx.embroiderer });
  assert.equal(r.body.data.status, 'pressing');
  b = await board(ctx.assembler);
  assert.deepEqual(onBoard(b, id), { arriving: null, ready: null });
  await retire(id);
});

test('a rep ROBE never enters التجميع (owner 2026-09-06: sashes only)', async () => {
  const id = await makeSash(ctx.repStudent, { type: 'robe' });
  await call(markEmbroideryZone, { params: { id }, body: { zone: 'sash_back', done: true }, user: ctx.embroiderer });
  const r = await call(markEmbroideryZone, { params: { id }, body: { zone: 'sash_front', done: true }, user: ctx.embroiderer });
  assert.equal(r.body.data.status, 'pressing');
  const b = await board(ctx.assembler);
  assert.deepEqual(onBoard(b, id), { arriving: null, ready: null });
  await retire(id);
});

test('an UNAPPROVED rep sash is never on the board — the rep-approval gate is inherited', async () => {
  const id = await makeSash(ctx.repStudent, { approval: 'pending' });
  await query(`UPDATE orders SET embroidery_zones = '{"sash_back": true}'::jsonb WHERE id = $1`, [id]);
  const b = await board(ctx.assembler);
  assert.deepEqual(onBoard(b, id), { arriving: null, ready: null });
  await retire(id);
});

test('the board carries no money and no contact; مفصل may not open it', async () => {
  const id = await makeSash(ctx.repStudent);
  await query(`UPDATE orders SET status = 'assembly' WHERE id = $1`, [id]);
  const b = await board(ctx.assembler);
  const row = onBoard(b, id).ready;
  assert.ok(row);
  for (const k of ['price', 'cost', 'profit', 'phone', 'student_phone', 'wholesaler_phone', 'embroidery_zones']) {
    assert.ok(!(k in row), `${k} must not be on a board row`);
  }
  const res = await call(getAssemblyBoard, { user: ctx.tailor, query: {} });
  assert.equal(res.statusCode, 403);
  await retire(id);
});

test('teardown', async () => {
  if (fx.orders.length) {
    await query(`DELETE FROM order_items WHERE order_id = ANY($1)`, [fx.orders]);
    await query(`DELETE FROM staff_activity_log WHERE order_id = ANY($1)`, [fx.orders]);
    await query(`DELETE FROM audit_log WHERE entity_id = ANY($1)`, [fx.orders]);
    await query(`DELETE FROM orders WHERE id = ANY($1)`, [fx.orders]);
  }
  if (fx.users.length) await query(`DELETE FROM notifications WHERE user_id = ANY($1)`, [fx.users]);
  if (fx.students.length) await query(`DELETE FROM students WHERE id = ANY($1)`, [fx.students]);
  if (fx.wholesalers.length) await query(`DELETE FROM wholesalers WHERE id = ANY($1)`, [fx.wholesalers]);
  if (fx.users.length) await query(`DELETE FROM users WHERE id = ANY($1)`, [fx.users]);
  if (fx.products.length) await query(`DELETE FROM products WHERE id = ANY($1)`, [fx.products]);
});
