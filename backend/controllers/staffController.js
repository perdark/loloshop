const { query } = require('../lib/db');
const { staffScopeAllows, staffTypesOf } = require('../middleware/auth');
const { canStaffTransition, STATUS_LABEL_AR, orderZoneClause } = require('./orderController');
const { nextStageFor } = require('./productionController');
const { moneyCalculations, calculationFor } = require('../lib/moneyCalculation');
const staffPresence = require('../lib/staffPresence');

const COMPLETED_STATUSES = ['design_complete', 'staff_review', 'printing', 'embroidery', 'pressing', 'preparing', 'ready', 'delivered'];
// "Done" for the orders console = handed over or ready to hand over.
const DONE_STATUSES = new Set(['ready', 'delivered']);

function buildWholesalerAccountSummary(rows, byId) {
  const inventory = {
    sash_royal: 0,
    sash_normal: 0,
    cap_royal: 0,
    cap_normal: 0,
  };
  let studentTotal = 0;
  let adminTotal = 0;
  const grouped = new Map();
  let priceAdjustment = 0;
  let costAdjustment = 0;

  for (const row of rows) {
    studentTotal += Number(row.price || 0);
    adminTotal += Number(row.cost || 0);
    if (row.product_type === 'sash') {
      inventory[row.piece_variant === 'royal' ? 'sash_royal' : 'sash_normal'] += 1;
    } else if (row.product_type === 'cap') {
      inventory[row.piece_variant === 'royal' ? 'cap_royal' : 'cap_normal'] += 1;
    }

    const calculation = calculationFor(row, byId);
    for (const line of calculation.lines) {
      const key = line.label;
      const current = grouped.get(key) || {
        label: line.label,
        qty: 0,
        student_amount: 0,
        admin_amount: 0,
        representative_profit: 0,
        kind: 'saved',
      };
      current.qty += Number(line.qty || 1);
      current.student_amount += Number(line.price || 0);
      current.admin_amount += Number(line.admin_price || 0);
      current.representative_profit = current.student_amount - current.admin_amount;
      grouped.set(key, current);
    }
    priceAdjustment += calculation.price_adjustment;
    costAdjustment += calculation.cost_adjustment;
  }

  const lines = [...grouped.values()];
  if (priceAdjustment !== 0 || costAdjustment !== 0) {
    lines.push({
      label: 'تسوية / سجل قديم',
      qty: 0,
      student_amount: priceAdjustment,
      admin_amount: costAdjustment,
      representative_profit: priceAdjustment - costAdjustment,
      kind: 'adjustment',
    });
  }
  return {
    scope: 'approved_non_cancelled',
    confirmed_inventory: inventory,
    money: {
      student_total: studentTotal,
      admin_total: adminTotal,
      representative_profit: studentTotal - adminTotal,
      lines,
    },
  };
}

async function wholesalerAccountSummary(wholesalerId) {
  const { rows } = await query(
    `SELECT o.id, o.price, o.cost, p.type::text AS product_type,
            COALESCE((
              SELECT CASE
                       WHEN COALESCE(NULLIF(btrim(oi.customer_text), ''), opt.label_ar, oi.label_snapshot)
                              ILIKE '%ملكي%' THEN 'royal'
                       WHEN COALESCE(NULLIF(btrim(oi.customer_text), ''), opt.label_ar, oi.label_snapshot)
                              ILIKE '%عادي%' THEN 'normal'
                     END
                FROM order_items oi
                LEFT JOIN options opt ON opt.id = oi.option_id
                LEFT JOIN option_groups og ON og.id = oi.group_id
               WHERE oi.order_id = o.id
                 AND (
                   (p.type = 'sash' AND (
                     oi.label_snapshot ILIKE '%نوع%وشاح%'
                     OR oi.label_snapshot ILIKE 'قطعة:%وشاح%'
                     OR og.name_ar ILIKE '%نوع%وشاح%'
                     OR og.name_ar ILIKE '%شكل%وشاح%'
                     OR (oi.group_id IS NULL AND opt.label_ar ~* '(ملكي|عادي)')
                   ))
                   OR
                   (p.type = 'cap' AND (
                     oi.label_snapshot ILIKE '%نوع%قبعة%'
                     OR oi.label_snapshot ILIKE 'قطعة:%قبعة%'
                     OR og.name_ar ILIKE '%نوع%قبعة%'
                     OR og.name_ar ILIKE '%شكل%قبعة%'
                     OR og.name_ar ILIKE '%القبعة عادية%'
                     OR (oi.group_id IS NULL AND opt.label_ar ~* '(ملكي|عادي)')
                   ))
                 )
                 AND COALESCE(NULLIF(btrim(oi.customer_text), ''), opt.label_ar, oi.label_snapshot)
                       ~* '(ملكي|عادي)'
               ORDER BY CASE WHEN oi.label_snapshot ILIKE '%نوع%' THEN 0
                             WHEN oi.option_id IS NOT NULL THEN 1 ELSE 2 END,
                        oi.created_at, oi.id
               LIMIT 1
            ), 'normal') AS piece_variant
       FROM orders o
       JOIN students s ON s.id = o.student_id
       JOIN products p ON p.id = o.product_id
      WHERE s.wholesaler_id = $1
        AND o.status::text <> 'cancelled'
        AND o.wholesaler_approval = 'approved'
      ORDER BY o.created_at, o.id`,
    [wholesalerId]
  );

  const byId = await moneyCalculations(rows);
  return buildWholesalerAccountSummary(rows, byId);
}

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

