const { query, tx } = require('../lib/db');
const { canStaffTransition, STATUS_LABEL_AR, TRANSITIONS } = require('./orderController');
const { staffScopeAllows } = require('../middleware/auth');
const { imageUpload, publicUrl } = require('../lib/upload');
const { addClient, publish } = require('../lib/eventBus');

// ---------- SSE stream: live presence + order events for staff/admin ----------
function streamEvents(req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable nginx buffering so events flush immediately
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  res.write('retry: 3000\n\n'); // tell EventSource to reconnect after 3s if dropped
  const remove = addClient(res);
  req.on('close', () => {
    remove();
    res.end();
  });
}

// Broadcast helpers — keep event shapes in one place.
function emitOrderChanged(orderId, status) {
  publish({ type: 'order', orderId, status });
}
function emitPresence(orderId, staffId, staffName) {
  publish({ type: 'presence', orderId, working_staff_id: staffId, working_staff_name: staffName });
}

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
  digitizer: ['converting'],
  embroiderer: ['embroidery'],
  presser: ['pressing'],
  preparer: ['preparing', 'ready'],
};
const MANAGER_STAGES = ['design_complete', 'converting', 'embroidery', 'pressing', 'preparing', 'ready'];

// Presence is heartbeat-based: a viewer re-claims every ~30s while the order tab
// is open. An order is "actively worked" only while its last heartbeat is fresh.
const PRESENCE_TTL_SECONDS = 90;

function isManager(u) {
  return u.role === 'admin' || u.staff_type === 'manager';
}

// Route-aware next stage: design-bearing sashes must use approve (not advance).
// Advance is for: converting, embroidery, pressing, preparing, ready + design-less embroidery orders
// from design_complete.
function nextStageFor(order) {
  const { status, design_id, needs_pressing } = order;
  switch (status) {
    case 'design_complete':
      // design-bearing sash must use approve endpoint, not advance
      if (design_id) return null;
      return 'converting';
    case 'converting':
      return 'embroidery';
    case 'embroidery':
      return needs_pressing ? 'pressing' : 'preparing';
    case 'pressing':
      return 'preparing';
    case 'preparing':
      return 'ready';
    case 'ready':
      return 'delivered';
    default:
      return null;
  }
}

