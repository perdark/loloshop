const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { query, tx } = require('../lib/db');
const { publicUrl } = require('../lib/upload');
const { persistFullSetOrder, readFullSetOrder, loadWholesalerPricing } = require('../lib/fullSetOrder');
const { setBundleApproval, notifyUser } = require('../lib/orderApproval');

async function getWholesalerId(userId) {
  const { rows } = await query(`SELECT id FROM wholesalers WHERE user_id = $1`, [userId]);
  return rows[0]?.id;
}

// Rep/student-facing pricing for the full-set form: base طقم price (0 = fall back to the
// package price client-side) + the add-on surcharges. NEVER exposes the admin-private price.
async function publicPricingFor(wholesalerId) {
  const p = await loadWholesalerPricing(wholesalerId);
  return {
    base: p.wholesalerPrice,
    addons: Object.fromEntries(Object.entries(p.addons).map(([key, pair]) => [key, pair.selling])),
  };
}

async function dashboard(req, res) {
  const wId = await getWholesalerId(req.user.id);
  if (!wId) return res.status(404).json({ error: 'حساب الممثل غير موجود', code: 'ERR_NOT_FOUND' });
  const { rows } = await query(
    `SELECT
       w.deadline, w.referral_code, w.commission_rate, w.embroidery_color,
       w.admin_price, w.wholesaler_price, w.pricing_addons,
       (SELECT COUNT(*) FROM students s WHERE s.wholesaler_id = w.id) AS student_count,
       (SELECT COUNT(*) FROM students s WHERE s.wholesaler_id = w.id AND s.status = 'pending_approval') AS pending_count,
       (SELECT COUNT(*) FROM students s JOIN designs d ON d.student_id = s.id
         WHERE s.wholesaler_id = w.id AND d.completed = TRUE) AS completed_designs,
       COALESCE((
         SELECT SUM(o.profit)::bigint
         FROM students s JOIN orders o ON o.student_id = s.id
         WHERE s.wholesaler_id = w.id AND o.status <> 'cancelled'
           AND o.wholesaler_approval = 'approved'
       ), 0) AS earned_commission
       ,COALESCE((
         SELECT SUM(o.cost)::bigint FROM students s JOIN orders o ON o.student_id=s.id
         WHERE s.wholesaler_id=w.id AND o.status <> 'cancelled'
           AND o.wholesaler_approval = 'approved'
       ),0) AS admin_due
       ,COALESCE((
         SELECT SUM(o.price)::bigint FROM students s JOIN orders o ON o.student_id=s.id
         WHERE s.wholesaler_id=w.id AND o.status <> 'cancelled'
           AND o.wholesaler_approval = 'approved'
       ),0) AS student_total
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
    admin_due: Number(r.admin_due),
    student_total: Number(r.student_total),
    pricing: {
      admin_base: Number(r.admin_price || 0),
      selling_base: Number(r.wholesaler_price || 0),
      addons: (await loadWholesalerPricing(wId)).addons,
    },
    referral_url: `${process.env.FRONTEND_URL}/join/${r.referral_code}`,
    referral_code: r.referral_code,
    embroidery_color: r.embroidery_color || null,
  });
}

// Rep self-edits their own «لون التطريز» without going through admin.
async function updateEmbroideryColor(req, res) {
  const wId = await getWholesalerId(req.user.id);
  if (!wId) return res.status(404).json({ error: 'حساب الممثل غير موجود', code: 'ERR_NOT_FOUND' });
  const raw = req.body.embroidery_color;
  if (raw === undefined) {
    return res.status(400).json({ error: 'embroidery_color مطلوب', code: 'ERR_VALIDATION' });
  }
  // Allow empty string → null (clears the color).
  const color = String(raw).trim().slice(0, 120) || null;
  const { rows } = await query(
    `UPDATE wholesalers SET embroidery_color = $1 WHERE id = $2 RETURNING embroidery_color`,
    [color, wId]
  );
  res.json({ data: { embroidery_color: rows[0].embroidery_color } });
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

// ── Rep-entered full-set order (digitizes the WhatsApp intake form) ──
// The rep fills this form on the student's behalf (الاسم · فصال · نوع · تطريز · ملاحظة).
// Shares persist/read logic with the student-facing endpoint via lib/fullSetOrder
// so both paths write byte-identical orders.

// Wholesaler-scoped image upload (optional embroidery reference photo).
async function uploadImage(req, res) {
  if (!req.file) return res.status(400).json({ error: 'لم يتم رفع ملف', code: 'ERR_VALIDATION' });
  res.json({ data: { url: publicUrl(req, 'images', req.file.filename) } });
}

// Active full-set packages the rep can order (الطقم الكامل) + the rep's «التسعيرة».
async function fullSetPackages(req, res) {
  const wId = await getWholesalerId(req.user.id);
  const { rows } = await query(
    `SELECT id, name_ar, price FROM packages
     WHERE active = TRUE AND is_full_set = TRUE ORDER BY sort, created_at`
  );
  res.json({ data: { packages: rows, pricing: await publicPricingFor(wId) } });
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

// Read back a student's existing full-set order so the rep can EDIT it (the form
// pre-fills from this — without it, "تعديل الطلب" opens blank and save is blocked
// on the empty required fields). Reverses createFullSetOrder's spec-line mapping.
async function getStudentOrder(req, res) {
  const wId = await getWholesalerId(req.user.id);
  if (!wId) return res.status(404).json({ error: 'حساب الممثل غير موجود', code: 'ERR_NOT_FOUND' });
  const { studentId } = req.params;
  const owns = await query(
    `SELECT id FROM students WHERE id = $1 AND wholesaler_id = $2`, [studentId, wId]
  );
  if (!owns.rows.length) return res.status(404).json({ error: 'الطالب غير موجود', code: 'ERR_NOT_FOUND' });
  res.json({ data: await readFullSetOrder(studentId) });
}

// Create/update the full-set order on the student's behalf.
async function createFullSetOrder(req, res) {
  const wId = await getWholesalerId(req.user.id);
  if (!wId) return res.status(404).json({ error: 'حساب الممثل غير موجود', code: 'ERR_NOT_FOUND' });
  const { studentId } = req.params;
  // student must belong to this rep AND be approved (a rep can't order for a link leak)
  const st = await query(
    `SELECT s.id, s.status, s.wholesaler_id, u.name, u.phone
     FROM students s JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.wholesaler_id = $2`,
    [studentId, wId]
  );
  if (!st.rows.length) return res.status(404).json({ error: 'الطالب غير موجود', code: 'ERR_NOT_FOUND' });
  if (st.rows[0].status !== 'approved') {
    return res.status(403).json({ error: 'يجب الموافقة على الطالب أولاً', code: 'ERR_NOT_APPROVED' });
  }
  const { status, json } = await persistFullSetOrder({
    student: st.rows[0], body: req.body, actorUserId: req.user.id,
  });
  res.status(status).json(json);
}

// ── Quick custom order (name-only student, student approval skipped) ──
// The rep adds a student BY NAME ONLY (no login account) and places the SAME full-set
// طقم order for them in one shot. Skips the student approval (the student is created
// pre-'approved') but the ORDER stays pending until the rep confirms from «طلبات الطلاب»
// → then it surfaces to staff + the dashboard. The created users row is
// intentionally UN-LOGINABLE: no phone/email (so no OTP path) + a random, unrecoverable
// bcrypt hash (so no password works).
async function quickFullSetOrder(req, res) {
  const wId = await getWholesalerId(req.user.id);
  if (!wId) return res.status(403).json({ error: 'حساب الممثل غير موجود', code: 'ERR_NOT_FOUND' });

  const name = String((req.body && req.body.student_name) || '').trim();
  if (!name) return res.status(400).json({ error: 'اسم الطالب مطلوب', code: 'ERR_VALIDATION' });
  if (name.length > 120) {
    return res.status(400).json({ error: 'اسم الطالب طويل جداً', code: 'ERR_VALIDATION' });
  }

  // Student inherits the rep's جامعة/قسم (mirrors joinController's inheritance).
  const wRow = await query(
    `SELECT university_name, department FROM wholesalers WHERE id = $1`,
    [wId]
  );
  const university = wRow.rows[0]?.university_name || null;
  const department = wRow.rows[0]?.department || null;

  // Create the name-only, pre-approved student in one transaction so a failure here leaves
  // NO orphan user/student. The random password hash keeps the account un-loginable.
  const hash = await bcrypt.hash(crypto.randomUUID(), 10);
  const created = await tx(async (client) => {
    const u = await client.query(
      `INSERT INTO users (name, phone, email, password_hash, role)
       VALUES ($1, NULL, NULL, $2, 'retail') RETURNING id`,
      [name, hash]
    );
    const s = await client.query(
      `INSERT INTO students (user_id, wholesaler_id, full_name_third, university_name, department, status)
       VALUES ($1, $2, $3, $4, $5, 'approved') RETURNING id`,
      [u.rows[0].id, wId, name, university, department]
    );
    return { userId: u.rows[0].id, studentId: s.rows[0].id };
  });

  // Place the order. persistFullSetOrder runs its OWN atomic transaction. It can throw
  // EITHER before committing (validation/build) OR after committing the orders (its
  // post-commit audit_log + publish). Only delete the just-created name-only user when
  // NO order rows exist — otherwise the cascade to students hits orders.student_id
  // ON DELETE RESTRICT, which would just mask a committed order. Log (don't swallow).
  const cleanupUser = async (reason) => {
    const has = await query(`SELECT 1 FROM orders WHERE student_id = $1 LIMIT 1`, [
      created.studentId,
    ]).catch(() => ({ rows: [] }));
    if (has.rows.length) {
      console.error(
        `quickFullSetOrder: ${reason} but orders already exist for student ${created.studentId} — left in place (manual review)`
      );
      return;
    }
    await query(`DELETE FROM users WHERE id = $1`, [created.userId]).catch((e) =>
      console.error('quickFullSetOrder: cleanup delete failed:', e.message)
    );
  };

  let result;
  try {
    result = await persistFullSetOrder({
      // phone '' (not null): a name-only student has no phone, but checkout_groups.phone_primary
      // is NOT NULL. The users row keeps phone=NULL (un-loginable); this only fills the order's
      // display contact field. (persistFullSetOrder uses student.phone solely for phone_primary.)
      student: { id: created.studentId, name, phone: '', wholesaler_id: wId },
      body: req.body,
      actorUserId: req.user.id,
    });
  } catch (err) {
    await cleanupUser('persistFullSetOrder threw');
    throw err;
  }
  if (result.status !== 201) {
    await cleanupUser('persistFullSetOrder rejected');
    return res.status(result.status).json(result.json);
  }

  res.status(201).json({
    data: { student_id: created.studentId, ...result.json.data },
  });
}

// ── Order approval endpoints (T4) ──

// GET /api/wholesaler/orders?approval=pending|approved|rejected|all
// Returns the rep's students' bundles, grouped by checkout_group_id.
async function listOrdersForApproval(req, res) {
  const wId = await getWholesalerId(req.user.id);
  if (!wId) return res.status(404).json({ error: 'حساب الممثل غير موجود', code: 'ERR_NOT_FOUND' });
  const f = String(req.query.approval || 'pending');
  const params = [wId];
  let clause = 'AND o.wholesaler_approval IS NOT NULL';
  if (['pending', 'approved', 'rejected'].includes(f)) {
    params.push(f);
    clause += ` AND o.wholesaler_approval = $2`;
  }
  const { rows } = await query(
    `SELECT o.checkout_group_id,
            MIN(o.created_at)                          AS submitted_at,
            MAX(o.wholesaler_approval::text)           AS approval,
            MAX(o.wholesaler_reject_reason)            AS reject_reason,
            s.id                                       AS student_id,
            u.name                                     AS student_name,
            SUM(o.cost)                                AS admin_amount,
            SUM(o.price)                               AS wholesaler_amount,
            STRING_AGG(p.name_ar, '، ' ORDER BY p.type) AS product_summary
       FROM orders o
       JOIN students s ON s.id = o.student_id
       JOIN users    u ON u.id = s.user_id
       JOIN products p ON p.id = o.product_id
      WHERE s.wholesaler_id = $1 AND o.checkout_group_id IS NOT NULL
        AND o.status <> 'cancelled' ${clause}
      GROUP BY o.checkout_group_id, s.id, u.name
      ORDER BY submitted_at DESC`,
    params
  );
  res.json({ data: rows.map(r => ({
    ...r,
    admin_amount: Number(r.admin_amount || 0),
    wholesaler_amount: Math.max(0, Number(r.wholesaler_amount || 0)),
  })) });
}

// POST /api/wholesaler/orders/:checkoutGroupId/approve
async function approveOrder(req, res) {
  const wId = await getWholesalerId(req.user.id);
  if (!wId) return res.status(404).json({ error: 'حساب الممثل غير موجود', code: 'ERR_NOT_FOUND' });
  const r = await setBundleApproval({
    checkoutGroupId: req.params.checkoutGroupId,
    decision: 'approved',
    actorUserId: req.user.id,
    repWholesalerId: wId,
  });
  await notifyUser(r.studentUserId, 'order_approved', 'تمت الموافقة على طلبك', 'طلبك الآن قيد الإنتاج', '/my-order');
  res.json({ data: { ok: true } });
}

// POST /api/wholesaler/orders/:checkoutGroupId/reject  body: { reason }
async function rejectOrder(req, res) {
  const wId = await getWholesalerId(req.user.id);
  if (!wId) return res.status(404).json({ error: 'حساب الممثل غير موجود', code: 'ERR_NOT_FOUND' });
  const reason = String((req.body && req.body.reason) || '').trim();
  if (!reason) return res.status(400).json({ error: 'سبب الإرجاع مطلوب', code: 'ERR_VALIDATION' });
  const r = await setBundleApproval({
    checkoutGroupId: req.params.checkoutGroupId,
    decision: 'rejected',
    actorUserId: req.user.id,
    reason,
    repWholesalerId: wId,
  });
  await notifyUser(
    r.studentUserId, 'order_rejected',
    'أعاد الممثل طلبك',
    `السبب: ${reason} — يرجى التعديل وإعادة الإرسال`,
    '/my-order'
  );
  res.json({ data: { ok: true } });
}

// POST /api/wholesaler/orders/bulk  body: { checkoutGroupIds:[], action:'approve'|'reject', reason? }
async function bulkOrders(req, res) {
  const wId = await getWholesalerId(req.user.id);
  if (!wId) return res.status(404).json({ error: 'حساب الممثل غير موجود', code: 'ERR_NOT_FOUND' });
  const ids = Array.isArray(req.body && req.body.checkoutGroupIds) ? req.body.checkoutGroupIds : [];
  const action = req.body && req.body.action;
  const reason = String((req.body && req.body.reason) || '').trim();
  if (!ids.length || !['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'طلب غير صالح', code: 'ERR_VALIDATION' });
  }
  if (action === 'reject' && !reason) {
    return res.status(400).json({ error: 'سبب الإرجاع مطلوب', code: 'ERR_VALIDATION' });
  }
  let done = 0;
  const skipped = [];
  for (const cg of ids) {
    try {
      const r = await setBundleApproval({
        checkoutGroupId: cg,
        decision: action === 'approve' ? 'approved' : 'rejected',
        actorUserId: req.user.id,
        reason,
        repWholesalerId: wId,
      });
      await notifyUser(
        r.studentUserId,
        action === 'approve' ? 'order_approved' : 'order_rejected',
        action === 'approve' ? 'تمت الموافقة على طلبك' : 'أعاد الممثل طلبك',
        action === 'approve' ? 'طلبك الآن قيد الإنتاج' : `السبب: ${reason}`,
        '/my-order'
      );
      done++;
    } catch { skipped.push(cg); }
  }
  res.json({ data: { done, skipped } });
}

module.exports = {
  dashboard, pendingStudents, listStudents, approve, reject, bulkSetStatus,
  getSashConfig, updateSashConfig,
  fullSetPackages, getStudent, getStudentOrder, createFullSetOrder, quickFullSetOrder, uploadImage,
  updateEmbroideryColor,
  listOrdersForApproval, approveOrder, rejectOrder, bulkOrders,
};
