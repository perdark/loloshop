'use strict';
// Workshop rates split by audience (ممثلين / تجزئة).
// Spec: docs/superpowers/specs/2026-07-29-workshop-retail-piece-rates-design.md
// Runs against the LAPTOP-LOCAL dev PG (:5433). Self-cleaning. Never point at prod.
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { query } = require('../lib/db');

const TAG = `wsaud-${crypto.randomBytes(4).toString('hex')}`;

// Unique, shape-valid Iraqi mobile (07 + 9 digits) — users.phone is UNIQUE.
function freshPhone() {
  return '077' + String(crypto.randomInt(0, 1e8)).padStart(8, '0');
}

test('migration 072: every rate row carries a valid audience', async () => {
  const { rows } = await query(
    `SELECT COUNT(*)::int bad FROM workshop_piece_rates
      WHERE audience NOT IN ('wholesale','retail')`
  );
  assert.strictEqual(rows[0].bad, 0);
});

test('migration 072: every wholesale rate has a retail twin', async () => {
  const { rows } = await query(
    `SELECT COUNT(*)::int missing
       FROM workshop_piece_rates w
      WHERE w.audience = 'wholesale'
        AND NOT EXISTS (
          SELECT 1 FROM workshop_piece_rates r
           WHERE r.operation = w.operation AND r.product = w.product
             AND r.audience = 'retail')`
  );
  assert.strictEqual(rows[0].missing, 0, 'a job with no retail price would record 0 IQD wages');
});

test('migration 072: the database rejects a duplicate (operation, product, audience)', async () => {
  // A GROUP BY ... HAVING COUNT(*) > 1 over current data only proves no duplicate happens
  // to exist right now — it would pass even if uq_workshop_rate had never been created.
  // Prove the constraint itself is live: pick a real existing row and try to insert its
  // exact key again; the unique index must make Postgres reject it (23505), not the test.
  const { rows: existing } = await query(
    `SELECT operation, product, audience FROM workshop_piece_rates LIMIT 1`
  );
  assert.ok(existing.length > 0, 'expected at least one existing rate row to test against');
  const { operation, product, audience } = existing[0];

  let insertedId = null;
  try {
    await assert.rejects(
      async () => {
        const { rows } = await query(
          `INSERT INTO workshop_piece_rates (operation, product, audience, amount)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [operation, product, audience, 999999]
        );
        // Only reached if the insert unexpectedly succeeded — record it so finally can
        // remove the phantom row; assert.rejects will then still fail the test below.
        insertedId = rows[0]?.id ?? null;
      },
      (err) => {
        assert.strictEqual(err.code, '23505', `expected a unique-violation, got: ${err.message}`);
        return true;
      }
    );
  } finally {
    if (insertedId) {
      await query(`DELETE FROM workshop_piece_rates WHERE id = $1`, [insertedId]);
    }
  }
});

test('migration 072: a production entry written without audience defaults to wholesale', async () => {
  // 0 rows exist in workshop_production_entries on the dev DB, so a plain COUNT(*) WHERE
  // audience NOT IN (...) passes vacuously whether or not the DEFAULT/backfill works.
  // Prove the actual guarantee: insert a row exactly like pre-migration code would (no
  // audience column named at all) and assert it comes back stamped 'wholesale'.
  let userId = null;
  let workerId = null;
  let entryId = null;
  try {
    const userRes = await query(
      `INSERT INTO users (name, phone, password_hash, role)
       VALUES ($1, $2, 'x', 'worker') RETURNING id`,
      [`${TAG}-worker`, freshPhone()]
    );
    userId = userRes.rows[0].id;

    const workerRes = await query(
      `INSERT INTO workshop_workers (user_id) VALUES ($1) RETURNING id`,
      [userId]
    );
    workerId = workerRes.rows[0].id;

    const entryRes = await query(
      `INSERT INTO workshop_production_entries (worker_id, product, operation, qty, rate, amount)
       VALUES ($1, 'robe', 'cut', 1, 500, 500) RETURNING id`,
      [workerId]
    );
    entryId = entryRes.rows[0].id;

    const { rows } = await query(
      `SELECT audience FROM workshop_production_entries WHERE id = $1`,
      [entryId]
    );
    assert.strictEqual(rows[0].audience, 'wholesale');
  } finally {
    if (entryId) await query(`DELETE FROM workshop_production_entries WHERE id = $1`, [entryId]);
    if (workerId) await query(`DELETE FROM workshop_workers WHERE id = $1`, [workerId]);
    if (userId) await query(`DELETE FROM users WHERE id = $1`, [userId]);
  }
});
