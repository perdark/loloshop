// «التكاليف والربح الحقيقي» — migration 113, lib/trueProfit.js, controllers/costController.js.
//
// Runs against the dev DB. Everything this file creates it deletes again in `finally`, and the
// seed-guard test runs inside a transaction it rolls back.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { query, tx } = require('../lib/db');
const counts = require('../lib/counts');
const { computePnl, resolveRange, currentMonth } = require('../lib/trueProfit');
const costs = require('../controllers/costController');
const admin = require('../controllers/adminController');

function mockRes() {
  const res = {
    statusCode: 200, body: null,
    status(c) { res.statusCode = c; return res; },
    json(b) { res.body = b; return res; },
  };
  return res;
}
const call = async (handler, req) => { const res = mockRes(); await handler(req, res); return res; };

async function anAdmin() {
  const r = await query(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`);
  return { id: r.rows[0].id, role: 'admin' };
}

// ── The one identity that matters: income here IS the dashboard's دخل المحل ──

test('P&L income equals counts.settledMoney over the same shop months', async () => {
  const { current } = currentMonth();
  const r = await computePnl({ from: '2026-06', to: current });
  const m = await counts.settledMoney({
    where: `to_char(o.created_at AT TIME ZONE 'Asia/Baghdad', 'YYYY-MM') BETWEEN $1 AND $2`,
    params: [r.from, r.to],
  });
  assert.strictEqual(r.total.income.shop_income, Number(m.shop_income));
  assert.strictEqual(r.total.income.rep_margin, Number(m.rep_margin));
});

test('net = shop income − every cost bucket, per month and in total', async () => {
  const r = await computePnl({ from: '2026-06' });
  for (const row of [...r.months, r.total]) {
    const sum = Object.values(row.costs).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(row.total_costs - sum) <= Object.keys(row.costs).length, `${row.month} costs add up`);
    assert.ok(Math.abs(row.net - (row.income.shop_income - row.total_costs)) <= 1, `${row.month} net`);
  }
  const monthsNet = r.months.reduce((a, m) => a + m.net, 0);
  assert.ok(Math.abs(monthsNet - r.total.net) <= r.months.length * 2, 'months sum to the total');
});

test('the rep margin is context only — never inside the net', async () => {
  const r = await computePnl({ from: '2026-07', to: '2026-07' });
  const row = r.months[0];
  assert.strictEqual(row.net, Math.round(row.income.shop_income - row.total_costs));
});

test('resolveRange validates and clamps', () => {
  assert.throws(() => resolveRange('2026-13', '2026-09'), /YYYY-MM/);
  assert.throws(() => resolveRange('2026-09', '2026-07'), /بعد/);
  assert.strictEqual(resolveRange('2025-01', '2026-07').from, '2026-06');
  const { current } = currentMonth();
  assert.strictEqual(resolveRange('2026-07', '2099-01').to, current);
});

// ── The seed must run once, EVER ────────────────────────────────────────────

test('re-applying migration 113 never resurrects an item the admin deleted', async () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../db/migrations/113_cost_model.sql'), 'utf8');
  await tx(async (client) => {
    const before = await client.query(`SELECT COUNT(*)::int AS n FROM cost_items`);
    await client.query(`DELETE FROM cost_items WHERE code = 'tissue'`);
    await client.query(sql); // what every deploy does via schema.sql
    const after = await client.query(`SELECT COUNT(*)::int AS n FROM cost_items`);
    assert.strictEqual(after.rows[0].n, before.rows[0].n - 1, 'the deleted seed row stays deleted');
    throw Object.assign(new Error('rollback'), { rollback: true });
  }).catch((e) => { if (!e.rollback) throw e; });
});

// ── Rep rows: `cost` is حصة الإدارة and must not be overwritten ─────────────

test('updateOrderCost refuses a rep order and leaves حصة الإدارة untouched', async () => {
  const r = await query(`SELECT id, cost FROM orders WHERE wholesaler_approval IS NOT NULL AND cost IS NOT NULL LIMIT 1`);
  if (!r.rows.length) return;
  const { id, cost } = r.rows[0];
  const res = await call(admin.updateOrderCost, { params: { id }, body: { cost: 1 }, user: await anAdmin() });
  assert.strictEqual(res.statusCode, 409);
  assert.strictEqual(res.body.code, 'ERR_REP_ORDER_COST');
  const after = await query(`SELECT cost FROM orders WHERE id = $1`, [id]);
  assert.strictEqual(after.rows[0].cost, cost);
});

// ── CRUD round trip, and the P&L actually moves ────────────────────────────

test('add → edit → recipe line → P&L materials move → delete cascades', async () => {
  const user = await anAdmin();
  const month = '2026-08';
  const base = await computePnl({ from: month, to: month });
  let itemId; let expenseId;
  try {
    const bad = await call(costs.createItem, { body: { category: 'material', name_ar: 'x', unit_cost: -5 }, user });
    assert.strictEqual(bad.statusCode, 400);

    const created = await call(costs.createItem, {
      body: { category: 'material', name_ar: 'بند اختبار', unit_ar: 'قطعة', unit_cost: 1000 }, user,
    });
    assert.strictEqual(created.statusCode, 201);
    itemId = created.body.item.id;
    assert.strictEqual(created.body.item.confirmed, false, 'new rows start as estimates');

    const edited = await call(costs.updateItem, { params: { id: itemId }, body: { unit_cost: 2000, confirmed: true }, user });
    assert.strictEqual(edited.body.item.unit_cost, 2000);
    assert.strictEqual(edited.body.item.confirmed, true);

    const line = await call(costs.createLine, {
      body: { product_type: 'shawl', product_id: null, audience: 'all', cost_item_id: itemId, qty: 1 }, user,
    });
    assert.strictEqual(line.statusCode, 201);

    const shawls = await query(
      `SELECT COUNT(*)::int AS n FROM orders o JOIN products p ON p.id = o.product_id
        WHERE p.type = 'shawl' AND o.wholesaler_approval IS NULL AND ${counts.billableOrderSql('o')}
          AND to_char(o.created_at AT TIME ZONE 'Asia/Baghdad','YYYY-MM') = $1`,
      [month]
    );
    const moved = await computePnl({ from: month, to: month });
    assert.strictEqual(moved.total.costs.materials - base.total.costs.materials, shawls.rows[0].n * 2000);

    const exp = await call(costs.createExpense, {
      body: { kind: 'loss', name_ar: 'خسارة اختبار', amount: 12345, starts_on: `${month}-10` }, user,
    });
    assert.strictEqual(exp.statusCode, 201);
    expenseId = exp.body.expense.id;
    const withLoss = await computePnl({ from: month, to: month });
    assert.strictEqual(withLoss.total.costs.losses - moved.total.costs.losses, 12345);

    const badEnd = await call(costs.updateExpense, { params: { id: expenseId }, body: { ends_on: `${month}-20` }, user });
    assert.strictEqual(badEnd.statusCode, 400, 'only a monthly expense has an end date');

    const del = await call(costs.deleteItem, { params: { id: itemId }, user });
    assert.strictEqual(del.body.ok, true);
    itemId = null;
    const orphan = await query(`SELECT 1 FROM product_cost_lines WHERE id = $1`, [line.body.line.id]);
    assert.strictEqual(orphan.rows.length, 0, 'deleting an item deletes its recipe lines');
  } finally {
    if (itemId) await query(`DELETE FROM cost_items WHERE id = $1`, [itemId]);
    if (expenseId) await query(`DELETE FROM shop_expenses WHERE id = $1`, [expenseId]);
  }
});

test('a recipe line cannot be pinned to a product of another type', async () => {
  const user = await anAdmin();
  const p = await query(`SELECT id FROM products WHERE type = 'robe' LIMIT 1`);
  const ci = await query(`SELECT id FROM cost_items LIMIT 1`);
  const res = await call(costs.createLine, {
    body: { product_type: 'sash', product_id: p.rows[0].id, cost_item_id: ci.rows[0].id, qty: 1 }, user,
  });
  assert.strictEqual(res.statusCode, 400);
});
