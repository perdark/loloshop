const { query } = require('../lib/db');
const { staffScopeAllows } = require('../middleware/auth');

const COMPLETED_STATUSES = ['design_complete', 'staff_review', 'printing', 'embroidery', 'pressing', 'preparing', 'ready', 'delivered'];

async function wholesalerStudents(req, res) {
  const { id } = req.params; // wholesaler id
  // These are wholesaler-source students (with phone PII). A retail-scoped staffer
  // has no business pulling wholesaler rosters; manager/admin + wholesaler/both pass.
  if (!staffScopeAllows(req.user, false)) {
    return res.status(403).json({ error: 'هذا خارج نطاقك', code: 'ERR_FORBIDDEN' });
  }
  const { rows } = await query(
    `SELECT s.id, u.name, u.phone, s.status, s.university_name, s.department,
       (SELECT status FROM orders WHERE student_id = s.id ORDER BY created_at DESC LIMIT 1) AS order_status
     FROM students s JOIN users u ON u.id = s.user_id
     WHERE s.wholesaler_id = $1
     ORDER BY s.created_at DESC`,
    [id]
  );
  const data = rows.map((r) => ({
    ...r,
    is_completed: r.order_status ? COMPLETED_STATUSES.includes(r.order_status) : false,
  }));
  res.json({ data });
}

module.exports = { wholesalerStudents };

