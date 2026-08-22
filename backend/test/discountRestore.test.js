'use strict';
// «إنهاء الخصومات» — the validation layer that stands between an admin tap and a price rise.
//
// The write itself (lib/discountRestore.applyPlan) is one transaction against a real database
// and is covered by the plate/status-guard tests' pattern; what this file guards is the part
// that decides WHETHER a write happens at all, because every failure mode here is a wrong price
// on a live shop:
//
//   · a stale page pressing "restore" against numbers that have since changed
//   · a cell that is not actually discounted being written anyway (a price CUT, unasked)
//   · an empty selection quietly meaning "everything"
//
// planFrom is pure — it takes the report the server just built and the selection the client
// sent back — so it is tested directly, with no DB.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const { planFrom } = require('../lib/discountRestore');

/** A two-product report: one discounted by 5,000 across both cells, one already at price. */
function fixture() {
  return {
    products: [
      {
        id: 'p1',
        name_ar: 'وشاح تخرج',
        type: 'sash',
        active: true,
        compare_at_price: 30000,
        cells: [
          { scope: 'product', current_price: 25000, compare_at_price: 30000, delta: 5000, discounted: true },
          { scope: 'retail', current_price: 25000, compare_at_price: 30000, delta: 5000, discounted: true },
          { scope: 'wholesaler', current_price: 20000, compare_at_price: 30000, delta: 10000, discounted: true },
        ],
      },
      {
        id: 'p2',
        name_ar: 'روب تخرج',
        type: 'robe',
        active: true,
        compare_at_price: 40000,
        cells: [
          { scope: 'product', current_price: 40000, compare_at_price: 40000, delta: 0, discounted: false },
        ],
      },
    ],
    summary: { products: 2, discounted_cells: 3, uniform_delta: null },
  };
}

test('an empty selection is refused, never read as "all products"', () => {
  assert.equal(planFrom([], fixture()).ok, false);
  assert.equal(planFrom(undefined, fixture()).ok, false);
  assert.equal(planFrom(null, fixture()).code, 'ERR_VALIDATION');
});

test('a stale compare-at price refuses the WHOLE operation', () => {
  // The client displayed 29,000 (someone edited the product since). Nothing may be written —
  // not even the products whose numbers still match.
  const res = planFrom(
    [
      { id: 'p1', expected_compare_at_price: 29000, scopes: ['product'] },
      { id: 'p2', expected_compare_at_price: 40000, scopes: [] },
    ],
    fixture()
  );
  assert.equal(res.ok, false);
  assert.equal(res.code, 'ERR_STALE');
});

test('an unknown product is refused rather than skipped', () => {
  const res = planFrom(
    [{ id: 'ghost', expected_compare_at_price: 1000, scopes: ['product'] }],
    fixture()
  );
  assert.equal(res.ok, false);
  assert.equal(res.code, 'ERR_NOT_FOUND');
});

test('an invalid scope is refused', () => {
  const res = planFrom(
    [{ id: 'p1', expected_compare_at_price: 30000, scopes: ['admin_price'] }],
    fixture()
  );
  assert.equal(res.ok, false);
  assert.equal(res.code, 'ERR_VALIDATION');
});

test('a cell that carries no discount is dropped — this operation never CUTS a price', () => {
  const res = planFrom(
    [{ id: 'p2', expected_compare_at_price: 40000, scopes: ['product'] }],
    fixture()
  );
  assert.equal(res.ok, true);
  assert.equal(res.plan.length, 1);
  assert.equal(res.plan[0].cells.length, 0, 'price already at the compare-at → nothing to write');
});

test('the selected cells are planned at the compare-at price, and only those', () => {
  const res = planFrom(
    [{ id: 'p1', expected_compare_at_price: 30000, scopes: ['product', 'retail'] }],
    fixture()
  );
  assert.equal(res.ok, true);
  const scopes = res.plan[0].cells.map((c) => c.scope);
  assert.deepEqual(scopes, ['product', 'retail']);
  assert.ok(!scopes.includes('wholesaler'), 'an unticked wholesaler price stays untouched');
  for (const cell of res.plan[0].cells) {
    assert.equal(cell.compare_at_price, 30000);
    assert.equal(cell.current_price, 25000);
  }
});

test('an empty scopes list is a valid plan — "clear the old price, touch no price"', () => {
  const res = planFrom(
    [{ id: 'p1', expected_compare_at_price: 30000, scopes: [] }],
    fixture()
  );
  assert.equal(res.ok, true);
  assert.equal(res.plan.length, 1);
  assert.equal(res.plan[0].cells.length, 0);
});
