const { query, tx } = require('../lib/db');
const { canStaffTransition, STATUS_LABEL_AR } = require('./orderController');
const { staffScopeAllows } = require('../middleware/auth');

// Resolve the order-source filter for a request: a scoped staff member is pinned to their
// users.order_scope; manager/admin (and 'both'-scope staff) may filter freely via ?source.
function resolveSourceFilter(user, querySource) {
  const scope = user.order_scope || 'both';
  const free = user.role === 'admin' || user.staff_type === 'manager' || scope === 'both';
  if (free) {
    return querySource === 'retail' || querySource === 'wholesaler' ? querySource : null;
  }
  return scope; // 'retail' | 'wholesaler'
}

function sourceClause(sourceFilter) {
  if (sourceFilter === 'retail') return 'AND s.wholesaler_id IS NULL';
  if (sourceFilter === 'wholesaler') return 'AND s.wholesaler_id IS NOT NULL';
  return '';
}

// Which production stages each staff_type works (its queue). Manager/admin see the whole line.
const QUEUE_STAGES = {
  designer: ['design_complete'],
  embroiderer: ['embroidery'],
  presser: ['pressing'],
  preparer: ['preparing', 'ready'],
};
const MANAGER_STAGES = ['design_complete', 'embroidery', 'pressing', 'preparing', 'ready'];

// Forward edges advanced via the generic "advance" action (designer uses approve/reject instead).
const NEXT_STAGE = {
  embroidery: 'pressing',
  pressing: 'preparing',
  preparing: 'ready',
  ready: 'delivered',
};

function isManager(u) {
  return u.role === 'admin' || u.staff_type === 'manager';
}

// ---------- Stage-scoped work queue for the requesting staff member ----------
async function getQueue(req, res) {
  const u = req.user;
  let stages;
  if (isManager(u)) {
    const filter = req.query.stage;
    stages = filter && MANAGER_STAGES.includes(filter) ? [filter] : MANAGER_STAGES;
  } else {
    stages = QUEUE_STAGES[u.staff_type] || [];
  }
  if (!stages.length) return res.json({ data: [] });

  // The designer only reviews designs still awaiting a verdict.
  const onlyPending = u.staff_type === 'designer' && !isManager(u);
  const srcClause = sourceClause(resolveSourceFilter(u, req.query.source));
  const { rows } = await query(
    `SELECT o.id, o.status, o.created_at, o.design_id, o.checkout_group_id,
            u.name AS student_name, s.university_name, s.department,
            p.name_ar AS product_name, p.type AS product_type,
            b.name_ar AS batch_name, b.deadline,
            d.approval_status, d.rejection_reason,
            CASE WHEN s.wholesaler_id IS NULL THEN 'retail' ELSE 'wholesaler' END AS source,
            wu.name AS wholesaler_name
     FROM orders o
     JOIN students s ON s.id = o.student_id
     JOIN users u ON u.id = s.user_id
     JOIN products p ON p.id = o.product_id
     LEFT JOIN batches b ON b.id = o.batch_id
     LEFT JOIN designs d ON d.id = o.design_id
     LEFT JOIN wholesalers w ON w.id = s.wholesaler_id
     LEFT JOIN users wu ON wu.id = w.user_id
     WHERE o.status::text = ANY($1)
       ${onlyPending ? "AND o.design_id IS NOT NULL AND d.approval_status = 'pending'" : ''}
       ${srcClause}
     ORDER BY b.deadline ASC NULLS LAST, o.created_at ASC`,
    [stages]
  );
  res.json({ data: rows });
}

