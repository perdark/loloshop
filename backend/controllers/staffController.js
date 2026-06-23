const { query } = require('../lib/db');
const { staffScopeAllows } = require('../middleware/auth');
const { canStaffTransition, STATUS_LABEL_AR, orderZoneClause } = require('./orderController');
const { nextStageFor } = require('./productionController');

const COMPLETED_STATUSES = ['design_complete', 'staff_review', 'printing', 'embroidery', 'pressing', 'preparing', 'ready', 'delivered'];
// "Done" for the orders console = handed over or ready to hand over.
const DONE_STATUSES = new Set(['ready', 'delivered']);

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

// ---------- Orders of one rep's students — the wholesaler order-working console ----------
// Per order we return `can_advance` (computed from the SAME state machine the advance
// endpoint enforces) so the UI never shows a checkbox that would 409. Optional ?zone=
// filter lets an embroiderer batch by zone ("10 right sashes, then 10 left, …").
async function wholesalerOrders(req, res) {
  const { id } = req.params; // wholesaler id
  if (!staffScopeAllows(req.user, false)) {
    return res.status(403).json({ error: 'هذا خارج نطاقك', code: 'ERR_FORBIDDEN' });
  }
  // Validate the zone key up front: an unknown key would otherwise be silently dropped
  // (orderZoneClause → null) and the console would look like "filter broken" by returning all.
  let zoneClause = null;
  if (req.query.zone) {
    zoneClause = orderZoneClause(req.query.zone, 'o');
    if (!zoneClause) return res.status(400).json({ error: 'منطقة تطريز غير صالحة', code: 'ERR_VALIDATION' });
  }
  // NOTE: final_design_url is intentionally NOT selected here — this endpoint is reachable by
  // read-only roles (tailor/presser with wholesaler/both scope), and leaking the final artwork
  // would side-door the per-role field strips in getOrder. The console doesn't render it.
  const { rows } = await query(
    `SELECT o.id, o.status, o.created_at, o.design_id, o.has_embroidery, o.needs_pressing,
            o.checkout_group_id,
            s.id AS student_id, u.name AS student_name,
            p.name_ar AS product_name, p.type AS product_type,
            b.name_ar AS batch_name, b.deadline,
            d.approval_status AS design_approval_status
     FROM orders o
     JOIN students s ON s.id = o.student_id
     JOIN users u ON u.id = s.user_id
     JOIN products p ON p.id = o.product_id
     LEFT JOIN batches b ON b.id = o.batch_id
     LEFT JOIN designs d ON d.id = o.design_id
     WHERE s.wholesaler_id = $1
       AND o.status::text <> 'cancelled'
       AND (o.wholesaler_approval IS NULL OR o.wholesaler_approval = 'approved')
       ${zoneClause ? 'AND ' + zoneClause : ''}
     ORDER BY u.name ASC, p.type ASC`,
    [id]
  );
  const data = rows.map((r) => {
    const to = nextStageFor(r);
    const canAdvance = !!to && canStaffTransition(req.user, r.status, to);
    return {
      id: r.id,
      student_id: r.student_id,
      student_name: r.student_name,
      product_name: r.product_name,
      product_type: r.product_type,
      status: r.status,
      status_label: STATUS_LABEL_AR[r.status] || r.status,
      is_done: DONE_STATUSES.has(r.status),
      batch_name: r.batch_name,
      deadline: r.deadline,
      created_at: r.created_at,
      can_advance: canAdvance,
      next_status: canAdvance ? to : null,
      next_label: canAdvance ? (STATUS_LABEL_AR[to] || to) : null,
    };
  });
  res.json({ data });
}

module.exports = { wholesalerStudents, wholesalerOrders };
