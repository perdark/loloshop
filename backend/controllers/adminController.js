const bcrypt = require('bcrypt');
const { query, tx } = require('../lib/db');
const { DEFAULT_ADDONS, sanitizeAddons } = require('../lib/fullSetOrder');
const { normalizeIqPhone } = require('../lib/otp');

const SALT_ROUNDS = 10;

// «التسعيرة» — a base price is a non-negative integer (IQD). null = invalid.
function parsePrice(v) {
  if (v == null || v === '') return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

const STAFF_TYPES = ['designer', 'embroiderer', 'presser', 'preparer', 'manager', 'digitizer', 'tailor'];
const STAFF_SCOPES = ['retail', 'wholesaler', 'both'];

// Multi-role (Migration 029): accept either staff_types[] (preferred) or a single
// staff_type (legacy clients). Returns a de-duped list; the PRIMARY role (index 0) is
// mirrored into users.staff_type for backward-compatible single-role reads.
function normalizeStaffTypes(body) {
  const list = Array.isArray(body.staff_types)
    ? body.staff_types
    : body.staff_type != null
      ? [body.staff_type]
      : [];
  return [...new Set(list.filter(Boolean))];
}

async function analytics(req, res) {
  const totals = await query(
    `SELECT
       COALESCE(SUM(price), 0)::bigint AS revenue,
       COALESCE(SUM(cost), 0)::bigint AS cost,
       COALESCE(SUM(profit), 0)::bigint AS profit,
       COUNT(*)::int AS orders
     FROM orders WHERE status <> 'cancelled'`
  );
  const byStatus = await query(
    `SELECT status, COUNT(*)::int AS count FROM orders GROUP BY status`
  );
  const daily = await query(
    `SELECT DATE(created_at AT TIME ZONE 'UTC') AS date,
            COUNT(*)::int AS orders,
            COALESCE(SUM(price), 0)::bigint AS revenue
     FROM orders
     WHERE created_at > NOW() - INTERVAL '30 days'
     GROUP BY 1 ORDER BY 1`
  );
  const topWholesalers = await query(
    `SELECT w.id, u.name, COUNT(o.id)::int AS order_count
     FROM wholesalers w
     JOIN users u ON u.id = w.user_id
     LEFT JOIN students s ON s.wholesaler_id = w.id
     LEFT JOIN orders o ON o.student_id = s.id
     GROUP BY w.id, u.name
     ORDER BY order_count DESC LIMIT 5`
  );
  const status = {};
  byStatus.rows.forEach((r) => (status[r.status] = r.count));
  res.json({
    totals: totals.rows[0],
    by_status: status,
    daily: daily.rows,
    top_wholesalers: topWholesalers.rows,
  });
}

async function accounting(req, res) {
  const totals = await query(
    `SELECT COALESCE(SUM(price),0)::bigint AS revenue,
            COALESCE(SUM(cost),0)::bigint AS cost,
            COALESCE(SUM(profit),0)::bigint AS profit,
            COUNT(*)::int AS orders
     FROM orders WHERE status <> 'cancelled'`
  );
  const byBatch = await query(
    `SELECT b.id, b.name_ar, wu.name AS wholesaler_name,
            COALESCE(SUM(o.price),0)::bigint AS revenue,
            COALESCE(SUM(o.cost),0)::bigint AS cost,
            COALESCE(SUM(o.profit),0)::bigint AS profit,
            COUNT(o.id)::int AS orders
     FROM batches b
     LEFT JOIN wholesalers w ON w.id = b.wholesaler_id
     LEFT JOIN users wu ON wu.id = w.user_id
     LEFT JOIN orders o ON o.batch_id = b.id AND o.status <> 'cancelled'
     GROUP BY b.id, wu.name ORDER BY revenue DESC`
  );
  const byWholesaler = await query(
    `SELECT w.id, u.name AS wholesaler_name, w.commission_rate,
            COALESCE(SUM(o.price),0)::bigint AS revenue,
            COALESCE(SUM(o.cost),0)::bigint AS cost,
            COALESCE(SUM(o.profit),0)::bigint AS profit,
            ROUND(COALESCE(SUM(o.price),0) * w.commission_rate / 100)::bigint AS commission,
            COUNT(o.id)::int AS orders
     FROM wholesalers w
     JOIN users u ON u.id = w.user_id
     LEFT JOIN students s ON s.wholesaler_id = w.id
     LEFT JOIN orders o ON o.student_id = s.id AND o.status <> 'cancelled'
     GROUP BY w.id, u.name, w.commission_rate ORDER BY revenue DESC`
  );
  const retail = await query(
    `SELECT COALESCE(SUM(o.price),0)::bigint AS revenue,
            COALESCE(SUM(o.cost),0)::bigint AS cost,
            COALESCE(SUM(o.profit),0)::bigint AS profit,
            COUNT(o.id)::int AS orders
     FROM orders o
     JOIN students s ON s.id = o.student_id
     WHERE s.wholesaler_id IS NULL AND o.status <> 'cancelled'`
  );
  res.json({
    totals: totals.rows[0],
    by_batch: byBatch.rows,
    by_wholesaler: byWholesaler.rows,
    independent_retail: retail.rows[0],
  });
}

async function updateOrderCost(req, res) {
  const { id } = req.params;
  const { cost } = req.body;
  if (cost == null || cost < 0) {
    return res.status(400).json({ error: 'تكلفة غير صالحة', code: 'ERR_VALIDATION' });
  }
  const { rows } = await query(
    `UPDATE orders SET cost = $1 WHERE id = $2 RETURNING id, price, cost, profit`,
    [cost, id]
  );
  if (!rows.length) return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'update_cost', 'order', $2, $3)`,
    [req.user.id, id, JSON.stringify({ cost })]
  );
  res.json({ data: rows[0] });
}

// Edit a full-set bundle's intake row — record the deposit (واصل) as cash arrives,
// fix phones/address, adjust the event date. Whitelisted columns only.
async function updateCheckoutGroup(req, res) {
  const { id } = req.params;
  if (req.body.deposit !== undefined && (!isFinite(Number(req.body.deposit)) || Number(req.body.deposit) < 0)) {
    return res.status(400).json({ error: 'عربون غير صالح', code: 'ERR_VALIDATION' });
  }
  const ALLOWED = [
    'customer_name', 'instagram_username', 'phone_primary', 'phone_secondary',
    'governorate', 'area_details', 'event_date', 'deposit', 'notes',
  ];
  const sets = [];
  const params = [];
  for (const col of ALLOWED) {
    if (req.body[col] !== undefined) {
      params.push(req.body[col] === '' ? null : req.body[col]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (!sets.length) return res.status(400).json({ error: 'لا تغييرات', code: 'ERR_VALIDATION' });
  params.push(id);
  const { rows } = await query(
    `UPDATE checkout_groups SET ${sets.join(', ')} WHERE id = $${params.length}
     RETURNING id, customer_name, instagram_username, phone_primary, phone_secondary,
               governorate, area_details, event_date::text AS event_date, deposit, notes,
               created_at, updated_at`,
    params
  );
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'update_checkout_group', 'checkout_group', $2, $3)`,
    [req.user.id, id, JSON.stringify({ fields: Object.keys(req.body) })]
  );
  res.json({ data: rows[0] });
}

