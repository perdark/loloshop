'use strict';
// «طلبك جاهز للاستلام» — ONE notification per طقم, sent once, re-armed if the set un-finishes.
// Runs against the LAPTOP-LOCAL dev PG (:5433). Self-cleaning. Never point at prod.
//
// This is the notification that replaced the per-stage one paused on 2026-09-14, so the things
// worth a red test are the ones that made the old one wrong:
//   1. it must NOT fire on a piece — only when every live piece in the checkout group is done
//      (180 students on the prod restore had exactly that mixed state);
//   2. it must fire ONCE, or a طقم whose last two pieces finish seconds apart buzzes twice;
//   3. it must RE-ARM when the set stops being finished, or a student whose order was pulled
//      back out of ready is never told when it is really ready;
//   4. a cancelled piece must not hold the set hostage, and a returned one is not in the set
//      at all (the student cannot see it on «طلباتي»).
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { query, tx } = require('../lib/db');
const { notifySetReady } = require('../lib/studentOrderNotices');

const TAG = `setready-${crypto.randomBytes(4).toString('hex')}`;
const freshPhone = () => '077' + String(crypto.randomInt(0, 1e8)).padStart(8, '0');

// ⚠️ ONE STUDENT PER TEST, AND ONE PRODUCT PER PIECE.
// `uq_orders_student_product_nodesign` is a partial unique index on (student_id, product_id)
// for design-less, non-cancelled orders — so a student cannot hold two orders of the same
// product, and a shared fixture student collides across tests. That index is not an obstacle
// to work around: the real طقم is a روب, a وشاح and a قبعة, one of each.
let products = [];
const made = [];

// ⚠️ EVERY FIXTURE STUDENT IS CREATED IN ONE BURST IN `before`, AND HANDED OUT BY INDEX.
// `node --test` runs FILES in parallel, and two tests elsewhere (anonymousDevicePush's
// «كل الأجهزة» pair) assert that two independently-taken live COUNTs of `users` agree. A file
// that inserts a user in the middle of its own body straddles those two counts and fails
// somebody else's test — the same shape the HANDOFF documents for adminNumbers.test.js.
// Front-loading does not make that assertion safe, but it shrinks this file's churn from
// "any moment during the run" to two tight bursts.
let handedOut = 0;
function nextStudent() {
  assert.ok(handedOut < made.length, 'raise STUDENT_POOL — the fixtures are created up front');
  return made[handedOut++];
}

/** Count the set-ready notifications this student has. */
async function noticeCount(userId) {
  const { rows } = await query(
    `SELECT count(*)::int n FROM notifications WHERE user_id = $1 AND type = 'order_ready'`, [userId]);
  return rows[0].n;
}

/** Drive the real helper the way the controllers do — inside a transaction. */
const run = (orderId) => tx((client) => notifySetReady(client, orderId));

/** A fresh student holding one طقم in the given statuses. */
async function set(statuses, { returned = [], group = crypto.randomUUID() } = {}) {
  const who = nextStudent();
  const ids = [];
  for (let i = 0; i < statuses.length; i++) {
    const { rows } = await query(
      `INSERT INTO orders (student_id, product_id, status, price, checkout_group_id, returned_to_customer)
       VALUES ($1,$2,$3,0,$4,$5) RETURNING id`,
      [who.studentId, products[i], statuses[i], group, returned.includes(i)]);
    ids.push(rows[0].id);
  }
  return { ...who, ids };
}

const setStatus = (id, s) => query(`UPDATE orders SET status = $2 WHERE id = $1`, [id, s]);

const STUDENT_POOL = 8;

test.before(async () => {
  const p = await query(`SELECT id FROM products ORDER BY created_at LIMIT 6`);
  products = p.rows.map((r) => r.id);
  assert.ok(products.length >= 4, 'dev DB needs at least 4 products');
  for (let i = 0; i < STUDENT_POOL; i++) {
    const u = await query(
      `INSERT INTO users (name, phone, password_hash, role) VALUES ($1,$2,'x','retail') RETURNING id`,
      [`${TAG}-${i}`, freshPhone()]);
    const st = await query(
      `INSERT INTO students (user_id, full_name_third) VALUES ($1, $2) RETURNING id`,
      [u.rows[0].id, TAG]);
    made.push({ userId: u.rows[0].id, studentId: st.rows[0].id });
  }
});

