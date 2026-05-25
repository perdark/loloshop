const { query } = require('../lib/db');

async function getWholesalerId(userId) {
  const { rows } = await query(`SELECT id FROM wholesalers WHERE user_id = $1`, [userId]);
  return rows[0]?.id;
}

async function dashboard(req, res) {
  const wId = await getWholesalerId(req.user.id);
  if (!wId) return res.status(404).json({ error: 'حساب الممثل غير موجود', code: 'ERR_NOT_FOUND' });
  const { rows } = await query(
    `SELECT
       w.deadline, w.referral_code,
       (SELECT COUNT(*) FROM students s WHERE s.wholesaler_id = w.id) AS student_count,
       (SELECT COUNT(*) FROM students s WHERE s.wholesaler_id = w.id AND s.status = 'pending_approval') AS pending_count,
       (SELECT COUNT(*) FROM students s JOIN designs d ON d.student_id = s.id
         WHERE s.wholesaler_id = w.id AND d.completed = TRUE) AS completed_designs
     FROM wholesalers w WHERE w.id = $1`,
    [wId]
  );
  const r = rows[0];
  res.json({
    deadline: r.deadline,
    student_count: parseInt(r.student_count, 10),
    pending_count: parseInt(r.pending_count, 10),
    completed_designs: parseInt(r.completed_designs, 10),
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
       (SELECT status FROM orders WHERE student_id = s.id ORDER BY created_at DESC LIMIT 1) AS order_status
     FROM students s JOIN users u ON u.id = s.user_id
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

module.exports = { dashboard, pendingStudents, listStudents, approve, reject };