async function listWholesalers(req, res) {
  const { rows } = await query(
    `SELECT w.id, u.name, u.phone, u.email, w.referral_code, w.deadline, w.commission_rate, w.created_at,
       w.university_name, w.department, w.admin_price, w.wholesaler_price, w.pricing_addons,
       (SELECT COUNT(*)::int FROM students s WHERE s.wholesaler_id = w.id) AS student_count,
       (SELECT COUNT(*)::int FROM students s WHERE s.wholesaler_id = w.id AND s.status = 'pending_approval') AS pending_count,
       -- «المستحق» = price-gap profit (سعر الممثل والطلاب − سعر المدير) across the rep's orders.
       COALESCE((
         SELECT SUM(o.profit)::bigint
         FROM students s JOIN orders o ON o.student_id = s.id
         WHERE s.wholesaler_id = w.id AND o.status <> 'cancelled'
       ), 0) AS earned_commission
     FROM wholesalers w JOIN users u ON u.id = w.user_id
     ORDER BY w.created_at DESC`
  );
  const data = rows.map((r) => ({
    ...r,
    admin_price: Number(r.admin_price || 0),
    wholesaler_price: Number(r.wholesaler_price || 0),
    pricing_addons: sanitizeAddons(r.pricing_addons),
    referral_url: `${process.env.FRONTEND_URL}/join/${r.referral_code}`,
  }));
  res.json({ data });
}

