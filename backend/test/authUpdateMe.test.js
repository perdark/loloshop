// PATCH /auth/me — the write side of a field `me` already reads. `students.gender` has
// existed in the schema from the start, but onboarding only ever wrote it to the browser's
// localStorage, so a signed-in student on a second device never saw their own choice (see
// HANDOFF's "Gender never reaches the DB"). This is wiring, not a new model.
//
// Tested directly against the controller (matching this repo's other auth-suite convention),
// against the real dev DB. Self-cleaning.

const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const { query } = require('../lib/db');
const auth = require('../controllers/authController');

const TAG = `me-gender-${crypto.randomBytes(4).toString('hex')}`;
const PASSWORD = `Meg-${crypto.randomBytes(12).toString('hex')}!9`;
const created = [];

function freshPhone() {
  return '074' + String(crypto.randomInt(0, 1e8)).padStart(8, '0');
}

function mockRes() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

async function makeRetailStudent() {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const { rows } = await query(
    `INSERT INTO users (name, phone, password_hash, role) VALUES ($1, $2, $3, 'retail') RETURNING id`,
    [`${TAG}-retail`, freshPhone(), hash]
  );
  created.push(rows[0].id);
  await query(
    `INSERT INTO students
       (user_id, full_name_third, university_name, department, study_type, instagram_username, status)
     VALUES ($1, $2, 'جامعة بغداد', 'هندسة', 'morning', $3, 'approved')`,
    [rows[0].id, `${TAG}-name`, `${TAG}_insta`]
  );
  return rows[0].id;
}

// A role with no `students` row at all — the negative case the endpoint must reject.
async function makeWholesaler() {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const { rows } = await query(
    `INSERT INTO users (name, phone, password_hash, role) VALUES ($1, $2, $3, 'wholesaler') RETURNING id`,
    [`${TAG}-wholesaler`, freshPhone(), hash]
  );
  created.push(rows[0].id);
  return rows[0].id;
}

test.after(async () => {
  if (!created.length) return;
  await query(`DELETE FROM students WHERE user_id = ANY($1::uuid[])`, [created]);
  await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [created]);
});

test('a retail student can set their gender', async () => {
  const userId = await makeRetailStudent();
  const res = mockRes();
  await auth.updateMe({ user: { id: userId, role: 'retail' }, body: { gender: 'female' } }, res);

  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.data.gender, 'female');

  const { rows } = await query(`SELECT gender FROM students WHERE user_id = $1`, [userId]);
  assert.strictEqual(rows[0].gender, 'female');
});

test('an invalid gender value is refused, field-tagged', async () => {
  const userId = await makeRetailStudent();
  const res = mockRes();
  await auth.updateMe({ user: { id: userId, role: 'retail' }, body: { gender: 'other' } }, res);

  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.field, 'gender');
});

test('a missing gender value is refused, not coerced', async () => {
  const userId = await makeRetailStudent();
  const res = mockRes();
  await auth.updateMe({ user: { id: userId, role: 'retail' }, body: {} }, res);

  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.field, 'gender');
});

test('a user with no students row cannot set a gender', async () => {
  const userId = await makeWholesaler();
  const res = mockRes();
  await auth.updateMe({ user: { id: userId, role: 'wholesaler' }, body: { gender: 'male' } }, res);

  assert.ok(
    res.statusCode === 403 || res.statusCode === 404,
    `expected 403 or 404, got ${res.statusCode}: ${JSON.stringify(res.body)}`
  );
  assert.ok(res.body.error, 'must carry an Arabic message');
});
