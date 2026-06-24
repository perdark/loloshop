const crypto = require('crypto');
const { query, tx } = require('../lib/db');
const { priceSelections } = require('./orderController');
const { priceRoleForUser } = require('./catalogController');

async function studentFor(userId) {
  const { rows } = await query(
    `SELECT id, gender, status, wholesaler_id FROM students WHERE user_id = $1`,
    [userId]
  );
  return rows[0];
}

async function getOrCreateCart(client, userId) {
  const existing = await client.query(`SELECT id FROM carts WHERE user_id = $1`, [userId]);
  if (existing.rows.length) return existing.rows[0].id;
  const created = await client.query(`INSERT INTO carts (user_id) VALUES ($1) RETURNING id`, [userId]);
  return created.rows[0].id;
}

function clampQty(v) {
  return Math.min(Math.max(parseInt(v, 10) || 1, 1), 50);
}

// ---------- GET /cart ----------
async function getCart(req, res) {
  const cart = await query(`SELECT id FROM carts WHERE user_id = $1`, [req.user.id]);
  if (!cart.rows.length) return res.json({ data: { id: null, items: [], total: 0 } });
  const cartId = cart.rows[0].id;
  const { rows } = await query(
    `SELECT ci.id, ci.product_id, ci.design_id, ci.selections, ci.price_snapshot, ci.qty,
            ci.measurements,
            p.name_ar AS product_name, p.type AS product_type, p.image_url, p.customizable
     FROM cart_items ci JOIN products p ON p.id = ci.product_id
     WHERE ci.cart_id = $1 ORDER BY ci.created_at`,
    [cartId]
  );
  const total = rows.reduce((sum, r) => sum + Number(r.price_snapshot) * r.qty, 0);
  res.json({ data: { id: cartId, items: rows, total } });
}