async function createWholesaler(req, res) {
  // Normalize phone before duplicate-check + insert so stored numbers are always canonical.
  req.body.phone = normalizeIqPhone(req.body.phone);
  const { name, phone, email, password, referral_code, deadline, university_name, department } = req.body;
  // «التسعيرة» — two base prices + editable add-ons (defaults applied; admin tweaks per rep later).
  const adminPrice = parsePrice(req.body.admin_price);
  const wholesalerPrice = parsePrice(req.body.wholesaler_price);
  if (adminPrice === null || wholesalerPrice === null) {
    return res.status(400).json({ error: 'سعر غير صالح', code: 'ERR_VALIDATION' });
  }
  const pricingAddons = sanitizeAddons(req.body.pricing_addons);
  if (!name || !phone || !password || !referral_code) {
    return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  }
  // The wholesaler's جامعة/قسم are inherited by every student who joins via their link,
  // so they are required at creation.
  if (!university_name || !String(university_name).trim()) {
    return res.status(400).json({ error: 'اسم الجامعة مطلوب', code: 'ERR_VALIDATION' });
  }
  if (!department || !String(department).trim()) {
    return res.status(400).json({ error: 'القسم/التخصص مطلوب', code: 'ERR_VALIDATION' });
  }
  const slugOk = /^[a-z0-9-]+$/.test(referral_code);
  if (!slugOk) {
    return res.status(400).json({ error: 'الرابط يجب أن يحتوي على حروف صغيرة وأرقام وشرطات', code: 'ERR_VALIDATION' });
  }
  // «لون التطريز» — optional per-wholesaler embroidery/thread color (max 120 chars; '' → null).
  const rawEmbColor = req.body.embroidery_color;
  const embroideryColor = rawEmbColor != null ? String(rawEmbColor).trim().slice(0, 120) || null : null;

  const exists = await query(`SELECT id FROM users WHERE phone = $1`, [phone]);
  if (exists.rows.length) {
    return res.status(409).json({ error: 'الرقم مستخدم', code: 'ERR_PHONE_TAKEN' });
  }
  const codeExists = await query(`SELECT id FROM wholesalers WHERE referral_code = $1`, [referral_code]);
  if (codeExists.rows.length) {
    return res.status(409).json({ error: 'الرمز مستخدم', code: 'ERR_VALIDATION' });
  }
  const hash = await bcrypt.hash(password, 10);
  const result = await tx(async (client) => {
    const u = await client.query(
      `INSERT INTO users (name, phone, email, password_hash, role, phone_verified)
       VALUES ($1, $2, $3, $4, 'wholesaler', TRUE) RETURNING id`,
      [name, phone, email || null, hash]
    );
    const w = await client.query(
      `INSERT INTO wholesalers (user_id, referral_code, deadline, approved_by_admin, university_name, department,
                               admin_price, wholesaler_price, pricing_addons, embroidery_color)
       VALUES ($1, $2, $3, TRUE, $4, $5, $6, $7, $8::jsonb, $9) RETURNING id, referral_code`,
      [u.rows[0].id, referral_code, deadline || null, String(university_name).trim(), String(department).trim(),
       adminPrice, wholesalerPrice, JSON.stringify(pricingAddons), embroideryColor]
    );
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'create_wholesaler', 'wholesaler', $2, $3)`,
      [req.user.id, w.rows[0].id, JSON.stringify({ name, referral_code })]
    );
    return w.rows[0];
  });
  res.status(201).json({
    data: {
      id: result.id,
      referral_url: `${process.env.FRONTEND_URL}/join/${result.referral_code}`,
    },
  });
}

// Edit a wholesaler's جامعة/قسم + «لون التطريز» (so existing reps can be filled in / corrected).
// جامعة/قسم flow to every student who joins via the rep's link; embroidery_color stamps
// all that rep's future full-set orders.
async function updateWholesaler(req, res) {
  const { id } = req.params;
  const { university_name, department } = req.body;
  if (!university_name || !String(university_name).trim()) {
    return res.status(400).json({ error: 'اسم الجامعة مطلوب', code: 'ERR_VALIDATION' });
  }
  if (!department || !String(department).trim()) {
    return res.status(400).json({ error: 'القسم/التخصص مطلوب', code: 'ERR_VALIDATION' });
  }
  // «لون التطريز» — optional; '' → null.
  const rawEmbColor = req.body.embroidery_color;
  const embroideryColor = rawEmbColor != null ? String(rawEmbColor).trim().slice(0, 120) || null : undefined;

  // Build the update dynamically so passing no embroidery_color field is a no-op.
  let sql, params;
  if (embroideryColor !== undefined) {
    sql = `UPDATE wholesalers SET university_name = $1, department = $2, embroidery_color = $3
           WHERE id = $4 RETURNING id, university_name, department, embroidery_color`;
    params = [String(university_name).trim(), String(department).trim(), embroideryColor, id];
  } else {
    sql = `UPDATE wholesalers SET university_name = $1, department = $2
           WHERE id = $3 RETURNING id, university_name, department, embroidery_color`;
    params = [String(university_name).trim(), String(department).trim(), id];
  }
  const { rows } = await query(sql, params);
  if (!rows.length) {
    return res.status(404).json({ error: 'الممثل غير موجود', code: 'ERR_NOT_FOUND' });
  }
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'update_wholesaler', 'wholesaler', $2, $3)`,
    [req.user.id, id, JSON.stringify({
      university_name: rows[0].university_name,
      department: rows[0].department,
      embroidery_color: rows[0].embroidery_color,
    })]
  );
  res.json({ data: rows[0] });
}

