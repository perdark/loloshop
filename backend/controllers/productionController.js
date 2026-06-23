const { query, tx } = require('../lib/db');
const { canStaffTransition, STATUS_LABEL_AR, TRANSITIONS, orderZoneClause } = require('./orderController');
const { staffScopeAllows, staffTypesOf } = require('../middleware/auth');
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
  const free = user.role === 'admin' || staffTypesOf(user).includes('manager') || scope === 'both';
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
  // Preparer also sees تم التسليم (delivered) — they're the ones who hand orders over,
  // so the "done" column lives in their queue (recency-capped in getQueue).
  preparer: ['preparing', 'ready', 'delivered'],
  // مفصل (tailor) — read-only viewer of every in-production order (recognises sashes by
  // name). No transitions exist for tailor, so available_actions stays empty (read-only).
  tailor: ['design_complete', 'converting', 'embroidery', 'pressing', 'preparing', 'ready'],
};
const MANAGER_STAGES = ['design_complete', 'converting', 'embroidery', 'pressing', 'preparing', 'ready'];
// What a manager/admin SEES in the production console — same as MANAGER_STAGES plus the
// تم التسليم "done" column. Kept separate so monitor()'s WIP math stays on the 6 live stages.
const MANAGER_VIEW_STAGES = [...MANAGER_STAGES, 'delivered'];

// Presence is heartbeat-based: a viewer re-claims every ~30s while the order tab
// is open. An order is "actively worked" only while its last heartbeat is fresh.
const PRESENCE_TTL_SECONDS = 90;

function isManager(u) {
  return u.role === 'admin' || staffTypesOf(u).includes('manager');
}

