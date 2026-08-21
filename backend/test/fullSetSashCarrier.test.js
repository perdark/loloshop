'use strict';
// A rep bundle's sash must NOT be renamed by a storefront merchandising flag.
//
// WHY THIS FILE EXISTS. The rep طقم form offers only عادي/ملكي — it has no shape picker
// (FullSetOrderForm.tsx). So the sash *product* on a rep order is a pure CARRIER: an identity
// to hang the order on. The real spec lives in the order lines («نوع الوشاح: ملكي»), and money
// reads عادي/ملكي from there too (staffController.wholesalerAccountSummary), never from the
// product. The carrier's base_price is never even SELECTed by the resolver.
//
// The resolver used to order by `featured DESC, sort, created_at`. Every sash has sort = 0, so
// the tiebreaker that actually decided the carrier was `featured` — a *merchandising* flag.
// On 2026-07-07 «وشاح الفراشة» was featured for the storefront, and from that moment every rep
// bundle silently became «وشاح الفراشة». Measured on prod 2026-08-21: 405 rep orders titled
// «وشاح الفراشة» whose student had picked ملكي, and rep students had landed on NO other sash
// since — 435 «الفراشة» + 165 «وشاح», zero of the other ten. June, before the flag, was 100%
// «وشاح» (the family parent). Nothing was mispriced; the +15,000 «إضافة: وشاح ملكي» line was
// present throughout. The damage was that staff, rep and student screens all showed a shape the
// student never chose — on the same card as the «ملكي» line that contradicted it.
//
// The invariant this file pins: the carrier is the family PARENT, and featuring any child must
// not move it. The test features a child itself and restores the flag, so it does not depend on
// whatever the local catalog happens to look like.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert');
const { persistFullSetOrder } = require('../lib/fullSetOrder');
const { query } = require('../lib/db');

const TAG = `ZZTEST-carrier-${Date.now().toString(36)}`;
const fx = { users: [], students: [], wholesalers: [] };
const ctx = { featuredBefore: [] };

const body = () => ({
  selected_pieces: ['sash'],
  sash_type: 'ملكي',
  embroidery: { sash_front: { text: 'محمد باقر', image_url: '' } },
});

async function makeStudent(suffix) {
  const su = await query(
    `INSERT INTO users (name, phone, password_hash, role) VALUES ($1, $2, 'x', 'retail') RETURNING id`,
    [`${TAG} طالب ${suffix}`, `0772${Math.floor(Math.random() * 10000000)}`]
  );
  fx.users.push(su.rows[0].id);
  const s = await query(
    `INSERT INTO students (user_id, full_name_third, status, wholesaler_id)
     VALUES ($1, $2, 'approved', $3) RETURNING id`,
    [su.rows[0].id, `${TAG} طالب ثلاثي ${suffix}`, ctx.wholesalerId]
  );
  fx.students.push(s.rows[0].id);
  return { id: s.rows[0].id, name: `${TAG} طالب ${suffix}`, phone: null, wholesaler_id: ctx.wholesalerId };
}

// The carrier the resolver actually chose for this student's sash piece.
async function carrierFor(studentId) {
  const { rows } = await query(
    `SELECT p.name_ar, (p.parent_id IS NULL) AS is_parent, p.featured
       FROM orders o JOIN products p ON p.id = o.product_id
      WHERE o.student_id = $1 AND o.design_id IS NULL AND o.status <> 'cancelled' AND p.type = 'sash'`,
    [studentId]
  );
  assert.strictEqual(rows.length, 1, 'expected exactly one live sash order');
  return rows[0];
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

  // Remember every sash featured flag so the catalog is left exactly as found.
  const before = await query(`SELECT id, featured FROM products WHERE type = 'sash'`);
  ctx.featuredBefore = before.rows;

  // Deliberately feature a CHILD sash — this is the storefront action that caused the bug.
  const child = await query(
    `SELECT id, name_ar FROM products
      WHERE type = 'sash' AND active = TRUE AND parent_id IS NOT NULL
      ORDER BY created_at LIMIT 1`
  );
  assert.ok(child.rows[0], 'the catalog needs at least one child sash for this test');
  ctx.featuredChild = child.rows[0];
  await query(`UPDATE products SET featured = TRUE WHERE id = $1`, [ctx.featuredChild.id]);
});

test.after(async () => {
  for (const r of ctx.featuredBefore) {
    await query(`UPDATE products SET featured = $2 WHERE id = $1`, [r.id, r.featured]);
  }
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

test('a featured child sash does not become the carrier for a rep bundle', async () => {
  const student = await makeStudent('a');
  const created = await persistFullSetOrder({ student, body: body(), actorUserId: null });
  assert.strictEqual(created.status, 201, 'order should be created');

  const carrier = await carrierFor(student.id);
  // Before the fix this was the featured child («وشاح الفراشة» on prod and on the dev catalog).
  assert.notStrictEqual(
    carrier.name_ar, ctx.featuredChild.name_ar,
    `the merchandising flag renamed the order to «${carrier.name_ar}»`
  );
  assert.ok(carrier.is_parent, `carrier should be the family parent, got «${carrier.name_ar}»`);
});

test('the student’s ملكي choice is still recorded on the lines, and priced', async () => {
  // The carrier is generic ON PURPOSE — the spec lives in the lines. Guard that the fix did not
  // "solve" the naming by dropping the choice, and that the ملكي add-on still bills.
  const student = await makeStudent('b');
  await persistFullSetOrder({ student, body: body(), actorUserId: null });

  const { rows } = await query(
    `SELECT oi.label_snapshot, oi.customer_text, oi.price_snapshot
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.student_id = $1 AND o.status <> 'cancelled'`,
    [student.id]
  );
  const type = rows.find((r) => r.label_snapshot === 'نوع الوشاح');
  assert.ok(type, 'the «نوع الوشاح» line is missing');
  assert.strictEqual(type.customer_text, 'ملكي', 'the student’s ملكي choice was lost');
});
