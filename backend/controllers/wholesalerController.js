const { query, tx } = require('../lib/db');
const { publicUrl } = require('../lib/upload');
const { publish } = require('../lib/eventBus');

async function getWholesalerId(userId) {
  const { rows } = await query(`SELECT id FROM wholesalers WHERE user_id = $1`, [userId]);
  return rows[0]?.id;
}

async function dashboard(req, res) {
  const wId = await getWholesalerId(req.user.id);
  if (!wId) return res.status(404).json({ error: 'حساب الممثل غير موجود', code: 'ERR_NOT_FOUND' });
  const { rows } = await query(
    `SELECT
       w.deadline, w.referral_code, w.commission_rate,
       (SELECT COUNT(*) FROM students s WHERE s.wholesaler_id = w.id) AS student_count,
       (SELECT COUNT(*) FROM students s WHERE s.wholesaler_id = w.id AND s.status = 'pending_approval') AS pending_count,
       (SELECT COUNT(*) FROM students s JOIN designs d ON d.student_id = s.id
         WHERE s.wholesaler_id = w.id AND d.completed = TRUE) AS completed_designs,
       COALESCE((
         SELECT ROUND(SUM(o.price) * w.commission_rate / 100)::bigint
         FROM students s JOIN orders o ON o.student_id = s.id
         WHERE s.wholesaler_id = w.id AND o.status <> 'cancelled'
       ), 0) AS earned_commission
     FROM wholesalers w WHERE w.id = $1`,
    [wId]
  );
  const r = rows[0];
  res.json({
    deadline: r.deadline,
    student_count: parseInt(r.student_count, 10),
    pending_count: parseInt(r.pending_count, 10),
    completed_designs: parseInt(r.completed_designs, 10),
    commission_rate: Number(r.commission_rate),
    earned_commission: Number(r.earned_commission),
    referral_url: `${process.env.FRONTEND_URL}/join/${r.referral_code}`,
    referral_code: r.referral_code,
  });
}

async function pendingStudents(req, res) {
  const wId = await getWholesalerId(req.user.id);
  if (!wId) return res.status(404).json({ error: 'حساب الممثل غير موجود', code: 'ERR_NOT_FOUND' });
  const { rows } = await query(
    `SELECT s.id, u.name, u.phone, u.email, s.university_name, s.department, s.created_at
     FROM students s JOIN users u ON u.id = s.user_id
     WHERE s.wholesaler_id = $1 AND s.status = 'pending_approval'
     ORDER BY s.created_at DESC`,
    [wId]
  );
  res.json({ data: rows });
}

async function listStudents(req, res) {
  const wId = await getWholesalerId(req.user.id);
  if (!wId) return res.status(404).json({ error: 'حساب الممثل غير موجود', code: 'ERR_NOT_FOUND' });
  const { status } = req.query;
  const params = [wId];
  let where = `s.wholesaler_id = $1`;
  if (status) {
    params.push(status);
    where += ` AND s.status = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT s.id, u.name, u.phone, s.status, s.university_name, s.department,
       lo.status AS order_status,
       (lo.status IN ('design_complete', 'staff_review', 'printing', 'embroidery', 'pressing', 'preparing', 'ready', 'delivered')) AS is_completed
     FROM students s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN LATERAL (
       SELECT status FROM orders WHERE student_id = s.id ORDER BY created_at DESC LIMIT 1
     ) lo ON TRUE
     WHERE ${where}
     ORDER BY s.created_at DESC`,
    params
  );
  res.json({ data: rows });
}

