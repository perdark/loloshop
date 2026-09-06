// Admin/مدير الإنتاج order editing — full طقم re-save + per-piece quick edits + student
// search. Mounted under /api/production behind requireStaffType() (admin role and the
// `manager` staff_type pass; every other staff type 403s).
//
// The full-form path reuses persistFullSetOrder/readFullSetOrder (the single source of
// truth shared with the rep + student forms) and NEVER applies to retail bundles: the
// form would re-price them with rep/piece pricing. Eligibility = the student is
// wholesaler-linked OR is an admin-created name-only account (users.phone IS NULL).
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { query, tx } = require('../lib/db');
const { persistFullSetOrder, readFullSetOrder, loadWholesalerPricing } = require('../lib/fullSetOrder');
const { priceSelections, validateRobeMeasurements } = require('./orderController');
const { publicUrl } = require('../lib/upload');
const { publish } = require('../lib/eventBus');
const { releaseForOrder } = require('../lib/shelf');
// Same canonical phone form auth uses, so an admin-created student's number matches if they
// later log in or recover by OTP.
const { normalizeIqPhone, isValidIqMobile } = require('../lib/otp');

const SALT_ROUNDS = 10;

function clean(v, max) {
  const t = v == null ? '' : String(v).trim();
  return t ? t.slice(0, max) : null;
}
const isUuid = (s) => /^[0-9a-f-]{36}$/i.test(String(s || ''));

async function loadStudent(studentId) {
  if (!isUuid(studentId)) return null;
  const { rows } = await query(
    `SELECT s.id, s.user_id, u.name, u.phone, s.status, s.gender::text AS gender, s.instagram_username,
            s.university_name, s.department, s.study_type::text AS study_type,
            s.wholesaler_id, wu.name AS rep_name
       FROM students s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN wholesalers w ON w.id = s.wholesaler_id
       LEFT JOIN users wu ON wu.id = w.user_id
      WHERE s.id = $1`,
    [studentId]
  );
  return rows[0] || null;
}

const eligibleForFullSet = (student) => !!student && (student.wholesaler_id != null || student.phone == null);

// ── Product swap (same family only) ─────────────────────────────────────────
// A retail piece may be re-pointed at a SIBLING product — «وشاح الفراشة» → «وشاح ملكي» —
// carrying the student's saved selections across verbatim.
//
// WHY same-family-only is the whole safety argument: child products own ZERO option
// groups (every group lives on the parent, see priceSelections' groupProductIds), so the
// saved (group_id, option_id, customer_text, customer_image_url) tuples remain valid on
// any sibling without remapping. Colours, embroidery texts and reference photos survive;
// only the base price moves. Cross-family or cross-type would invalidate every selection,
// and on a REP bundle «ملكي» is an add-on LINE (إضافة: وشاح ملكي) rather than a product,
// so swapping there would double-charge — hence retail-only, enforced by the caller.
const familyKey = (row) => String(row.parent_id || row.id);

// ── One live design-less piece per (student, product) ───────────────────────
// `uq_orders_student_product_nodesign` (db/schema.sql) is a DB-level invariant, not a
// suggestion: a student may hold at most ONE non-cancelled design-less order per product.
// BOTH write paths here can violate it — a swap moves a piece ONTO a product, «طلب مخصص»
// creates one — and an unguarded write surfaces as a raw 23505 with no Arabic message and
// a 500 the admin can do nothing with. So: look the clash up first for a useful error, and
// still catch 23505 as the race backstop (the check and the write are not atomic).
async function liveOrderForProduct(studentId, productId, exceptOrderId = null) {
  const { rows } = await query(
    `SELECT id FROM orders
      WHERE student_id = $1 AND product_id = $2
        AND design_id IS NULL AND status <> 'cancelled'
        AND ($3::uuid IS NULL OR id <> $3::uuid)
      LIMIT 1`,
    [studentId, productId, exceptOrderId || null]
  );
  return rows[0]?.id || null;
}

const isUniqueViolation = (e) => e && e.code === '23505';

// Sibling candidates for the swap picker. Deliberately re-derived from the DB on every
// request (never cached, never trusted from the client) so prod catalog shape rules.
// Products the student ALREADY holds a live design-less piece of are filtered out — the
// picker must never offer a target that the unique index above would then refuse.
async function swapCandidates({ productId, parentId, productType, gender, studentId, orderId }) {
  const { rows } = await query(
    `SELECT p.id, p.name_ar, p.image_url,
            COALESCE(ppr.base_price, p.base_price)::int AS retail_price
       FROM products p
       LEFT JOIN product_price_roles ppr ON ppr.product_id = p.id AND ppr.role = 'retail'
      WHERE p.active = TRUE
        AND p.type::text = $1
        AND COALESCE(p.parent_id, p.id) = $2::uuid
        AND p.id <> $3::uuid
        AND p.wholesaler_only = FALSE
        AND (p.gender_restriction IS NULL OR p.gender_restriction::text IS NOT DISTINCT FROM $4)
        AND NOT EXISTS (
          SELECT 1 FROM orders o2
           WHERE o2.student_id = $5::uuid
             AND o2.product_id = p.id
             AND o2.design_id IS NULL
             AND o2.status <> 'cancelled'
             AND o2.id <> $6::uuid
        )
      ORDER BY p.sort, p.name_ar`,
    [productType, parentId || productId, productId, gender || null, studentId, orderId]
  );
  return rows;
}

// Full server-side re-validation of a requested swap target. Returns {error:{status,message,code}}
// or {product}. Every rule is checked against the DB row, never against anything the client sent.
async function resolveSwapTarget({ targetProductId, current }) {
  if (!isUuid(targetProductId)) {
    return { error: { status: 400, message: 'منتج غير صحيح', code: 'ERR_VALIDATION' } };
  }
  const { rows } = await query(
    `SELECT id, name_ar, type::text AS type, parent_id, active, wholesaler_only,
            gender_restriction::text AS gender_restriction
       FROM products WHERE id = $1`,
    [targetProductId]
  );
  if (!rows.length) {
    return { error: { status: 404, message: 'المنتج غير موجود', code: 'ERR_NOT_FOUND' } };
  }
  const target = rows[0];
  if (!target.active) {
    return { error: { status: 400, message: 'هذا المنتج غير مفعّل', code: 'ERR_PRODUCT_INACTIVE' } };
  }
  if (target.wholesaler_only) {
    return { error: { status: 403, message: 'هذا المنتج مخصص للممثلين فقط', code: 'ERR_FORBIDDEN' } };
  }
  if (target.type !== current.product_type) {
    return { error: { status: 400, message: 'لا يمكن التبديل إلى نوع منتج مختلف', code: 'ERR_PRODUCT_TYPE_MISMATCH' } };
  }
  if (familyKey(target) !== familyKey({ id: current.product_id, parent_id: current.product_parent_id })) {
    return {
      error: {
        status: 400,
        message: 'لا يمكن التبديل إلا بين منتجات من نفس العائلة',
        code: 'ERR_PRODUCT_FAMILY_MISMATCH',
      },
    };
  }
  if (target.gender_restriction && target.gender_restriction !== current.gender) {
    return { error: { status: 403, message: 'هذا المنتج غير متاح', code: 'ERR_GENDER' } };
  }
  return { product: target };
}

// FE «التسعيرة» shape (selling side only — same as the rep-facing pricing payload).
async function publicPricing(wholesalerId) {
  const p = await loadWholesalerPricing(wholesalerId || null);
  return {
    base: p.wholesalerPrice,
    addons: Object.fromEntries(Object.entries(p.addons).map(([k, v]) => [k, v.selling])),
  };
}

// ── Approval preservation ────────────────────────────────────────────────────
// persistFullSetOrder flips every saved row to wholesaler_approval='pending' (an edit
// re-enters the REP approval flow). For an admin/manager edit that is wrong three ways:
// an approved bundle would vanish from the staff queue, a direct admin order (NULL)
// would enter an approval flow it never belonged to, and a rejected bundle would lose
// its reason. So: capture the bundle state BEFORE the save, restore it exactly AFTER.
async function captureApproval(studentId) {
  const { rows } = await query(
    `SELECT o.checkout_group_id, o.wholesaler_approval::text AS state,
            o.wholesaler_approved_at, o.wholesaler_approved_by, o.wholesaler_reject_reason
       FROM orders o
      WHERE o.student_id = $1 AND o.design_id IS NULL AND o.status <> 'cancelled'
        AND o.checkout_group_id IS NOT NULL
      ORDER BY o.created_at DESC LIMIT 1`,
    [studentId]
  );
  if (!rows.length) return { exists: false };
  return { exists: true, ...rows[0] };
}

