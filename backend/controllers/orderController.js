const { query, tx } = require('../lib/db');
const { priceRoleForUser } = require('./catalogController');

const ALL_STATUSES = [
  'pending_approval', 'designing', 'design_complete', 'staff_review',
  'printing', 'ready', 'delivered', 'cancelled',
];

// Staff may only move orders through the production pipeline
const STAFF_ALLOWED = ['staff_review', 'printing', 'ready', 'delivered'];

// Allowed status transitions (state machine). Admin/staff cannot make illegal jumps.
const TRANSITIONS = {
  pending_approval: ['designing', 'cancelled'],
  designing: ['design_complete', 'cancelled'],
  design_complete: ['staff_review', 'cancelled'],
  staff_review: ['printing', 'designing', 'cancelled'],
  printing: ['ready', 'cancelled'],
  ready: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

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
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const countRes = await query(
    `SELECT COUNT(*)::int AS total FROM orders o JOIN students s ON s.id = o.student_id ${whereSql}`,
    params
  );

  const dataParams = [...params, limit, offset];
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
    ${whereSql}
    ORDER BY o.created_at DESC
    LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`;
  const { rows } = await query(sql, dataParams);
  res.json({ data: rows, total: countRes.rows[0].total, limit, offset });
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
  if (prev !== status && !(TRANSITIONS[prev] || []).includes(status)) {
    return res.status(409).json({ error: 'انتقال حالة غير مسموح', code: 'ERR_INVALID_TRANSITION' });
  }
  const deliveredSet = status === 'delivered' ? ', delivered_at = NOW()' : '';
  const updated = await tx(async (client) => {
    const { rows } = await client.query(
      `UPDATE orders SET status = $1${deliveredSet} WHERE id = $2 RETURNING id, status`,
      [status, id]
    );
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'status_change', 'order', $2, $3)`,
      [req.user.id, id, JSON.stringify({ from: prev, to: status })]
    );
    await client.query(
      `INSERT INTO notifications (user_id, type, title_ar, body_ar, link)
       VALUES ($1, 'status_change', $2, $3, '/')`,
      [cur.rows[0].user_id, 'تحديث حالة الطلب', `حالة طلبك الآن: ${STATUS_LABEL_AR[status]}`]
    );
    return rows[0];
  });
  res.json({ data: updated });
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
  let resolvedBatchId = null;
  if (batch_id) {
    // Client-supplied batch must belong to this student's wholesaler (no cross-tenant linkage).
    const owned = await query(
      `SELECT id FROM batches WHERE id = $1 AND wholesaler_id = $2`,
      [batch_id, student.wholesaler_id]
    );
    if (!owned.rows.length) {
      return res.status(403).json({ error: 'الدفعة غير صالحة', code: 'ERR_FORBIDDEN' });
    }
    resolvedBatchId = batch_id;
  } else if (student.wholesaler_id) {
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
    `SELECT id, name_ar, required, max_select, input_type, gender_restriction, requires_customer_image
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

  // Batch-fetch every selected option in one query (avoids per-option N+1 round-trips).
  const optionIds = sel.map((s) => s.option_id).filter(Boolean);
  const optMap = new Map();
  if (optionIds.length) {
    const opts = await query(
      `SELECT o.id, o.group_id, o.label_ar, o.requires_customer_image,
              COALESCE(opr.price_delta, o.price_delta) AS price_delta
       FROM options o
       LEFT JOIN option_price_roles opr ON opr.option_id = o.id AND opr.role = $2
       WHERE o.id = ANY($1) AND o.active = TRUE`,
      [optionIds, role]
    );
    for (const o of opts.rows) optMap.set(o.id, o);
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
    const opt = optMap.get(s.option_id);
    if (!opt || opt.group_id !== s.group_id) {
      return res.status(400).json({ error: 'خيار غير صالح', code: 'ERR_VALIDATION' });
    }
    // customer must upload a reference photo when group or option requires it (e.g. مثلث)
    const needsImage = g.requires_customer_image || opt.requires_customer_image;
    if (needsImage && !s.customer_image_url) {
      return res.status(400).json({ error: `يرجى رفع صورة لـ ${g.name_ar}`, code: 'ERR_CUSTOMER_IMAGE_REQUIRED' });
    }
    const line = opt.price_delta * qty;
    total += line;
    items.push({
      label: `${g.name_ar}: ${opt.label_ar}${qty > 1 ? ' ×' + qty : ''}`,
      price: line, group_id: s.group_id, option_id: opt.id, qty,
      customer_image_url: s.customer_image_url || null,
    });
  }

  // Reconcile with an existing order to avoid duplicates. SELECT + UPDATE must be
  // inside the same transaction with FOR UPDATE to prevent a race condition where
  // two simultaneous taps both see no existing order and both INSERT.
  const orderId = await tx(async (client) => {
    const existingSql = design_id
      ? `SELECT id, status FROM orders WHERE student_id = $1 AND design_id = $2 FOR UPDATE`
      : `SELECT id, status FROM orders WHERE student_id = $1 AND product_id = $2 AND design_id IS NULL FOR UPDATE`;
    const existingArgs = design_id
      ? [student.id, design_id]
      : [student.id, product_id];
    const existing = await client.query(existingSql, existingArgs);

    let oid;
    if (existing.rows.length) {
      const currentStatus = existing.rows[0].status;
      // Only allow reconfiguring orders that haven't been picked up for production
      const reconfigurable = ['designing', 'design_complete'];
      if (!reconfigurable.includes(currentStatus)) {
        throw Object.assign(new Error('ORDER_IN_PROGRESS'), { status: 409, code: 'ERR_ORDER_IN_PROGRESS' });
      }
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
        `INSERT INTO order_items (order_id, group_id, option_id, label_snapshot, price_snapshot, qty, customer_image_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [oid, it.group_id, it.option_id, it.label, it.price, it.qty, it.customer_image_url || null]
      );
    }
    return oid;
  });

  res.status(201).json({ data: { order_id: orderId, price_role: role, total, breakdown: items } });
}