async function updateDeadline(req, res) {
  const { id } = req.params;
  const { deadline, extend_days } = req.body;
  let sql, params;
  if (deadline) {
    sql = `UPDATE wholesalers SET deadline = $1 WHERE id = $2 RETURNING id, deadline`;
    params = [deadline, id];
  } else if (extend_days) {
    sql = `UPDATE wholesalers SET deadline = COALESCE(deadline, NOW()) + ($1 || ' days')::interval
           WHERE id = $2 RETURNING id, deadline`;
    params = [extend_days, id];
  } else {
    return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  }
  const { rows } = await query(sql, params);
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'extend_deadline', 'wholesaler', $2, $3)`,
    [req.user.id, id, JSON.stringify({ deadline, extend_days })]
  );
  res.json({ data: rows[0] });
}

// «التسعيرة»: set a rep's two base prices + editable add-on surcharges.
async function updatePricing(req, res) {
  const { id } = req.params;
  const adminPrice = parsePrice(req.body.admin_price);
  const wholesalerPrice = parsePrice(req.body.wholesaler_price);
  if (adminPrice === null || wholesalerPrice === null) {
    return res.status(400).json({ error: 'سعر غير صالح', code: 'ERR_VALIDATION' });
  }
  const pricingAddons = sanitizeAddons(req.body.pricing_addons);
  const { rows } = await query(
    `UPDATE wholesalers SET admin_price = $1, wholesaler_price = $2, pricing_addons = $3::jsonb
     WHERE id = $4 RETURNING id, admin_price, wholesaler_price, pricing_addons`,
    [adminPrice, wholesalerPrice, JSON.stringify(pricingAddons), id]
  );
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'update_pricing', 'wholesaler', $2, $3)`,
    [req.user.id, id, JSON.stringify({ admin_price: adminPrice, wholesaler_price: wholesalerPrice, pricing_addons: pricingAddons })]
  );
  res.json({
    data: {
      id: rows[0].id,
      admin_price: Number(rows[0].admin_price || 0),
      wholesaler_price: Number(rows[0].wholesaler_price || 0),
      pricing_addons: sanitizeAddons(rows[0].pricing_addons),
    },
  });
}

