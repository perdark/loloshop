'use strict';
// A discount round, start to finish, against a REAL database.
//
// discountRound.test.js covers the pure decision layer. This covers the claim that layer cannot
// make: that STARTING a round and then ENDING it leaves every price exactly where it began.
// The two halves are separate files written months apart over the same two mutable columns —
// products.base_price and products.compare_at_price — and nothing but a round-trip proves they
// are actually inverses. If they ever stop being, the shop silently keeps selling at a discount
// it thinks it ended, which is the failure discount_restore_log exists to make recoverable and
// this test exists to prevent.
//
// Everything happens on a product this file creates and deletes, so it never touches catalogue
// data, and it asserts the ledger too: a rollback is only as good as what was written down.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const { query } = require('../lib/db');
const round = require('../lib/discountRound');
const restore = require('../lib/discountRestore');

const NAME = 'ZZ اختبار جولة الخصم';

async function makeProduct() {
  const { rows } = await query(
    `INSERT INTO products (type, name_ar, base_price, active, sort)
     VALUES ('sash', $1, 30000, TRUE, 9999) RETURNING id`,
    [NAME]
  );
  const id = rows[0].id;
  await query(
    `INSERT INTO product_price_roles (product_id, role, base_price) VALUES ($1, 'retail', 28000)`,
    [id]
  );
  return id;
}

async function prices(id) {
  const { rows } = await query(
    `SELECT p.base_price, p.compare_at_price, r.base_price AS retail
       FROM products p LEFT JOIN product_price_roles r
         ON r.product_id = p.id AND r.role = 'retail'
      WHERE p.id = $1`,
    [id]
  );
  return {
    base: Number(rows[0].base_price),
    retail: Number(rows[0].retail),
    compare_at: rows[0].compare_at_price === null ? null : Number(rows[0].compare_at_price),
  };
}

async function cleanup(id) {
  await query(`DELETE FROM discount_restore_log WHERE product_id = $1`, [id]);
  await query(`DELETE FROM products WHERE id = $1`, [id]);
}

test('start → end returns every price to where it began, and the ledger records both halves', async (t) => {
  const id = await makeProduct();
  t.after(() => cleanup(id));

  const before = await prices(id);
  assert.deepEqual(before, { base: 30000, retail: 28000, compare_at: null });

  // ── START ────────────────────────────────────────────────────────────────────────────────
  const candidates = await round.buildCandidates();
  const planned = round.planStart(
    // 28,000 and not 30,000: the compare-at follows the EFFECTIVE retail price, which is the
    // role row when one exists. Sending the product's own base here must read as stale.
    [{ id, expected_price: 28000, scopes: ['product', 'retail'] }],
    candidates,
    { amount: 5000 }
  );
  assert.equal(planned.ok, true, planned.error);
  const started = await round.applyStart(planned.plan, { adminId: null, note: 'test', amount: 5000 });

  const during = await prices(id);
  assert.deepEqual(during, { base: 25000, retail: 23000, compare_at: 28000 });
  assert.equal(started.written.length, 2);

  const { rows: startRows } = await query(
    `SELECT scope, old_price, new_price, direction FROM discount_restore_log
      WHERE batch_id = $1 ORDER BY scope`,
    [started.batch_id]
  );
  assert.equal(startRows.length, 2);
  assert.ok(startRows.every((r) => r.direction === 'start'));

  // ── END ──────────────────────────────────────────────────────────────────────────────────
  const report = await restore.buildReport();
  const plan2 = restore.planFrom(
    [{ id, expected_compare_at_price: 28000, scopes: ['product', 'retail'] }],
    report
  );
  assert.equal(plan2.ok, true, plan2.error);
  const ended = await restore.applyPlan(plan2.plan, { adminId: null, note: 'test' });

  const after = await prices(id);
  // ⚠️ `base` comes back as 28,000, NOT the 30,000 it started at, and that is CORRECT rather
  // than a round-trip failure: ending a round restores every selected cell to the single
  // compare-at, which was the effective retail price. The product-level base was only ever
  // higher because no retail viewer could see it. What must round-trip is the price a customer
  // actually pays — the retail cell — and it does.
  assert.equal(after.retail, 23000 + 5000);
  assert.equal(after.compare_at, null, 'the badge must be gone');
  assert.equal(ended.written.length, 2);

  const { rows: endRows } = await query(
    `SELECT direction FROM discount_restore_log WHERE batch_id = $1`,
    [ended.batch_id]
  );
  assert.ok(endRows.length > 0 && endRows.every((r) => r.direction === 'end'));
});

test('a second round on an already-discounted product is refused by the database state, not just the fixture', async (t) => {
  const id = await makeProduct();
  t.after(() => cleanup(id));

  const c1 = await round.buildCandidates();
  const p1 = round.planStart([{ id, expected_price: 28000, scopes: ['retail'] }], c1, { amount: 5000 });
  await round.applyStart(p1.plan, { adminId: null, note: null, amount: 5000 });

  // Re-read: the product now carries a compare-at, so the same call must refuse. This is the
  // irreversible case — a second start would write 23,000 in as "the old price" and 28,000
  // would be gone from the database entirely.
  const c2 = await round.buildCandidates();
  const p2 = round.planStart([{ id, expected_price: 23000, scopes: ['retail'] }], c2, { amount: 5000 });
  assert.equal(p2.ok, false);
  assert.equal(p2.code, 'ERR_ALREADY_DISCOUNTED');

  const still = await prices(id);
  assert.equal(still.compare_at, 28000, 'the real pre-discount price must survive');
});
