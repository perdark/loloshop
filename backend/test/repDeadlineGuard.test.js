// A rep-linked student may not create/add/edit an order after the rep's deadline day.
// See middleware/repDeadline.js for the rules this pins.
require('dotenv').config({ quiet: true });
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { query } = require('../lib/db');
const { repDeadlineOpen, requireRepDeadlineOpen } = require('../middleware/repDeadline');

const TAG = `rdl${crypto.randomInt(0, 1e6)}`;
const fx = { users: [], students: [], wholesalers: [] };

async function mkUser(role) {
  const r = await query(
    `INSERT INTO users (name, phone, password_hash, role, deleted_at)
     VALUES ($1,$2,'x',$3,NOW()) RETURNING id`,
    [`${TAG}-${role}`, `077${String(crypto.randomInt(0, 1e8)).padStart(8, '0')}`, role]
  );
  fx.users.push(r.rows[0].id);
  return r.rows[0].id;
}

// `deadlineSql` is an SQL expression so the day boundary is computed in Baghdad, like the guard.
async function repStudent(deadlineSql, { editException = false } = {}) {
  const repUser = await mkUser('wholesaler');
  const w = await query(
    `INSERT INTO wholesalers (user_id, university_name, referral_code, deadline)
     VALUES ($1,$2,$3, ${deadlineSql}) RETURNING id`,
    [repUser, `${TAG}-uni`, `${TAG}${fx.wholesalers.length}`.slice(0, 20)]
  );
  fx.wholesalers.push(w.rows[0].id);
  const u = await mkUser('retail');
  const s = await query(
    `INSERT INTO students (user_id, wholesaler_id, full_name_third, status, edit_exception)
     VALUES ($1,$2,$3,'approved',$4) RETURNING id`,
    [u, w.rows[0].id, `${TAG}-stu`, editException]
  );
  fx.students.push(s.rows[0].id);
  return u;
}

// Midnight UTC of a Baghdad date = how `<input type="date">` stores it (03:00 Baghdad).
const BAGHDAD_TODAY = `((NOW() AT TIME ZONE 'Asia/Baghdad')::date)`;
const asDateInput = (dayOffset) => `((${BAGHDAD_TODAY} + ${dayOffset})::timestamp AT TIME ZONE 'UTC')`;

test.after(async () => {
  await query(`DELETE FROM students WHERE id = ANY($1::uuid[])`, [fx.students]);
  await query(`DELETE FROM wholesalers WHERE id = ANY($1::uuid[])`, [fx.wholesalers]);
  await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [fx.users]);
});

test('a deadline YESTERDAY locks the rep student', async () => {
  assert.strictEqual(await repDeadlineOpen(await repStudent(asDateInput(-1))), false);
});

test('the deadline DAY itself stays open, even though its stored instant is already past', async () => {
  // Stored as 00:00 UTC today, which is before NOW() for most of the day.
  assert.strictEqual(await repDeadlineOpen(await repStudent(asDateInput(0))), true);
});

test('a future deadline and no deadline are both open', async () => {
  assert.strictEqual(await repDeadlineOpen(await repStudent(asDateInput(3))), true);
  assert.strictEqual(await repDeadlineOpen(await repStudent('NULL')), true);
});

test('edit_exception reopens one student past the deadline', async () => {
  assert.strictEqual(await repDeadlineOpen(await repStudent(asDateInput(-5), { editException: true })), true);
});

test('a retail student with no rep is never locked', async () => {
  const u = await mkUser('retail');
  const s = await query(
    `INSERT INTO students (user_id, full_name_third, status) VALUES ($1,$2,'approved') RETURNING id`,
    [u, `${TAG}-retail`]
  );
  fx.students.push(s.rows[0].id);
  assert.strictEqual(await repDeadlineOpen(u), true);
});

test('the middleware 403s ERR_DEADLINE_PASSED for a locked student and passes other roles through', async () => {
  const locked = await repStudent(asDateInput(-1));
  let status = null; let body = null; let nexted = false;
  const res = { status(c) { status = c; return this; }, json(b) { body = b; return this; } };
  await requireRepDeadlineOpen({ user: { id: locked, role: 'retail' } }, res, () => { nexted = true; });
  assert.strictEqual(nexted, false);
  assert.strictEqual(status, 403);
  assert.strictEqual(body.code, 'ERR_DEADLINE_PASSED');

  // Same user id under a non-student role (the rep's own configure-package) is not gated.
  nexted = false;
  await requireRepDeadlineOpen({ user: { id: locked, role: 'wholesaler' } }, res, () => { nexted = true; });
  assert.strictEqual(nexted, true);
});