test.after(async () => {
  for (const { userId, studentId } of made) {
    await query(`DELETE FROM notifications WHERE user_id = $1`, [userId]);
    await query(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE student_id = $1)`, [studentId]);
    await query(`DELETE FROM orders WHERE student_id = $1`, [studentId]);
    await query(`DELETE FROM students WHERE id = $1`, [studentId]);
    await query(`DELETE FROM users WHERE id = $1`, [userId]);
  }
});

test('a set with one piece still in production says NOTHING', async () => {
  const { userId, ids: [cap, sash] } = await set(['ready', 'pressing']);
  assert.equal(await run(cap), false, 'announced a طقم that is not finished');
  assert.equal(await run(sash), false);
  assert.equal(await noticeCount(userId), 0, 'a notification was written anyway');
});

test('the last piece reaching ready announces the whole set — exactly once', async () => {
  const { userId, ids: [a, b] } = await set(['ready', 'pressing']);
  assert.equal(await run(a), false);
  await setStatus(b, 'ready');
  assert.equal(await run(b), true, 'the completed set was not announced');
  assert.equal(await noticeCount(userId), 1);

  // Every other piece of the same set re-checking must stay silent — this is the "two pieces
  // finish seconds apart" case, and it is what the stamp exists for.
  assert.equal(await run(a), false, 'announced twice');
  assert.equal(await run(b), false, 'announced twice');
  assert.equal(await noticeCount(userId), 1);
});

test('a revert out of ready RE-ARMS, and the next completion announces again', async () => {
  const { userId, ids: [a, b] } = await set(['ready', 'ready']);
  assert.equal(await run(a), true);
  assert.equal(await noticeCount(userId), 1);

  await setStatus(b, 'pressing');          // staff pulled it back
  assert.equal(await run(b), false, 'an unfinished set must not announce');
  const stamped = await query(
    `SELECT count(*)::int n FROM orders WHERE id = ANY($1) AND ready_notified_at IS NOT NULL`,
    [[a, b]]);
  assert.equal(stamped.rows[0].n, 0, 'the stamp was not cleared — the student can never be told again');

  await setStatus(b, 'ready');
  assert.equal(await run(b), true, 'the re-finished set was never announced');
  assert.equal(await noticeCount(userId), 2);
});

test('a cancelled piece does not hold the set back', async () => {
  const { userId, ids: [a] } = await set(['ready', 'cancelled']);
  assert.equal(await run(a), true, 'a cancelled piece blocked a finished set');
  assert.equal(await noticeCount(userId), 1);
});

test('a set with nothing live in it says nothing', async () => {
  const { userId, ids: [c, d] } = await set(['cancelled', 'cancelled']);
  assert.equal(await run(c), false, 'announced a set with nothing live in it');
  assert.equal(await run(d), false);
  assert.equal(await noticeCount(userId), 0);
});

test('a RETURNED piece is not part of the set — it neither blocks nor is announced', async () => {
  // Piece 1 is ready, piece 2 was handed back to the student to edit. «طلباتي» shows only the
  // first, so the set the student can see IS finished.
  const { userId, ids: [a, b] } = await set(['ready', 'designing'], { returned: [1] });
  assert.equal(await run(a), true, 'a piece the student cannot even see held the set back');
  assert.equal(await noticeCount(userId), 1);

  // Resubmitted: it re-enters the set in production, so the set un-finishes and re-arms.
  await query(`UPDATE orders SET returned_to_customer = FALSE WHERE id = $1`, [b]);
  assert.equal(await run(b), false);
  await setStatus(b, 'ready');
  assert.equal(await run(b), true, 'the resubmitted piece finishing was never announced');
  assert.equal(await noticeCount(userId), 2);
});

test('a legacy order with no checkout_group_id is its own set', async () => {
  const who = nextStudent();
  const { rows } = await query(
    `INSERT INTO orders (student_id, product_id, status, price, checkout_group_id)
     VALUES ($1,$2,'ready',0,NULL) RETURNING id`, [who.studentId, products[0]]);
  assert.equal(await run(rows[0].id), true);
  assert.equal(await noticeCount(who.userId), 1);
  assert.equal(await run(rows[0].id), false, 'announced twice');
});