// ---------- Stage-appropriate order projection (presser NEVER receives the canvas) ----------
async function getOrder(req, res) {
  const { id } = req.params;
  const u = req.user;
  const presserOnly = u.staff_type === 'presser' && !isManager(u);

  const base = await query(
    `SELECT o.id, o.status, o.created_at, o.price, o.design_id, o.package_id, o.checkout_group_id,
            o.batch_id, o.student_id,
            u.name AS student_name, u.phone AS student_phone,
            s.university_name, s.department, s.gender,
            p.name_ar AS product_name, p.type AS product_type,
            b.name_ar AS batch_name, b.deadline,
            CASE WHEN s.wholesaler_id IS NULL THEN 'retail' ELSE 'wholesaler' END AS source,
            wu.name AS wholesaler_name
     FROM orders o
     JOIN students s ON s.id = o.student_id
     JOIN users u ON u.id = s.user_id
     JOIN products p ON p.id = o.product_id
     LEFT JOIN batches b ON b.id = o.batch_id
     LEFT JOIN wholesalers w ON w.id = s.wholesaler_id
     LEFT JOIN users wu ON wu.id = w.user_id
     WHERE o.id = $1`,
    [id]
  );
  if (!base.rows.length) return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  const order = base.rows[0];

  // SECURITY: non-managers are scoped to either retail or wholesaler orders only.
  // Enforce this BEFORE loading any further data to prevent IDOR.
  if (!isManager(u) && !staffScopeAllows(u, order.source === 'retail')) {
    return res.status(403).json({ error: 'هذا الطلب خارج نطاقك', code: 'ERR_FORBIDDEN' });
  }

  let design = null;
  if (order.design_id) {
    if (presserOnly) {
      // sash info only — colour + status, NO artwork/canvas/logos.
      const d = await query(
        `SELECT id, sash_color, approval_status, completed FROM designs WHERE id = $1`,
        [order.design_id]
      );
      design = d.rows[0] || null;
    } else {
      const d = await query(
        `SELECT id, sash_color, left_canvas, right_canvas, logo_url, extra_image_url,
                fonts_used, notes, approval_status, rejection_reason, completed
         FROM designs WHERE id = $1`,
        [order.design_id]
      );
      design = d.rows[0] || null;
    }
  }

  // Option selections (sizes etc.). Customer reference photos are design-side → hide from presser.
  const itemsRes = await query(
    `SELECT label_snapshot, price_snapshot, qty, customer_image_url, group_id, option_id
     FROM order_items WHERE order_id = $1 ORDER BY created_at`,
    [id]
  );
  const items = itemsRes.rows.map((it) =>
    presserOnly ? { ...it, customer_image_url: null } : it
  );

  // Bundle siblings: visible to all staff types and managers for context.
  // A bundle exists if the order has a non-null checkout_group_id OR a non-null package_id.
  // We query siblings sharing either key for the same student.
  let bundle = null;
  const hasBundle = order.checkout_group_id != null || order.package_id != null;
  if (hasBundle) {
    const sib = await query(
      `SELECT o.id, o.status, o.price, p.name_ar AS product_name, p.type AS product_type
       FROM orders o JOIN products p ON p.id = o.product_id
       WHERE o.student_id = $1
         AND ( (o.checkout_group_id IS NOT NULL AND o.checkout_group_id = $2)
               OR (o.package_id IS NOT NULL AND o.package_id = $3) )
       ORDER BY p.type`,
      [order.student_id, order.checkout_group_id, order.package_id]
    );
    if (sib.rows.length >= 2) {
      bundle = sib.rows.map((row) => ({
        id: row.id,
        status: row.status,
        price: row.price,
        product_name: row.product_name,
        product_type: row.product_type,
        is_current: row.id === order.id,
      }));
    }
  }

  res.json({
    data: {
      order,
      design,
      items,
      bundle,
      package_orders: bundle, // backward-compat alias
      can_see_design: !presserOnly,
    },
  });
}

