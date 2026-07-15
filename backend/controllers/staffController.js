const { query } = require('../lib/db');
const { staffScopeAllows, staffTypesOf } = require('../middleware/auth');
const { canStaffTransition, STATUS_LABEL_AR, orderZoneClause } = require('./orderController');
const { nextStageFor } = require('./productionController');

const COMPLETED_STATUSES = ['design_complete', 'staff_review', 'printing', 'embroidery', 'pressing', 'preparing', 'ready', 'delivered'];
// "Done" for the orders console = handed over or ready to hand over.
const DONE_STATUSES = new Set(['ready', 'delivered']);

// Safe staff-facing representative index. This intentionally excludes referral codes,
// pricing, commission and email fields returned by the admin-only endpoint.
async function listWholesalers(req, res) {
  if (!staffScopeAllows(req.user, false)) {
    return res.status(403).json({ error: 'هذا خارج نطاقك', code: 'ERR_FORBIDDEN' });
  }
  const { rows } = await query(
    `SELECT w.id, u.name, u.phone, w.deadline,
       (SELECT COUNT(*)::int FROM students s WHERE s.wholesaler_id = w.id) AS student_count,
       (SELECT COUNT(*)::int FROM students s
         WHERE s.wholesaler_id = w.id AND s.status = 'pending_approval') AS pending_count
     FROM wholesalers w
     JOIN users u ON u.id = w.user_id
     ORDER BY u.name ASC`
  );
  res.json({ data: rows });
}

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
  const canSeeMoney = req.user.role === 'admin' || staffTypesOf(req.user).includes('manager');
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
            o.price, o.cost,
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
    // ready→delivered needs the delivery-details modal (/deliver), so it is NOT a bulk-advance
    // edge — keep the checkbox disabled for `ready` so the console can't silently deliver.
    const canAdvance = !!to && to !== 'delivered' && canStaffTransition(req.user, r.status, to);
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
      admin_amount: canSeeMoney ? Number(r.cost || 0) : null,
      wholesaler_amount: canSeeMoney ? Number(r.price || 0) : null,
    };
  });

  // Per-order money breakdown (only for money-eligible roles) so the admin page can show
  // WHY the admin/rep totals are what they are: packages (rep keeps the base spread),
  // شال امريكي (admin fixed 20,000 → rep keeps the rest), other add-ons + single pieces
  // (100% to admin). pkg_admin is derived on the client from admin_amount, so no admin_price
  // round-trip is needed and the split always reconciles to orders.cost/price.
  if (canSeeMoney && data.length) {
    const ids = rows.map((r) => r.id);
    const { rows: bd } = await query(
      `SELECT oi.order_id,
              COUNT(*) FILTER (WHERE oi.label_snapshot = 'طقم كامل')::int AS pkg_count,
              COALESCE(SUM(oi.price_snapshot) FILTER (WHERE oi.label_snapshot = 'طقم كامل'),0)::bigint AS pkg_student,
              COUNT(*) FILTER (WHERE oi.label_snapshot ILIKE 'إضافة%شال%')::int AS shawl_count,
              COALESCE(SUM(oi.price_snapshot) FILTER (WHERE oi.label_snapshot ILIKE 'إضافة%شال%'),0)::bigint AS shawl_student,
              COALESCE(SUM(oi.price_snapshot) FILTER (WHERE oi.label_snapshot ILIKE 'إضافة%' AND oi.label_snapshot NOT ILIKE '%شال%'),0)::bigint AS other_student,
              COALESCE(SUM(oi.price_snapshot) FILTER (WHERE oi.label_snapshot ILIKE 'قطعة:%'),0)::bigint AS piece_student
         FROM order_items oi
        WHERE oi.order_id = ANY($1::uuid[])
        GROUP BY oi.order_id`,
      [ids]
    );
    const byId = new Map(bd.map((b) => [b.order_id, b]));
    for (const d of data) {
      const b = byId.get(d.id);
      d.pkg_count = b ? Number(b.pkg_count) : 0;
      d.pkg_student = b ? Number(b.pkg_student) : 0;
      d.shawl_count = b ? Number(b.shawl_count) : 0;
      d.shawl_student = b ? Number(b.shawl_student) : 0;
      d.other_student = b ? Number(b.other_student) : 0;
      d.piece_student = b ? Number(b.piece_student) : 0;
    }
  }
  res.json({ data });
}

module.exports = { listWholesalers, wholesalerStudents, wholesalerOrders };
