const { query } = require('./db');

// Saved item snapshots explain an order's accounting without consulting today's pricing.
// Historical/manual differences are reconciled separately against orders.price/cost.
async function moneyCalculations(rows, exec = query) {
  const ids = [...new Set(rows.map((row) => row.order_id || row.id).filter(Boolean))];
  if (!ids.length) return new Map();
  const detail = await exec(
    `SELECT order_id, label_snapshot, price_snapshot, admin_price_snapshot, qty
       FROM order_items
      WHERE order_id = ANY($1::uuid[])
        AND (price_snapshot <> 0 OR admin_price_snapshot <> 0)
      ORDER BY created_at, id`,
    [ids]
  );
  const byId = new Map(ids.map((id) => [id, []]));
  for (const line of detail.rows) {
    byId.get(line.order_id)?.push({
      label: line.label_snapshot,
      price: Number(line.price_snapshot || 0),
      admin_price: Number(line.admin_price_snapshot || 0),
      qty: Number(line.qty || 1),
    });
  }
  return byId;
}

function calculationFor(row, byId) {
  const id = row.order_id || row.id;
  const lines = byId.get(id) || [];
  const linePrice = lines.reduce((sum, line) => sum + line.price, 0);
  const lineAdmin = lines.reduce((sum, line) => sum + line.admin_price, 0);
  const price = Number(row.price || 0);
  const cost = Number(row.cost || 0);
  return {
    lines,
    line_price_total: linePrice,
    line_admin_total: lineAdmin,
    price_adjustment: price - linePrice,
    cost_adjustment: cost - lineAdmin,
  };
}

module.exports = { moneyCalculations, calculationFor };