// ---------- Configure package (wholesaler selection or rep student bundle) ----------
async function configurePackage(req, res) {
  const { package_id, cap_option_id, batch_id } = req.body;
  if (!package_id) {
    return res.status(400).json({ error: 'الباقة مطلوبة', code: 'ERR_VALIDATION' });
  }

  const pkg = await query(
    `SELECT p.id, p.name_ar, p.price, p.active,
            pr.sash_type_option_id,
            o.label_ar AS sash_type_label
     FROM packages p
     LEFT JOIN package_rules pr ON pr.package_id = p.id
     LEFT JOIN options o ON o.id = pr.sash_type_option_id
     WHERE p.id = $1 AND p.active = TRUE`,
    [package_id]
  );
  if (!pkg.rows.length) {
    return res.status(404).json({ error: 'الباقة غير موجودة', code: 'ERR_NOT_FOUND' });
  }
  const packageRow = pkg.rows[0];

  if (cap_option_id) {
    const capOpt = await query(
      `SELECT o.id FROM options o
       JOIN option_groups g ON g.id = o.group_id
       JOIN products p ON p.id = g.product_id AND p.type = 'cap'
       WHERE o.id = $1 AND o.active = TRUE`,
      [cap_option_id]
    );
    if (!capOpt.rows.length) {
      return res.status(400).json({ error: 'خيار القبعة غير صالح', code: 'ERR_VALIDATION' });
    }
  }

  if (req.user.role === 'wholesaler') {
    const w = await query(`SELECT id FROM wholesalers WHERE user_id = $1`, [req.user.id]);
    if (!w.rows.length) {
      return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
    }
    if (batch_id) {
      const owned = await query(
        `SELECT id FROM batches WHERE id = $1 AND wholesaler_id = $2`,
        [batch_id, w.rows[0].id]
      );
      if (!owned.rows.length) {
        return res.status(403).json({ error: 'الدفعة غير صالحة', code: 'ERR_FORBIDDEN' });
      }
    }
    await query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'select_package', 'package', $2, $3)`,
      [
        req.user.id,
        package_id,
        JSON.stringify({
          cap_option_id: cap_option_id || null,
          batch_id: batch_id || null,
          package_name: packageRow.name_ar,
        }),
      ]
    );
    return res.status(201).json({ data: { order_id: package_id } });
  }

  const st = await query(
    `SELECT id, gender, status, wholesaler_id FROM students WHERE user_id = $1`, [req.user.id]
  );
  if (!st.rows.length) {
    return res.status(404).json({ error: 'حساب الطالب غير موجود', code: 'ERR_NOT_FOUND' });
  }
  const student = st.rows[0];
  if (!student.wholesaler_id) {
    return res.status(403).json({ error: 'الباقات للطلاب المسجلين عبر ممثل فقط', code: 'ERR_FORBIDDEN' });
  }
  if (student.status !== 'approved') {
    return res.status(403).json({ error: 'يجب موافقة الممثل أولاً', code: 'ERR_NOT_APPROVED' });
  }

  let resolvedBatchId = null;
  if (batch_id) {
    const owned = await query(
      `SELECT id FROM batches WHERE id = $1 AND wholesaler_id = $2`,
      [batch_id, student.wholesaler_id]
    );
    if (!owned.rows.length) {
      return res.status(403).json({ error: 'الدفعة غير صالحة', code: 'ERR_FORBIDDEN' });
    }
    resolvedBatchId = batch_id;
  } else {
    const b = await query(
      `SELECT id FROM batches WHERE wholesaler_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [student.wholesaler_id]
    );
    resolvedBatchId = b.rows[0]?.id || null;
  }

  const prods = await query(
    `SELECT id, type FROM products WHERE type IN ('sash','robe','cap') AND active = TRUE
     ORDER BY type, featured DESC, sort, created_at`
  );
  const byType = {};
  for (const p of prods.rows) if (!byType[p.type]) byType[p.type] = p.id;

  if (!byType.sash || !byType.robe || !byType.cap) {
    return res.status(500).json({ error: 'منتجات الباقة غير مكتملة في النظام', code: 'ERR_CONFIG' });
  }

  const productPrices = {
    [byType.sash]: packageRow.price,
    [byType.robe]: 0,
    [byType.cap]: 0,
  };

  const orderIds = await tx(async (client) => {
    const ids = {};
    for (const [prodId, price] of Object.entries(productPrices)) {
      const existing = await client.query(
        `SELECT id FROM orders WHERE student_id = $1 AND product_id = $2 AND design_id IS NULL AND status <> 'cancelled'`,
        [student.id, prodId]
      );
      let oid;
      if (existing.rows.length) {
        oid = existing.rows[0].id;
        await client.query(
          `UPDATE orders SET price = $1, batch_id = $2, package_id = $3, status = 'designing' WHERE id = $4`,
          [price, resolvedBatchId, package_id, oid]
        );
        await client.query(`DELETE FROM order_items WHERE order_id = $1`, [oid]);
      } else {
        const o = await client.query(
          `INSERT INTO orders (student_id, product_id, batch_id, package_id, price, status)
           VALUES ($1, $2, $3, $4, $5, 'designing') RETURNING id`,
          [student.id, prodId, resolvedBatchId, package_id, price]
        );
        oid = o.rows[0].id;
      }
      await client.query(
        `INSERT INTO order_items (order_id, label_snapshot, price_snapshot, qty, option_id)
         VALUES ($1, $2, $3, 1, $4)`,
        [
          oid,
          `باقة: ${packageRow.name_ar}`,
          price,
          prodId === byType.cap ? cap_option_id || null : packageRow.sash_type_option_id || null,
        ]
      );
      ids[prodId] = oid;
    }
    return ids;
  });

  res.status(201).json({
    data: {
      order_id: orderIds[byType.sash],
      package_id,
      package_name: packageRow.name_ar,
      total: packageRow.price,
      orders: orderIds,
    },
  });
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
    `SELECT label_snapshot, price_snapshot, qty, customer_image_url FROM order_items
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
  listOrders, updateStatus, configureOrder, configurePackage, getOrderBreakdown,
  ALL_STATUSES, STAFF_ALLOWED,
};