// persistFullSetOrder overwrites checkout_groups.phone_primary with users.phone (''
// for name-only students) on every save. If an admin previously stored a contact phone
// on the group and this save didn't provide one, put it back instead of wiping it.
async function restoreGroupPhone({ checkoutGroupId, prevGroupId, prevPhone }) {
  if (!prevPhone || prevGroupId !== checkoutGroupId) return;
  await query(
    `UPDATE checkout_groups SET phone_primary = $1, updated_at = NOW()
      WHERE id = $2 AND phone_primary = ''`,
    [prevPhone, checkoutGroupId]
  );
}

async function captureGroupPhone(prev) {
  if (!prev.exists || !prev.checkout_group_id) return { prevGroupId: null, prevPhone: null };
  const { rows } = await query(`SELECT phone_primary FROM checkout_groups WHERE id = $1`, [prev.checkout_group_id]);
  return { prevGroupId: prev.checkout_group_id, prevPhone: rows[0]?.phone_primary || null };
}

async function restoreApproval({ checkoutGroupId, prev, isRepLinked, actorUserId }) {
  const target = prev.exists ? prev.state : isRepLinked ? 'approved' : null;
  if (target === 'pending') return 'pending'; // persist already wrote it
  if (target === null) {
    await query(
      `UPDATE orders SET wholesaler_approval = NULL, wholesaler_reject_reason = NULL,
              wholesaler_approved_at = NULL, wholesaler_approved_by = NULL, updated_at = NOW()
        WHERE checkout_group_id = $1`,
      [checkoutGroupId]
    );
  } else if (target === 'approved') {
    await query(
      `UPDATE orders SET wholesaler_approval = 'approved', wholesaler_reject_reason = NULL,
              wholesaler_approved_at = COALESCE($2, NOW()), wholesaler_approved_by = $3, updated_at = NOW()
        WHERE checkout_group_id = $1 AND wholesaler_approval IS NOT NULL`,
      [checkoutGroupId, prev.exists ? prev.wholesaler_approved_at : null,
       (prev.exists && prev.wholesaler_approved_by) || actorUserId || null]
    );
  } else if (target === 'rejected') {
    await query(
      `UPDATE orders SET wholesaler_approval = 'rejected', wholesaler_reject_reason = $2, updated_at = NOW()
        WHERE checkout_group_id = $1 AND wholesaler_approval IS NOT NULL`,
      [checkoutGroupId, prev.wholesaler_reject_reason || null]
    );
  }
  return target;
}

// Validate + normalise EVERY supplied field BEFORE anything is written. Returns
// `{error}` or `{values}` holding only the keys the caller actually provided.
//
// Validating up front matters because these writes span several statements: validating
// inline (as this did until 2026-07-20) meant a bad `study_type` returned 400 *after*
// the name/university/department had already been committed — a half-applied edit
// reported to the caller as a clean failure.
function validateStudentInfo(info) {
  const provided = (k) => Object.prototype.hasOwnProperty.call(info, k);
  const v = {};
  if (provided('name')) {
    const name = clean(info.name, 120);
    if (!name) return { error: 'اسم الطالب مطلوب' };
    v.name = name;
  }
  if (provided('instagram_username')) {
    v.instagram_username = clean(String(info.instagram_username || '').replace(/^@+/, ''), 100);
  }
  if (provided('university_name')) v.university_name = clean(info.university_name, 160);
  if (provided('department')) v.department = clean(info.department, 160);
  if (provided('study_type')) {
    // Postgres enum ('morning' | 'evening'); '' / null clears it back to NULL. Checked
    // against the allow-list BEFORE truncation so a future longer enum value can't be
    // silently cut down into an invalid one.
    const raw = info.study_type;
    if (raw != null && typeof raw !== 'string') return { error: 'نوع الدراسة غير صحيح' };
    const st = raw == null ? null : (raw.trim() || null);
    if (st !== null && st !== 'morning' && st !== 'evening') {
      return { error: 'نوع الدراسة غير صحيح' };
    }
    v.study_type = st;
  }
  // checkout_groups.phone_primary is NOT NULL — empty string is the "no phone" marker
  // (same convention as name-only students).
  if (provided('phone_primary')) v.phone_primary = clean(info.phone_primary, 20) || '';
  if (provided('phone_secondary')) v.phone_secondary = clean(info.phone_secondary, 20);
  return { values: v };
}

// Dual-write rules: the staff order page reads the name/IG from BOTH students and the
// bundle's checkout_groups — keep the pair in sync so the edit shows everywhere. The
// academic fields live ONLY on `students` (no checkout_groups mirror) and are exactly what
// the order page renders under «بيانات الطالب» — before 2026-07-20 they were display-only,
// so a wrong university/department could not be corrected anywhere in the app.
//
// `exec` lets the caller run every write inside an existing transaction; it defaults to the
// pool so the full-set path (which has already committed) keeps its current behaviour.
async function applyStudentInfo(student, info, checkoutGroupId, exec = query) {
  const validated = validateStudentInfo(info);
  if (validated.error) return validated;
  const v = validated.values;
  const has = (k) => Object.prototype.hasOwnProperty.call(v, k);
  const changed = [];

  if (has('name')) {
    await exec(`UPDATE users SET name = $1 WHERE id = $2`, [v.name, student.user_id]);
    await exec(`UPDATE students SET full_name_third = $1 WHERE id = $2`, [v.name, student.id]);
    if (checkoutGroupId) {
      await exec(`UPDATE checkout_groups SET customer_name = $1, updated_at = NOW() WHERE id = $2`, [v.name, checkoutGroupId]);
    }
    changed.push('name');
    student.name = v.name;
  }
  if (has('instagram_username')) {
    await exec(`UPDATE students SET instagram_username = $1 WHERE id = $2`, [v.instagram_username, student.id]);
    if (checkoutGroupId) {
      await exec(`UPDATE checkout_groups SET instagram_username = $1, updated_at = NOW() WHERE id = $2`, [v.instagram_username, checkoutGroupId]);
    }
    changed.push('instagram_username');
  }
  if (has('university_name')) {
    await exec(`UPDATE students SET university_name = $1 WHERE id = $2`, [v.university_name, student.id]);
    changed.push('university_name');
  }
  if (has('department')) {
    await exec(`UPDATE students SET department = $1 WHERE id = $2`, [v.department, student.id]);
    changed.push('department');
  }
  if (has('study_type')) {
    await exec(`UPDATE students SET study_type = $1::study_type WHERE id = $2`, [v.study_type, student.id]);
    changed.push('study_type');
  }
  if (checkoutGroupId && has('phone_primary')) {
    await exec(`UPDATE checkout_groups SET phone_primary = $1, updated_at = NOW() WHERE id = $2`, [v.phone_primary, checkoutGroupId]);
    changed.push('phone_primary');
  }
  if (checkoutGroupId && has('phone_secondary')) {
    await exec(`UPDATE checkout_groups SET phone_secondary = $1, updated_at = NOW() WHERE id = $2`, [v.phone_secondary, checkoutGroupId]);
    changed.push('phone_secondary');
  }
  return { changed };
}