// ---------- Advance an order to its next production stage ----------
async function advance(req, res) {
  const { id } = req.params;
  const cur = await query(
    `SELECT o.id, o.status, s.user_id, s.wholesaler_id
     FROM orders o JOIN students s ON s.id = o.student_id WHERE o.id = $1`,
    [id]
  );
  if (!cur.rows.length) return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  if (!staffScopeAllows(req.user, cur.rows[0].wholesaler_id == null)) {
    return res.status(403).json({ error: 'هذا الطلب خارج نطاقك', code: 'ERR_FORBIDDEN' });
  }
  const from = cur.rows[0].status;
  const to = NEXT_STAGE[from];
  if (!to) {
    return res.status(409).json({ error: 'لا يمكن تقديم هذه الحالة', code: 'ERR_INVALID_TRANSITION' });
  }
  if (!canStaffTransition(req.user, from, to)) {
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  }
  const deliveredSet = to === 'delivered' ? ', delivered_at = NOW()' : '';
  const updated = await tx(async (client) => {
    const { rows } = await client.query(
      `UPDATE orders SET status = $1${deliveredSet} WHERE id = $2 RETURNING id, status`,
      [to, id]
    );
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'status_change', 'order', $2, $3)`,
      [req.user.id, id, JSON.stringify({ from, to, by: req.user.staff_type || req.user.role })]
    );
    await client.query(
      `INSERT INTO notifications (user_id, type, title_ar, body_ar, link)
       VALUES ($1, 'status_change', $2, $3, '/')`,
      [cur.rows[0].user_id, 'تحديث حالة الطلب', `حالة طلبك الآن: ${STATUS_LABEL_AR[to]}`]
    );
    return rows[0];
  });
  res.json({ data: updated });
}

// ---------- Manager / admin: staff performance + pipeline health ----------
async function monitor(req, res) {
  // Manager/admin may filter the whole dashboard by order source (?source=retail|wholesaler).
  const sc = sourceClause(resolveSourceFilter(req.user, req.query.source));
  const wip = await query(
    `SELECT o.status AS status, COUNT(*)::int AS count
     FROM orders o JOIN students s ON s.id = o.student_id
     WHERE o.status::text = ANY($1) ${sc}
     GROUP BY o.status`,
    [MANAGER_STAGES]
  );
  const throughput = await query(
    `SELECT a.actor_id, us.name, us.staff_type, COUNT(*)::int AS actions,
            MAX(a.created_at) AS last_action
     FROM audit_log a
     JOIN users us ON us.id = a.actor_id
     WHERE a.action IN ('status_change', 'approve_design', 'reject_design')
       AND us.role = 'staff'
       AND a.created_at > NOW() - INTERVAL '30 days'
     GROUP BY a.actor_id, us.name, us.staff_type
     ORDER BY actions DESC`
  );
  const overdue = await query(
    `SELECT o.id, u.name AS student_name, p.name_ar AS product_name, o.status,
            b.name_ar AS batch_name, b.deadline
     FROM orders o
     JOIN students s ON s.id = o.student_id
     JOIN users u ON u.id = s.user_id
     JOIN products p ON p.id = o.product_id
     JOIN batches b ON b.id = o.batch_id
     WHERE b.deadline < NOW() AND o.status NOT IN ('ready', 'delivered', 'cancelled') ${sc}
     ORDER BY b.deadline ASC LIMIT 50`
  );
  const stale = await query(
    `SELECT o.id, u.name AS student_name, o.status, o.updated_at,
            ROUND(EXTRACT(EPOCH FROM (NOW() - o.updated_at)) / 3600)::int AS hours_in_stage
     FROM orders o
     JOIN students s ON s.id = o.student_id
     JOIN users u ON u.id = s.user_id
     WHERE o.status IN ('design_complete', 'embroidery', 'pressing', 'preparing') ${sc}
     ORDER BY o.updated_at ASC LIMIT 20`
  );
  const byStage = {};
  wip.rows.forEach((r) => (byStage[r.status] = r.count));
  res.json({
    data: {
      wip: byStage,
      throughput: throughput.rows,
      overdue: overdue.rows,
      stale: stale.rows,
    },
  });
}

module.exports = { getQueue, getOrder, advance, monitor };