// Route-aware next stage: design-bearing sashes must use approve (not advance).
// Advance is for: converting, embroidery, pressing, preparing, ready + design-less embroidery orders
// from design_complete. An APPROVED design at design_complete may also advance (sash done, move on).
function nextStageFor(order) {
  const { status, design_id, needs_pressing, design_approval_status } = order;
  switch (status) {
    case 'design_complete':
      // design-bearing sash: must be approved before it can advance to converting.
      // Pending or rejected designs still need the designer's verdict first.
      if (design_id) {
        if (design_approval_status === 'approved') return 'converting';
        return null; // pending/rejected → use approve endpoint
      }
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

// REVERT map: one step back for each status.
// design_complete → designing so the student/staff can submit a new design.
// When reverting to designing the advance() handler resets the design approval_status to 'pending'.
const REVERT_MAP = {
  delivered: 'preparing',
  ready: 'preparing',
  preparing: 'embroidery',
  pressing: 'embroidery',
  embroidery: 'converting',
  converting: 'design_complete',
  design_complete: 'designing',
};

// ---------- Stage-scoped work queue for the requesting staff member ----------
async function getQueue(req, res) {
  const u = req.user;
  let stages;
  if (isManager(u)) {
    const filter = req.query.stage;
    stages = filter && MANAGER_VIEW_STAGES.includes(filter) ? [filter] : MANAGER_VIEW_STAGES;
  } else {
    // Multi-role: union the stage queues of every role the staff member holds.
    const set = new Set();
    for (const t of staffTypesOf(u)) (QUEUE_STAGES[t] || []).forEach((st) => set.add(st));
    stages = [...set];
  }
  if (!stages.length) return res.json({ data: [] });

  // A designer only reviews designs still awaiting a verdict — but this narrows ONLY the
  // design_complete stage, so a multi-role designer (e.g. designer+embroiderer) still sees
  // their other merged stages unfiltered. Design-less embroidery orders (cap/robe) the
  // designer also handles (design_id IS NULL).
  const designerPending = staffTypesOf(u).includes('designer') && !isManager(u);
  const srcClause = sourceClause(resolveSourceFilter(u, req.query.source));
  // Embroidery-zone / pleat filter (sash R/L/back · cap side/top · robe pleats).
  const zoneClause = req.query.zone ? orderZoneClause(req.query.zone, 'o') : null;
  const { rows } = await query(
    `SELECT o.id, o.status, o.created_at, o.design_id, o.checkout_group_id,
            o.working_staff_id, o.working_since,
            o.final_design_url, o.has_embroidery,
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
       -- تم التسليم column is bounded to the last 90 days so the console can't grow unbounded.
       -- NULL delivered_at (legacy/migrated rows) is kept so a delivered order never just vanishes.
       AND (o.status::text <> 'delivered' OR o.delivered_at IS NULL OR o.delivered_at > NOW() - INTERVAL '90 days')
       -- Wholesaler approval gate: only show approved (or retail, i.e. NULL) orders to staff.
       AND (o.wholesaler_approval IS NULL OR o.wholesaler_approval = 'approved')
       ${designerPending
         ? "AND (o.status::text <> 'design_complete' OR ((o.design_id IS NOT NULL AND d.approval_status = 'pending') OR (o.design_id IS NULL AND o.has_embroidery = TRUE)))"
         : ''}
       ${srcClause}
       ${zoneClause ? 'AND ' + zoneClause : ''}
     ORDER BY b.deadline ASC NULLS LAST, o.created_at ASC`,
    [stages]
  );
  res.json({ data: rows });
}

// ---------- Stage-appropriate order projection (presser NEVER receives the canvas) ----------
async function getOrder(req, res) {
  const { id } = req.params;
  const u = req.user;
  // Presser is the only role barred from the canvas/contact details. A multi-role user who
  // is ALSO a presser still sees them via their other role, so block only when presser is the
  // sole role.
  const uTypes = staffTypesOf(u);
  const presserOnly = !isManager(u) && uTypes.includes('presser') && uTypes.every((t) => t === 'presser');
  // مفصل (tailor) is a READ-ONLY view: only student name + sash + American-shawl info.
  // Applies when tailor is the sole role (a tailor who is also a designer sees the full view).
  const tailorOnly = !isManager(u) && uTypes.includes('tailor') && uTypes.every((t) => t === 'tailor');

  const base = await query(
    `SELECT o.id, o.status, o.created_at, o.price, o.design_id, o.package_id, o.checkout_group_id,
            o.batch_id, o.student_id,
            o.has_embroidery, o.needs_pressing, o.measurements, o.final_design_url,
            o.working_staff_id, o.working_since,
            o.delivered_at, o.delivery_method, o.recipient_name, o.delivery_address,
            o.delivery_phone, o.delivery_notes, du.name AS delivered_by_name,
            u.name AS student_name, u.phone AS student_phone,
            s.university_name, s.department, s.gender, s.study_type, s.instagram_username,
            p.name_ar AS product_name, p.type AS product_type,
            b.name_ar AS batch_name, b.deadline,
            CASE WHEN s.wholesaler_id IS NULL THEN 'retail' ELSE 'wholesaler' END AS source,
            wu.name AS wholesaler_name,
            wk.name AS working_staff_name,
            cg.customer_name AS intake_customer_name, cg.instagram_username AS intake_instagram,
            cg.phone_primary AS intake_phone_primary, cg.phone_secondary AS intake_phone_secondary,
            cg.governorate AS intake_governorate, cg.area_details AS intake_area_details,
            cg.event_date::text AS intake_event_date, cg.deposit AS intake_deposit, cg.notes AS intake_notes
     FROM orders o
     JOIN students s ON s.id = o.student_id
     JOIN users u ON u.id = s.user_id
     JOIN products p ON p.id = o.product_id
     LEFT JOIN batches b ON b.id = o.batch_id
     LEFT JOIN wholesalers w ON w.id = s.wholesaler_id
     LEFT JOIN users wu ON wu.id = w.user_id
     LEFT JOIN users wk ON wk.id = o.working_staff_id
     LEFT JOIN users du ON du.id = o.delivered_by
     LEFT JOIN checkout_groups cg ON cg.id = o.checkout_group_id
     WHERE o.id = $1`,
    [id]
  );
  if (!base.rows.length) return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  const order = { ...base.rows[0] };

  // Full-set form intake (delivery / phones / event date / deposit) — null for cart bundles.
  order.intake = order.intake_customer_name ? {
    customer_name: order.intake_customer_name,
    instagram_username: order.intake_instagram,
    phone_primary: order.intake_phone_primary,
    phone_secondary: order.intake_phone_secondary,
    governorate: order.intake_governorate,
    area_details: order.intake_area_details,
    event_date: order.intake_event_date,
    deposit: Number(order.intake_deposit) || 0,
    notes: order.intake_notes,
  } : null;
  for (const k of Object.keys(order)) if (k.startsWith('intake_')) delete order[k];

  // SECURITY: non-managers are scoped to either retail or wholesaler orders only.
  if (!isManager(u) && !staffScopeAllows(u, order.source === 'retail')) {
    return res.status(403).json({ error: 'هذا الطلب خارج نطاقك', code: 'ERR_FORBIDDEN' });
  }

  // PRICE VISIBILITY: only manager/admin/embroiderer sees price (deposit is money too)
  if (!isManager(u) && !uTypes.includes('embroiderer') && u.role !== 'admin') {
    delete order.price;
    if (order.intake) delete order.intake.deposit;
  }
  // Presser gets no customer contact/address — just the event date for urgency.
  if (presserOnly && order.intake) {
    order.intake = { event_date: order.intake.event_date };
  }
  // Delivery details are PII (address + phone of the recipient) — keep them off the
  // presser view as well (tailor is already stripped by the allow-list above).
  if (presserOnly) {
    order.delivery_address = null;
    order.delivery_phone = null;
    order.recipient_name = null;
    order.delivery_notes = null;
  }
  // Tailor (مفصل) is the most-restricted role: ONLY student name + sash/shawl spec lines
  // (the items[] below). Rebuild `order` from an ALLOW-LIST so nothing else can ever leak
  // via a direct API call — not price, contact, intake, demographics, measurements, the
  // final-design URL, batch, or wholesaler. (Allow-list, not deny-list, so a future column
  // added to the SELECT can't silently re-open the hole.)
  if (tailorOnly) {
    const ALLOWED = new Set(['id', 'status', 'created_at', 'student_name', 'product_name', 'product_type']);
    for (const k of Object.keys(order)) if (!ALLOWED.has(k)) delete order[k];
  }

  let design = null;
  if (order.design_id && !tailorOnly) {
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
  let items = itemsRes.rows.map((it) =>
    presserOnly ? { ...it, customer_image_url: null, customer_text: null } : it
  );
  // Tailor: only sash/shawl spec lines with real content, and never the per-line price.
  if (tailorOnly) {
    items = items
      .filter((it) => it.group_id !== null || it.customer_text || it.customer_image_url)
      .map((it) => ({ ...it, price_snapshot: null }));
  }

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

  // Compute available_actions from the same state machine used by POST handlers,
  // so the frontend never shows a button the backend would reject.
  const orderForActions = {
    ...order,
    design_approval_status: design?.approval_status ?? null,
  };
  const nextTo = nextStageFor(orderForActions);
  const revertTo = REVERT_MAP[order.status] ?? null;

  const { canStaffTransition: canTransition } = require('./orderController');

  const ADVANCE_LABEL_AR = {
    design_complete: 'إرسال للتحويل / التطريز',
    converting:      'إنهاء التحويل، نقل للتطريز',
    embroidery:      'إنهاء التطريز، نقل للكوي',
    pressing:        'إنهاء الكوي، نقل للتجهيز',
    preparing:       'إنهاء التجهيز، تحديد جاهز',
    ready:           'تأكيد التسليم',
  };

  const available_actions = {
    advance: nextTo && canTransition(u, order.status, nextTo)
      ? { to: nextTo, label: ADVANCE_LABEL_AR[order.status] ?? 'تقدم للمرحلة التالية' }
      : null,
    revert: revertTo && canTransition(u, order.status, revertTo)
      ? { to: revertTo }
      : null,
    can_approve:
      !!design &&
      design.approval_status === 'pending' &&
      order.status === 'design_complete' &&
      (uTypes.includes('designer') || isManager(u)),
    can_reject:
      !!design &&
      design.approval_status === 'pending' &&
      order.status === 'design_complete' &&
      (uTypes.includes('designer') || isManager(u)),
  };

  res.json({
    data: {
      order,
      design,
      items,
      bundle,
      package_orders: bundle, // backward-compat alias
      can_see_design: !presserOnly && !tailorOnly,
      available_actions,
    },
  });
}

// ---------- Advance an order to its next production stage ----------
// Load the row needed to compute + apply an advance (shared by single + bulk).
async function loadAdvanceRow(id) {
  const cur = await query(
    `SELECT o.id, o.status, o.design_id, o.has_embroidery, o.needs_pressing,
            s.user_id, s.wholesaler_id, d.approval_status AS design_approval_status
     FROM orders o JOIN students s ON s.id = o.student_id
     LEFT JOIN designs d ON d.id = o.design_id
     WHERE o.id = $1`,
    [id]
  );
  return cur.rows[0] || null;
}

// Apply ONE forward advance (guards must be checked by the caller). Writes the
// status + audit/activity/notification in a tx, then emits live events. Returns
// the updated {id, status} row.
async function performAdvance(order, user) {
  const from = order.status;
  const to = nextStageFor(order);
  const deliveredSet = to === 'delivered' ? ', delivered_at = NOW()' : '';
  const updated = await tx(async (client) => {
    const { rows } = await client.query(
      `UPDATE orders SET status = $1${deliveredSet},
       working_staff_id = NULL, working_since = NULL
       WHERE id = $2 RETURNING id, status`,
      [to, order.id]
    );
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'status_change', 'order', $2, $3)`,
      [user.id, order.id, JSON.stringify({ from, to, by: user.staff_type || user.role })]
    );
    await client.query(
      `INSERT INTO staff_activity_log (user_id, action, order_id, from_stage, to_stage)
       VALUES ($1, 'advance', $2, $3, $4)`,
      [user.id, order.id, from, to]
    );
    await client.query(
      `INSERT INTO notifications (user_id, type, title_ar, body_ar, link)
       VALUES ($1, 'status_change', $2, $3, '/')`,
      [order.user_id, 'تحديث حالة الطلب', `حالة طلبك الآن: ${STATUS_LABEL_AR[to]}`]
    );
    return rows[0];
  });
  emitOrderChanged(order.id, updated.status);
  emitPresence(order.id, null, null); // advancing clears the working_staff
  return updated;
}

async function advance(req, res) {
  const { id } = req.params;
  const order = await loadAdvanceRow(id);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  if (!staffScopeAllows(req.user, order.wholesaler_id == null)) {
    return res.status(403).json({ error: 'هذا الطلب خارج نطاقك', code: 'ERR_FORBIDDEN' });
  }
  const to = nextStageFor(order);
  if (!to) {
    return res.status(409).json({ error: 'لا يمكن تقديم هذه الحالة', code: 'ERR_INVALID_TRANSITION' });
  }
  if (!canStaffTransition(req.user, order.status, to)) {
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  }
  const updated = await performAdvance(order, req.user);
  res.json({ data: updated });
}

// ---------- Bulk advance: "إكمال" multiple orders one stage at a time ----------
// Each order is guarded INDEPENDENTLY (scope + state-machine + role) and advanced in
// its own tx, so one bad/locked order never blocks the rest. Orders the caller can't
// move are skipped (never error the whole call) and reported back.
async function advanceBulk(req, res) {
  const ids = Array.isArray(req.body.ids)
    ? [...new Set(req.body.ids.filter((x) => typeof x === 'string' && x))].slice(0, 200)
    : [];
  if (!ids.length) {
    return res.status(400).json({ error: 'لم تُحدد أي طلبات', code: 'ERR_VALIDATION' });
  }
  const results = [];
  let advanced = 0;
  for (const id of ids) {
    const order = await loadAdvanceRow(id);
    if (!order) { results.push({ id, ok: false, reason: 'not_found' }); continue; }
    if (!staffScopeAllows(req.user, order.wholesaler_id == null)) {
      results.push({ id, ok: false, reason: 'forbidden' }); continue;
    }
    const to = nextStageFor(order);
    if (!to || !canStaffTransition(req.user, order.status, to)) {
      results.push({ id, ok: false, reason: 'not_advanceable' }); continue;
    }
    try {
      const updated = await performAdvance(order, req.user);
      advanced++;
      results.push({ id, ok: true, status: updated.status });
    } catch {
      results.push({ id, ok: false, reason: 'error' });
    }
  }
  res.json({ data: { advanced, skipped: ids.length - advanced, results } });
}

// ---------- Confirm delivery (ready → delivered) with hand-off details ----------
// Captures HOW the order was handed over so the shop can see, afterwards, which
// orders were delivered, who received them, and whether by توصيل (delivery, with
// address + phone) or استلام من المحل (pickup).
async function deliver(req, res) {
  const { id } = req.params;
  const method = String(req.body.delivery_method || '').trim();
  const recipientName = String(req.body.recipient_name || '').trim();
  const address = String(req.body.delivery_address || '').trim();
  const phone = String(req.body.delivery_phone || '').trim();
  const dnotes = String(req.body.delivery_notes || '').trim();

  if (method !== 'delivery' && method !== 'pickup') {
    return res.status(400).json({ error: 'حدّد طريقة التسليم (توصيل أو استلام من المحل)', code: 'ERR_VALIDATION' });
  }
  if (!recipientName) {
    return res.status(400).json({ error: 'اسم مستلم الطلب مطلوب', code: 'ERR_VALIDATION' });
  }
  if (method === 'delivery' && (!address || !phone)) {
    return res.status(400).json({ error: 'عنوان ورقم هاتف التوصيل مطلوبان', code: 'ERR_VALIDATION' });
  }

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
  if (from !== 'ready') {
    return res.status(409).json({ error: 'لا يمكن تأكيد تسليم هذا الطلب', code: 'ERR_INVALID_TRANSITION' });
  }
  if (!canStaffTransition(req.user, 'ready', 'delivered')) {
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  }
  const updated = await tx(async (client) => {
    const { rows } = await client.query(
      `UPDATE orders SET status = 'delivered', delivered_at = NOW(),
              delivery_method = $1, recipient_name = $2,
              delivery_address = $3, delivery_phone = $4, delivery_notes = $5,
              delivered_by = $6, working_staff_id = NULL, working_since = NULL
       WHERE id = $7 AND status = 'ready' RETURNING id, status`,
      [method, recipientName,
       method === 'delivery' ? address : null,
       method === 'delivery' ? phone : null,
       dnotes || null, req.user.id, id]
    );
    if (!rows.length) {
      throw Object.assign(new Error('لا يمكن تأكيد تسليم هذا الطلب'), {
        expose: true, status: 409, code: 'ERR_INVALID_TRANSITION',
      });
    }
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'delivery_confirmed', 'order', $2, $3)`,
      [req.user.id, id, JSON.stringify({ from, to: 'delivered', delivery_method: method, recipient_name: recipientName })]
    );
    await client.query(
      `INSERT INTO staff_activity_log (user_id, action, order_id, from_stage, to_stage)
       VALUES ($1, 'advance', $2, $3, 'delivered')`,
      [req.user.id, id, from]
    );
    await client.query(
      `INSERT INTO notifications (user_id, type, title_ar, body_ar, link)
       VALUES ($1, 'status_change', $2, $3, '/')`,
      [order.user_id, 'تم تسليم طلبك',
       method === 'delivery' ? 'تم تسليم طلبك عبر التوصيل' : 'تم تسليم طلبك من المحل']
    );
    return rows[0];
  });
  emitOrderChanged(id, updated.status);
  emitPresence(id, null, null);
  res.json({ data: updated });
}

// ---------- Revert an order one step back ----------
async function revert(req, res) {
  const { id } = req.params;
  const cur = await query(
    `SELECT o.id, o.status, o.design_id, s.user_id, s.wholesaler_id
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
    // Reverting to designing resets the design to pending so the student/staff
    // can submit a new design and the approve→advance flow works again.
    if (to === 'designing' && order.design_id) {
      await client.query(
        `UPDATE designs SET approval_status = 'pending', rejection_reason = NULL
         WHERE id = $1`,
        [order.design_id]
      );
    }
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

// ══════════════════════════════════════════════════════════════════════════════
// «الفصال» (tailor) — a PARALLEL, fully-independent track over RETAIL orders.
// ابو عبدو works a retail order's tailoring at the SAME TIME the designer pipeline
// runs. Marking tailoring done writes ONLY orders.tailor_status (+ done_at/by) — it
// never touches orders.status, and advancing the pipeline never touches the tailor
// track. Retail-only everywhere (students.wholesaler_id IS NULL).
// ══════════════════════════════════════════════════════════════════════════════

// Who may work the tailor track: the مفصل (tailor) staff_type, or a manager/admin.
function canTailor(u) {
  return isManager(u) || staffTypesOf(u).includes('tailor');
}

// ---------- GET /tailor-queue?done=0|1 — ابو عبدو's parallel to-do ----------
async function tailorQueue(req, res) {
  if (!canTailor(req.user)) {
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  }
  // Default (absent / '0') = pending; '1' = done.
  const wantDone = String(req.query.done || '') === '1';
  const tailorStatus = wantDone ? 'done' : 'pending';
  const { rows } = await query(
    `SELECT o.id, o.status, o.created_at,
            o.tailor_status, o.tailor_done_at,
            u.name AS student_name,
            p.name_ar AS product_name, p.type AS product_type,
            b.name_ar AS batch_name, b.deadline
     FROM orders o
     JOIN students s ON s.id = o.student_id
     JOIN users u ON u.id = s.user_id
     JOIN products p ON p.id = o.product_id
     LEFT JOIN batches b ON b.id = o.batch_id
     WHERE s.wholesaler_id IS NULL
       AND o.status::text <> 'cancelled'
       AND o.tailor_status::text = $1
     ORDER BY b.deadline ASC NULLS LAST, o.created_at ASC`,
    [tailorStatus]
  );
  // status_label: pipeline status is DISPLAY-ONLY context here (never an action).
  const data = rows.map((r) => ({ ...r, status_label: STATUS_LABEL_AR[r.status] ?? r.status }));
  res.json({ data });
}

// Load the row needed to guard + apply a tailor mutation (shared by single + bulk).
async function loadTailorRow(id) {
  const cur = await query(
    `SELECT o.id, o.tailor_status, s.wholesaler_id
     FROM orders o JOIN students s ON s.id = o.student_id
     WHERE o.id = $1`,
    [id]
  );
  return cur.rows[0] || null;
}

// Apply ONE tailor mark (guards checked by caller). done=true → mark done; false → reopen.
// Writes tailor_status + audit row in a tx. Idempotent. Returns the updated row.
async function performTailorMark(orderId, user, done) {
  return tx(async (client) => {
    const { rows } = await client.query(
      done
        ? `UPDATE orders SET tailor_status = 'done', tailor_done_at = NOW(), tailor_done_by = $1
           WHERE id = $2 RETURNING id, tailor_status, tailor_done_at`
        : `UPDATE orders SET tailor_status = 'pending', tailor_done_at = NULL, tailor_done_by = NULL
           WHERE id = $1 RETURNING id, tailor_status, tailor_done_at`,
      done ? [user.id, orderId] : [orderId]
    );
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, $2, 'order', $3, $4)`,
      [user.id, done ? 'tailor_complete' : 'tailor_reopen', orderId,
       JSON.stringify({ tailor_status: done ? 'done' : 'pending' })]
    );
    return rows[0];
  });
}