const ALL_STATUSES = Object.keys(STATUS_LABEL_AR);

/**
 * Which production stages the VIEWER personally works — their own station(s).
 *
 * Derived from the same authz table `advance` enforces rather than kept as a second copy
 * of productionController's QUEUE_STAGES: a status is "mine" exactly when I am allowed to
 * move an order OUT of it. That equivalence is exact for the five working staff_types
 * (designer→بانتظار التصميم · digitizer→converting · embroiderer→تطريز · presser→كوي ·
 * preparer→تجهيز/جاهز/مُسلّم), unions correctly for multi-role staff, and self-maintains
 * if a transition is ever added — one definition, so the console can never drift from the
 * queue the way a duplicated stage table would.
 *
 * Returns [] = "no personal station, show الكل", which is the correct default for:
 *   · manager / admin — they own the whole line (canStaffTransition passes them everything,
 *     so they MUST be short-circuited here or they'd "own" every stage)
 *   · tailor (مفصل) — a deliberately read-only viewer of every in-production order
 */
function viewerStages(user) {
  if (user.role === 'admin' || staffTypesOf(user).includes('manager')) return [];
  return ALL_STATUSES.filter(
    (from) =>
      from !== 'cancelled' &&
      ALL_STATUSES.some((to) => to !== from && canStaffTransition(user, from, to))
  );
}

// ---------- Orders of one rep's students — the wholesaler order-working console ----------
// Per order we return `can_advance` (computed from the SAME state machine the advance
// endpoint enforces) so the UI never shows a checkbox that would 409. Optional ?zone=
// filter lets an embroiderer batch by zone ("10 right sashes, then 10 left, …").
//
// The row set is deliberately still EVERY approved non-cancelled order: the console offers
// «الكل», and one payload keeps all four view counts live without a refetch per toggle
// (these are phone/iPad users on slow networks). What the response adds is `my_stages`, so
// the client can OPEN on the viewer's own station instead of 402 rows of other stations'
// finished work — see the designer case in the 2026-08-13 bug plan (bug 2).
async function wholesalerOrders(req, res) {
  const { id } = req.params; // wholesaler id
  if (!staffScopeAllows(req.user, false)) {
    return res.status(403).json({ error: 'هذا خارج نطاقك', code: 'ERR_FORBIDDEN' });
  }
  const canSeeMoney = req.user.role === 'admin' || staffTypesOf(req.user).includes('manager');
  // Account/inventory are whole-wholesaler confirmed totals. They deliberately do not
  // inherit the work-list's zone filter.
  const summary = canSeeMoney ? await wholesalerAccountSummary(id) : null;
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
       AND o.wholesaler_approval = 'approved'
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

  res.json({ data, summary, my_stages: viewerStages(req.user) });
}

/**
 * POST /api/staff/app-open — «الموظف فاتح التطبيق هسه».
 *
 * The fourth presence signal (migration 084), independent of بصمة and of production actions.
 * See lib/staffPresence.js for why none of the three existing tables could answer this.
 *
 * ALWAYS 204, success or failure. This is a fire-and-forget beacon on the ROOT layout: a
 * staff member with a queue open must never see an error, a spinner, or a retry because a
 * presence write failed. A tracking endpoint that can break a page is worse than no tracking.
 *
 * ⚠️ Writes NOTHING to payroll. Opening the app is not attendance.
 */
async function appOpen(req, res) {
  try {
    await staffPresence.recordAppOpen({
      userId: req.user.id,
      platform: req.body && req.body.platform,
    });
  } catch (err) {
    console.error('staff app-open track failed:', err.message);
  }
  return res.status(204).end();
}

module.exports = {
  listWholesalers,
  wholesalerStudents,
  wholesalerOrders,
  // Exported for focused tests of confirmed-only inventory/account math.
  wholesalerAccountSummary,
  buildWholesalerAccountSummary,
  // Exported for tests: the viewer→station mapping is pure, so it is asserted directly
  // against productionController's QUEUE_STAGES rather than through an HTTP round trip.
  viewerStages,
  appOpen,
};
