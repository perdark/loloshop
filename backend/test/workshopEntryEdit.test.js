'use strict';
// «تعديل» / «حذف» on a recorded piece (owner 2026-09-14: «العامل يسجّل قطعة غلط وما يكدر
// يشيلها»). Runs against the LAPTOP-LOCAL dev PG (:5433). Self-cleaning. Never point at prod.
//
// Three things are worth a red test here, and each has already been got wrong somewhere else
// in this codebase:
//
//   1. **The wage is recomputed, never accepted.** `insertProduction` reads
//      `workshop_piece_rates` and multiplies; the edit path has to do the SAME, or the first
//      caller that posts `amount` writes their own salary. Test: post a lying amount/rate.
//   2. **A worker may fix their own row and nobody else's.** The route deliberately has no
//      `requireLead` — the guard is in `loadEntryFor`, so if anyone "tidies" it into route
//      middleware, both halves must still hold: mine = yes, someone else's = 403.
//   3. **The triple is validated after the merge, not before.** product/operation/audience
//      only have a price together, so a partial PATCH ({qty}) must be checked as a whole —
//      and an impossible pair (e.g. robe + cap_sew) must be refused even though each half is
//      individually a real value.
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { query } = require('../lib/db');
const wc = require('../controllers/workshopController');

const TAG = `wsedit-${crypto.randomBytes(4).toString('hex')}`;
const freshPhone = () => '077' + String(crypto.randomInt(0, 1e8)).padStart(8, '0');

function resDouble() {
  const out = { statusCode: 200, body: null };
  return Object.assign(out, {
    status(c) { out.statusCode = c; return out; },
    json(p) { out.body = p; return out; },
  });
}

const made = { users: [], entries: [] };

async function makeWorker() {
  const u = await query(
    `INSERT INTO users (name, phone, password_hash, role) VALUES ($1,$2,'x','worker') RETURNING id`,
    [`${TAG}-w`, freshPhone()]);
  const w = await query(
    `INSERT INTO workshop_workers (user_id) VALUES ($1) RETURNING id, is_lead, active`, [u.rows[0].id]);
  made.users.push(u.rows[0].id);
  return { userId: u.rows[0].id, worker: w.rows[0] };
}

async function makeEntry(workerId, over = {}) {
  const row = {
    product: 'cap', operation: 'cut', audience: 'wholesale', qty: 4, rate: 500, amount: 2000, ...over,
  };
  const { rows } = await query(
    `INSERT INTO workshop_production_entries
       (worker_id, product, operation, audience, qty, rate, amount, work_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_DATE) RETURNING id`,
    [workerId, row.product, row.operation, row.audience, row.qty, row.rate, row.amount]);
  made.entries.push(rows[0].id);
  return rows[0].id;
}

/** The real price the server should land on for a triple. */
async function rateFor(operation, product, audience) {
  const { rows } = await query(
    `SELECT amount FROM workshop_piece_rates WHERE operation=$1 AND product=$2 AND audience=$3`,
    [operation, product, audience]);
  return Number(rows[0]?.amount || 0);
}

async function adminUser() {
  const { rows } = await query(`SELECT id FROM users WHERE role='admin' LIMIT 1`);
  assert.ok(rows.length, 'dev DB has no admin');
  return { id: rows[0].id, role: 'admin' };
}

test.after(async () => {
  for (const id of made.entries) await query(`DELETE FROM workshop_production_entries WHERE id=$1`, [id]);
  for (const id of made.users) await query(`DELETE FROM users WHERE id=$1`, [id]);
});

