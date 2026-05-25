const { query, tx } = require('../lib/db');
const { priceRoleForUser } = require('./catalogController');

const ALL_STATUSES = [
  'pending_approval', 'designing', 'design_complete', 'staff_review',
  'printing', 'ready', 'delivered', 'cancelled',
];

// Staff may only move orders through the production pipeline
const STAFF_ALLOWED = ['staff_review', 'printing', 'ready', 'delivered'];

const STATUS_LABEL_AR = {
  pending_approval: 'بانتظار الموافقة',
  designing: 'قيد التصميم',
  design_complete: 'اكتمل التصميم',
  staff_review: 'قيد المراجعة',
  printing: 'قيد الطباعة',
  ready: 'جاهز للاستلام',
  delivered: 'تم التسليم',
  cancelled: 'ملغي',
};

async function listOrders(req, res) {
  const { wholesaler_id, status, from, to } = req.query;
  const params = [];
  const where = [];
  if (wholesaler_id) {
    params.push(wholesaler_id);
    where.push(`s.wholesaler_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`o.status = $${params.length}`);
  }
  if (from) {
    params.push(from);
    where.push(`o.created_at >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    where.push(`o.created_at <= $${params.length}`);
  }
  const sql = `
    SELECT o.id, s.id AS student_id, u.name AS student_full_name,
           s.university_name, s.department,
           p.name_ar AS product_name, wu.name AS wholesaler_name,
           o.price, o.cost, o.profit, o.status, o.created_at
    FROM orders o
    JOIN students s ON s.id = o.student_id
    JOIN users u ON u.id = s.user_id
    JOIN products p ON p.id = o.product_id
    LEFT JOIN wholesalers w ON w.id = s.wholesaler_id
    LEFT JOIN users wu ON wu.id = w.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY o.created_at DESC
    LIMIT 200`;
  const { rows } = await query(sql, params);
  res.json({ data: rows });
}

async function updateStatus(req, res) {
  const { id } = req.params;
  const { status } = req.body;
  if (!ALL_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'حالة غير صالحة', code: 'ERR_VALIDATION' });
  }
  if (req.user.role === 'staff' && !STAFF_ALLOWED.includes(status)) {
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  }
  const cur = await query(
    `SELECT o.id, o.status, s.user_id
     FROM orders o JOIN students s ON s.id = o.student_id
     WHERE o.id = $1`,
    [id]
  );
  if (!cur.rows.length) {
    return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  }
  const prev = cur.rows[0].status;
  const deliveredSet = status === 'delivered' ? ', delivered_at = NOW()' : '';
  const { rows } = await query(
    `UPDATE orders SET status = $1${deliveredSet} WHERE id = $2 RETURNING id, status`,
    [status, id]
  );
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'status_change', 'order', $2, $3)`,
    [req.user.id, id, JSON.stringify({ from: prev, to: status })]
  );
  await query(
    `INSERT INTO notifications (user_id, type, title_ar, body_ar, link)
     VALUES ($1, 'status_change', $2, $3, '/')`,
    [cur.rows[0].user_id, 'تحديث حالة الطلب', `حالة طلبك الآن: ${STATUS_LABEL_AR[status]}`]
  );
  res.json({ data: rows[0] });
}

// ---------- Configure order from selected options (retail student) ----------
async function configureOrder(req, res) {
  const { product_id, design_id, batch_id, selections } = req.body;
  if (!product_id) {
    return res.status(400).json({ error: 'المنتج مطلوب', code: 'ERR_VALIDATION' });
  }
  const st = await query(
    `SELECT id, gender, status, wholesaler_id FROM students WHERE user_id = $1`, [req.user.id]
  );
  if (!st.rows.length) {
    return res.status(404).json({ error: 'حساب الطالب غير موجود', code: 'ERR_NOT_FOUND' });
  }
  const student = st.rows[0];
  // rep students need approval; independent retail (no wholesaler) are pre-approved
  if (student.wholesaler_id && student.status !== 'approved') {
    return res.status(403).json({ error: 'يجب موافقة الممثل أولاً', code: 'ERR_NOT_APPROVED' });
  }
  const role = await priceRoleForUser(req.user);

  // auto-attach rep orders to their wholesaler's most recent batch
  let resolvedBatchId = batch_id || null;
  if (!resolvedBatchId && student.wholesaler_id) {
    const b = await query(
      `SELECT id FROM batches WHERE wholesaler_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [student.wholesaler_id]
    );
    resolvedBatchId = b.rows[0]?.id || null;
  }

  const prod = await query(
    `SELECT p.id, p.gender_restriction, COALESCE(ppr.base_price, p.base_price) AS base_price
     FROM products p
     LEFT JOIN product_price_roles ppr ON ppr.product_id = p.id AND ppr.role = $2
     WHERE p.id = $1 AND p.active = TRUE`,
    [product_id, role]
  );
  if (!prod.rows.length) {
    return res.status(404).json({ error: 'المنتج غير موجود', code: 'ERR_NOT_FOUND' });
  }
  if (prod.rows[0].gender_restriction && prod.rows[0].gender_restriction !== student.gender) {
    return res.status(403).json({ error: 'هذا المنتج غير متاح', code: 'ERR_GENDER' });
  }

  const groups = await query(
    `SELECT id, name_ar, required, max_select, input_type, gender_restriction
     FROM option_groups WHERE product_id = $1 AND active = TRUE`,
    [product_id]
  );
  const groupMap = new Map(groups.rows.map((g) => [g.id, g]));
  const sel = Array.isArray(selections) ? selections : [];
  const selectedGroupIds = new Set(sel.map((s) => s.group_id));
  for (const g of groups.rows) {
    if (g.required && !selectedGroupIds.has(g.id)) {
      return res.status(400).json({ error: `يرجى اختيار: ${g.name_ar}`, code: 'ERR_REQUIRED_OPTION' });
    }
  }

  let total = prod.rows[0].base_price;
  const items = [{ label: 'السعر الأساسي', price: total, group_id: null, option_id: null, qty: 1 }];
  for (const s of sel) {
    const g = groupMap.get(s.group_id);
    if (!g) return res.status(400).json({ error: 'خيار غير صالح', code: 'ERR_VALIDATION' });
    if (g.gender_restriction && g.gender_restriction !== student.gender) {
      return res.status(403).json({ error: 'خيار غير متاح', code: 'ERR_GENDER' });
    }
    const qty = g.input_type === 'counter'
      ? Math.min(Math.max(parseInt(s.qty, 10) || 1, 1), g.max_select)
      : 1;
    const opt = await query(
      `SELECT o.id, o.label_ar, COALESCE(opr.price_delta, o.price_delta) AS price_delta
       FROM options o
       LEFT JOIN option_price_roles opr ON opr.option_id = o.id AND opr.role = $2
       WHERE o.id = $1 AND o.group_id = $3 AND o.active = TRUE`,
      [s.option_id, role, s.group_id]
    );
    if (!opt.rows.length) {
      return res.status(400).json({ error: 'خيار غير صالح', code: 'ERR_VALIDATION' });
    }
    const line = opt.rows[0].price_delta * qty;
    total += line;
    items.push({
      label: `${g.name_ar}: ${opt.rows[0].label_ar}${qty > 1 ? ' ×' + qty : ''}`,
      price: line, group_id: s.group_id, option_id: opt.rows[0].id, qty,
    });
  }

  // Reconcile with an existing order to avoid duplicates:
  //  - sash: the designer auto-creates a 'designing' order keyed by design_id → update it
  //  - other products: one order per (student, product) without a design → update on re-config
  const existing = design_id
    ? await query(`SELECT id FROM orders WHERE student_id = $1 AND design_id = $2`, [student.id, design_id])
    : await query(`SELECT id FROM orders WHERE student_id = $1 AND product_id = $2 AND design_id IS NULL`, [student.id, product_id]);

  const orderId = await tx(async (client) => {
    let oid;
    if (existing.rows.length) {
      oid = existing.rows[0].id;
      await client.query(
        `UPDATE orders SET price = $1, batch_id = $2, status = 'design_complete' WHERE id = $3`,
        [total, resolvedBatchId, oid]
      );
      await client.query(`DELETE FROM order_items WHERE order_id = $1`, [oid]);
    } else {
      const o = await client.query(
        `INSERT INTO orders (student_id, product_id, design_id, batch_id, price, status)
         VALUES ($1, $2, $3, $4, $5, 'design_complete') RETURNING id`,
        [student.id, product_id, design_id || null, resolvedBatchId, total]
      );
      oid = o.rows[0].id;
    }
    for (const it of items) {
      await client.query(
        `INSERT INTO order_items (order_id, group_id, option_id, label_snapshot, price_snapshot, qty)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [oid, it.group_id, it.option_id, it.label, it.price, it.qty]
      );
    }
    return oid;
  });

  res.status(201).json({ data: { order_id: orderId, price_role: role, total, breakdown: items } });
}

// ---------- Order price breakdown (owner / staff / admin) ----------
async function getOrderBreakdown(req, res) {
  const { id } = req.params;
  const o = await query(
    `SELECT o.id, o.price, o.status, o.created_at, s.user_id,
            u.name AS student_name, p.name_ar AS product_name
     FROM orders o
     JOIN students s ON s.id = o.student_id
     JOIN users u ON u.id = s.user_id
     JOIN products p ON p.id = o.product_id
     WHERE o.id = $1`,
    [id]
  );
  if (!o.rows.length) return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  const row = o.rows[0];
  if (!['admin', 'staff'].includes(req.user.role) && row.user_id !== req.user.id) {
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  }
  const items = await query(
    `SELECT label_snapshot, price_snapshot, qty FROM order_items
     WHERE order_id = $1 ORDER BY created_at`,
    [id]
  );
  res.json({
    data: {
      id: row.id, product_name: row.product_name, student_name: row.student_name,
      total: row.price, status: row.status, created_at: row.created_at,
      breakdown: items.rows,
    },
  });
}

module.exports = {
  listOrders, updateStatus, configureOrder, getOrderBreakdown,
  ALL_STATUSES, STAFF_ALLOWED,
};