// REVERT map: one step back for each status
const REVERT_MAP = {
  delivered: 'preparing',
  ready: 'preparing',
  preparing: 'embroidery',
  pressing: 'embroidery',
  embroidery: 'converting',
  converting: 'design_complete',
};

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
  // For design-less embroidery orders (cap/robe) the designer also handles them (design_id IS NULL).
  const onlyPending = u.staff_type === 'designer' && !isManager(u);
  const srcClause = sourceClause(resolveSourceFilter(u, req.query.source));
  const { rows } = await query(
    `SELECT o.id, o.status, o.created_at, o.design_id, o.checkout_group_id,
            o.working_staff_id, o.working_since,
            u.name AS student_name, s.university_name, s.department,
            p.name_ar AS product_name, p.type AS product_type,
            b.name_ar AS batch_name, b.deadline,
            d.approval_status, d.rejection_reason,
            CASE WHEN s.wholesaler_id IS NULL THEN 'retail' ELSE 'wholesaler' END AS source,
            wu.name AS wholesaler_name,
            -- Only expose the worker while their heartbeat is fresh, so the queue
            -- tag reflects who has the tab open RIGHT NOW (stale claims read free).
            CASE WHEN o.working_since > NOW() - INTERVAL '${PRESENCE_TTL_SECONDS} seconds'
                 THEN wk.name END AS working_staff_name
     FROM orders o
     JOIN students s ON s.id = o.student_id
     JOIN users u ON u.id = s.user_id
     JOIN products p ON p.id = o.product_id
     LEFT JOIN batches b ON b.id = o.batch_id
     LEFT JOIN designs d ON d.id = o.design_id
     LEFT JOIN wholesalers w ON w.id = s.wholesaler_id
     LEFT JOIN users wu ON wu.id = w.user_id
     LEFT JOIN users wk ON wk.id = o.working_staff_id
     WHERE o.status::text = ANY($1)
       ${onlyPending
         ? "AND ((o.design_id IS NOT NULL AND d.approval_status = 'pending') OR (o.design_id IS NULL AND o.has_embroidery = TRUE))"
         : ''}
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
            o.has_embroidery, o.needs_pressing, o.measurements, o.final_design_url,
            o.working_staff_id, o.working_since,
            u.name AS student_name, u.phone AS student_phone,
            s.university_name, s.department, s.gender, s.study_type, s.instagram_username,
            p.name_ar AS product_name, p.type AS product_type,
            b.name_ar AS batch_name, b.deadline,
            CASE WHEN s.wholesaler_id IS NULL THEN 'retail' ELSE 'wholesaler' END AS source,
            wu.name AS wholesaler_name,
            wk.name AS working_staff_name
     FROM orders o
     JOIN students s ON s.id = o.student_id
     JOIN users u ON u.id = s.user_id
     JOIN products p ON p.id = o.product_id
     LEFT JOIN batches b ON b.id = o.batch_id
     LEFT JOIN wholesalers w ON w.id = s.wholesaler_id
     LEFT JOIN users wu ON wu.id = w.user_id
     LEFT JOIN users wk ON wk.id = o.working_staff_id
     WHERE o.id = $1`,
    [id]
  );
  if (!base.rows.length) return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  const order = { ...base.rows[0] };

  // SECURITY: non-managers are scoped to either retail or wholesaler orders only.
  if (!isManager(u) && !staffScopeAllows(u, order.source === 'retail')) {
    return res.status(403).json({ error: 'هذا الطلب خارج نطاقك', code: 'ERR_FORBIDDEN' });
  }

  // PRICE VISIBILITY: only manager/admin/embroiderer sees price
  if (!isManager(u) && u.staff_type !== 'embroiderer' && u.role !== 'admin') {
    delete order.price;
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
    `SELECT label_snapshot, price_snapshot, qty, customer_image_url, customer_text, group_id, option_id
     FROM order_items WHERE order_id = $1 ORDER BY created_at`,
    [id]
  );
  const items = itemsRes.rows.map((it) =>
    presserOnly ? { ...it, customer_image_url: null, customer_text: null } : it
  );

  // Bundle siblings
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
    `SELECT o.id, o.status, o.design_id, o.has_embroidery, o.needs_pressing,
            s.user_id, s.wholesaler_id
     FROM orders o JOIN students s ON s.id = o.student_id WHERE o.id = $1`,
    [id]
  );
  if (!cur.rows.length) return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  const order = cur.rows[0];
  if (!staffScopeAllows(req.user, order.wholesaler_id == null)) {
    return res.status(403).json({ error: 'هذا الطلب خارج نطاقك', code: 'ERR_FORBIDDEN' });
  }
  const from = order.status;
  const to = nextStageFor(order);
  if (!to) {
    return res.status(409).json({ error: 'لا يمكن تقديم هذه الحالة', code: 'ERR_INVALID_TRANSITION' });
  }
  if (!canStaffTransition(req.user, from, to)) {
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  }
  const deliveredSet = to === 'delivered' ? ', delivered_at = NOW()' : '';
  const updated = await tx(async (client) => {
    const { rows } = await client.query(
      `UPDATE orders SET status = $1${deliveredSet},
       working_staff_id = NULL, working_since = NULL
       WHERE id = $2 RETURNING id, status`,
      [to, id]
    );
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'status_change', 'order', $2, $3)`,
      [req.user.id, id, JSON.stringify({ from, to, by: req.user.staff_type || req.user.role })]
    );
    await client.query(
      `INSERT INTO staff_activity_log (user_id, action, order_id, from_stage, to_stage)
       VALUES ($1, 'advance', $2, $3, $4)`,
      [req.user.id, id, from, to]
    );
    await client.query(
      `INSERT INTO notifications (user_id, type, title_ar, body_ar, link)
       VALUES ($1, 'status_change', $2, $3, '/')`,
      [order.user_id, 'تحديث حالة الطلب', `حالة طلبك الآن: ${STATUS_LABEL_AR[to]}`]
    );
    return rows[0];
  });
  emitOrderChanged(id, updated.status);
  emitPresence(id, null, null); // advancing clears the working_staff
  res.json({ data: updated });
}

// ---------- Revert an order one step back ----------
async function revert(req, res) {
  const { id } = req.params;
  const cur = await query(
    `SELECT o.id, o.status, s.user_id, s.wholesaler_id
     FROM orders o JOIN students s ON s.id = o.student_id WHERE o.id = $1`,
    [id]
  );
  if (!cur.rows.length) return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  const order = cur.rows[0];
  if (!staffScopeAllows(req.user, order.wholesaler_id == null)) {
    return res.status(403).json({ error: 'هذا الطلب خارج نطاقك', code: 'ERR_FORBIDDEN' });
  }
  const from = order.status;
  const to = REVERT_MAP[from];
  if (!to) {
    return res.status(409).json({ error: 'لا يمكن التراجع عن هذه الحالة', code: 'ERR_INVALID_TRANSITION' });
  }
  if (!canStaffTransition(req.user, from, to)) {
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  }
  const updated = await tx(async (client) => {
    const { rows } = await client.query(
      `UPDATE orders SET status = $1, working_staff_id = NULL, working_since = NULL
       WHERE id = $2 RETURNING id, status`,
      [to, id]
    );
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'status_revert', 'order', $2, $3)`,
      [req.user.id, id, JSON.stringify({ from, to, by: req.user.staff_type || req.user.role })]
    );
    await client.query(
      `INSERT INTO staff_activity_log (user_id, action, order_id, from_stage, to_stage)
       VALUES ($1, 'revert', $2, $3, $4)`,
      [req.user.id, id, from, to]
    );
    await client.query(
      `INSERT INTO notifications (user_id, type, title_ar, body_ar, link)
       VALUES ($1, 'status_change', $2, $3, '/')`,
      [order.user_id, 'تحديث حالة الطلب', `حالة طلبك الآن: ${STATUS_LABEL_AR[to]}`]
    );
    return rows[0];
  });
  emitOrderChanged(id, updated.status);
  emitPresence(id, null, null);
  res.json({ data: updated });
}