// ── GET /api/production/orders/:id/edit-context ─────────────────────────────
async function editContext(req, res) {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'طلب غير صحيح', code: 'ERR_VALIDATION' });
  const o = await query(
    `SELECT o.id, o.student_id, o.design_id, o.checkout_group_id, o.product_id,
            o.status::text AS status, o.price, o.cost, o.measurements, o.has_embroidery,
            o.needs_pressing, o.tailor_status::text AS tailor_status,
            p.type::text AS product_type, p.name_ar AS product_name, p.parent_id AS product_parent_id
       FROM orders o
       JOIN products p ON p.id = o.product_id
      WHERE o.id = $1`,
    [id]
  );
  if (!o.rows.length) return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  const order = o.rows[0];
  const student = await loadStudent(order.student_id);
  if (!student) return res.status(404).json({ error: 'الطالب غير موجود', code: 'ERR_NOT_FOUND' });
  const canEdit = !order.design_id && eligibleForFullSet(student);
  const existing = canEdit ? await readFullSetOrder(student.id) : null;
  let group = null;
  if (order.checkout_group_id) {
    const g = await query(
      `SELECT id, customer_name, instagram_username, phone_primary, phone_secondary, notes
         FROM checkout_groups WHERE id = $1`,
      [order.checkout_group_id]
    );
    group = g.rows[0] || null;
  }
  // Full saved retail selection snapshot. The old response exposed only typed lines, which
  // made measurements, cap shape, normal/royal options and image-only rows impossible to edit.
  //
  // FIX (2026-07-20): this used to also require `COALESCE(price_snapshot,0) = 0`, meant as
  // "never touch price rows". That conflated a line CARRYING a price with editing CHANGING
  // one — and since the update below only ever writes `customer_text`, the price is untouchable
  // either way. The filter silently hid 208 lines across 166 live retail orders — precisely the
  // embroidery texts staff need to correct («القبعة من الجانب» ٩٧، «تطريز ردن الروب» ٥٩، …),
  // because those options cost money. Money stays safe because the UPDATE writes ONLY
  // `customer_text` — never price_snapshot — and is scoped by `order_id`.
  //
  // NB `customer_text IS NOT NULL` is NOT a "free text only" filter: some option/selection
  // rows also carry it (نوع الوشاح، نوع القبعة، لون التطريز، كسرة الكتف — see fullSetOrder.js).
  // Those have always been price-0 and so were always editable here. One consequence worth
  // knowing: readFullSetOrder derives sash_type/cap_type from those values, so retyping
  // «نوع الوشاح» to «ملكي» re-prices the bundle on the NEXT full-form save (not here).
  const editable = await query(
    `SELECT id, group_id, option_id, label_snapshot AS label, qty,
            customer_text AS text, customer_image_url
       FROM order_items
      WHERE order_id = $1
      ORDER BY id`,
    [order.id]
  );
  const qtyResult = await query(
    `SELECT COALESCE((
       SELECT GREATEST(qty, 1)
         FROM order_items
        WHERE order_id = $1 AND group_id IS NULL AND option_id IS NULL
        ORDER BY created_at, id
        LIMIT 1
     ), 1)::int AS quantity`,
    [order.id]
  );
  const editMode = canEdit
    ? 'full_set'
    : (student.wholesaler_id == null && student.phone != null ? 'retail' : 'limited');
  // Swap targets are offered ONLY on the retail snapshot, and only while no Fabric design is
  // attached (a design belongs to the product it was drawn on).
  const swaps = editMode === 'retail' && !order.design_id
    ? await swapCandidates({
      productId: order.product_id,
      parentId: order.product_parent_id,
      productType: order.product_type,
      gender: student.gender,
      studentId: order.student_id,
      orderId: order.id,
    })
    : [];
  res.json({
    data: {
      student: {
        id: student.id,
        name: student.name,
        phone: student.phone,
        gender: student.gender,
        instagram_username: student.instagram_username,
        university_name: student.university_name,
        department: student.department,
        study_type: student.study_type,
        wholesaler_id: student.wholesaler_id,
        rep_name: student.rep_name,
      },
      group,
      existing,
      pricing: await publicPricing(student.wholesaler_id),
      can_edit_full_set: canEdit,
      edit_mode: editMode,
      editable_items: editable.rows.filter((it) => it.text != null),
      retail_order: editMode === 'retail' ? {
        id: order.id,
        product_id: order.product_id,
        product_type: order.product_type,
        product_name: order.product_name,
        product_parent_id: order.product_parent_id,
        swap_candidates: swaps,
        status: order.status,
        // Whether «أرجع الطلب إلى بانتظار التصميم» is meaningful here is a state-machine
        // question, so it is answered HERE and never re-derived in the UI — a frontend copy
        // of this set is how ghost buttons that 409 get built.
        can_force_rework: REWORKABLE_STAGES.has(order.status),
        price: Number(order.price || 0),
        cost: Number(order.cost || 0),
        measurements: order.measurements,
        has_embroidery: !!order.has_embroidery,
        needs_pressing: !!order.needs_pressing,
        tailor_status: order.tailor_status,
        quantity: Number(qtyResult.rows[0]?.quantity || 1),
        selections: editable.rows
          .filter((it) => it.group_id != null && it.option_id != null)
          .map((it) => ({
            group_id: it.group_id,
            option_id: it.option_id,
            qty: Number(it.qty || 1),
            customer_text: it.text,
            customer_image_url: it.customer_image_url,
          })),
      } : null,
    },
  });
}

function normalizeRetailMeasurements(productType, raw) {
  if (productType !== 'robe') return null;
  const m = raw || {};
  const chest = m.chest_cm == null || m.chest_cm === '' ? null : Number(m.chest_cm);
  return {
    shoulder_cm: Number(m.shoulder_cm),
    chest_cm: Number.isFinite(chest) && chest > 0 ? chest : null,
    robe_length_cm: Number(m.robe_length_cm),
    sleeve_length_cm: Number(m.sleeve_length_cm),
    tailor_notes: clean(m.tailor_notes, 500),
    receipt_image_url: clean(m.receipt_image_url, 1000),
  };
}

function comparableSelections(lines) {
  return lines
    .filter((line) => line.group_id && line.option_id)
    .map((line) => ({
      group_id: String(line.group_id),
      option_id: String(line.option_id),
      qty: Number(line.qty || 1),
      customer_text: clean(line.customer_text, 200),
      customer_image_url: clean(line.customer_image_url, 1000),
    }))
    .sort((a, b) =>
      `${a.group_id}:${a.option_id}`.localeCompare(`${b.group_id}:${b.option_id}`)
    );
}

function comparableStoredSelections(lines, orderQuantity) {
  const multiplier = Math.max(1, Number(orderQuantity) || 1);
  return comparableSelections(lines.map((line) => ({
    ...line,
    // Cart checkout stores line quantities multiplied by the number of identical
    // pieces. priceSelections() returns the per-piece selection, so normalize the
    // saved value or an unchanged ×2 order would look edited.
    qty: Number(line.qty || 1) / multiplier,
  })));
}

const DESIGN_PASSED_STAGES = new Set([
  'converting', 'embroidery', 'assembly', 'pressing', 'preparing', 'ready', 'delivered',
]);
// Stages from which an EXPLICIT «أرجع الطلب إلى بانتظار التصميم» is meaningful. Includes
// design_complete itself (there the rework is a reset: zones + artwork cleared, shelf slot
// released) but never the pre-design stages, where forcing it would push the piece FORWARD.
const REWORKABLE_STAGES = new Set([...DESIGN_PASSED_STAGES, 'design_complete']);

