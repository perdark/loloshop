'use strict';
// ⚠️ THE FIRST STATEMENT IS THE TEST. `work_date` and `entry_date` are DATE columns, and the
// bug they cause is invisible on a UTC box — which is exactly what CI runs on. Moving this
// line below the requires makes the whole file pass against broken code, the same way
// test/attendanceVisibility.test.js documents for the attendance calendar.
process.env.TZ = 'Europe/Berlin';

// What it guards: pg parses a DATE into a JS Date at the SERVER's local midnight, and
// JSON.stringify then writes that as UTC — so under a positive-offset zone 2026-09-11 leaves
// the API as "2026-09-10T21:00:00.000Z". The admin list printed that raw, and the new edit
// modal read its first ten characters into an <input type="date">, so every save quietly
// moved the piecework back one day. The fix is `to_char(... ,'YYYY-MM-DD')` in the query —
// the same thing salaryController has always done. This asserts the SHAPE, because a Date
// object that happens to be right today is still the bug.
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { query } = require('../lib/db');
const wc = require('../controllers/workshopController');

const TAG = `wsdate-${crypto.randomBytes(4).toString('hex')}`;
const freshPhone = () => '077' + String(crypto.randomInt(0, 1e8)).padStart(8, '0');
const WORK_DATE = '2026-09-11';

let userId, workerId, entryId, adjId;

test.before(async () => {
  const u = await query(
    `INSERT INTO users (name, phone, password_hash, role) VALUES ($1,$2,'x','worker') RETURNING id`,
    [`${TAG}`, freshPhone()]);
  userId = u.rows[0].id;
  const w = await query(`INSERT INTO workshop_workers (user_id) VALUES ($1) RETURNING id`, [userId]);
  workerId = w.rows[0].id;
  const e = await query(
    `INSERT INTO workshop_production_entries
       (worker_id, product, operation, audience, qty, rate, amount, work_date)
     VALUES ($1,'cap','cut','wholesale',1,100,100,$2::date) RETURNING id`, [workerId, WORK_DATE]);
  entryId = e.rows[0].id;
  const a = await query(
    `INSERT INTO workshop_adjustments (worker_id, kind, amount, reason, entry_date)
     VALUES ($1,'bonus',1000,'t',$2::date) RETURNING id`, [workerId, WORK_DATE]);
  adjId = a.rows[0].id;
});

test.after(async () => { if (userId) await query(`DELETE FROM users WHERE id=$1`, [userId]); });

test('ledgerFor returns the stored day as a plain YYYY-MM-DD string, not a Date', async () => {
  const ledger = await wc.ledgerFor(workerId);
  const piece = ledger.entries.find((e) => e.id === entryId);
  const bonus = ledger.entries.find((e) => e.id === adjId);
  for (const [label, row] of [['production', piece], ['adjustment', bonus]]) {
    assert.ok(row, `${label} row missing`);
    assert.equal(typeof row.entry_date, 'string', `${label}: a Date leaks the server's zone`);
    assert.equal(row.entry_date, WORK_DATE, `${label}: the day shifted`);
  }
});

test('the dashboard feed carries the same day', async () => {
  let body = null;
  await wc.dashboard({}, { json: (p) => { body = p; } });
  const row = body.recent.find((r) => r.id === entryId);
  assert.ok(row, 'entry missing from the recent feed');
  assert.equal(row.entry_date, WORK_DATE);
});

test('an edit that does not mention the date leaves the day exactly where it was', async () => {
  const { rows } = await query(`SELECT id FROM users WHERE role='admin' LIMIT 1`);
  let body = null;
  await wc.updateProduction(
    { params: { id: entryId }, user: { id: rows[0].id, role: 'admin' }, worker: null, body: { qty: 5 } },
    { status() { return this; }, json: (p) => { body = p; } }
  );
  assert.equal(body.data.work_date, WORK_DATE, 'a qty-only edit moved the work day');
  const stored = await query(
    `SELECT to_char(work_date,'YYYY-MM-DD') d FROM workshop_production_entries WHERE id=$1`, [entryId]);
  assert.equal(stored.rows[0].d, WORK_DATE);
});