// ---------- POST /orders/:id/tailor-complete — mark tailoring done (idempotent) ----------
async function tailorComplete(req, res) {
  if (!canTailor(req.user)) {
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  }
  const { id } = req.params;
  const order = await loadTailorRow(id);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  // Tailor track is retail-only — a wholesaler order is out of scope.
  if (order.wholesaler_id != null) {
    return res.status(403).json({ error: 'هذا الطلب خارج نطاق الفصال', code: 'ERR_FORBIDDEN' });
  }
  if (order.tailor_status === 'done') {
    return res.json({ data: { id: order.id, tailor_status: 'done' } }); // idempotent
  }
  const updated = await performTailorMark(id, req.user, true);
  res.json({ data: updated });
}

// ---------- POST /orders/:id/tailor-reopen — undo a mistaken completion ----------
async function tailorReopen(req, res) {
  if (!canTailor(req.user)) {
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  }
  const { id } = req.params;
  const order = await loadTailorRow(id);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  if (order.wholesaler_id != null) {
    return res.status(403).json({ error: 'هذا الطلب خارج نطاق الفصال', code: 'ERR_FORBIDDEN' });
  }
  if (order.tailor_status === 'pending') {
    return res.json({ data: { id: order.id, tailor_status: 'pending' } }); // idempotent
  }
  const updated = await performTailorMark(id, req.user, false);
  res.json({ data: updated });
}