// ---------- POST /cart/items ----------
async function addItem(req, res) {
  const { product_id, selections, qty, design_id, measurements } = req.body;
  if (!product_id) return res.status(400).json({ error: 'المنتج مطلوب', code: 'ERR_VALIDATION' });
  const student = await studentFor(req.user.id);
  if (!student) return res.status(404).json({ error: 'حساب الطالب غير موجود', code: 'ERR_NOT_FOUND' });

  const role = await priceRoleForUser(req.user);
  const priced = await priceSelections({
    productId: product_id, role, selections, studentGender: student.gender,
  });
  if (!priced.ok) return res.status(priced.status).json({ error: priced.error, code: priced.code });

  // A designed sash carries its design_id — verify it belongs to this student.
  let designId = null;
  if (design_id) {
    const d = await query(`SELECT id FROM designs WHERE id = $1 AND student_id = $2`, [design_id, student.id]);
    if (!d.rows.length) return res.status(400).json({ error: 'تصميم غير صالح', code: 'ERR_VALIDATION' });
    designId = design_id;
  }

  const quantity = clampQty(qty);
  const selJson = JSON.stringify(Array.isArray(selections) ? selections : []);
  const measurementsJson = measurements ? JSON.stringify(measurements) : null;

  const itemId = await tx(async (client) => {
    const cartId = await getOrCreateCart(client, req.user.id);
    // One cart line per design: re-confirming the same sash design updates its line, never duplicates.
    if (designId) {
      const existing = await client.query(
        `SELECT id FROM cart_items WHERE cart_id = $1 AND design_id = $2`,
        [cartId, designId]
      );
      if (existing.rows.length) {
        await client.query(
          `UPDATE cart_items SET product_id = $1, selections = $2, price_snapshot = $3, qty = $4, measurements = $5
           WHERE id = $6`,
          [product_id, selJson, priced.total, quantity, measurementsJson, existing.rows[0].id]
        );
        await client.query(`UPDATE carts SET updated_at = NOW() WHERE id = $1`, [cartId]);
        return existing.rows[0].id;
      }
    }
    const { rows } = await client.query(
      `INSERT INTO cart_items (cart_id, product_id, design_id, selections, price_snapshot, qty, measurements)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [cartId, product_id, designId, selJson, priced.total, quantity, measurementsJson]
    );
    await client.query(`UPDATE carts SET updated_at = NOW() WHERE id = $1`, [cartId]);
    return rows[0].id;
  });
  res.status(201).json({ data: { id: itemId, price_snapshot: priced.total, qty: quantity } });
}

// ---------- PATCH /cart/items/:id ----------
async function updateItem(req, res) {
  const { id } = req.params;
  const quantity = clampQty(req.body.qty);
  const { rows } = await query(
    `UPDATE cart_items SET qty = $1
     WHERE id = $2 AND cart_id = (SELECT id FROM carts WHERE user_id = $3)
     RETURNING id, qty`,
    [quantity, id, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'العنصر غير موجود', code: 'ERR_NOT_FOUND' });
  res.json({ data: rows[0] });
}

// ---------- DELETE /cart/items/:id ----------
async function removeItem(req, res) {
  const { id } = req.params;
  const { rows } = await query(
    `DELETE FROM cart_items
     WHERE id = $1 AND cart_id = (SELECT id FROM carts WHERE user_id = $2) RETURNING id`,
    [id, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'العنصر غير موجود', code: 'ERR_NOT_FOUND' });
  res.json({ data: rows[0] });
}

// ---------- POST /cart/checkout ----------
// Re-prices every line authoritatively (never trusts the snapshot), then turns each line into
// an order. Cart is cleared on success.
async function checkout(req, res) {
  const student = await studentFor(req.user.id);
  if (!student) return res.status(404).json({ error: 'حساب الطالب غير موجود', code: 'ERR_NOT_FOUND' });
  const role = await priceRoleForUser(req.user);

  const cart = await query(`SELECT id FROM carts WHERE user_id = $1`, [req.user.id]);
  if (!cart.rows.length) return res.status(400).json({ error: 'السلة فارغة', code: 'ERR_EMPTY_CART' });
  const cartId = cart.rows[0].id;
  const itemsRes = await query(
    `SELECT ci.id, ci.product_id, ci.design_id, ci.selections, ci.qty, ci.measurements, p.customizable, p.type AS product_type
     FROM cart_items ci JOIN products p ON p.id = ci.product_id
     WHERE ci.cart_id = $1 ORDER BY ci.created_at`,
    [cartId]
  );
  if (!itemsRes.rows.length) return res.status(400).json({ error: 'السلة فارغة', code: 'ERR_EMPTY_CART' });

  const lines = [];
  for (const ci of itemsRes.rows) {
    const priced = await priceSelections({
      productId: ci.product_id, role, selections: ci.selections, studentGender: student.gender,
    });
    if (!priced.ok) return res.status(priced.status).json({ error: priced.error, code: priced.code });
    lines.push({ ci, priced });
  }

  // Assign a shared bundle ID when this checkout contains more than one item.
  const bundleId = lines.length > 1 ? crypto.randomUUID() : null;

  const orderIds = await tx(async (client) => {
    const created = [];
    for (const { ci, priced } of lines) {
      const note = ci.qty > 1 ? `الكمية المطلوبة: ${ci.qty}` : null;
      const measurementsJson = ci.measurements ? JSON.stringify(ci.measurements) : null;
      let oid;

      // Compute routing flags
      const has_embroidery = !!ci.design_id || priced.hasEmbroidery;
      const needs_pressing = (ci.product_type === 'sash' || ci.product_type === 'robe');

      if (ci.design_id) {
        // Designed sash → finalize the design and place it into the approval pipeline.
        await client.query(
          `UPDATE designs SET completed = TRUE, completed_at = COALESCE(completed_at, NOW()) WHERE id = $1`,
          [ci.design_id]
        );
        const existing = await client.query(
          `SELECT id FROM orders WHERE design_id = $1 AND status <> 'cancelled'`,
          [ci.design_id]
        );
        if (existing.rows.length) {
          oid = existing.rows[0].id;
          await client.query(
            `UPDATE orders SET price = $1, status = 'design_complete', notes = $2, checkout_group_id = $3,
             has_embroidery = $4, needs_pressing = $5, measurements = $6
             WHERE id = $7`,
            [priced.total, note, bundleId, has_embroidery, needs_pressing, measurementsJson, oid]
          );
          await client.query(`DELETE FROM order_items WHERE order_id = $1`, [oid]);
        } else {
          const o = await client.query(
            `INSERT INTO orders (student_id, product_id, design_id, price, status, notes, checkout_group_id,
                                 has_embroidery, needs_pressing, measurements)
             VALUES ($1, $2, $3, $4, 'design_complete', $5, $6, $7, $8, $9) RETURNING id`,
            [student.id, ci.product_id, ci.design_id, priced.total, note, bundleId,
             has_embroidery, needs_pressing, measurementsJson]
          );
          oid = o.rows[0].id;
        }
      } else {
        // Non-design products: route based on embroidery flag
        let status;
        if (ci.customizable) {
          status = 'designing';
        } else if (priced.hasEmbroidery) {
          status = 'design_complete'; // designer handles design-less embroidery
        } else {
          status = 'preparing';
        }
        const existing = await client.query(
          `SELECT id FROM orders WHERE student_id = $1 AND product_id = $2 AND design_id IS NULL AND status <> 'cancelled'`,
          [student.id, ci.product_id]
        );
        if (existing.rows.length) {
          oid = existing.rows[0].id;
          await client.query(
            `UPDATE orders SET price = $1, status = $2, notes = $3, checkout_group_id = $4,
             has_embroidery = $5, needs_pressing = $6, measurements = $7
             WHERE id = $8`,
            [priced.total, status, note, bundleId, has_embroidery, needs_pressing, measurementsJson, oid]
          );
          await client.query(`DELETE FROM order_items WHERE order_id = $1`, [oid]);
        } else {
          const o = await client.query(
            `INSERT INTO orders (student_id, product_id, price, status, notes, checkout_group_id,
                                 has_embroidery, needs_pressing, measurements)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [student.id, ci.product_id, priced.total, status, note, bundleId,
             has_embroidery, needs_pressing, measurementsJson]
          );
          oid = o.rows[0].id;
        }
      }
      for (const it of priced.items) {
        await client.query(
          `INSERT INTO order_items (order_id, group_id, option_id, label_snapshot, price_snapshot, qty, customer_image_url, customer_text)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [oid, it.group_id, it.option_id, it.label, it.price, it.qty,
           it.customer_image_url || null, it.customer_text || null]
        );
      }
      created.push(oid);
    }
    await client.query(`DELETE FROM cart_items WHERE cart_id = $1`, [cartId]);
    return created;
  });

  res.status(201).json({ data: { orders: orderIds, count: orderIds.length, bundle_id: bundleId } });
}

module.exports = { getCart, addItem, updateItem, removeItem, checkout };
