const { query, tx } = require('../lib/db');

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

module.exports = { dashboard, pendingStudents, listStudents, approve, reject, bulkSetStatus, getSashConfig, updateSashConfig };
