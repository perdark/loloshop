'use strict';
// «حذف عامل» on /admin/workshop → العمّال (owner 2026-09-14).
//
// The whole point of these tests is the REFUSAL, not the delete. `workshop_production_entries`
// and `workshop_adjustments` are both ON DELETE CASCADE on `worker_id`, so deleting a worker
// who has been paid erases their wage ledger and NOTHING on any screen shows a gap afterwards —
// the totals are just smaller. «إيقاف» (active = FALSE) is the tool for someone who left.
// Delete is for the row that should never have existed: a typo, a «(تجريبي)» test worker.
//
// The second guarantee is that a delete never reaches a real `users` row. Deleting a user
// cascades into staff_attendance_records / staff_salary_transactions / staff_salaries /
// staff_activity_log — a person's بصمات and راتب — so a workshop-only account is SOFT-deleted
// (`deleted_at`, which middleware/auth.js reads to refuse a login) and a linked staff account
// is not touched at all.
//
// Runs against the LAPTOP-LOCAL dev PG (:5433). Self-cleaning. Never point at prod.
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { query } = require('../lib/db');
const wc = require('../controllers/workshopController');

const TAG = `wsdel-${crypto.randomBytes(4).toString('hex')}`;
const freshPhone = () => '077' + String(crypto.randomInt(0, 1e8)).padStart(8, '0');

/** Minimal res double — captures status + body the way the controller writes them. */
function resDouble() {
  const out = { statusCode: 200, body: null };
  return Object.assign(out, {
    status(code) { out.statusCode = code; return out; },
    json(payload) { out.body = payload; return out; },
  });
}

async function makeWorker({ role = 'worker', isLead = false } = {}) {
  const u = await query(
    `INSERT INTO users (name, phone, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id`,
    [`${TAG}-${role}`, freshPhone(), role]
  );
  const w = await query(
    `INSERT INTO workshop_workers (user_id, is_lead) VALUES ($1, $2) RETURNING id`,
    [u.rows[0].id, isLead]
  );
  return { userId: u.rows[0].id, workerId: w.rows[0].id };
}

async function admin() {
  const { rows } = await query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
  assert.ok(rows.length, 'dev DB has no admin to act as');
  return { id: rows[0].id, role: 'admin' };
}

const cleanup = [];
test.after(async () => {
  for (const userId of cleanup) await query(`DELETE FROM users WHERE id = $1`, [userId]);
});

test('a worker with no ledger is removed and their workshop login is retired', async () => {
  const { userId, workerId } = await makeWorker();
  cleanup.push(userId);
  const res = resDouble();
  await wc.deleteWorker({ params: { id: workerId }, user: await admin() }, res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.account_retired, true);
  const gone = await query(`SELECT 1 FROM workshop_workers WHERE id = $1`, [workerId]);
  assert.equal(gone.rows.length, 0, 'roster row survived');
  // The user row itself must SURVIVE — soft-deleted, not cascaded away.
  const user = await query(`SELECT deleted_at, token_version FROM users WHERE id = $1`, [userId]);
  assert.equal(user.rows.length, 1, 'the users row was hard-deleted — that cascades into attendance and salary');
  assert.ok(user.rows[0].deleted_at, 'login was not retired');
});

test('a worker who has been paid is REFUSED, and nothing is deleted', async () => {
  const { userId, workerId } = await makeWorker();
  cleanup.push(userId);
  await query(
    `INSERT INTO workshop_production_entries (worker_id, product, operation, audience, qty, rate, amount, work_date)
     VALUES ($1, 'cap', 'cut', 'wholesale', 3, 1000, 3000, CURRENT_DATE)`,
    [workerId]
  );
  const res = resDouble();
  await wc.deleteWorker({ params: { id: workerId }, user: await admin() }, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'ERR_HAS_HISTORY');
  assert.match(res.body.error, /إيقاف/, 'the refusal must name the tool the admin should use instead');
  const still = await query(`SELECT 1 FROM workshop_workers WHERE id = $1`, [workerId]);
  assert.equal(still.rows.length, 1, 'the refusal deleted the worker anyway');
  const ledger = await query(`SELECT 1 FROM workshop_production_entries WHERE worker_id = $1`, [workerId]);
  assert.equal(ledger.rows.length, 1, 'the wage ledger was touched by a refused delete');
});

test('a worker who only has an adjustment is refused too', async () => {
  const { userId, workerId } = await makeWorker();
  cleanup.push(userId);
  const a = await admin();
  await query(
    `INSERT INTO workshop_adjustments (worker_id, kind, amount, reason, entry_date, created_by)
     VALUES ($1, 'bonus', 5000, 'test', CURRENT_DATE, $2)`,
    [workerId, a.id]
  );
  const res = resDouble();
  await wc.deleteWorker({ params: { id: workerId }, user: a }, res);
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, 'ERR_HAS_HISTORY');
});

test('a LINKED STAFF worker loses the roster row and keeps their account', async () => {
  const { userId, workerId } = await makeWorker({ role: 'staff' });
  cleanup.push(userId);
  const res = resDouble();
  await wc.deleteWorker({ params: { id: workerId }, user: await admin() }, res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.account_retired, false, 'a staff member still works in the shop');
  const user = await query(`SELECT deleted_at FROM users WHERE id = $1`, [userId]);
  assert.equal(user.rows.length, 1);
  assert.equal(user.rows[0].deleted_at, null, 'the workshop screen disabled a staff login');
});

test('a bad id is rejected before any query', async () => {
  const res = resDouble();
  await wc.deleteWorker({ params: { id: 'not-a-uuid' }, user: await admin() }, res);
  assert.equal(res.statusCode, 400);
  const res2 = resDouble();
  await wc.deleteWorker({ params: { id: crypto.randomUUID() }, user: await admin() }, res2);
  assert.equal(res2.statusCode, 404);
});