async function deleteWholesaler(req, res) {
  const { id } = req.params;
  const { rows } = await query(
    `SELECT user_id FROM wholesalers WHERE id = $1`,
    [id]
  );
  if (!rows.length) {
    return res
      .status(404)
      .json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  }
  const userId = rows[0].user_id;
  await tx(async (client) => {
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'delete_wholesaler', 'wholesaler', $2, $3)`,
      [req.user.id, id, JSON.stringify({ user_id: userId })]
    );
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  });
  res.json({ data: { id } });
}
// ── Sash side lock config (per wholesaler) ──
// editable_sash_side: 'left' | 'right' | null (null = both editable)
// locked_side_design: Fabric JSON for the locked (non-editable) side.
function validateSashSide(side) {
  return side === null || side === 'left' || side === 'right';
}

async function getWholesalerSashConfig(req, res) {
  const { id } = req.params;
  const { rows } = await query(
    `SELECT id, editable_sash_side, locked_side_design FROM wholesalers WHERE id = $1`,
    [id]
  );
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  res.json({ data: rows[0] });
}

async function updateWholesalerSashConfig(req, res) {
  const { id } = req.params;
  const side = req.body.editable_sash_side ?? null;
  if (!validateSashSide(side)) {
    return res.status(400).json({ error: 'جانب غير صالح', code: 'ERR_VALIDATION' });
  }
  // When unlocking (side = null) we also clear the saved locked-side design.
  const design = side === null ? null : (req.body.locked_side_design ?? null);
  const { rows } = await query(
    `UPDATE wholesalers SET editable_sash_side = $1, locked_side_design = $2
     WHERE id = $3 RETURNING id, editable_sash_side, locked_side_design`,
    [side, design, id]
  );
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'update_sash_side', 'wholesaler', $2, $3)`,
    [req.user.id, id, JSON.stringify({ editable_sash_side: side })]
  );
  res.json({ data: rows[0] });
}

async function wholesalerStudents(req, res) {
  const { id } = req.params;
  const { rows } = await query(
    `SELECT s.id, u.name, u.phone, s.status, s.university_name, s.department,
       lo.status AS order_status,
       (lo.status IN ('design_complete', 'staff_review', 'printing', 'embroidery', 'pressing', 'preparing', 'ready', 'delivered')) AS is_completed
     FROM students s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN LATERAL (
       SELECT status FROM orders WHERE student_id = s.id ORDER BY created_at DESC LIMIT 1
     ) lo ON TRUE
     WHERE s.wholesaler_id = $1
     ORDER BY s.created_at DESC`,
    [id]
  );
  res.json({ data: rows });
}