// ---------- Claim an order (mark working_staff) — presence on tab open ----------
async function claim(req, res) {
  const { id } = req.params;
  const cur = await query(
    `SELECT o.id, o.working_staff_id, s.wholesaler_id,
            EXTRACT(EPOCH FROM (NOW() - o.working_since)) AS age_seconds,
            wk.name AS working_staff_name
     FROM orders o
     JOIN students s ON s.id = o.student_id
     LEFT JOIN users wk ON wk.id = o.working_staff_id
     WHERE o.id = $1`,
    [id]
  );
  if (!cur.rows.length) return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  const row = cur.rows[0];
  if (!staffScopeAllows(req.user, row.wholesaler_id == null)) {
    return res.status(403).json({ error: 'هذا الطلب خارج نطاقك', code: 'ERR_FORBIDDEN' });
  }

  // Someone else is actively in the tab (fresh heartbeat) → don't steal it.
  // Report the current owner so the UI can warn the second viewer.
  const heldByOther =
    row.working_staff_id &&
    row.working_staff_id !== req.user.id &&
    row.age_seconds != null &&
    Number(row.age_seconds) < PRESENCE_TTL_SECONDS;
  if (heldByOther) {
    return res.json({
      data: {
        claimed: false,
        working_staff_id: row.working_staff_id,
        working_staff_name: row.working_staff_name,
      },
    });
  }

  // Free, stale, or already mine → take it / refresh the heartbeat.
  const isFreshClaim = row.working_staff_id !== req.user.id;
  await query(
    `UPDATE orders SET working_staff_id = $1, working_since = NOW() WHERE id = $2`,
    [req.user.id, id]
  );
  if (isFreshClaim) {
    await query(
      `INSERT INTO staff_activity_log (user_id, action, order_id)
       VALUES ($1, 'claim', $2)`,
      [req.user.id, id]
    );
    // Broadcast only on a fresh claim — heartbeat refreshes are silent.
    emitPresence(id, req.user.id, req.user.name);
  }
  res.json({
    data: {
      claimed: true,
      working_staff_id: req.user.id,
      working_staff_name: req.user.name,
      working_since: new Date(),
    },
  });
}