// ── PUT /api/production/orders/:id/retail-configuration ─────────────────────
// Full structured editor for independent retail pieces. Product/design identity and recorded
// production cost stay immutable; selections are authoritatively re-priced at the retail role.
async function saveRetailConfiguration(req, res) {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'طلب غير صحيح', code: 'ERR_VALIDATION' });

  const current = await query(
    `SELECT o.id, o.student_id, o.product_id, o.design_id, o.checkout_group_id,
            o.status::text AS status,
            o.price, o.cost, o.measurements, o.has_embroidery, o.needs_pressing,
            o.tailor_status::text AS tailor_status,
            s.user_id, s.gender::text AS gender, s.wholesaler_id, u.phone, u.name,
            p.type::text AS product_type, p.parent_id AS product_parent_id,
            p.name_ar AS product_name
       FROM orders o
       JOIN students s ON s.id = o.student_id
       JOIN users u ON u.id = s.user_id
       JOIN products p ON p.id = o.product_id
      WHERE o.id = $1`,
    [id]
  );
  if (!current.rows.length) {
    return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  }
  const order = current.rows[0];
  if (order.wholesaler_id != null || order.phone == null) {
    return res.status(403).json({ error: 'هذا المسار للطلبات المفردة فقط', code: 'ERR_FORBIDDEN' });
  }
  if (order.status === 'cancelled') {
    return res.status(409).json({ error: 'لا يمكن تعديل طلب ملغى', code: 'ERR_INVALID_STATE' });
  }

  const selections = Array.isArray(req.body?.selections) ? req.body.selections : [];
  if (selections.length > 50) {
    return res.status(400).json({ error: 'عدد كبير من الخيارات', code: 'ERR_VALIDATION' });
  }

  // ── Optional product swap ────────────────────────────────────────────────
  // Resolved BEFORE measurements are validated and before pricing, so every downstream
  // rule (robe measurements, needs_pressing, priceSelections) is applied against the
  // product the piece will actually become.
  const rawTarget = req.body?.product_id;
  const targetProductId = rawTarget == null || rawTarget === '' ? order.product_id : String(rawTarget);
  const productChanged = targetProductId !== order.product_id;
  let targetProduct = null;
  if (productChanged) {
    // A Fabric design belongs to the exact product it was drawn on — re-pointing it would
    // silently attach that artwork to a different garment shape.
    if (order.design_id) {
      return res.status(409).json({
        error: 'لا يمكن تبديل منتج طلب مرتبط بتصميم', code: 'ERR_INVALID_STATE',
      });
    }
    const resolved = await resolveSwapTarget({ targetProductId, current: order });
    if (resolved.error) {
      return res.status(resolved.error.status).json({
        error: resolved.error.message, code: resolved.error.code,
      });
    }
    // The student may already hold a live piece of the target product — swapping onto it
    // would collide with uq_orders_student_product_nodesign. Name the other order so the
    // admin can go and edit it instead.
    const clash = await liveOrderForProduct(order.student_id, targetProductId, id);
    if (clash) {
      return res.status(409).json({
        error: 'الطالب لديه طلب فعّال بهذا المنتج — لا يمكن التبديل إليه',
        code: 'ERR_DUPLICATE_PIECE',
        existing_order_id: clash,
      });
    }
    targetProduct = resolved.product;
  }
  const targetType = targetProduct ? targetProduct.type : order.product_type;
  const targetName = targetProduct ? targetProduct.name_ar : order.product_name;

  const measurementError = validateRobeMeasurements(targetType, req.body?.measurements);
  if (measurementError) {
    return res.status(400).json({ error: measurementError, code: 'ERR_VALIDATION' });
  }
  const infoPayload = { ...(req.body?.student || {}), ...(req.body?.group || {}) };
  const infoValidation = validateStudentInfo(infoPayload);
  if (infoValidation.error) {
    return res.status(400).json({ error: infoValidation.error, code: 'ERR_VALIDATION' });
  }

  // Authoritative re-price at the retail role against the TARGET product. priceSelections
  // re-checks active + gender + group ownership itself, so a swap can never smuggle in an
  // option that does not belong to the destination family.
  const priced = await priceSelections({
    productId: targetProductId,
    role: 'retail',
    selections,
    studentGender: order.gender,
  });
  if (!priced.ok) {
    return res.status(priced.status).json({ error: priced.error, code: priced.code });
  }

  const oldItemsResult = await query(
    `SELECT group_id, option_id, qty, customer_text, customer_image_url
       FROM order_items
      WHERE order_id = $1 AND group_id IS NOT NULL AND option_id IS NOT NULL
      ORDER BY id`,
    [id]
  );
  const qtyResult = await query(
    `SELECT COALESCE((
       SELECT GREATEST(qty, 1)
         FROM order_items
        WHERE order_id = $1 AND group_id IS NULL AND option_id IS NULL
        ORDER BY created_at, id
        LIMIT 1
     ), 1)::int AS quantity`,
    [id]
  );
  const orderQuantity = Number(qtyResult.rows[0]?.quantity || 1);
  const beforeSelections = comparableStoredSelections(oldItemsResult.rows, orderQuantity);
  const afterSelections = comparableSelections(priced.items);
  const selectionsChanged = JSON.stringify(beforeSelections) !== JSON.stringify(afterSelections);
  const beforeMeasurements = normalizeRetailMeasurements(targetType, order.measurements);
  const afterMeasurements = normalizeRetailMeasurements(targetType, req.body?.measurements);
  const measurementsChanged = JSON.stringify(beforeMeasurements) !== JSON.stringify(afterMeasurements);

  // A SAME-FAMILY SWAP ALONE NEVER FORCES REWORK. The selections are byte-identical
  // (same group/option ids), so ticked embroidery zones and the approved artwork stay
  // meaningful — only the base garment changed. The admin may still ask for rework
  // explicitly («أرجع الطلب إلى بانتظار التصميم»), which reuses this exact branch.
  const forceRework = req.body?.force_design_rework === true;
  const autoRework =
    priced.hasEmbroidery && selectionsChanged && DESIGN_PASSED_STAGES.has(order.status);
  const designRework = autoRework || (forceRework && REWORKABLE_STAGES.has(order.status));
  const tailorReopened =
    targetType === 'robe' && measurementsChanged && order.tailor_status === 'done';
  const resultingStatus = designRework ? 'design_complete' : order.status;
  const keepPrice = req.body?.keep_price === true;
  const newPrice = Number(priced.total || 0) * orderQuantity;
  const oldPrice = Number(order.price || 0);
  // Money never moves silently: the caller is told the recomputed price either way, and
  // `keep_price` is what decides whether it is actually written.
  const appliedPrice = keepPrice ? oldPrice : newPrice;
  const recordedCost = Number(order.cost || 0);

  let studentInfoChanged = [];
  await tx(async (client) => {
    const locked = await client.query(
      `SELECT status::text AS status, price, product_id FROM orders WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!locked.rows.length) {
      const e = new Error('الطلب غير موجود');
      e.statusCode = 404;
      throw e;
    }
    if (locked.rows[0].status === 'cancelled') {
      const e = new Error('لا يمكن تعديل طلب ملغى');
      e.statusCode = 409;
      throw e;
    }
    if (
      locked.rows[0].status !== order.status ||
      Number(locked.rows[0].price || 0) !== oldPrice ||
      String(locked.rows[0].product_id) !== String(order.product_id)
    ) {
      const e = new Error('تم تحديث الطلب أثناء التعديل — أعد تحميل الصفحة ثم حاول مجدداً');
      e.statusCode = 409;
      throw e;
    }

    // ── KEYED RECONCILIATION of order_items (was: DELETE-ALL + re-INSERT) ──────
    // calligraphy_plates.order_item_id is ON DELETE SET NULL and there is NO relink path
    // (calligraphyController joins plates to orders THROUGH order_item_id), so wiping the
    // rows silently orphaned every generated plate — unrecoverably — on EVERY save.
    // Matching on (group_id, option_id) and updating in place keeps order_items.id stable,
    // so plate links survive an edit and, because a same-family swap keeps identical
    // group/option ids, they survive a product swap too.
    const existingItems = await client.query(
      `SELECT id, group_id, option_id FROM order_items
        WHERE order_id = $1 ORDER BY created_at, id`,
      [id]
    );
    const lineKey = (g, o) => `${g || ''}|${o || ''}`;
    const byKey = new Map();
    for (const row of existingItems.rows) {
      // First row wins per key — the base line is the FIRST (group NULL, option NULL) row,
      // the same rule the quantity probe above uses. Any further duplicate is surplus.
      const k = lineKey(row.group_id, row.option_id);
      if (!byKey.has(k)) byKey.set(k, row.id);
    }
    const keptIds = [];
    for (const item of priced.items) {
      const values = [
        item.label,
        Number(item.price || 0) * orderQuantity,
        Number(item.qty || 1) * orderQuantity,
        clean(item.customer_image_url, 1000),
        clean(item.customer_text, 200),
      ];
      const matchId = byKey.get(lineKey(item.group_id, item.option_id));
      if (matchId) {
        await client.query(
          `UPDATE order_items
              SET label_snapshot = $1, price_snapshot = $2, admin_price_snapshot = 0,
                  qty = $3, customer_image_url = $4, customer_text = $5
            WHERE id = $6`,
          [...values, matchId]
        );
        keptIds.push(matchId);
      } else {
        const ins = await client.query(
          `INSERT INTO order_items
             (order_id, group_id, option_id, label_snapshot, price_snapshot,
              admin_price_snapshot, qty, customer_image_url, customer_text)
           VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8) RETURNING id`,
          [id, item.group_id || null, item.option_id || null, ...values]
        );
        keptIds.push(ins.rows[0].id);
      }
    }
    // Only genuinely removed selections (and surplus duplicate keys) are deleted.
    await client.query(
      `DELETE FROM order_items WHERE order_id = $1 AND NOT (id = ANY($2::uuid[]))`,
      [id, keptIds]
    );

    await client.query(
      `UPDATE orders
          SET price = $1,
              status = $2,
              measurements = $3::jsonb,
              has_embroidery = $4,
              needs_pressing = $5,
              embroidery_zones = CASE WHEN $6 THEN '{}'::jsonb ELSE embroidery_zones END,
              final_design_url = CASE WHEN $6 THEN NULL ELSE final_design_url END,
              tailor_status = CASE WHEN $7 THEN 'pending'::tailor_track_status ELSE tailor_status END,
              tailor_done_at = CASE WHEN $7 THEN NULL ELSE tailor_done_at END,
              tailor_done_by = CASE WHEN $7 THEN NULL ELSE tailor_done_by END,
              product_id = $8
        WHERE id = $9`,
      [
        appliedPrice,
        resultingStatus,
        afterMeasurements == null ? null : JSON.stringify(afterMeasurements),
        !!priced.hasEmbroidery,
        targetType !== 'cap',
        designRework,
        tailorReopened,
        targetProductId,
        id,
      ]
    );
    if (designRework) await releaseForOrder(id, client);
    const infoResult = await applyStudentInfo(
      {
        id: order.student_id,
        user_id: order.user_id,
        name: order.name,
      },
      infoPayload,
      order.checkout_group_id,
      (sql, params) => client.query(sql, params)
    );
    if (infoResult.error) {
      const e = new Error(infoResult.error);
      e.statusCode = 400;
      throw e;
    }
    studentInfoChanged = infoResult.changed || [];

    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'staff_order_edit', 'order', $2, $3::jsonb)`,
      [
        req.user.id,
        id,
        JSON.stringify({
          via: 'retail_configuration',
          product_id: targetProductId,
          product_id_before: order.product_id,
          product_id_after: targetProductId,
          product_name_before: order.product_name,
          product_name_after: targetName,
          product_swapped: productChanged,
          selections_before: beforeSelections,
          selections_after: afterSelections,
          measurements_before: beforeMeasurements,
          measurements_after: afterMeasurements,
          price_before: oldPrice,
          price_after: appliedPrice,
          price_computed: newPrice,
          price_kept: keepPrice,
          cost_preserved: recordedCost,
          profit_before: oldPrice - recordedCost,
          profit_after: appliedPrice - recordedCost,
          status_before: order.status,
          status_after: resultingStatus,
          design_rework: designRework,
          design_rework_forced: forceRework,
          tailor_reopened: tailorReopened,
          student_info_fields: studentInfoChanged,
        }),
      ]
    );
  }).catch((err) => {
    if (err.statusCode) {
      res.status(err.statusCode).json({
        error: err.message,
        code: err.statusCode === 404 ? 'ERR_NOT_FOUND' : 'ERR_INVALID_STATE',
      });
      return null;
    }
    // Race backstop for the pre-check above: another save could have taken the target
    // product between the lookup and this write.
    if (isUniqueViolation(err)) {
      res.status(409).json({
        error: 'الطالب لديه طلب فعّال بهذا المنتج — لا يمكن التبديل إليه',
        code: 'ERR_DUPLICATE_PIECE',
      });
      return null;
    }
    throw err;
  });
  if (res.headersSent) return;

  publish({ type: 'order', orderId: id, status: resultingStatus });
  res.json({
    data: {
      id,
      old_price: oldPrice,
      new_price: newPrice,
      price_difference: newPrice - oldPrice,
      // What was actually written to orders.price — equals old_price when keep_price was set.
      price_applied: appliedPrice,
      price_kept: keepPrice,
      cost: recordedCost,
      profit: appliedPrice - recordedCost,
      product_changed: productChanged,
      product_id: targetProductId,
      product_name: targetName,
      status: resultingStatus,
      design_rework: designRework,
      tailor_reopened: tailorReopened,
      quantity: orderQuantity,
      selections: afterSelections,
      measurements: afterMeasurements,
    },
  });
}

