'use strict';
// Workshop rates split by audience (ممثلين / تجزئة).
// Spec: docs/superpowers/specs/2026-07-29-workshop-retail-piece-rates-design.md
// Runs against the LAPTOP-LOCAL dev PG (:5433). Self-cleaning. Never point at prod.
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert');
const { query } = require('../lib/db');

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

test('migration 072: (operation, product, audience) is unique', async () => {
  const { rows } = await query(
    `SELECT COUNT(*)::int dupes FROM (
       SELECT operation, product, audience FROM workshop_piece_rates
        GROUP BY operation, product, audience HAVING COUNT(*) > 1) d`
  );
  assert.strictEqual(rows[0].dupes, 0);
});

test('migration 072: pre-existing production entries defaulted to wholesale', async () => {
  const { rows } = await query(
    `SELECT COUNT(*)::int bad FROM workshop_production_entries
      WHERE audience NOT IN ('wholesale','retail')`
  );
  assert.strictEqual(rows[0].bad, 0);
});