// ---------- Release an order (clear working_staff) ----------
async function release(req, res) {
  const { id } = req.params;
  const cur = await query(
    `SELECT o.id, o.working_staff_id, s.wholesaler_id
     FROM orders o JOIN students s ON s.id = o.student_id WHERE o.id = $1`,
    [id]
  );
  if (!cur.rows.length) return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  const order = cur.rows[0];
  // Only the claimer or a manager/admin may release
  if (!isManager(req.user) && order.working_staff_id !== req.user.id) {
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  }
  await query(
    `UPDATE orders SET working_staff_id = NULL, working_since = NULL WHERE id = $1`,
    [id]
  );
  emitPresence(id, null, null);
  res.json({ data: { released: true } });
}

// ---------- GET /completed — orders in ready/delivered for staff ----------
async function completed(req, res) {
  const u = req.user;
  const srcClause = sourceClause(resolveSourceFilter(u, req.query.source));
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const { rows } = await query(
    `SELECT o.id, o.status, o.created_at, o.checkout_group_id,
            o.working_staff_id,
            u.name AS student_name, s.university_name,
            p.name_ar AS product_name, p.type AS product_type,
            b.name_ar AS batch_name,
            CASE WHEN s.wholesaler_id IS NULL THEN 'retail' ELSE 'wholesaler' END AS source,
            wu.name AS wholesaler_name,
            CASE WHEN o.working_since > NOW() - INTERVAL '${PRESENCE_TTL_SECONDS} seconds'
                 THEN wk.name END AS working_staff_name
     FROM orders o
     JOIN students s ON s.id = o.student_id
     JOIN users u ON u.id = s.user_id
     JOIN products p ON p.id = o.product_id
     LEFT JOIN batches b ON b.id = o.batch_id
     LEFT JOIN wholesalers w ON w.id = s.wholesaler_id
     LEFT JOIN users wu ON wu.id = w.user_id
     LEFT JOIN users wk ON wk.id = o.working_staff_id
     WHERE o.status IN ('ready', 'delivered')
       ${srcClause}
     ORDER BY o.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  res.json({ data: rows });
}

// ---------- Upload final design file for an order ----------
async function uploadFinalDesign(req, res) {
  const { id } = req.params;
  const u = req.user;
  // Any staff member (or admin) may upload the final design photo.
  // The route guard (requireRole 'admin','staff') already gates non-staff out.
  if (!req.file) return res.status(400).json({ error: 'لم يتم رفع ملف', code: 'ERR_VALIDATION' });
  const url = publicUrl(req, 'images', req.file.filename);
  const cur = await query(
    `UPDATE orders SET final_design_url = $1 WHERE id = $2 RETURNING id`,
    [url, id]
  );
  if (!cur.rows.length) return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'final_design', 'order', $2, $3)`,
    [u.id, id, JSON.stringify({ url })]
  );
  res.json({ data: { url } });
}

// ---------- Manager / admin: staff performance + pipeline health ----------
async function monitor(req, res) {
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
     WHERE o.status IN ('design_complete', 'converting', 'embroidery', 'pressing', 'preparing') ${sc}
     ORDER BY o.updated_at ASC LIMIT 20`
  );
  // Currently claimed orders (within last 30 min)
  const working = await query(
    `SELECT o.id, o.status,
            u.name AS student_name,
            p.name_ar AS product_name,
            wk.name AS working_staff_name,
            o.working_since
     FROM orders o
     JOIN students s ON s.id = o.student_id
     JOIN users u ON u.id = s.user_id
     JOIN products p ON p.id = o.product_id
     JOIN users wk ON wk.id = o.working_staff_id
     WHERE o.working_staff_id IS NOT NULL
       AND o.working_since > NOW() - INTERVAL '30 minutes'
       ${sc}
     ORDER BY o.working_since DESC`
  );
  const byStage = {};
  wip.rows.forEach((r) => (byStage[r.status] = r.count));
  res.json({
    data: {
      wip: byStage,
      throughput: throughput.rows,
      overdue: overdue.rows,
      stale: stale.rows,
      working: working.rows,
    },
  });
}

module.exports = {
  getQueue, getOrder, advance, revert, claim, release, completed, uploadFinalDesign, monitor,
  streamEvents,
};