// ---------- POST /tailor-complete-bulk { ids:[] } — mirror advanceBulk ----------
// Each order guarded INDEPENDENTLY (retail + permission); the rest are skipped + reported.
async function tailorCompleteBulk(req, res) {
  if (!canTailor(req.user)) {
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  }
  const ids = Array.isArray(req.body.ids)
    ? [...new Set(req.body.ids.filter((x) => typeof x === 'string' && x))].slice(0, 200)
    : [];
  if (!ids.length) {
    return res.status(400).json({ error: 'لم تُحدد أي طلبات', code: 'ERR_VALIDATION' });
  }
  const results = [];
  let done = 0;
  for (const id of ids) {
    const order = await loadTailorRow(id);
    if (!order) { results.push({ id, ok: false, reason: 'not_found' }); continue; }
    if (order.wholesaler_id != null) {
      results.push({ id, ok: false, reason: 'not_retail' }); continue;
    }
    if (order.tailor_status === 'done') {
      // Already done → count as success (idempotent), no extra write/audit.
      done++; results.push({ id, ok: true }); continue;
    }
    try {
      await performTailorMark(id, req.user, true);
      done++;
      results.push({ id, ok: true });
    } catch {
      results.push({ id, ok: false, reason: 'error' });
    }
  }
  res.json({ data: { done, skipped: ids.length - done, results } });
}

// ---------- GET /tailor-summary — parallel-progress counts over RETAIL orders ----------
async function tailorSummary(req, res) {
  if (!canTailor(req.user)) {
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  }
  const { rows } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE o.tailor_status::text = 'pending')::int AS pending,
       COUNT(*) FILTER (WHERE o.tailor_status::text = 'done')::int    AS done,
       COUNT(*)::int AS total
     FROM orders o JOIN students s ON s.id = o.student_id
     WHERE s.wholesaler_id IS NULL AND o.status::text <> 'cancelled'`
  );
  const r = rows[0] || { pending: 0, done: 0, total: 0 };
  res.json({ data: { pending: r.pending, done: r.done, total: r.total } });
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
  getQueue, getOrder, advance, advanceBulk, deliver, revert, claim, release, completed, uploadFinalDesign, monitor,
  streamEvents, nextStageFor,
  tailorQueue, tailorComplete, tailorReopen, tailorCompleteBulk, tailorSummary,
};
