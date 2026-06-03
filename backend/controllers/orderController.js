const { query, tx } = require('../lib/db');
const { priceRoleForUser } = require('./catalogController');
const { publish } = require('../lib/eventBus');
const { staffScopeAllows } = require('../middleware/auth');

const ALL_STATUSES = [
  'pending_approval', 'designing', 'design_complete', 'converting',
  'staff_review', 'printing', 'embroidery', 'pressing', 'preparing',
  'ready', 'delivered', 'cancelled',
];

// Allowed status transitions (state machine).
// Pipeline: pending_approval → designing → design_complete
//   → (designer APPROVES sash) converting → (digitizer) embroidery → pressing → preparing → ready → delivered
//   → (designer ADVANCES design-less emb order) converting → ...
// Also includes reopen edges (delivered→preparing etc.) for reverting.
const TRANSITIONS = {
  pending_approval: ['designing', 'cancelled'],
  designing: ['design_complete', 'cancelled'],
  design_complete: ['converting', 'embroidery', 'designing', 'cancelled'],
  converting: ['embroidery', 'design_complete', 'cancelled'],
  embroidery: ['pressing', 'preparing', 'cancelled'],
  pressing: ['preparing', 'cancelled'],
  preparing: ['ready', 'embroidery', 'cancelled'],
  ready: ['delivered', 'preparing', 'cancelled'],
  delivered: ['preparing'],
  cancelled: [],
  // Legacy drain-only statuses
  staff_review: ['embroidery', 'designing', 'cancelled'],
  printing: ['embroidery', 'pressing', 'cancelled'],
};

// Which staff_type may perform each "from→to" edge.
// admin role and `manager` staff_type bypass this map entirely; cancelling is manager/admin only.
const STAGE_AUTHZ = {
  // forward edges
  'design_complete→converting': ['designer'],
  'design_complete→designing': ['designer'],
  'converting→embroidery': ['digitizer'],
  'converting→design_complete': ['digitizer'],
  'embroidery→pressing': ['embroiderer'],
  'embroidery→preparing': ['embroiderer'],
  'pressing→preparing': ['presser'],
  'preparing→ready': ['preparer'],
  'ready→delivered': ['preparer'],
  // revert edges
  'delivered→preparing': ['preparer'],
  'ready→preparing': ['preparer'],
  'preparing→embroidery': ['preparer'],
  'pressing→embroidery': ['presser'],
  'embroidery→converting': ['embroiderer'],
  'converting→design_complete': ['digitizer'],
};

function canStaffTransition(user, from, to) {
  if (user.role === 'admin') return true;
  if (user.staff_type === 'manager') return true;
  if (to === 'cancelled') return false;
  const allowed = STAGE_AUTHZ[`${from}→${to}`];
  return Array.isArray(allowed) && allowed.includes(user.staff_type);
}

const STATUS_LABEL_AR = {
  pending_approval: 'بانتظار الموافقة',
  designing: 'قيد التصميم',
  design_complete: 'اكتمل التصميم',
  converting: 'تحويل التصميم لتطريز',
  staff_review: 'قيد المراجعة',
  printing: 'قيد الطباعة',
  embroidery: 'قيد التطريز',
  pressing: 'قيد الكوي',
  preparing: 'قيد التجهيز',
  ready: 'جاهز للاستلام',
  delivered: 'تم التسليم',
  cancelled: 'ملغي',
};

// Valid product types for the `type` filter
const VALID_PRODUCT_TYPES = ['sash', 'robe', 'cap', 'shawl'];

