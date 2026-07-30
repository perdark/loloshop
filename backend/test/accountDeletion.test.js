'use strict';
// Self-service account deletion — Apple guideline 5.1.1(v), migration 076.
// Runs against the LAPTOP-LOCAL dev PG (:5433). Self-cleaning. Never point at prod.
//
// The property under test is the split: the ACCOUNT is destroyed, the ORDER is kept.
// Get that backwards in either direction and the feature fails — erase the order and
// the shop loses a sale it has already cut fabric for; keep the account and Apple
// rejects the submission again.

require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { query } = require('../lib/db');
const account = require('../controllers/accountController');
const { authRequired } = require('../middleware/auth');

const TAG = `del-${crypto.randomBytes(4).toString('hex')}`;
const PASSWORD = 'DeleteMe#2026';
const createdUsers = [];
const createdGroups = [];

function freshPhone() {
  return '077' + String(crypto.randomInt(0, 1e8)).padStart(8, '0');
}

function mkRes() {
  return {
    code: 200,
    body: null,
    status(c) {
      this.code = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}

function mkReq(user, body = {}) {
  return { user, body, params: {}, query: {}, ip: '127.0.0.1', headers: {}, socket: {} };
}

/** A retail student with the full spread of personal data the deletion must clear. */
async function makeStudent({ role = 'retail' } = {}) {
  const phone = freshPhone();
  const hash = await bcrypt.hash(PASSWORD, 10);
  const u = await query(
    `INSERT INTO users (name, phone, email, password_hash, role, phone_verified)
     VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING id, role, token_version`,
    // email is UNIQUE — one address per fixture, or the fixtures collide, not the code.
    [`${TAG}-طالبة`, phone, `${TAG}-${phone}@example.com`, hash, role]
  );
  const user = u.rows[0];
  createdUsers.push(user.id);

  if (role === 'retail') {
    await query(
      `INSERT INTO students (user_id, full_name_third, university_name, department,
                             gender, study_type, instagram_username, status)
       VALUES ($1, $2, 'جامعة بغداد', 'هندسة', 'female', 'morning', $3, 'approved')`,
      [user.id, `${TAG}-الاسم الثلاثي`, `${TAG}_insta`]
    );
  }
  return { ...user, phone };
}

/** A live order for that student, with the delivery snapshot a real order carries. */
async function makeOrder(userId) {
  const s = await query(`SELECT id FROM students WHERE user_id = $1`, [userId]);
  const p = await query(`SELECT id FROM products LIMIT 1`);
  assert.ok(p.rows.length, 'dev DB needs at least one product');
  const g = await query(
    `INSERT INTO checkout_groups (customer_name, phone_primary, instagram_username, governorate)
     VALUES ($1, '07701234567', $2, 'بغداد') RETURNING id`,
    [`${TAG}-اسم التسليم`, `${TAG}_insta`]
  );
  createdGroups.push(g.rows[0].id);
  const o = await query(
    `INSERT INTO orders (student_id, product_id, price, status, checkout_group_id)
     VALUES ($1, $2, 65000, 'embroidery', $3) RETURNING id`,
    [s.rows[0].id, p.rows[0].id, g.rows[0].id]
  );
  return { orderId: o.rows[0].id, groupId: g.rows[0].id, studentId: s.rows[0].id };
}

test.after(async () => {
  for (const id of createdUsers) {
    const s = await query(`SELECT id FROM students WHERE user_id = $1`, [id]);
    for (const row of s.rows) {
      await query(`DELETE FROM orders WHERE student_id = $1`, [row.id]);
    }
    await query(`DELETE FROM audit_log WHERE actor_id = $1`, [id]);
    await query(`DELETE FROM students WHERE user_id = $1`, [id]);
    await query(`DELETE FROM users WHERE id = $1`, [id]);
  }
  for (const id of createdGroups) {
    await query(`DELETE FROM checkout_groups WHERE id = $1`, [id]);
  }
});

test('preview reports the active orders a student is about to leave behind', async () => {
  const user = await makeStudent();
  await makeOrder(user.id);
  const res = mkRes();
  await account.deletionPreview(mkReq(user), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.eligible, true);
  assert.equal(res.body.active_orders, 1, 'an embroidery order is still active');
  assert.equal(res.body.total_orders, 1);
});

test('a wrong password does not delete the account', async () => {
  const user = await makeStudent();
  const res = mkRes();
  await account.deleteAccount(mkReq(user, { password: 'not-the-password' }), res);
  assert.equal(res.code, 401);
  assert.equal(res.body.code, 'ERR_INVALID_CREDENTIALS');
  const check = await query(`SELECT deleted_at, phone FROM users WHERE id = $1`, [user.id]);
  assert.equal(check.rows[0].deleted_at, null, 'account must survive a failed confirmation');
  assert.ok(check.rows[0].phone, 'phone must survive a failed confirmation');
});

test('a missing password is rejected before any write', async () => {
  const user = await makeStudent();
  const res = mkRes();
  await account.deleteAccount(mkReq(user, {}), res);
  assert.equal(res.code, 400);
  assert.equal(res.body.field, 'password');
  const check = await query(`SELECT deleted_at FROM users WHERE id = $1`, [user.id]);
  assert.equal(check.rows[0].deleted_at, null);
});

test('deletion erases the account but keeps the order and its delivery snapshot', async () => {
  const user = await makeStudent();
  const { orderId, groupId, studentId } = await makeOrder(user.id);

  // Personal data that must not survive.
  await query(`INSERT INTO carts (user_id) VALUES ($1)`, [user.id]);
  await query(
    `INSERT INTO notifications (user_id, type, title_ar) VALUES ($1, 'test', 'تنبيه')`,
    [user.id]
  );
  await query(
    `INSERT INTO trusted_devices (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '90 days')`,
    [user.id, crypto.randomBytes(32).toString('hex')]
  );

  const res = mkRes();
  await account.deleteAccount(mkReq(user, { password: PASSWORD }), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.data.deleted, true);
  assert.equal(res.body.data.already_deleted, false);
  assert.equal(res.body.data.retained_orders, 1);

  // --- the account is gone -------------------------------------------------
  const u = await query(
    `SELECT name, phone, email, password_hash, phone_verified, token_version, deleted_at
     FROM users WHERE id = $1`,
    [user.id]
  );
  const row = u.rows[0];
  assert.equal(row.phone, null, 'phone NULLed — login looks accounts up BY phone');
  assert.equal(row.email, null);
  assert.equal(row.name, 'حساب محذوف');
  assert.equal(row.phone_verified, false);
  assert.ok(row.deleted_at, 'deleted_at stamped');
  assert.equal(
    Number(row.token_version),
    Number(user.token_version) + 1,
    'token_version bumped — every issued JWT dies at once'
  );
  assert.equal(
    await bcrypt.compare(PASSWORD, row.password_hash),
    false,
    'the old password must no longer match'
  );

  const s = await query(
    `SELECT full_name_third, instagram_username, university_name, department
     FROM students WHERE id = $1`,
    [studentId]
  );
  assert.equal(s.rows[0].full_name_third, 'حساب محذوف');
  assert.equal(s.rows[0].instagram_username, null);
  assert.equal(s.rows[0].university_name, null);
  assert.equal(s.rows[0].department, null);

  for (const table of ['carts', 'notifications', 'trusted_devices']) {
    const left = await query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE user_id = $1`, [
      user.id,
    ]);
    assert.equal(left.rows[0].n, 0, `${table} must be cleared`);
  }

  // --- the order is NOT gone -----------------------------------------------
  const o = await query(`SELECT id, status FROM orders WHERE id = $1`, [orderId]);
  assert.equal(o.rows.length, 1, 'the sale survives — it is a business record');
  assert.equal(o.rows[0].status, 'embroidery', 'and it is still in production');

  const g = await query(
    `SELECT customer_name, phone_primary FROM checkout_groups WHERE id = $1`,
    [groupId]
  );
  assert.equal(
    g.rows[0].customer_name,
    `${TAG}-اسم التسليم`,
    'the delivery snapshot stays, so an in-flight sash can still be finished'
  );
  assert.ok(g.rows[0].phone_primary, 'and the shop can still reach whoever collects it');

  // --- it is audited --------------------------------------------------------
  const a = await query(
    `SELECT action, details FROM audit_log WHERE actor_id = $1 AND action = 'account_self_delete'`,
    [user.id]
  );
  assert.equal(a.rows.length, 1);
  assert.equal(a.rows[0].details.total_orders, 1);
  assert.equal(
    JSON.stringify(a.rows[0].details).includes(TAG),
    false,
    'the audit row must not re-store the personal data just erased'
  );
});

test('the account cannot be signed into again, by phone or by an existing token', async () => {
  const user = await makeStudent();
  // A token minted while the account was alive — the realistic attack: the phone
  // stays signed in after deletion.
  const liveToken = jwt.sign(
    { sub: user.id, role: user.role, name: 'x', ver: Number(user.token_version) },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '7d' }
  );

  const res = mkRes();
  await account.deleteAccount(mkReq(user, { password: PASSWORD }), res);
  assert.equal(res.code, 200);

  // Password login: the lookup is by phone, and the phone is now NULL.
  const byPhone = await query(`SELECT id FROM users WHERE phone = $1`, [user.phone]);
  assert.equal(byPhone.rows.length, 0, 'the number no longer resolves to any account');

  // Bearer token: rejected by authRequired.
  const authRes = mkRes();
  let nextCalled = false;
  await authRequired(
    { headers: { authorization: `Bearer ${liveToken}` } },
    authRes,
    () => {
      nextCalled = true;
    }
  );
  assert.equal(nextCalled, false, 'a token minted before deletion must not authenticate');
  assert.equal(authRes.code, 401);
});

test('two concurrent delete requests erase the account exactly once', async () => {
  const user = await makeStudent();
  const resA = mkRes();
  const resB = mkRes();
  await Promise.all([
    account.deleteAccount(mkReq(user, { password: PASSWORD }), resA),
    account.deleteAccount(mkReq(user, { password: PASSWORD }), resB),
  ]);
  const bodies = [resA, resB].filter((r) => r.code === 200).map((r) => r.body.data);
  assert.ok(bodies.length >= 1, 'at least one request must succeed');
  // Whichever ordering the DB picks, the account ends up deleted exactly once and
  // token_version moves by exactly one — a double bump would mean a double erase.
  const u = await query(`SELECT token_version, deleted_at FROM users WHERE id = $1`, [user.id]);
  assert.ok(u.rows[0].deleted_at);
  assert.equal(
    Number(u.rows[0].token_version),
    Number(user.token_version) + 1,
    'the UPDATE guard makes the erase idempotent'
  );
  const audits = await query(
    `SELECT COUNT(*)::int AS n FROM audit_log WHERE actor_id = $1 AND action = 'account_self_delete'`,
    [user.id]
  );
  assert.equal(audits.rows[0].n, 1, 'exactly one audit row');
});

test('a non-retail account cannot delete itself', async () => {
  const staff = await makeStudent({ role: 'staff' });
  const res = mkRes();
  await account.deleteAccount(mkReq(staff, { password: PASSWORD }), res);
  assert.equal(res.code, 403);
  assert.equal(res.body.code, 'ERR_ROLE_NOT_SELF_DELETABLE');
  const check = await query(`SELECT deleted_at, phone FROM users WHERE id = $1`, [staff.id]);
  assert.equal(check.rows[0].deleted_at, null, 'a payroll identity must survive');
  assert.ok(check.rows[0].phone);
});

test('preview tells a non-retail account why it has no delete button', async () => {
  const staff = await makeStudent({ role: 'staff' });
  const res = mkRes();
  await account.deletionPreview(mkReq(staff), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.eligible, false);
  assert.ok(res.body.reason_ar, 'the screen needs an Arabic reason to show');
});