async function setStatus(req, res, newStatus) {
  const wId = await getWholesalerId(req.user.id);
  if (!wId) return res.status(404).json({ error: 'حساب الممثل غير موجود', code: 'ERR_NOT_FOUND' });
  const { studentId } = req.params;
  const { rows } = await query(
    `UPDATE students SET status = $1
     WHERE id = $2 AND wholesaler_id = $3 AND status = 'pending_approval'
     RETURNING id, user_id, status`,
    [newStatus, studentId, wId]
  );
  if (!rows.length) {
    return res.status(404).json({ error: 'الطالب غير موجود أو تمت معالجته', code: 'ERR_NOT_FOUND' });
  }
  const action = newStatus === 'approved' ? 'approve_student' : 'reject_student';
  const title = newStatus === 'approved' ? 'تمت الموافقة' : 'تم الرفض';
  const body = newStatus === 'approved' ? 'وافق الممثل على طلبك، يمكنك البدء بالتصميم' : 'تم رفض طلبك من الممثل';
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id) VALUES ($1, $2, 'student', $3)`,
    [req.user.id, action, studentId]
  );
  await query(
    `INSERT INTO notifications (user_id, type, title_ar, body_ar, link) VALUES ($1, $2, $3, $4, $5)`,
    [rows[0].user_id, newStatus, title, body, '/']
  );
  res.json({ data: { id: rows[0].id, status: rows[0].status } });
}

const approve = (req, res) => setStatus(req, res, 'approved');
const reject = (req, res) => setStatus(req, res, 'rejected');

// Approve/reject many pending students in one transaction (phone-first rep handles 100+).
async function bulkSetStatus(req, res) {
  const wId = await getWholesalerId(req.user.id);
  if (!wId) return res.status(404).json({ error: 'حساب الممثل غير موجود', code: 'ERR_NOT_FOUND' });
  const { studentIds, action } = req.body;
  const newStatus = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : null;
  if (!newStatus) {
    return res.status(400).json({ error: 'إجراء غير صالح', code: 'ERR_VALIDATION' });
  }
  if (!Array.isArray(studentIds) || !studentIds.length) {
    return res.status(400).json({ error: 'لم يتم اختيار أي طالب', code: 'ERR_VALIDATION' });
  }
  const ids = studentIds.slice(0, 500);
  const title = newStatus === 'approved' ? 'تمت الموافقة' : 'تم الرفض';
  const body = newStatus === 'approved'
    ? 'وافق الممثل على طلبك، يمكنك البدء بالتصميم'
    : 'تم رفض طلبك من الممثل';
  const auditAction = newStatus === 'approved' ? 'approve_student' : 'reject_student';

  const updated = await tx(async (client) => {
    const { rows } = await client.query(
      `UPDATE students SET status = $1
       WHERE id = ANY($2) AND wholesaler_id = $3 AND status = 'pending_approval'
       RETURNING id, user_id`,
      [newStatus, ids, wId]
    );
    for (const r of rows) {
      await client.query(
        `INSERT INTO audit_log (actor_id, action, entity, entity_id) VALUES ($1, $2, 'student', $3)`,
        [req.user.id, auditAction, r.id]
      );
      await client.query(
        `INSERT INTO notifications (user_id, type, title_ar, body_ar, link) VALUES ($1, $2, $3, $4, $5)`,
        [r.user_id, newStatus, title, body, '/']
      );
    }
    return rows;
  });
  res.json({ data: { count: updated.length, status: newStatus } });
}

// ── Sash side lock config — wholesaler manages their own ──
async function getSashConfig(req, res) {
  const wId = await getWholesalerId(req.user.id);
  if (!wId) return res.status(404).json({ error: 'حساب الممثل غير موجود', code: 'ERR_NOT_FOUND' });
  const { rows } = await query(
    `SELECT id, editable_sash_side, locked_side_design FROM wholesalers WHERE id = $1`,
    [wId]
  );
  res.json({ data: rows[0] });
}

async function updateSashConfig(req, res) {
  const wId = await getWholesalerId(req.user.id);
  if (!wId) return res.status(404).json({ error: 'حساب الممثل غير موجود', code: 'ERR_NOT_FOUND' });
  const side = req.body.editable_sash_side ?? null;
  if (!(side === null || side === 'left' || side === 'right')) {
    return res.status(400).json({ error: 'جانب غير صالح', code: 'ERR_VALIDATION' });
  }
  const design = side === null ? null : (req.body.locked_side_design ?? null);
  const { rows } = await query(
    `UPDATE wholesalers SET editable_sash_side = $1, locked_side_design = $2
     WHERE id = $3 RETURNING id, editable_sash_side, locked_side_design`,
    [side, design, wId]
  );
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'update_sash_side', 'wholesaler', $2, $3)`,
    [req.user.id, wId, JSON.stringify({ editable_sash_side: side })]
  );
  res.json({ data: rows[0] });
}

// ── Wholesaler-entered full-set order (digitizes the WhatsApp intake form) ──
// The rep's students never browse the shop / use a cart; the rep fills this form
// (الاسم · فصال الروب · نوع الوشاح/القبعة · التطريز · ملاحظة) and orders the طقم.
// Reuses the same full-set pipeline as configureFullSet (3 linked orders under one
// checkout_group, package price on the sash, batch attach, staff statuses) — but
// no delivery intake (the batch handles delivery) and types/embroidery are captured
// as manufacturing spec lines, not priced options.