// ── POST /api/production/students/:studentId/full-set-order ──────────────────
// Body = the rep form payload (+ optional student_info {name, instagram_username,
// phone_primary, phone_secondary}). Saves through persistFullSetOrder then restores the
// bundle's approval state (see above).
async function saveFullSetOrder(req, res) {
  const student = await loadStudent(req.params.studentId);
  if (!student) return res.status(404).json({ error: 'الطالب غير موجود', code: 'ERR_NOT_FOUND' });
  if (!eligibleForFullSet(student)) {
    return res.status(403).json({ error: 'لا يمكن تعديل طلب تجزئة من هنا', code: 'ERR_FORBIDDEN' });
  }

  const prev = await captureApproval(student.id);
  const prevContact = await captureGroupPhone(prev);
  const info = req.body?.student_info || {};

  // Validate the WHOLE student_info block before persistFullSetOrder commits. Validating
  // only at the post-persist write meant an invalid field returned 400 after the طقم had
  // already been saved and the approval restored — with the audit row skipped entirely.
  const preValidated = validateStudentInfo(info);
  if (preValidated.error) return res.status(400).json({ error: preValidated.error, code: 'ERR_VALIDATION' });

  // The name update lands BEFORE the save so persist writes the fresh customer_name
  // into the checkout_group itself.
  const pre = Object.prototype.hasOwnProperty.call(info, 'name') ? { name: info.name } : {};
  const infoResult = await applyStudentInfo(student, pre, null);
  if (infoResult.error) return res.status(400).json({ error: infoResult.error, code: 'ERR_VALIDATION' });

  // FIX #2 (2026-07-17): approval preservation is now threaded INTO persistFullSetOrder
  // so the restore happens atomically, in the SAME transaction as the piece writes — no
  // more post-commit restoreApproval() call, so a crash/Neon drop right after persist's
  // commit can no longer leave an approved bundle stuck at 'pending'. Compute the exact
  // SAME target restoreApproval used to (prior state if one existed, else auto-approved
  // for rep-linked students / NULL for an independent admin edit).
  const isRepLinked = student.wholesaler_id != null;
  const approvalTarget = prev.exists ? prev.state : (isRepLinked ? 'approved' : null);
  const approvalParam = {
    state: approvalTarget,
    approved_at: prev.exists ? prev.wholesaler_approved_at : null,
    approved_by: (prev.exists && prev.wholesaler_approved_by) || req.user.id || null,
    reject_reason: prev.exists ? prev.wholesaler_reject_reason : null,
  };

  const { status, json } = await persistFullSetOrder({
    student: { id: student.id, name: student.name, phone: student.phone ?? '', wholesaler_id: student.wholesaler_id },
    body: req.body,
    actorUserId: req.user.id,
    approval: approvalParam,
  });
  if (status !== 201) return res.status(status).json(json);

  const cgId = json.data.checkout_group_id;
  const approval = approvalTarget;
  // Group-level fields (IG mirror + phones) exist only after the group does → after persist.
  const groupInfo = await applyStudentInfo(student,
    Object.fromEntries(Object.entries(info).filter(([k]) =>
      ['instagram_username', 'phone_primary', 'phone_secondary', 'university_name', 'department', 'study_type'].includes(k))),
    cgId);
  if (groupInfo.error) return res.status(400).json({ error: groupInfo.error, code: 'ERR_VALIDATION' });
  if (!Object.prototype.hasOwnProperty.call(info, 'phone_primary')) {
    await restoreGroupPhone({ checkoutGroupId: cgId, ...prevContact });
  }

  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'staff_order_edit', 'order', $2, $3::jsonb)`,
    [req.user.id, json.data.orders.sash || json.data.orders.robe || json.data.orders.cap,
     JSON.stringify({
       via: 'full_set_form', student_id: student.id, checkout_group_id: cgId,
       approval_restored: approval,
       student_info_fields: [...(infoResult.changed || []), ...(groupInfo.changed || [])],
     })]
  );
  res.status(201).json({ data: { ...json.data, wholesaler_approval: approval } });
}

// ── PATCH /api/production/orders/:id/details — per-piece quick edit ──────────
// items[] may only touch spec lines OF THIS ORDER that already carry typed content
// (customer_text IS NOT NULL) — never option selections or prices.
async function patchOrderDetails(req, res) {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'طلب غير صحيح', code: 'ERR_VALIDATION' });
  const o = await query(`SELECT id, student_id, checkout_group_id FROM orders WHERE id = $1`, [id]);
  if (!o.rows.length) return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  const order = o.rows[0];
  const student = await loadStudent(order.student_id);
  if (!student) return res.status(404).json({ error: 'الطالب غير موجود', code: 'ERR_NOT_FOUND' });

  // Owner decision (2026-07-17): the quick edit (student info + each piece's text) is allowed
  // for RETAIL orders too — this endpoint is already manager/admin-only (requireStaffType),
  // and admins need to fix a retail student's name/IG/phones + typed spec lines. Only the full
  // طقم re-price form (saveFullSetOrder) stays blocked for retail (it would re-price the cart).
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (items.length > 30) return res.status(400).json({ error: 'عدد كبير من التعديلات', code: 'ERR_VALIDATION' });
  for (const it of items) {
    if (!isUuid(it?.item_id) || !clean(it?.customer_text, 200)) {
      return res.status(400).json({ error: 'النص المعدَّل مطلوب', code: 'ERR_VALIDATION' });
    }
  }

  // Validate the student/group fields BEFORE opening the transaction, so an invalid value
  // can never leave the item texts committed alongside a 400.
  const infoPayload = { ...(req.body?.student || {}), ...(req.body?.group || {}) };
  const preValidated = validateStudentInfo(infoPayload);
  if (preValidated.error) return res.status(400).json({ error: preValidated.error, code: 'ERR_VALIDATION' });

  // Everything the request touches — item texts, student info, group notes and the audit
  // row — lands in ONE transaction: the quick edit is all-or-nothing.
  const changed = [];
  let infoChanged = [];
  const failed = await tx(async (client) => {
    const exec = (sql, params) => client.query(sql, params);
    for (const it of items) {
      // Only `customer_text` is ever written — price_snapshot/label_snapshot are untouched, so a
      // priced line's money cannot change. See the editContext note re: dropping the price filter.
      const r = await client.query(
        `UPDATE order_items SET customer_text = $1
          WHERE id = $2 AND order_id = $3 AND customer_text IS NOT NULL
          RETURNING label_snapshot`,
        [clean(it.customer_text, 200), it.item_id, id]
      );
      if (!r.rows.length) {
        const e = new Error('عنصر غير قابل للتعديل');
        e.statusCode = 400;
        throw e;
      }
      changed.push(r.rows[0].label_snapshot);
    }

    const infoResult = await applyStudentInfo(student, infoPayload, order.checkout_group_id, exec);
    if (infoResult.error) {
      const e = new Error(infoResult.error);
      e.statusCode = 400;
      throw e;
    }
    infoChanged = infoResult.changed;
    if (Object.prototype.hasOwnProperty.call(req.body?.group || {}, 'notes') && order.checkout_group_id) {
      await exec(`UPDATE checkout_groups SET notes = $1, updated_at = NOW() WHERE id = $2`,
        [clean(req.body.group.notes, 500), order.checkout_group_id]);
      infoChanged.push('notes');
    }

    await exec(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'staff_order_edit', 'order', $2, $3::jsonb)`,
      [req.user.id, id, JSON.stringify({ via: 'quick_edit', items_changed: changed, student_info_fields: infoChanged })]
    );
    return null;
  }).catch((err) => {
    if (err.statusCode === 400) return err.message;
    throw err;
  });
  if (failed) return res.status(400).json({ error: failed, code: 'ERR_VALIDATION' });

  res.json({ data: { ok: true, items_changed: changed.length, student_info_fields: infoChanged } });
}