async function toggleEditException(req, res) {
  const { id } = req.params;
  const { rows } = await query(
    `UPDATE students SET edit_exception = NOT edit_exception WHERE id = $1 RETURNING id, edit_exception`,
    [id]
  );
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'toggle_edit_exception', 'student', $2, $3)`,
    [req.user.id, id, JSON.stringify({ edit_exception: rows[0].edit_exception })]
  );
  res.json({ data: rows[0] });
}

// Reps drill-down: every wholesaler with their batches + total order count, for the
// admin orders «ممثلين» landing grid (click a rep → filter orders to their students).
async function repsOverview(req, res) {
  const { rows } = await query(
    `SELECT w.id, u.name,
            COALESCE(
              json_agg(DISTINCT jsonb_build_object('id', b.id, 'name_ar', b.name_ar, 'deadline', b.deadline))
                FILTER (WHERE b.id IS NOT NULL),
              '[]'
            ) AS batches,
            COUNT(DISTINCT o.id)::int AS order_count
     FROM wholesalers w
     JOIN users u ON u.id = w.user_id
     LEFT JOIN batches b ON b.wholesaler_id = w.id
     LEFT JOIN students s ON s.wholesaler_id = w.id
     LEFT JOIN orders o ON o.student_id = s.id
     GROUP BY w.id, u.name
     ORDER BY u.name ASC`
  );
  res.json({ data: rows });
}

async function listStaff(req, res) {
  const { rows } = await query(
    `SELECT id, name, phone, email, staff_type, staff_types, order_scope, phone_verified
     FROM users
     WHERE role = 'staff'
     ORDER BY name ASC`
  );
  res.json({ data: rows });
}

async function createStaff(req, res) {
  // Phone is OPTIONAL: staff with no phone log in via the private staff portal
  // (name + password, no OTP). Treat empty/missing as NULL; normalize when present.
  const rawPhone = req.body.phone;
  const phone =
    rawPhone != null && String(rawPhone).trim() !== ''
      ? normalizeIqPhone(rawPhone)
      : null;
  const { name, email, password, order_scope } = req.body;
  if (!name || !password) {
    return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'كلمة المرور قصيرة', code: 'ERR_VALIDATION' });
  }
  const staffTypes = normalizeStaffTypes(req.body);
  if (staffTypes.some((t) => !STAFF_TYPES.includes(t))) {
    return res.status(400).json({ error: 'نوع موظف غير صالح', code: 'ERR_VALIDATION' });
  }
  if (order_scope && !STAFF_SCOPES.includes(order_scope)) {
    return res.status(400).json({ error: 'نطاق طلبات غير صالح', code: 'ERR_VALIDATION' });
  }
  if (phone) {
    const exists = await query(`SELECT id FROM users WHERE phone = $1`, [phone]);
    if (exists.rows.length) {
      return res.status(409).json({ error: 'الرقم مستخدم', code: 'ERR_PHONE_TAKEN' });
    }
  }
  const primaryType = staffTypes[0] || null;
  const typesParam = staffTypes.length ? staffTypes : null;
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const { rows } = await query(
    `INSERT INTO users (name, phone, email, password_hash, role, staff_type, staff_types, order_scope, phone_verified)
     VALUES ($1, $2, $3, $4, 'staff', $5::staff_type, $6::staff_type[], COALESCE($7::staff_order_scope, 'both'), TRUE)
     RETURNING id, name, phone, email, staff_type, staff_types, order_scope, phone_verified`,
    [name, phone, email || null, hash, primaryType, typesParam, order_scope || null]
  );
  const staff = rows[0];
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'create_staff', 'user', $2, $3)`,
    [req.user.id, staff.id, JSON.stringify({ role: 'staff', staff_types: staffTypes, order_scope: order_scope || 'both', phone })]
  );
  res.status(201).json({ data: staff });
}

async function updateStaffScope(req, res) {
  const { id } = req.params;
  const { order_scope } = req.body;
  if (!STAFF_SCOPES.includes(order_scope)) {
    return res.status(400).json({ error: 'نطاق طلبات غير صالح', code: 'ERR_VALIDATION' });
  }
  const { rows } = await query(
    `UPDATE users SET order_scope = $1 WHERE id = $2 AND role = 'staff'
     RETURNING id, name, order_scope`,
    [order_scope, id]
  );
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'update_staff_scope', 'user', $2, $3)`,
    [req.user.id, id, JSON.stringify({ order_scope })]
  );
  res.json({ data: rows[0] });
}

async function updateStaffType(req, res) {
  const { id } = req.params;
  const staffTypes = normalizeStaffTypes(req.body);
  if (staffTypes.some((t) => !STAFF_TYPES.includes(t))) {
    return res.status(400).json({ error: 'نوع موظف غير صالح', code: 'ERR_VALIDATION' });
  }
  const primaryType = staffTypes[0] || null;
  const typesParam = staffTypes.length ? staffTypes : null;
  const { rows } = await query(
    `UPDATE users SET staff_type = $1::staff_type, staff_types = $2::staff_type[]
     WHERE id = $3 AND role = 'staff'
     RETURNING id, name, staff_type, staff_types`,
    [primaryType, typesParam, id]
  );
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'update_staff_type', 'user', $2, $3)`,
    [req.user.id, id, JSON.stringify({ staff_types: staffTypes })]
  );
  res.json({ data: rows[0] });
}