// Customers type Arabic-Indic digits (٠٧٨٣…) for measurements — normalize first.
function wsNormalizeDigits(s) {
  return String(s ?? '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}
function wsClean(v, max) {
  const t = v == null ? '' : String(v).trim();
  return t ? t.slice(0, max) : null;
}

const WS_MEAS_RANGE = { shoulder_cm: [25, 80], robe_length_cm: [70, 190], sleeve_length_cm: [30, 100] };
const WS_MEAS_LABEL = { shoulder_cm: 'عرض الكتف', robe_length_cm: 'طول الروب', sleeve_length_cm: 'طول الردن' };
const PIECE_TYPES = ['عادي', 'ملكي']; // نوع الوشاح / نوع القبعة — only these two

// Wholesaler-scoped image upload (optional embroidery reference photo).
async function uploadImage(req, res) {
  if (!req.file) return res.status(400).json({ error: 'لم يتم رفع ملف', code: 'ERR_VALIDATION' });
  res.json({ data: { url: publicUrl(req, 'images', req.file.filename) } });
}

// Active full-set packages the rep can order (الطقم الكامل).
async function fullSetPackages(req, res) {
  const { rows } = await query(
    `SELECT id, name_ar, price FROM packages
     WHERE active = TRUE AND is_full_set = TRUE ORDER BY sort, created_at`
  );
  res.json({ data: rows });
}

// One student's basics (scoped to this rep) — feeds the order form header + guard.
async function getStudent(req, res) {
  const wId = await getWholesalerId(req.user.id);
  if (!wId) return res.status(404).json({ error: 'حساب الممثل غير موجود', code: 'ERR_NOT_FOUND' });
  const { studentId } = req.params;
  const { rows } = await query(
    `SELECT s.id, u.name, u.phone, s.status, s.university_name, s.department,
            EXISTS (SELECT 1 FROM orders o WHERE o.student_id = s.id AND o.status <> 'cancelled') AS has_order
     FROM students s JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.wholesaler_id = $2`,
    [studentId, wId]
  );
  if (!rows.length) return res.status(404).json({ error: 'الطالب غير موجود', code: 'ERR_NOT_FOUND' });
  res.json({ data: rows[0] });
}

async function createFullSetOrder(req, res) {
  const wId = await getWholesalerId(req.user.id);
  if (!wId) return res.status(404).json({ error: 'حساب الممثل غير موجود', code: 'ERR_NOT_FOUND' });
  const { studentId } = req.params;
  const { package_id, measurements, sash_type, cap_type, embroidery, notes } = req.body || {};

  // student must belong to this rep AND be approved (a rep can't order for a link leak)
  const st = await query(
    `SELECT s.id, s.status, u.name, u.phone
     FROM students s JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.wholesaler_id = $2`,
    [studentId, wId]
  );
  if (!st.rows.length) return res.status(404).json({ error: 'الطالب غير موجود', code: 'ERR_NOT_FOUND' });
  const student = st.rows[0];
  if (student.status !== 'approved') {
    return res.status(403).json({ error: 'يجب الموافقة على الطالب أولاً', code: 'ERR_NOT_APPROVED' });
  }

  // full-set package
  if (!package_id) return res.status(400).json({ error: 'الطقم مطلوب', code: 'ERR_VALIDATION' });
  const pkg = await query(
    `SELECT id, name_ar, price FROM packages WHERE id = $1 AND active = TRUE AND is_full_set = TRUE`,
    [package_id]
  );
  if (!pkg.rows.length) return res.status(404).json({ error: 'الطقم غير موجود', code: 'ERR_NOT_FOUND' });
  const packageRow = pkg.rows[0];

  // robe measurements (فصال) — typo-guarded, same ranges as the retail form
  const m = measurements || {};
  const meas = {
    shoulder_cm: Number(wsNormalizeDigits(m.shoulder_cm)),
    robe_length_cm: Number(wsNormalizeDigits(m.robe_length_cm)),
    sleeve_length_cm: Number(wsNormalizeDigits(m.sleeve_length_cm)),
  };
  for (const [k, [lo, hi]] of Object.entries(WS_MEAS_RANGE)) {
    if (!isFinite(meas[k]) || meas[k] < lo || meas[k] > hi) {
      return res.status(400).json({
        error: `قياسات الروب غير صالحة — ${WS_MEAS_LABEL[k]} يجب أن يكون بين ${lo} و ${hi} سم`,
        code: 'ERR_VALIDATION',
      });
    }
  }

  // نوع الوشاح / نوع القبعة — only عادي or ملكي
  const sashType = PIECE_TYPES.includes(sash_type) ? sash_type : null;
  const capType = PIECE_TYPES.includes(cap_type) ? cap_type : null;
  if (!sashType) return res.status(400).json({ error: 'نوع الوشاح مطلوب (عادي أو ملكي)', code: 'ERR_VALIDATION' });
  if (!capType) return res.status(400).json({ error: 'نوع القبعة مطلوب (عادي أو ملكي)', code: 'ERR_VALIDATION' });

  // embroidery zones — free text (the name to embroider) + optional reference photo
  const e = embroidery || {};
  const zone = (z) => ({ text: wsClean(z?.text, 200), image_url: wsClean(z?.image_url, 500) });
  const emb = {
    cap_side: zone(e.cap_side),
    cap_top: zone(e.cap_top),
    sash_front: zone(e.sash_front),
    sash_back: zone(e.sash_back),
  };
  const groupNotes = wsClean(notes, 500);

  // resolve the three products: package-pinned wins, else first active per type
  const byType = {};
  const pinned = await query(
    `SELECT p.id, p.type FROM package_products pl JOIN products p ON p.id = pl.product_id
     WHERE pl.package_id = $1 AND p.active = TRUE AND p.type IN ('sash','robe','cap')`,
    [package_id]
  );
  for (const p of pinned.rows) byType[p.type] = p.id;
  const prods = await query(
    `SELECT id, type FROM products WHERE type IN ('sash','robe','cap') AND active = TRUE
     ORDER BY type, featured DESC, sort, created_at`
  );
  for (const p of prods.rows) if (!byType[p.type]) byType[p.type] = p.id;
  if (!byType.sash || !byType.robe || !byType.cap) {
    return res.status(500).json({ error: 'منتجات الطقم غير مكتملة في النظام', code: 'ERR_CONFIG' });
  }

  // pricing: the bundle price sits on the sash; robe/cap = 0 (same as configureFullSet)
  const itemPrice = { sash: Number(packageRow.price), robe: 0, cap: 0 };

  // production routing per piece — embroidered piece enters at design_complete,
  // a plain piece skips straight to preparing (identical rules to the retail full set)
  const sashHasEmb = !!(emb.sash_front.text || emb.sash_front.image_url || emb.sash_back.text || emb.sash_back.image_url);
  const capHasEmb = !!(emb.cap_side.text || emb.cap_side.image_url || emb.cap_top.text || emb.cap_top.image_url);
  const itemFlags = {
    sash: { has_embroidery: sashHasEmb, status: sashHasEmb ? 'design_complete' : 'preparing' },
    cap: { has_embroidery: capHasEmb, status: capHasEmb ? 'design_complete' : 'preparing' },
    robe: { has_embroidery: false, status: 'preparing' },
  };

  // manufacturing spec lines (price 0) — staff render label + customer_text/image
  const specLines = {
    sash: [
      { label: 'نوع الوشاح', customer_text: sashType },
      ...(emb.sash_front.text || emb.sash_front.image_url
        ? [{ label: 'تطريز الوشاح من الأمام', customer_text: emb.sash_front.text, customer_image_url: emb.sash_front.image_url }] : []),
      ...(emb.sash_back.text || emb.sash_back.image_url
        ? [{ label: 'تطريز الوشاح من الخلف', customer_text: emb.sash_back.text, customer_image_url: emb.sash_back.image_url }] : []),
    ],
    cap: [
      { label: 'نوع القبعة', customer_text: capType },
      ...(emb.cap_side.text || emb.cap_side.image_url
        ? [{ label: 'تطريز القبعة من الجانب', customer_text: emb.cap_side.text, customer_image_url: emb.cap_side.image_url }] : []),
      ...(emb.cap_top.text || emb.cap_top.image_url
        ? [{ label: 'تطريز القبعة من الأعلى', customer_text: emb.cap_top.text, customer_image_url: emb.cap_top.image_url }] : []),
    ],
    robe: [],
  };

  // rep students auto-attach to the rep's latest batch (same as configureOrder)
  const b = await query(
    `SELECT id FROM batches WHERE wholesaler_id = $1 ORDER BY created_at DESC LIMIT 1`, [wId]
  );
  const resolvedBatchId = b.rows[0]?.id || null;

  const result = await tx(async (client) => {
    // reuse the intake row when the rep re-submits this student's set
    const prevGroup = await client.query(
      `SELECT cg.id FROM checkout_groups cg
       JOIN orders o ON o.checkout_group_id = cg.id
       WHERE o.student_id = $1 AND o.status <> 'cancelled'
       ORDER BY cg.created_at DESC LIMIT 1`,
      [student.id]
    );
    let cgId;
    const cgParams = [student.name, student.phone, groupNotes];
    if (prevGroup.rows.length) {
      cgId = prevGroup.rows[0].id;
      await client.query(
        `UPDATE checkout_groups SET customer_name=$1, phone_primary=$2, notes=$3 WHERE id=$4`,
        [...cgParams, cgId]
      );
    } else {
      const cg = await client.query(
        `INSERT INTO checkout_groups (customer_name, phone_primary, notes) VALUES ($1,$2,$3) RETURNING id`,
        cgParams
      );
      cgId = cg.rows[0].id;
    }

    const ids = {};
    for (const type of ['sash', 'robe', 'cap']) {
      const prodId = byType[type];
      const flags = itemFlags[type];
      const measurementsJson = type === 'robe' ? JSON.stringify(meas) : null;
      const existing = await client.query(
        `SELECT id FROM orders
         WHERE student_id = $1 AND product_id = $2 AND design_id IS NULL AND status <> 'cancelled'`,
        [student.id, prodId]
      );
      let oid;
      if (existing.rows.length) {
        oid = existing.rows[0].id;
        await client.query(
          `UPDATE orders SET price=$1, batch_id=$2, package_id=$3, checkout_group_id=$4,
             status=$5, has_embroidery=$6, needs_pressing=FALSE, measurements=$7, notes=$8
           WHERE id=$9`,
          [itemPrice[type], resolvedBatchId, package_id, cgId, flags.status, flags.has_embroidery, measurementsJson, groupNotes, oid]
        );
        await client.query(`DELETE FROM order_items WHERE order_id = $1`, [oid]);
      } else {
        const o = await client.query(
          `INSERT INTO orders (student_id, product_id, batch_id, package_id, checkout_group_id,
                               price, status, has_embroidery, needs_pressing, measurements, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,FALSE,$9,$10) RETURNING id`,
          [student.id, prodId, resolvedBatchId, package_id, cgId,
           itemPrice[type], flags.status, flags.has_embroidery, measurementsJson, groupNotes]
        );
        oid = o.rows[0].id;
      }

      const baseLine = type === 'sash'
        ? { label: `طقم: ${packageRow.name_ar}`, price: Number(packageRow.price) }
        : { label: `ضمن طقم: ${packageRow.name_ar}`, price: 0 };
      const lines = [baseLine, ...specLines[type].map((l) => ({ ...l, price: 0 }))];
      for (const it of lines) {
        await client.query(
          `INSERT INTO order_items (order_id, group_id, option_id, label_snapshot, price_snapshot, qty,
                                    customer_image_url, customer_text)
           VALUES ($1,NULL,NULL,$2,$3,1,$4,$5)`,
          [oid, it.label, it.price || 0, it.customer_image_url || null, it.customer_text || null]
        );
      }
      ids[type] = oid;
    }
    return { cgId, ids };
  });

  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'wholesaler_create_fullset', 'order', $2, $3)`,
    [req.user.id, result.ids.sash, JSON.stringify({ student_id: student.id, package_id })]
  );
  publish({ type: 'order_new', orderId: result.ids.sash });
  res.status(201).json({
    data: {
      checkout_group_id: result.cgId,
      package_id,
      package_name: packageRow.name_ar,
      total: itemPrice.sash,
      orders: result.ids,
    },
  });
}

module.exports = {
  dashboard, pendingStudents, listStudents, approve, reject, bulkSetStatus,
  getSashConfig, updateSashConfig,
  fullSetPackages, getStudent, createFullSetOrder, uploadImage,
};