test('an admin edit recomputes the wage from the rate table and IGNORES a posted amount', async () => {
  const { worker } = await makeWorker();
  const id = await makeEntry(worker.id);
  const res = resDouble();
  await wc.updateProduction({
    params: { id }, user: await adminUser(), worker: null,
    // The lie: a caller claiming its own price per piece and its own total.
    body: { qty: 7, rate: 999999, amount: 12345678 },
  }, res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const expected = await rateFor('cut', 'cap', 'wholesale');
  assert.equal(res.body.data.rate, expected, 'the posted rate was trusted');
  assert.equal(res.body.data.amount, expected * 7, 'the posted amount was trusted');
  const stored = await query(`SELECT qty, rate, amount FROM workshop_production_entries WHERE id=$1`, [id]);
  assert.equal(Number(stored.rows[0].qty), 7);
  assert.equal(Number(stored.rows[0].amount), expected * 7);
});

test('a partial edit keeps the untouched fields and still validates the whole triple', async () => {
  const { worker } = await makeWorker();
  const id = await makeEntry(worker.id, { audience: 'retail' });
  const res = resDouble();
  await wc.updateProduction({ params: { id }, user: await adminUser(), worker: null, body: { qty: 2 } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.audience, 'retail', 'audience was silently reset');
  assert.equal(res.body.data.product, 'cap');
  assert.equal(res.body.data.rate, await rateFor('cut', 'cap', 'retail'));
});

test('an impossible (product, operation) pair is refused even though both values are real', async () => {
  const { worker } = await makeWorker();
  const id = await makeEntry(worker.id);
  const res = resDouble();
  // 'cap_sew' is a real operation and 'robe' a real product — the PAIR is what PRODUCT_OPS denies.
  await wc.updateProduction({
    params: { id }, user: await adminUser(), worker: null,
    body: { product: 'robe', operation: 'cap_sew' },
  }, res);
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.equal(res.body.code, 'ERR_VALIDATION');
});

test('a worker may fix and delete THEIR OWN entry', async () => {
  const { userId, worker } = await makeWorker();
  const id = await makeEntry(worker.id);
  const asSelf = { params: { id }, user: { id: userId, role: 'worker' }, worker };

  const edit = resDouble();
  await wc.updateProduction({ ...asSelf, body: { qty: 1 } }, edit);
  assert.equal(edit.statusCode, 200, JSON.stringify(edit.body));
  assert.equal(edit.body.data.qty, 1);

  const del = resDouble();
  await wc.deleteProduction({ ...asSelf, body: {} }, del);
  assert.equal(del.statusCode, 200, JSON.stringify(del.body));
  const gone = await query(`SELECT 1 FROM workshop_production_entries WHERE id=$1`, [id]);
  assert.equal(gone.rows.length, 0, 'the entry survived its own owner deleting it');
});

test("a worker may NOT touch another worker's entry", async () => {
  const mine = await makeWorker();
  const theirs = await makeWorker();
  const id = await makeEntry(theirs.worker.id);
  const asOther = { params: { id }, user: { id: mine.userId, role: 'worker' }, worker: mine.worker };

  const edit = resDouble();
  await wc.updateProduction({ ...asOther, body: { qty: 99 } }, edit);
  assert.equal(edit.statusCode, 403);

  const del = resDouble();
  await wc.deleteProduction({ ...asOther, body: {} }, del);
  assert.equal(del.statusCode, 403);

  const still = await query(`SELECT qty FROM workshop_production_entries WHERE id=$1`, [id]);
  assert.equal(still.rows.length, 1, 'a refused delete removed the row anyway');
  assert.equal(Number(still.rows[0].qty), 4, 'a refused edit changed the row anyway');
});

test('a deleted entry leaves an audit row carrying the whole amount', async () => {
  const { worker } = await makeWorker();
  const id = await makeEntry(worker.id, { qty: 3, rate: 700, amount: 2100 });
  const admin = await adminUser();
  const res = resDouble();
  await wc.deleteProduction({ params: { id }, user: admin, worker: null, body: {} }, res);
  assert.equal(res.statusCode, 200);
  const { rows } = await query(
    `SELECT details FROM audit_log WHERE entity='workshop_entry' AND entity_id=$1
       AND action='workshop_entry_deleted'`, [id]);
  assert.equal(rows.length, 1, 'no audit row — «منو شالها» is unanswerable');
  assert.equal(rows[0].details.amount, 2100);
  assert.equal(rows[0].details.qty, 3);
});

test('an unknown or malformed id is refused before anything is written', async () => {
  const admin = await adminUser();
  for (const fn of [wc.updateProduction, wc.deleteProduction]) {
    const bad = resDouble();
    await fn({ params: { id: 'nope' }, user: admin, worker: null, body: {} }, bad);
    assert.equal(bad.statusCode, 400);
    const missing = resDouble();
    await fn({ params: { id: crypto.randomUUID() }, user: admin, worker: null, body: {} }, missing);
    assert.equal(missing.statusCode, 404);
  }
});