// ── GET /api/production/students-search?q= ───────────────────────────────────
// Returns EVERY retail-role student and flags which form applies:
//   full_set_eligible = true  → rep-linked or admin-created name-only → the طقم form
//   full_set_eligible = false → self-registered تجزئة student → the retail-order form
//
// Until 2026-07-25 تجزئة students were HIDDEN here, which made «طلب مخصص» structurally
// impossible for them (invisible in search, 403 on every follow-up call). Hiding them was
// never the safety property — the 403 in getStudentFullSet/saveFullSetOrder is, and that
// guard is unchanged: the طقم form prices at REP prices and its deselect-cancel can cancel
// the student's cart pieces. Callers branch on this flag instead.
async function studentsSearch(req, res) {
  const raw = String(req.query.q || '').trim();
  if (raw.length < 2) return res.json({ data: [] });
  const q = `%${raw.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const { rows } = await query(
    `SELECT s.id, u.name, u.phone, s.university_name, s.wholesaler_id, wu.name AS rep_name,
            s.gender::text AS gender,
            (s.wholesaler_id IS NOT NULL OR u.phone IS NULL) AS full_set_eligible,
            EXISTS (SELECT 1 FROM orders o
                     WHERE o.student_id = s.id AND o.design_id IS NULL AND o.status <> 'cancelled') AS has_full_set
       FROM students s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN wholesalers w ON w.id = s.wholesaler_id
       LEFT JOIN users wu ON wu.id = w.user_id
      WHERE u.role = 'retail'
        AND (u.name ILIKE $1 OR s.full_name_third ILIKE $1 OR u.phone ILIKE $1)
      ORDER BY u.name ASC
      LIMIT 20`,
    [q]
  );
  res.json({ data: rows });
}

// ── GET /api/production/students/:studentId/full-set-order ───────────────────
// Read-back for the custom-order picker: seeds the form with the student's existing
// طقم so a save EDITS it (a blank form + the optional-everything upsert would wipe it).
async function getStudentFullSet(req, res) {
  const student = await loadStudent(req.params.studentId);
  if (!student) return res.status(404).json({ error: 'الطالب غير موجود', code: 'ERR_NOT_FOUND' });
  if (!eligibleForFullSet(student)) {
    return res.status(403).json({ error: 'لا يمكن تعديل طلب تجزئة من هنا', code: 'ERR_FORBIDDEN' });
  }
  res.json({
    data: {
      existing: await readFullSetOrder(student.id),
      pricing: await publicPricing(student.wholesaler_id),
    },
  });
}

// ── RETAIL ORDER CREATION — one bundle, N pieces ────────────────────────────
// «طلب مخصص» for a تجزئة student, whether they self-registered or the admin is creating
// them right now. The mirror image of saveFullSetOrder: this path is reachable ONLY when
// the طقم path is not, and vice-versa — the two guards are exact complements, so a student
// can never be served by both.
//
// Four rules make this safe where the طقم form is not:
//  1. priced authoritatively at the RETAIL role via priceSelections — never the rep addon table
//     (which would book a 20,000 sash against a 25,000–30,000 catalog piece);
//  2. ALWAYS a brand-new checkout_group — the student's existing orders / cart pieces are never
//     read, re-priced, cancelled or re-bound (the طقم upsert's deselect-cancel is what makes it
//     unsafe here);
//  3. wholesaler_approval = NULL — a direct admin order never enters the rep approval flow
//     (same as adminCustomOrderController's independent-student branch);
//  4. every write — the student, the bundle, every piece — commits in ONE transaction, so a
//     half-created student with no order, or 2 of 3 pieces, can never be left behind.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PIECES = 10;
const GENDERS = new Set(['male', 'female']);
const STUDY_TYPES = new Set(['morning', 'evening']);

// Validate + price every requested piece against the DB. Nothing here trusts the payload:
// product identity, activity, audience and price all come from a fresh read, because the
// catalog shape on prod is not what the client (or this laptop's snapshot) says it is.
// `studentId` is null when the student is being created in this same request — there is
// nothing to collide with yet, so the duplicate probe is skipped.
async function resolveRetailPieces({ rawPieces, studentId, gender }) {
  const err = (status, message, code, extra) => ({ error: { status, message, code, ...extra } });

  if (!Array.isArray(rawPieces) || rawPieces.length === 0) {
    return err(400, 'اختر قطعة واحدة على الأقل', 'ERR_VALIDATION');
  }
  if (rawPieces.length > MAX_PIECES) {
    return err(400, `لا يمكن إضافة أكثر من ${MAX_PIECES} قطع في طلب واحد`, 'ERR_VALIDATION');
  }

  const seen = new Set();
  const pieces = [];
  for (const raw of rawPieces) {
    const productId = raw?.product_id;
    if (!productId) return err(400, 'المنتج مطلوب', 'ERR_VALIDATION');
    if (!isUuid(productId)) return err(400, 'منتج غير صحيح', 'ERR_VALIDATION');
    // Two pieces of the same product in ONE payload would each pass the DB probe below and
    // then collide with uq_orders_student_product_nodesign mid-transaction. Name it up front.
    if (seen.has(productId)) {
      return err(400, 'لا يمكن إضافة نفس المنتج مرتين في الطلب نفسه', 'ERR_DUPLICATE_PIECE');
    }
    seen.add(productId);

    const selections = Array.isArray(raw?.selections) ? raw.selections : [];
    if (selections.length > 50) return err(400, 'عدد كبير من الخيارات', 'ERR_VALIDATION');

    const prod = await query(
      `SELECT id, name_ar, type::text AS type, active, wholesaler_only
         FROM products WHERE id = $1`,
      [productId]
    );
    if (!prod.rows.length || !prod.rows[0].active) {
      return err(404, 'المنتج غير موجود', 'ERR_NOT_FOUND');
    }
    const product = prod.rows[0];
    if (product.wholesaler_only) {
      return err(403, 'هذا المنتج مخصص للممثلين فقط', 'ERR_FORBIDDEN');
    }

    const measurementError = validateRobeMeasurements(product.type, raw?.measurements);
    if (measurementError) return err(400, measurementError, 'ERR_VALIDATION');

    // A second live piece of the same product for the same student is a DB-level
    // impossibility (see liveOrderForProduct). Refuse it by name and hand back the order to
    // edit instead — the honest answer, since this path deliberately never touches existing
    // orders.
    if (studentId) {
      const clash = await liveOrderForProduct(studentId, productId);
      if (clash) {
        return err(
          409,
          `الطالب لديه طلب فعّال بـ«${product.name_ar}» — عدّل الطلب الحالي بدل إنشاء طلب جديد`,
          'ERR_DUPLICATE_PIECE',
          { existing_order_id: clash }
        );
      }
    }

    const priced = await priceSelections({
      productId, role: 'retail', selections, studentGender: gender,
    });
    if (!priced.ok) return err(priced.status, priced.error, priced.code);

    pieces.push({
      product,
      priced,
      // Routing copied verbatim from the retail creation path in orderController.configureOrder:
      // المكوجي gets every piece except caps; a plain cap goes straight to التجهيز.
      needsPressing: product.type !== 'cap',
      status: priced.hasEmbroidery
        ? 'design_complete'
        : (product.type === 'cap' ? 'preparing' : 'pressing'),
      total: Number(priced.total || 0),
      measurementsJson: product.type === 'robe' && raw?.measurements
        ? JSON.stringify(normalizeRetailMeasurements(product.type, raw.measurements))
        : null,
    });
  }
  return { pieces };
}

// The single write. Runs INSIDE a caller-supplied transaction so student creation (when the
// caller is making one) commits with the pieces or not at all.
async function writeRetailBundle(client, { student, pieces, group, actorId }) {
  const g = group || {};
  const cg = await client.query(
    `INSERT INTO checkout_groups
       (customer_name, instagram_username, phone_primary, phone_secondary,
        governorate, area_details, event_date, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      clean(g.customer_name, 120) || student.name,
      clean(String(g.instagram_username ?? student.instagram_username ?? '').replace(/^@+/, ''), 100),
      clean(g.phone_primary, 20) || student.phone || '',
      clean(g.phone_secondary, 20),
      clean(g.governorate, 120),
      clean(g.area_details, 300),
      clean(g.event_date, 10),
      clean(g.notes, 500),
    ]
  );
  const cgId = cg.rows[0].id;

  const orders = [];
  for (const piece of pieces) {
    const o = await client.query(
      `INSERT INTO orders
         (student_id, product_id, checkout_group_id, price, status,
          has_embroidery, needs_pressing, measurements, wholesaler_approval)
       VALUES ($1,$2,$3,$4,$5::order_status,$6,$7,$8::jsonb,NULL) RETURNING id`,
      [student.id, piece.product.id, cgId, piece.total, piece.status,
        !!piece.priced.hasEmbroidery, piece.needsPressing, piece.measurementsJson]
    );
    const orderId = o.rows[0].id;
    for (const it of piece.priced.items) {
      await client.query(
        `INSERT INTO order_items
           (order_id, group_id, option_id, label_snapshot, price_snapshot,
            admin_price_snapshot, qty, customer_image_url, customer_text)
         VALUES ($1,$2,$3,$4,$5,0,$6,$7,$8)`,
        [orderId, it.group_id || null, it.option_id || null, it.label,
          Number(it.price || 0), Number(it.qty || 1),
          clean(it.customer_image_url, 1000), clean(it.customer_text, 200)]
      );
    }
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'staff_retail_order_create', 'order', $2, $3::jsonb)`,
      [actorId, orderId, JSON.stringify({
        via: 'retail_custom_order',
        student_id: student.id,
        checkout_group_id: cgId,
        product_id: piece.product.id,
        product_name: piece.product.name_ar,
        price: piece.total,
        status: piece.status,
        has_embroidery: !!piece.priced.hasEmbroidery,
        piece_count: pieces.length,
        selections: comparableSelections(piece.priced.items),
      })]
    );
    orders.push({
      id: orderId,
      product_id: piece.product.id,
      product_name: piece.product.name_ar,
      price: piece.total,
      status: piece.status,
    });
  }
  return { cgId, orders };
}

const duplicatePieceRace = (res) =>
  res.status(409).json({
    error: 'الطالب لديه طلب فعّال بأحد هذه المنتجات — أعد تحميل الصفحة ثم حاول مجدداً',
    code: 'ERR_DUPLICATE_PIECE',
  });

// ── POST /api/production/students/:studentId/retail-order ───────────────────
// Single-piece adapter kept for the existing caller. It is a thin mapping onto the same core
// as the multi-piece endpoint — one write path, not two.
async function createRetailOrder(req, res) {
  const student = await loadStudent(req.params.studentId);
  if (!student) return res.status(404).json({ error: 'الطالب غير موجود', code: 'ERR_NOT_FOUND' });
  // EXACT mirror of eligibleForFullSet — self-registered retail only.
  if (eligibleForFullSet(student)) {
    return res.status(403).json({ error: 'هذا المسار لطلاب التجزئة فقط', code: 'ERR_FORBIDDEN' });
  }

  const g = req.body?.group || {};
  const eventDate = clean(g.event_date, 10);
  if (eventDate && !DATE_ONLY.test(eventDate)) {
    return res.status(400).json({ error: 'تاريخ الحفلة غير صحيح', code: 'ERR_VALIDATION' });
  }

  const resolved = await resolveRetailPieces({
    rawPieces: [{
      product_id: req.body?.product_id,
      selections: req.body?.selections,
      measurements: req.body?.measurements,
    }],
    studentId: student.id,
    gender: student.gender,
  });
  if (resolved.error) {
    const { status, message, code, ...extra } = resolved.error;
    return res.status(status).json({ error: message, code, ...extra });
  }

  const created = await tx((client) =>
    writeRetailBundle(client, {
      student, pieces: resolved.pieces, group: req.body?.group, actorId: req.user.id,
    })
  ).catch((err) => {
    // Race backstop for the pre-check above.
    if (isUniqueViolation(err)) return duplicatePieceRace(res), null;
    throw err;
  });
  if (res.headersSent) return;

  const order = created.orders[0];
  publish({ type: 'order_new', orderId: order.id });
  res.status(201).json({
    data: {
      order_id: order.id,
      checkout_group_id: created.cgId,
      price: order.price,
      status: order.status,
    },
  });
}

// Validate the «student» block of a multi-piece create. Name, phone and gender are REQUIRED
// and each is load-bearing:
//  · phone flips eligibleForFullSet to false, so this student's orders are owned by the retail
//    edit path for life. Without it the طقم editor would re-price them rep-style on the next
//    edit — the write-paths-out-of-sync money bug (2026-07-16).
//  · gender decides which option groups exist: priceSelections REJECTS a gender-restricted
//    option when studentGender is null, so a null-gender student cannot be priced correctly.
function validateNewStudent(raw) {
  const name = String(raw?.name || '').trim();
  if (!name) return { error: { status: 400, message: 'اسم الطالب مطلوب', code: 'ERR_VALIDATION', field: 'name' } };
  if (name.length > 120) {
    return { error: { status: 400, message: 'اسم الطالب طويل جداً', code: 'ERR_VALIDATION', field: 'name' } };
  }

  const phone = normalizeIqPhone(raw?.phone);
  if (!phone) {
    return { error: { status: 400, message: 'رقم الهاتف مطلوب', code: 'ERR_VALIDATION', field: 'phone' } };
  }
  if (!isValidIqMobile(phone)) {
    return {
      error: {
        status: 400, code: 'ERR_VALIDATION', field: 'phone',
        message: 'رقم الهاتف غير صحيح — يجب أن يبدأ بـ 07 ويتكوّن من 11 رقماً',
      },
    };
  }

  const gender = String(raw?.gender || '').trim();
  if (!GENDERS.has(gender)) {
    return { error: { status: 400, message: 'جنس الطالب مطلوب', code: 'ERR_VALIDATION', field: 'gender' } };
  }

  const studyType = clean(raw?.study_type, 20);
  if (studyType && !STUDY_TYPES.has(studyType)) {
    return { error: { status: 400, message: 'نوع الدراسة غير صحيح', code: 'ERR_VALIDATION', field: 'study_type' } };
  }

  return {
    student: {
      name,
      phone,
      gender,
      study_type: studyType,
      instagram_username: clean(String(raw?.instagram_username ?? '').replace(/^@+/, ''), 100),
      university_name: clean(raw?.university_name, 120),
      department: clean(raw?.department, 120),
    },
  };
}

// ── POST /api/production/retail-orders ──────────────────────────────────────
// «طلب مخصص» for a تجزئة student — either an existing one (`student_id`) or one created here
// (`student`). One bundle, up to MAX_PIECES pieces, every piece priced at the retail book.
async function createRetailOrders(req, res) {
  const body = req.body || {};
  const wantsNewStudent = !body.student_id;

  const eventDate = clean(body.group?.event_date, 10);
  if (eventDate && !DATE_ONLY.test(eventDate)) {
    return res.status(400).json({ error: 'تاريخ الحفلة غير صحيح', code: 'ERR_VALIDATION' });
  }

  // ── Existing student ──────────────────────────────────────────────────────
  if (!wantsNewStudent) {
    const student = await loadStudent(String(body.student_id));
    if (!student) return res.status(404).json({ error: 'الطالب غير موجود', code: 'ERR_NOT_FOUND' });
    if (eligibleForFullSet(student)) {
      return res.status(403).json({ error: 'هذا المسار لطلاب التجزئة فقط', code: 'ERR_FORBIDDEN' });
    }
    const resolved = await resolveRetailPieces({
      rawPieces: body.pieces, studentId: student.id, gender: student.gender,
    });
    if (resolved.error) {
      const { status, message, code, ...extra } = resolved.error;
      return res.status(status).json({ error: message, code, ...extra });
    }
    const created = await tx((client) =>
      writeRetailBundle(client, {
        student, pieces: resolved.pieces, group: body.group, actorId: req.user.id,
      })
    ).catch((err) => {
      if (isUniqueViolation(err)) return duplicatePieceRace(res), null;
      throw err;
    });
    if (res.headersSent) return;
    return respondRetailBundle(res, student.id, created);
  }

  // ── New independent student ───────────────────────────────────────────────
  const validated = validateNewStudent(body.student);
  if (validated.error) {
    const { status, message, code, ...extra } = validated.error;
    return res.status(status).json({ error: message, code, ...extra });
  }
  const info = validated.student;

  // users.phone is UNIQUE. Refuse by name and hand back the existing student so the admin
  // switches to «طالب موجود» — silently attaching an order to whoever already owns the number
  // would bind it to the wrong human.
  const taken = await query(
    `SELECT u.id AS user_id, u.name, u.role::text AS role, s.id AS student_id
       FROM users u LEFT JOIN students s ON s.user_id = u.id
      WHERE u.phone = $1`,
    [info.phone]
  );
  if (taken.rows.length) {
    const owner = taken.rows[0];
    return res.status(409).json({
      error: owner.student_id
        ? `هذا الرقم مسجّل باسم «${owner.name}» — اختره من «طالب موجود» بدل إنشاء حساب جديد`
        : `هذا الرقم مسجّل لحساب آخر (${owner.name}) — استخدم رقماً غير مستخدم`,
      code: 'ERR_PHONE_TAKEN',
      student_id: owner.student_id || null,
    });
  }

  // Priced BEFORE the transaction opens: a rejected option must not leave a created user
  // behind, and pricing is read-only.
  const resolved = await resolveRetailPieces({
    rawPieces: body.pieces, studentId: null, gender: info.gender,
  });
  if (resolved.error) {
    const { status, message, code, ...extra } = resolved.error;
    return res.status(status).json({ error: message, code, ...extra });
  }

  const passwordHash = await bcrypt.hash(crypto.randomUUID(), SALT_ROUNDS);
  const created = await tx(async (client) => {
    const u = await client.query(
      `INSERT INTO users (name, phone, email, password_hash, role)
       VALUES ($1, $2, NULL, $3, 'retail') RETURNING id`,
      [info.name, info.phone, passwordHash]
    );
    const s = await client.query(
      `INSERT INTO students
         (user_id, wholesaler_id, full_name_third, university_name, department,
          gender, study_type, instagram_username, status)
       VALUES ($1, NULL, $2, $3, $4, $5::gender, $6::study_type, $7, 'approved')
       RETURNING id`,
      [u.rows[0].id, info.name, info.university_name, info.department,
        info.gender, info.study_type, info.instagram_username]
    );
    const student = {
      id: s.rows[0].id,
      name: info.name,
      phone: info.phone,
      instagram_username: info.instagram_username,
    };
    const bundle = await writeRetailBundle(client, {
      student, pieces: resolved.pieces, group: body.group, actorId: req.user.id,
    });
    return { ...bundle, studentId: student.id };
  }).catch((err) => {
    // The phone probe above and this INSERT are not atomic.
    if (isUniqueViolation(err) && String(err.constraint || '').includes('phone')) {
      res.status(409).json({
        error: 'هذا الرقم سُجّل للتو من مكان آخر — أعد تحميل الصفحة ثم حاول مجدداً',
        code: 'ERR_PHONE_TAKEN',
      });
      return null;
    }
    if (isUniqueViolation(err)) return duplicatePieceRace(res), null;
    throw err;
  });
  if (res.headersSent) return;

  return respondRetailBundle(res, created.studentId, created);
}

function respondRetailBundle(res, studentId, created) {
  for (const o of created.orders) publish({ type: 'order_new', orderId: o.id });
  return res.status(201).json({
    data: {
      student_id: studentId,
      checkout_group_id: created.cgId,
      orders: created.orders,
      total: created.orders.reduce((sum, o) => sum + Number(o.price || 0), 0),
    },
  });
}

// Reference-photo upload for the edit form (multer runs in the route).
async function uploadImage(req, res) {
  if (!req.file) return res.status(400).json({ error: 'الملف مطلوب', code: 'ERR_VALIDATION' });
  res.json({ data: { url: publicUrl(req, 'images', req.file.filename) } });
}

module.exports = {
  editContext, saveFullSetOrder, saveRetailConfiguration, patchOrderDetails,
  studentsSearch, getStudentFullSet, createRetailOrder, createRetailOrders, uploadImage,
  // shared with adminCustomOrderController (existing-student mode)
  loadStudent, eligibleForFullSet, captureApproval, restoreApproval,
  captureGroupPhone, restoreGroupPhone,
  // exported for unit tests
  validateStudentInfo, applyStudentInfo, normalizeRetailMeasurements, comparableSelections,
  comparableStoredSelections, familyKey, resolveSwapTarget, swapCandidates,
  validateNewStudent, resolveRetailPieces,
};
