'use strict';
// «ابدأ الخصومات» — the validation layer that stands between an admin tap and a price CUT.
//
// The mirror of discountRestore.test.js, and the failure modes are mirrored too: that file
// guards against raising a price nobody asked to raise, this one against lowering a price
// nobody asked to lower — and against the one loss that cannot be undone at all.
//
// ⚠️ THE IRREVERSIBLE ONE IS `ERR_ALREADY_DISCOUNTED`. Starting a round writes the product's
// CURRENT price into `compare_at_price`. Run it twice and the second press stores the already-
// discounted price as "the old price", so the real pre-discount price is gone from the database
// entirely — `discount_restore_log` cannot help, because the damage is in what was WRITTEN to
// it, not in what was lost from products. That is why a product already carrying a compare-at
// is refused outright rather than skipped quietly.
//
// planStart is pure — candidates in, selection in, plan out — so it is tested with no DB.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const { planStart, defaultScopesFor } = require('../lib/discountRound');

/**
 * Three products at full price, plus one mid-round.
 * `retail_price_now` is the EFFECTIVE retail price (the role row when there is one, else the
 * product's own base) — that is the number the storefront strikes through, so it is the number
 * the compare-at must be set to and the number staleness is checked against.
 */
function fixture() {
  return {
    products: [
      {
        id: 'p1',
        name_ar: 'وشاح تخرج',
        type: 'sash',
        active: true,
        already_discounted: false,
        retail_price_now: 30000,
        cells: [
          { scope: 'product', current_price: 30000 },
          { scope: 'retail', current_price: 30000 },
          { scope: 'wholesaler', current_price: 22000 },
        ],
      },
      {
        id: 'p2',
        name_ar: 'قبعة تخرج',
        type: 'cap',
        active: true,
        already_discounted: false,
        retail_price_now: 6000,
        cells: [{ scope: 'product', current_price: 6000 }],
      },
      {
        id: 'p3',
        name_ar: 'روب مخصوم أصلاً',
        type: 'robe',
        active: true,
        already_discounted: true,
        retail_price_now: 35000,
        cells: [{ scope: 'product', current_price: 35000 }],
      },
    ],
  };
}

const sel = (id, price, scopes = ['retail']) => ({
  id,
  expected_price: price,
  scopes,
});

test('an empty selection is refused, never read as "every product"', () => {
  assert.equal(planStart([], fixture(), { amount: 5000 }).ok, false);
  assert.equal(planStart(undefined, fixture(), { amount: 5000 }).ok, false);
  assert.equal(planStart(null, fixture(), { amount: 5000 }).code, 'ERR_VALIDATION');
});

test('the happy path lowers every selected cell and pins the compare-at to today\'s retail price', () => {
  const res = planStart([sel('p1', 30000, ['product', 'retail'])], fixture(), { amount: 5000 });
  assert.equal(res.ok, true);
  assert.equal(res.plan.length, 1);

  const entry = res.plan[0];
  assert.equal(entry.compare_at, 30000);
  assert.deepEqual(
    entry.cells.map((c) => [c.scope, c.current_price, c.new_price]),
    [
      ['product', 30000, 25000],
      ['retail', 30000, 25000],
    ]
  );
});

test('the default ticks the cell that IS the retail price, and only that one', () => {
  // A product with a retail row: its own base_price is a DIFFERENT audience's price sitting
  // above it, and discounting both would not survive a start→end round-trip (the base would
  // come back lowered to the compare-at). A product without one: its base IS the retail price.
  const [withRetail, withoutRetail] = fixture().products;
  assert.deepEqual(defaultScopesFor(withRetail), ['retail']);
  assert.deepEqual(defaultScopesFor(withoutRetail), ['product']);
});

test('a product already carrying «السعر قبل الخصم» is REFUSED, not skipped', () => {
  // Skipping would be the friendly-looking choice and the destructive one: the admin would
  // believe the round covered p3. Refusing sends them to «إنهاء الخصومات» first, which is the
  // only order that preserves the real price.
  const res = planStart([sel('p1', 30000), sel('p3', 35000, ['product'])], fixture(), { amount: 5000 });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'ERR_ALREADY_DISCOUNTED');
  assert.match(res.error, /مخصوم/);
});

test('a stale price refuses the WHOLE round, not just the product that moved', () => {
  const res = planStart([sel('p1', 29000), sel('p2', 6000, ['product'])], fixture(), { amount: 1000 });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'ERR_STALE');
});

test('an amount at or above a selected price is refused — no free or negative products', () => {
  // 6,000 قبعة in a 6,000 round would go to zero; the same round is fine for the 30,000 وشاح,
  // which is exactly why this is checked per CELL and refuses the round rather than the cell.
  const res = planStart([sel('p1', 30000), sel('p2', 6000, ['product'])], fixture(), { amount: 6000 });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'ERR_AMOUNT_TOO_BIG');
  assert.match(res.error, /قبعة/);
});

test('a zero or negative amount is refused', () => {
  assert.equal(planStart([sel('p1', 30000)], fixture(), { amount: 0 }).code, 'ERR_VALIDATION');
  assert.equal(planStart([sel('p1', 30000)], fixture(), { amount: -5000 }).code, 'ERR_VALIDATION');
  assert.equal(planStart([sel('p1', 30000)], fixture(), { amount: 1.5 }).code, 'ERR_VALIDATION');
});

test('an unknown product id is refused', () => {
  assert.equal(planStart([sel('nope', 30000)], fixture(), { amount: 5000 }).code, 'ERR_NOT_FOUND');
});

test('an invalid scope is refused, and a scope the product does not have is refused', () => {
  assert.equal(
    planStart([sel('p1', 30000, ['product', 'staff'])], fixture(), { amount: 5000 }).code,
    'ERR_VALIDATION'
  );
  assert.equal(
    planStart([sel('p2', 6000, ['retail'])], fixture(), { amount: 1000 }).code,
    'ERR_NOT_FOUND'
  );
});

test('an empty scopes list is refused — unlike ENDING a round, it would mean nothing', () => {
  // discountRestore accepts empty scopes on purpose (clear the badge, touch no price). Starting
  // a round with no price to lower would set a compare-at EQUAL to the current price: a «خصم»
  // badge on a product whose price never moved. That is a lie on the storefront, not a no-op.
  assert.equal(planStart([sel('p1', 30000, [])], fixture(), { amount: 5000 }).code, 'ERR_VALIDATION');
});

test('سعر الجملة is only touched when it is explicitly asked for', () => {
  const off = planStart([sel('p1', 30000)], fixture(), { amount: 5000 });
  assert.deepEqual(off.plan[0].cells.map((c) => c.scope), ['retail']);

  const on = planStart([sel('p1', 30000, ['product', 'retail', 'wholesaler'])], fixture(), {
    amount: 5000,
  });
  assert.deepEqual(on.plan[0].cells.map((c) => c.scope), ['product', 'retail', 'wholesaler']);
  assert.equal(on.plan[0].cells[2].new_price, 17000);
});
