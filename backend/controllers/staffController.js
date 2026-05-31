const { query } = require('../lib/db');

const COMPLETED_STATUSES = ['design_complete', 'staff_review', 'printing', 'embroidery', 'pressing', 'preparing', 'ready', 'delivered'];

async function wholesalerStudents(req, res) {
  const { id } = req.params; // wholesaler id
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