async function updateStaffPassword(req, res) {
  const { id } = req.params;
  const { password } = req.body;
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: 'كلمة المرور قصيرة', code: 'ERR_VALIDATION' });
  }
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const { rows } = await query(
    `UPDATE users
     SET password_hash = $1
     WHERE id = $2 AND role = 'staff'
     RETURNING id`,
    [hash, id]
  );
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'reset_staff_password', 'user', $2, $3)`,
    [req.user.id, id, JSON.stringify({ role: 'staff' })]
  );
  res.json({ data: { id } });
}

async function deleteStaff(req, res) {
  const { id } = req.params;
  const { rows } = await query(
    `DELETE FROM users WHERE id = $1 AND role = 'staff' RETURNING id`,
    [id]
  );
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'delete_staff', 'user', $2, $3)`,
    [req.user.id, id, JSON.stringify({ role: 'staff' })]
  );
  res.json({ data: { id } });
}

// ---------- Admin: discount popup promo config ----------
async function updatePromo(req, res) {
  const { active, title_ar, message_ar, deadline } = req.body;

  // active: coerce to boolean
  const activeVal = !!active;

  // title_ar: required, trimmed, max 120 chars
  const titleTrimmed = typeof title_ar === 'string' ? title_ar.trim() : '';
  if (!titleTrimmed) {
    return res.status(400).json({ error: 'العنوان مطلوب', code: 'ERR_VALIDATION' });
  }
  if (titleTrimmed.length > 120) {
    return res.status(400).json({ error: 'العنوان طويل جداً (الحد 120 حرف)', code: 'ERR_VALIDATION' });
  }

  // message_ar: required, trimmed, max 600 chars
  const msgTrimmed = typeof message_ar === 'string' ? message_ar.trim() : '';
  if (!msgTrimmed) {
    return res.status(400).json({ error: 'الرسالة مطلوبة', code: 'ERR_VALIDATION' });
  }
  if (msgTrimmed.length > 600) {
    return res.status(400).json({ error: 'الرسالة طويلة جداً (الحد 600 حرف)', code: 'ERR_VALIDATION' });
  }

  // deadline: null/'' → null; otherwise must be a valid ISO date
  let deadlineVal = null;
  if (deadline != null && deadline !== '') {
    const d = new Date(deadline);
    if (isNaN(d.getTime())) {
      return res.status(400).json({ error: 'تاريخ غير صالح', code: 'ERR_VALIDATION' });
    }
    deadlineVal = d.toISOString();
  }

  const cfg = { active: activeVal, title_ar: titleTrimmed, message_ar: msgTrimmed, deadline: deadlineVal };

  await query(
    `INSERT INTO site_settings (key, value, updated_at)
     VALUES ('discount_popup', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(cfg)]
  );

  res.json({ data: cfg });
}

module.exports = {
  analytics, accounting, updateOrderCost, updateCheckoutGroup,
  listWholesalers, createWholesaler, updateWholesaler, updateDeadline, updatePricing, deleteWholesaler,
  getWholesalerSashConfig, updateWholesalerSashConfig,
  wholesalerStudents, toggleEditException,
  listStaff, createStaff, updateStaffType, updateStaffScope, updateStaffPassword, deleteStaff,
  repsOverview, updatePromo,
};
