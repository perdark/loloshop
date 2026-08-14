'use strict';
// طقم (full-set) order edit must NOT destroy the generated calligraphy plate.
//
// WHY THIS FILE EXISTS. Migration 080 split `order_items.customer_image_url` into two columns:
// the student's uploaded reference photo stays put, the generated plate moves to
// `plate_image_url`. `persistFullSetOrder` rebuilds a bundle by DELETE-ing every order_item and
// re-INSERTing it from the request payload — and the plate is NOT in that payload, because it is
// a server-side artifact produced by the generator, not something the form posts.
//
// Before 080 this happened to be safe: the plate lived in `customer_image_url`, which
// `readFullSetOrder` DOES read back and the form DOES resubmit, so the plate round-tripped by
// accident. After the split that accident stopped working, and any طقم save — a measurement, a
// piece toggle, a note — silently threw away already-paid-for AI artwork. Measured on the dev
// snapshot: 1 plate -> 0 plates on a single no-op re-save.
//
// The fix preserves the plate server-side, keyed by label, across the delete/re-insert. It is
// deliberately NOT round-tripped through the client, so a browser cannot clear a plate by posting
// an empty field. This test is the guard: it drives the REAL persistFullSetOrder against the
// laptop-local dev PG (:5433), and is fully self-cleaning.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert');
const { persistFullSetOrder, readFullSetOrder } = require('../lib/fullSetOrder');
const { query } = require('../lib/db');

const TAG = `ZZTEST-plate-${Date.now().toString(36)}`;
const fx = { users: [], students: [], wholesalers: [], orders: [] };
const ctx = {};

const PLATE_URL = 'http://localhost:4000/uploads/calligraphy/plates/zztest-plate-survival.png';
const FRONT_LABEL = 'تطريز الوشاح من الأمام';

function body() {
  return {
    selected_pieces: ['sash'],
    sash_type: 'عادي',
    notes: `${TAG} note`,
    embroidery: {
      sash_front: { text: 'محمد باقر', image_url: '' },
      sash_back: { text: '', image_url: '' },
    },
  };
}

test.before(async () => {
  const wu = await query(
    `INSERT INTO users (name, phone, password_hash, role) VALUES ($1, $2, 'x', 'wholesaler') RETURNING id`,
    [`${TAG} ممثل`, `0771${Math.floor(Math.random() * 10000000)}`]
  );
  fx.users.push(wu.rows[0].id);
  const w = await query(
    `INSERT INTO wholesalers (user_id, referral_code) VALUES ($1, $2) RETURNING id`,
    [wu.rows[0].id, `${TAG}`.slice(0, 20)]
  );
  ctx.wholesalerId = w.rows[0].id;
  fx.wholesalers.push(ctx.wholesalerId);

  const su = await query(
    `INSERT INTO users (name, phone, password_hash, role) VALUES ($1, $2, 'x', 'retail') RETURNING id`,
    [`${TAG} طالب`, `0772${Math.floor(Math.random() * 10000000)}`]
  );
  fx.users.push(su.rows[0].id);
  const s = await query(
    `INSERT INTO students (user_id, full_name_third, status, wholesaler_id)
     VALUES ($1, $2, 'approved', $3) RETURNING id`,
    [su.rows[0].id, `${TAG} طالب ثلاثي`, ctx.wholesalerId]
  );
  ctx.studentId = s.rows[0].id;
  fx.students.push(ctx.studentId);

  ctx.student = {
    id: ctx.studentId,
    name: `${TAG} طالب`,
    phone: `0772${Math.floor(Math.random() * 10000000)}`,
    wholesaler_id: ctx.wholesalerId,
  };
});

test.after(async () => {
  await query(
    `DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE student_id = ANY($1::uuid[]))`,
    [fx.students]
  );
  await query(`DELETE FROM orders WHERE student_id = ANY($1::uuid[])`, [fx.students]);
  await query(`DELETE FROM students WHERE id = ANY($1::uuid[])`, [fx.students]);
  await query(`DELETE FROM wholesalers WHERE id = ANY($1::uuid[])`, [fx.wholesalers]);
  await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [fx.users]);
  const left = await query(`SELECT count(*)::int n FROM students WHERE full_name_third LIKE $1`, [`${TAG}%`]);
  assert.strictEqual(left.rows[0].n, 0, 'fixture rows left behind');
});

test('a طقم re-save preserves the generated calligraphy plate', async () => {
  // 1. Place the order.
  const created = await persistFullSetOrder({ student: ctx.student, body: body(), actorUserId: null });
  assert.strictEqual(created.status, 201, 'order should be created');

  // 2. The generator links a plate onto the front-embroidery line (what autoLinkPlate does).
  const linked = await query(
    `UPDATE order_items oi SET plate_image_url = $1
       FROM orders o
      WHERE o.id = oi.order_id AND o.student_id = $2 AND o.design_id IS NULL
        AND o.status <> 'cancelled' AND oi.label_snapshot = $3`,
    [PLATE_URL, ctx.studentId, FRONT_LABEL]
  );
  assert.strictEqual(linked.rowCount, 1, 'exactly one front-embroidery line should take the plate');

  // 3. The rep edits the order — here a no-op re-save, which is the weakest possible edit.
  //    Anything stronger (a measurement, a piece toggle) goes through the same rebuild.
  const again = await readFullSetOrder(ctx.studentId);
  assert.ok(again, 'the order should read back');
  const resaved = await persistFullSetOrder({ student: ctx.student, body: again, actorUserId: null });
  assert.ok(resaved.status === 200 || resaved.status === 201, `re-save should succeed, got ${resaved.status}`);

  // 4. The plate must still be attached. Before the fix this returned 0 rows.
  const after = await query(
    `SELECT oi.plate_image_url
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.student_id = $1 AND o.design_id IS NULL AND o.status <> 'cancelled'
        AND oi.plate_image_url IS NOT NULL`,
    [ctx.studentId]
  );
  assert.strictEqual(after.rowCount, 1, 'the plate was destroyed by the re-save');
  assert.strictEqual(after.rows[0].plate_image_url, PLATE_URL, 'the plate URL changed');
});

test('the re-save does not invent a plate on a line that never had one', async () => {
  // The preservation is keyed by label, so it must not smear the plate across sibling lines.
  const rows = await query(
    `SELECT count(*)::int n
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.student_id = $1 AND o.design_id IS NULL AND o.status <> 'cancelled'
        AND oi.plate_image_url IS NOT NULL AND oi.label_snapshot <> $2`,
    [ctx.studentId, FRONT_LABEL]
  );
  assert.strictEqual(rows.rows[0].n, 0, 'a plate leaked onto a line that never had one');
});
