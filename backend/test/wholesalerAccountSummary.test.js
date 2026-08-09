process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';

const test = require('node:test');
const assert = require('node:assert');
const { buildWholesalerAccountSummary } = require('../controllers/staffController');

test('confirmed account summary counts the four inventory classes and saved price shares', () => {
  const rows = [
    { id: 's1', product_type: 'sash', piece_variant: 'royal', price: 65000, cost: 55000 },
    { id: 's2', product_type: 'sash', piece_variant: 'normal', price: 50000, cost: 40000 },
    { id: 'c1', product_type: 'cap', piece_variant: 'royal', price: 20000, cost: 17000 },
    { id: 'c2', product_type: 'cap', piece_variant: 'normal', price: 15000, cost: 12000 },
  ];
  const byId = new Map([
    ['s1', [{ label: 'طقم كامل', price: 50000, admin_price: 40000, qty: 1 },
            { label: 'إضافة: وشاح ملكي', price: 15000, admin_price: 15000, qty: 1 }]],
    ['s2', [{ label: 'قطعة: وشاح عادي', price: 50000, admin_price: 40000, qty: 1 }]],
    ['c1', [{ label: 'قطعة: قبعة ملكية', price: 20000, admin_price: 17000, qty: 1 }]],
    ['c2', [{ label: 'قطعة: قبعة عادية', price: 15000, admin_price: 12000, qty: 1 }]],
  ]);

  const summary = buildWholesalerAccountSummary(rows, byId);
  assert.deepStrictEqual(summary.confirmed_inventory, {
    sash_royal: 1,
    sash_normal: 1,
    cap_royal: 1,
    cap_normal: 1,
  });
  assert.strictEqual(summary.money.student_total, 150000);
  assert.strictEqual(summary.money.admin_total, 124000);
  assert.strictEqual(summary.money.representative_profit, 26000);
  assert.strictEqual(
    summary.money.lines.reduce((sum, line) => sum + line.student_amount, 0),
    summary.money.student_total
  );
  assert.strictEqual(
    summary.money.lines.reduce((sum, line) => sum + line.admin_amount, 0),
    summary.money.admin_total
  );
});

test('historical/manual differences are explicit adjustments, never hidden guesses', () => {
  const rows = [
    { id: 'old', product_type: 'sash', piece_variant: 'normal', price: 60000, cost: 45000 },
  ];
  const byId = new Map([
    ['old', [{ label: 'سجل قديم', price: 50000, admin_price: 0, qty: 1 }]],
  ]);
  const summary = buildWholesalerAccountSummary(rows, byId);
  const adjustment = summary.money.lines.find((line) => line.kind === 'adjustment');
  assert.ok(adjustment);
  assert.strictEqual(adjustment.student_amount, 10000);
  assert.strictEqual(adjustment.admin_amount, 45000);
  assert.strictEqual(adjustment.representative_profit, -35000);
  assert.strictEqual(
    summary.money.lines.reduce((sum, line) => sum + line.representative_profit, 0),
    summary.money.representative_profit
  );
});