async function listOrders(req, res) {
  const { wholesaler_id, status, from, to, source, type, group } = req.query;
  const params = [];
  const where = [];
  if (wholesaler_id) {
    params.push(wholesaler_id);
    where.push(`s.wholesaler_id = $${params.length}`);
  }
  // Source filter: retail = independent students (no wholesaler), wholesaler = rep-linked.
  if (source === 'retail') where.push('s.wholesaler_id IS NULL');
  else if (source === 'wholesaler') where.push('s.wholesaler_id IS NOT NULL');
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

  // `type` filter — only applicable in item (flat) mode
  const typeFilter = type && VALID_PRODUCT_TYPES.includes(type) ? type : null;

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  // ── group=bundle: aggregate orders into bundles ──
  if (group === 'bundle') {
    // Pull all matching flat rows (no pagination — bundles group across rows).
    // Note: bundle mode does not apply the `type` filter (bundles span types).
    const bundleSql = `
      SELECT o.id AS order_id, o.checkout_group_id,
             u.name AS student_name, s.university_name,
             o.created_at,
             o.price, COALESCE(o.cost, 0) AS cost, COALESCE(o.profit, 0) AS profit,
             p.name_ar AS product_name, p.type AS product_type, o.status
      FROM orders o
      JOIN students s ON s.id = o.student_id
      JOIN users u ON u.id = s.user_id
      JOIN products p ON p.id = o.product_id
      LEFT JOIN wholesalers w ON w.id = s.wholesaler_id
      LEFT JOIN users wu ON wu.id = w.user_id
      ${whereSql}
      ORDER BY o.checkout_group_id NULLS LAST, o.created_at ASC`;
    const { rows } = await query(bundleSql, params);

    // Group by checkout_group_id; NULL rows each become their own single-item bundle
    const bundleMap = new Map();
    for (const row of rows) {
      const key = row.checkout_group_id || `solo:${row.order_id}`;
      if (!bundleMap.has(key)) {
        bundleMap.set(key, {
          checkout_group_id: row.checkout_group_id,
          student_name: row.student_name,
          university_name: row.university_name,
          created_at: row.created_at,
          total_price: 0,
          total_cost: 0,
          total_profit: 0,
          items: [],
        });
      }
      const b = bundleMap.get(key);
      b.total_price += Number(row.price) || 0;
      b.total_cost += Number(row.cost) || 0;
      b.total_profit += Number(row.profit) || 0;
      b.items.push({
        order_id: row.order_id,
        product_name: row.product_name,
        product_type: row.product_type,
        status: row.status,
        price: Number(row.price) || 0,
        cost: Number(row.cost) || 0,
        profit: Number(row.profit) || 0,
      });
    }

    return res.json({ data: { bundles: Array.from(bundleMap.values()) } });
  }

  // ── Default flat mode (existing behavior + optional type filter) ──
  if (typeFilter) {
    params.push(typeFilter);
    where.push(`p.type = $${params.length}`);
  }
  const flatWhereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const countRes = await query(
    `SELECT COUNT(*)::int AS total FROM orders o
     JOIN students s ON s.id = o.student_id
     JOIN products p ON p.id = o.product_id
     ${flatWhereSql}`,
    params
  );

  const dataParams = [...params, limit, offset];
  const sql = `
    SELECT o.id, s.id AS student_id, u.name AS student_full_name,
           s.university_name, s.department,
           p.name_ar AS product_name, p.type AS product_type,
           wu.name AS wholesaler_name,
           CASE WHEN s.wholesaler_id IS NULL THEN 'retail' ELSE 'wholesaler' END AS source,
           o.checkout_group_id,
           o.price, o.cost, o.profit, o.status, o.created_at
    FROM orders o
    JOIN students s ON s.id = o.student_id
    JOIN users u ON u.id = s.user_id
    JOIN products p ON p.id = o.product_id
    LEFT JOIN wholesalers w ON w.id = s.wholesaler_id
    LEFT JOIN users wu ON wu.id = w.user_id
    ${flatWhereSql}
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
  const cur = await query(
    `SELECT o.id, o.status, s.user_id, s.wholesaler_id
     FROM orders o JOIN students s ON s.id = o.student_id
     WHERE o.id = $1`,
    [id]
  );
  if (!cur.rows.length) {
    return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  }
  // Scope guard: a retail/wholesaler-scoped staffer may only touch orders of their
  // source (manager/admin bypass). Mirrors the /production advance|revert routes —
  // this legacy PATCH must not be an unguarded side door into the state machine.
  if (!staffScopeAllows(req.user, cur.rows[0].wholesaler_id == null)) {
    return res.status(403).json({ error: 'هذا الطلب خارج نطاقك', code: 'ERR_FORBIDDEN' });
  }
  const prev = cur.rows[0].status;
  if (prev !== status && !(TRANSITIONS[prev] || []).includes(status)) {
    return res.status(409).json({ error: 'انتقال حالة غير مسموح', code: 'ERR_INVALID_TRANSITION' });
  }
  // Line staff may only advance their own stage; manager staff_type + admin role bypass.
  if (prev !== status && !canStaffTransition(req.user, prev, status)) {
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
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
  publish({ type: 'order', orderId: updated.id, status: updated.status });
  res.json({ data: updated });
}

// Validate + price a set of option selections for a product at a price role.
// Shared by the order configurator and the retail cart so pricing/validation lives in
// one place. Returns { ok:true, total, items, hasEmbroidery } or { ok:false, status, error, code }.
async function priceSelections({ productId, role, selections, studentGender }) {
  const prod = await query(
    `SELECT p.id, p.parent_id, p.gender_restriction, COALESCE(ppr.base_price, p.base_price) AS base_price
     FROM products p
     LEFT JOIN product_price_roles ppr ON ppr.product_id = p.id AND ppr.role = $2
     WHERE p.id = $1 AND p.active = TRUE`,
    [productId, role]
  );
  if (!prod.rows.length) {
    return { ok: false, status: 404, error: 'المنتج غير موجود', code: 'ERR_NOT_FOUND' };
  }
  if (prod.rows[0].gender_restriction && prod.rows[0].gender_restriction !== studentGender) {
    return { ok: false, status: 403, error: 'هذا المنتج غير متاح', code: 'ERR_GENDER' };
  }

  // Child products inherit their parent's option groups (same as catalog getProductFull),
  // so validate against own + inherited groups — not just the product's own (else every
  // inherited-group selection on a child product is wrongly rejected as "خيار غير صالح").
  const groupProductIds = prod.rows[0].parent_id
    ? [productId, prod.rows[0].parent_id]
    : [productId];
  const groups = await query(
    `SELECT id, name_ar, required, max_select, input_type, gender_restriction,
            requires_customer_image, requires_customer_text
     FROM option_groups WHERE product_id = ANY($1::uuid[]) AND active = TRUE`,
    [groupProductIds]
  );
  const groupMap = new Map(groups.rows.map((g) => [g.id, g]));
  const sel = Array.isArray(selections) ? selections : [];
  const selectedGroupIds = new Set(sel.map((s) => s.group_id));
  for (const g of groups.rows) {
    if (g.required && !selectedGroupIds.has(g.id)) {
      return { ok: false, status: 400, error: `يرجى اختيار: ${g.name_ar}`, code: 'ERR_REQUIRED_OPTION' };
    }
  }

  // Batch-fetch every selected option in one query (avoids per-option N+1 round-trips).
  const optionIds = sel.map((s) => s.option_id).filter(Boolean);
  const optMap = new Map();
  if (optionIds.length) {
    const opts = await query(
      `SELECT o.id, o.group_id, o.label_ar, o.requires_customer_image, o.requires_customer_text,
              COALESCE(opr.price_delta, o.price_delta) AS price_delta
       FROM options o
       LEFT JOIN option_price_roles opr ON opr.option_id = o.id AND opr.role = $2
       WHERE o.id = ANY($1) AND o.active = TRUE`,
      [optionIds, role]
    );
    for (const o of opts.rows) optMap.set(o.id, o);
  }

  let total = prod.rows[0].base_price;
  const items = [{ label: 'السعر الأساسي', price: total, group_id: null, option_id: null, qty: 1, customer_text: null }];
  let hasEmbroidery = false;

  for (const s of sel) {
    const g = groupMap.get(s.group_id);
    if (!g) return { ok: false, status: 400, error: 'خيار غير صالح', code: 'ERR_VALIDATION' };
    if (g.gender_restriction && g.gender_restriction !== studentGender) {
      return { ok: false, status: 403, error: 'خيار غير متاح', code: 'ERR_GENDER' };
    }
    const qty = g.input_type === 'counter'
      ? Math.min(Math.max(parseInt(s.qty, 10) || 1, 1), g.max_select)
      : 1;
    const opt = optMap.get(s.option_id);
    if (!opt || opt.group_id !== s.group_id) {
      return { ok: false, status: 400, error: 'خيار غير صالح', code: 'ERR_VALIDATION' };
    }
    // customer must upload a reference photo when group or option requires it (e.g. مثلث)
    const needsImage = g.requires_customer_image || opt.requires_customer_image;
    if (needsImage && !s.customer_image_url) {
      return { ok: false, status: 400, error: `يرجى رفع صورة لـ ${g.name_ar}`, code: 'ERR_CUSTOMER_IMAGE_REQUIRED' };
    }
    // customer must provide embroidery text when group or option requires it
    const needsText = g.requires_customer_text || opt.requires_customer_text;
    if (needsText && (!s.customer_text || !String(s.customer_text).trim())) {
      return { ok: false, status: 400, error: `يرجى كتابة تفاصيل التطريز لـ ${g.name_ar}`, code: 'ERR_CUSTOMER_TEXT_REQUIRED' };
    }
    // Track embroidery: any option requiring image OR text means embroidery work
    if (needsImage || needsText) hasEmbroidery = true;

    const line = opt.price_delta * qty;
    total += line;
    items.push({
      label: `${g.name_ar}: ${opt.label_ar}${qty > 1 ? ' ×' + qty : ''}`,
      price: line, group_id: s.group_id, option_id: opt.id, qty,
      customer_image_url: s.customer_image_url || null,
      customer_text: needsText ? String(s.customer_text).trim() : null,
    });
  }
  return { ok: true, total, items, hasEmbroidery };
}

// ---------- Configure order from selected options (retail student) ----------
async function configureOrder(req, res) {
  const { product_id, design_id, batch_id, selections, measurements } = req.body;
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

  // Fetch product type for robe validation
  const prodTypeRes = await query(`SELECT type FROM products WHERE id = $1 AND active = TRUE`, [product_id]);
  if (!prodTypeRes.rows.length) {
    return res.status(404).json({ error: 'المنتج غير موجود', code: 'ERR_NOT_FOUND' });
  }
  const productType = prodTypeRes.rows[0].type;

  // Robe requires measurements
  if (productType === 'robe') {
    const m = measurements || {};
    const { shoulder_cm, robe_length_cm, sleeve_length_cm } = m;
    if (
      !isFinite(Number(shoulder_cm)) || Number(shoulder_cm) <= 0 ||
      !isFinite(Number(robe_length_cm)) || Number(robe_length_cm) <= 0 ||
      !isFinite(Number(sleeve_length_cm)) || Number(sleeve_length_cm) <= 0
    ) {
      return res.status(400).json({ error: 'يرجى إدخال قياسات الروب', code: 'ERR_VALIDATION' });
    }
  }

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

  const priced = await priceSelections({
    productId: product_id, role, selections, studentGender: student.gender,
  });
  if (!priced.ok) {
    return res.status(priced.status).json({ error: priced.error, code: priced.code });
  }
  const { total, items } = priced;

  // Compute routing flags
  const has_embroidery = !!design_id || priced.hasEmbroidery;
  const needs_pressing = !!design_id;

  // Determine initial status based on routing
  let initialStatus;
  if (design_id) {
    initialStatus = 'design_complete';
  } else if (priced.hasEmbroidery) {
    initialStatus = 'design_complete'; // designer handles design-less embroidery
  } else {
    initialStatus = 'preparing';
  }

  const measurementsJson = (productType === 'robe' && measurements) ? JSON.stringify(measurements) : null;

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
        `UPDATE orders SET price = $1, batch_id = $2, status = $3,
         has_embroidery = $4, needs_pressing = $5, measurements = $6
         WHERE id = $7`,
        [total, resolvedBatchId, initialStatus, has_embroidery, needs_pressing, measurementsJson, oid]
      );
      await client.query(`DELETE FROM order_items WHERE order_id = $1`, [oid]);
    } else {
      const o = await client.query(
        `INSERT INTO orders (student_id, product_id, design_id, batch_id, price, status,
                             has_embroidery, needs_pressing, measurements)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [student.id, product_id, design_id || null, resolvedBatchId, total, initialStatus,
         has_embroidery, needs_pressing, measurementsJson]
      );
      oid = o.rows[0].id;
    }
    for (const it of items) {
      await client.query(
        `INSERT INTO order_items (order_id, group_id, option_id, label_snapshot, price_snapshot, qty, customer_image_url, customer_text)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [oid, it.group_id, it.option_id, it.label, it.price, it.qty,
         it.customer_image_url || null, it.customer_text || null]
      );
    }
    return oid;
  });

  publish({ type: 'order_new', orderId });
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
    publish({ type: 'order_new', orderId: package_id });
    return res.status(201).json({ data: { order_id: package_id } });
  }

  const st = await query(
    `SELECT id, gender, status, wholesaler_id FROM students WHERE user_id = $1`, [req.user.id]
  );
  if (!st.rows.length) {
    return res.status(404).json({ error: 'حساب الطالب غير موجود', code: 'ERR_NOT_FOUND' });
  }
  const student = st.rows[0];
  // Independent retail (no wholesaler) may now buy packages too; rep students still need approval.
  if (student.wholesaler_id && student.status !== 'approved') {
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
      // Only the sash is designed by the student; robe + cap have nothing to design,
      // so they enter the preparer's queue directly.
      const pkgStatus = prodId === byType.sash ? 'designing' : 'preparing';
      let oid;
      if (existing.rows.length) {
        oid = existing.rows[0].id;
        await client.query(
          `UPDATE orders SET price = $1, batch_id = $2, package_id = $3, status = $4 WHERE id = $5`,
          [price, resolvedBatchId, package_id, pkgStatus, oid]
        );
        await client.query(`DELETE FROM order_items WHERE order_id = $1`, [oid]);
      } else {
        const o = await client.query(
          `INSERT INTO orders (student_id, product_id, batch_id, package_id, price, status)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [student.id, prodId, resolvedBatchId, package_id, price, pkgStatus]
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

  publish({ type: 'order_new' });
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
    `SELECT label_snapshot, price_snapshot, qty, customer_image_url, customer_text FROM order_items
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
  priceSelections, canStaffTransition, TRANSITIONS, STATUS_LABEL_AR, ALL_STATUSES,
};
