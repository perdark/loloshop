const { query, tx } = require('../lib/db');
const { publicUrl } = require('../lib/upload');
const { persistFullSetOrder, readFullSetOrder } = require('../lib/fullSetOrder');

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

// ── Rep-entered full-set order (digitizes the WhatsApp intake form) ──
// The rep fills this form on the student's behalf (الاسم · فصال · نوع · تطريز · ملاحظة).
// Shares persist/read logic with the student-facing endpoint via lib/fullSetOrder
// so both paths write byte-identical orders.

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

module.exports = {
  dashboard, pendingStudents, listStudents, approve, reject, bulkSetStatus,
  getSashConfig, updateSashConfig,
  fullSetPackages, getStudent, getStudentOrder, createFullSetOrder, uploadImage,
};
