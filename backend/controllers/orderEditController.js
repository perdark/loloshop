// Admin/مدير الإنتاج order editing — full طقم re-save + per-piece quick edits + student
// search. Mounted under /api/production behind requireStaffType() (admin role and the
// `manager` staff_type pass; every other staff type 403s).
//
// The full-form path reuses persistFullSetOrder/readFullSetOrder (the single source of
// truth shared with the rep + student forms) and NEVER applies to retail bundles: the
// form would re-price them with rep/piece pricing. Eligibility = the student is
// wholesaler-linked OR is an admin-created name-only account (users.phone IS NULL).
const { query, tx } = require('../lib/db');
const { persistFullSetOrder, readFullSetOrder, loadWholesalerPricing } = require('../lib/fullSetOrder');
const { priceSelections, validateRobeMeasurements } = require('./orderController');
const { publicUrl } = require('../lib/upload');
const { publish } = require('../lib/eventBus');
const { releaseForOrder } = require('../lib/shelf');

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
            p.type::text AS product_type, p.name_ar AS product_name
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
        status: order.status,
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
  'converting', 'embroidery', 'pressing', 'preparing', 'ready', 'delivered',
]);

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
            p.type::text AS product_type
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
  const measurementError = validateRobeMeasurements(order.product_type, req.body?.measurements);
  if (measurementError) {
    return res.status(400).json({ error: measurementError, code: 'ERR_VALIDATION' });
  }
  const infoPayload = { ...(req.body?.student || {}), ...(req.body?.group || {}) };
  const infoValidation = validateStudentInfo(infoPayload);
  if (infoValidation.error) {
    return res.status(400).json({ error: infoValidation.error, code: 'ERR_VALIDATION' });
  }

  const priced = await priceSelections({
    productId: order.product_id,
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
  const beforeMeasurements = normalizeRetailMeasurements(order.product_type, order.measurements);
  const afterMeasurements = normalizeRetailMeasurements(order.product_type, req.body?.measurements);
  const measurementsChanged = JSON.stringify(beforeMeasurements) !== JSON.stringify(afterMeasurements);

  const designRework =
    priced.hasEmbroidery && selectionsChanged && DESIGN_PASSED_STAGES.has(order.status);
  const tailorReopened =
    order.product_type === 'robe' && measurementsChanged && order.tailor_status === 'done';
  const resultingStatus = designRework ? 'design_complete' : order.status;
  const newPrice = Number(priced.total || 0) * orderQuantity;
  const oldPrice = Number(order.price || 0);
  const recordedCost = Number(order.cost || 0);

  let studentInfoChanged = [];
  await tx(async (client) => {
    const locked = await client.query(
      `SELECT status::text AS status, price FROM orders WHERE id = $1 FOR UPDATE`,
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
      Number(locked.rows[0].price || 0) !== oldPrice
    ) {
      const e = new Error('تم تحديث الطلب أثناء التعديل — أعد تحميل الصفحة ثم حاول مجدداً');
      e.statusCode = 409;
      throw e;
    }

    await client.query(`DELETE FROM order_items WHERE order_id = $1`, [id]);
    for (const item of priced.items) {
      await client.query(
        `INSERT INTO order_items
           (order_id, group_id, option_id, label_snapshot, price_snapshot,
            admin_price_snapshot, qty, customer_image_url, customer_text)
         VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8)`,
        [
          id,
          item.group_id || null,
          item.option_id || null,
          item.label,
          Number(item.price || 0) * orderQuantity,
          Number(item.qty || 1) * orderQuantity,
          clean(item.customer_image_url, 1000),
          clean(item.customer_text, 200),
        ]
      );
    }

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
              tailor_done_by = CASE WHEN $7 THEN NULL ELSE tailor_done_by END
        WHERE id = $8`,
      [
        newPrice,
        resultingStatus,
        afterMeasurements == null ? null : JSON.stringify(afterMeasurements),
        !!priced.hasEmbroidery,
        order.product_type !== 'cap',
        designRework,
        tailorReopened,
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
          product_id: order.product_id,
          selections_before: beforeSelections,
          selections_after: afterSelections,
          measurements_before: beforeMeasurements,
          measurements_after: afterMeasurements,
          price_before: oldPrice,
          price_after: newPrice,
          cost_preserved: recordedCost,
          profit_before: oldPrice - recordedCost,
          profit_after: newPrice - recordedCost,
          status_before: order.status,
          status_after: resultingStatus,
          design_rework: designRework,
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
      cost: recordedCost,
      profit: newPrice - recordedCost,
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
// Only full-set-eligible students (rep-linked or admin-created name-only) — retail
// self-registered students must never be targeted by the طقم form (see header note).
async function studentsSearch(req, res) {
  const raw = String(req.query.q || '').trim();
  if (raw.length < 2) return res.json({ data: [] });
  const q = `%${raw.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const { rows } = await query(
    `SELECT s.id, u.name, u.phone, s.university_name, s.wholesaler_id, wu.name AS rep_name,
            EXISTS (SELECT 1 FROM orders o
                     WHERE o.student_id = s.id AND o.design_id IS NULL AND o.status <> 'cancelled') AS has_full_set
       FROM students s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN wholesalers w ON w.id = s.wholesaler_id
       LEFT JOIN users wu ON wu.id = w.user_id
      WHERE u.role = 'retail'
        AND (s.wholesaler_id IS NOT NULL OR u.phone IS NULL)
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

// Reference-photo upload for the edit form (multer runs in the route).
async function uploadImage(req, res) {
  if (!req.file) return res.status(400).json({ error: 'الملف مطلوب', code: 'ERR_VALIDATION' });
  res.json({ data: { url: publicUrl(req, 'images', req.file.filename) } });
}

module.exports = {
  editContext, saveFullSetOrder, saveRetailConfiguration, patchOrderDetails,
  studentsSearch, getStudentFullSet, uploadImage,
  // shared with adminCustomOrderController (existing-student mode)
  loadStudent, eligibleForFullSet, captureApproval, restoreApproval,
  captureGroupPhone, restoreGroupPhone,
  // exported for unit tests
  validateStudentInfo, applyStudentInfo, normalizeRetailMeasurements, comparableSelections,
  comparableStoredSelections,
};
