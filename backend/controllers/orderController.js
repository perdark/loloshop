const { query, tx } = require('../lib/db');
const { moneyCalculations, calculationFor } = require('../lib/moneyCalculation');
const { priceRoleForUser } = require('./catalogController');
const { publish } = require('../lib/eventBus');
const { staffScopeAllows, staffTypesOf } = require('../middleware/auth');
const { persistFullSetOrder, readFullSetOrder, loadWholesalerPricing } = require('../lib/fullSetOrder');
const { capturePlates, plateFor } = require('../lib/platePreservation');
const memoCache = require('../lib/memoCache');

const ALL_STATUSES = [
  'pending_approval', 'designing', 'design_complete', 'converting',
  'staff_review', 'printing', 'embroidery', 'pressing', 'preparing',
  'ready', 'delivered', 'cancelled',
];

// The pipeline in ORDER, used only to tell a forward move from a backward one when logging who
// moved a piece. Deliberately NOT ALL_STATUSES: that list ends in 'cancelled', which would make
// «ألغِ الطلب» read as the furthest-forward stage there is.
const STAGE_ORDER = [
  'pending_approval', 'designing', 'design_complete', 'converting',
  'staff_review', 'printing', 'embroidery', 'pressing', 'preparing',
  'ready', 'delivered',
];

// Allowed status transitions (state machine).
// Pipeline: pending_approval → designing → design_complete (بانتظار التصميم)
//   → (designer sends «تحويل للتطريز») embroidery → pressing → preparing → ready → delivered
// STAGE-2 REMOVED (user 2026-07-15): 'converting' is drain-only — legacy rows + orders the
// old prod code still creates until deploy keep their edges so they can flow out.
// Also includes reopen edges (delivered→preparing etc.) for reverting.
const TRANSITIONS = {
  pending_approval: ['designing', 'cancelled'],
  designing: ['design_complete', 'cancelled'],
  design_complete: ['converting', 'embroidery', 'designing', 'cancelled'],
  converting: ['embroidery', 'design_complete', 'cancelled'], // drain-only
  embroidery: ['assembly', 'pressing', 'preparing', 'design_complete', 'cancelled'],
  // «التجميع» (migration 105, 2026-09-06): a ممثل SASH's two embroidered halves are sewn into
  // one garment here before الكوي. Rep sashes only — productionController.isAssemblyPiece is
  // the single fork; every other piece keeps embroidery→pressing/preparing.
  assembly: ['pressing', 'preparing', 'embroidery', 'cancelled'],
  pressing: ['preparing', 'assembly', 'cancelled'],
  preparing: ['ready', 'embroidery', 'pressing', 'assembly', 'cancelled'],
  ready: ['delivered', 'preparing', 'cancelled'],
  delivered: ['preparing'],
  cancelled: [],
  // Legacy drain-only statuses
  staff_review: ['embroidery', 'designing', 'cancelled'],
  printing: ['embroidery', 'pressing', 'cancelled'],
};

// Every staff_type that works the production line. `tailor` (مفصل) is deliberately absent:
// it is a read-only viewer of the whole line and has never had a transition.
const LINE_STAFF = ['designer', 'digitizer', 'embroiderer', 'assembler', 'presser', 'preparer'];

// Which staff_type may perform each "from→to" edge.
// admin role and `manager` staff_type bypass this map entirely; cancelling is manager/admin only.
//
// ⚠️ OWNER DECISION 2026-08-31 — «all staff, all stages EXCEPT the design stage», and they may
// MOVE, not just look. Every non-design edge below is therefore LINE_STAFF. The reason is
// concrete: 197 retail شال امريكي (and 387 other retail pieces) sat at التطريز from 2026-06-29
// because the only embroiderer's `order_scope` is wholesaler-only, and no other station was
// allowed to push them on. One person's scope must not be able to dam the line.
//
// TWO THINGS THIS DELIBERATELY DOES NOT OPEN, and neither is an oversight:
//   · التصميم — `design_complete→*` stays ['designer']. That is the exception the owner named.
//   · Any edge that moves a piece BACK INTO the design desk (`→design_complete`) keeps its
//     original owner plus the designer. Reopening a design is a design decision; letting a
//     presser do it would put work back on a desk they do not sit at.
// The embroidery per-zone checklist is a SEPARATE guard in productionController.advance and
// still applies to every non-manager, so widening this map cannot skip تطريز tracking.
const STAGE_AUTHZ = {
  // forward edges
  'design_complete→embroidery': ['designer'], // stage-2 removed: design goes straight to التطريز
  'design_complete→converting': ['designer'], // drain-only
  'converting→embroidery': LINE_STAFF,        // drain-only
  'converting→design_complete': ['digitizer', 'designer'], // drain-only, back into التصميم
  'embroidery→pressing': LINE_STAFF,
  'embroidery→preparing': LINE_STAFF,
  'embroidery→assembly': LINE_STAFF,   // rep sash: التطريز → التجميع
  'assembly→pressing': LINE_STAFF,
  'assembly→preparing': LINE_STAFF,
  'pressing→preparing': LINE_STAFF,
  'preparing→ready': LINE_STAFF,
  'ready→delivered': LINE_STAFF,
  // revert edges
  'design_complete→designing': ['designer'],
  'delivered→preparing': LINE_STAFF,
  'ready→preparing': LINE_STAFF,
  'preparing→embroidery': LINE_STAFF,
  // Revert for a PLAIN piece that came straight from الكوي (never embroidered).
  'preparing→pressing': LINE_STAFF,
  'pressing→embroidery': LINE_STAFF,
  'assembly→embroidery': LINE_STAFF,   // revert: a rep sash back to التطريز
  'pressing→assembly': LINE_STAFF,     // revert: a rep sash came through التجميع
  'preparing→assembly': LINE_STAFF,    // revert: a rep sash that skipped الكوي
  'embroidery→converting': LINE_STAFF, // drain-only
  'embroidery→design_complete': ['embroiderer', 'designer'], // revert: back to the design desk
};

function canStaffTransition(user, from, to) {
  if (user.role === 'admin') return true;
  const mine = staffTypesOf(user);
  if (mine.includes('manager')) return true;
  if (to === 'cancelled') return false;
  const allowed = STAGE_AUTHZ[`${from}→${to}`];
  // Multi-role: a transition is permitted if ANY of the user's roles may perform it.
  return Array.isArray(allowed) && allowed.some((t) => mine.includes(t));
}

const STATUS_LABEL_AR = {
  pending_approval: 'بانتظار الموافقة',
  designing: 'قيد التصميم',
  design_complete: 'بانتظار التصميم',
  converting: 'تحويل التصميم لتطريز',
  staff_review: 'قيد المراجعة',
  printing: 'قيد الطباعة',
  embroidery: 'قيد التطريز',
  assembly: 'قيد التجميع',
  pressing: 'قيد الكوي',
  preparing: 'قيد التجهيز',
  ready: 'جاهز للاستلام',
  delivered: 'تم التسليم',
  cancelled: 'ملغي',
};

// Valid product types for the `type` filter
const VALID_PRODUCT_TYPES = ['sash', 'robe', 'cap', 'shawl'];

// Embroidery-zone / pleat filter. Maps a zone key → a SQL EXISTS predicate over the order's
// spec lines (order_items.label_snapshot / customer_text). Shared by the admin orders list
// and the staff production queue so design/embroidery/transfer/admin can filter to e.g.
// "only sashes with right-side embroidery" or "robes with shoulder pleats". The clause uses
// only constant text (zone is a validated key, never raw input) → injection-safe.
const ORDER_ZONE_MATCH = {
  // Retail single-sash zones (right side = university, left = name).
  sash_right:    `(oi.label_snapshot ILIKE '%يمين%' OR oi.label_snapshot ILIKE '%اليمن%')`,
  sash_left:     `(oi.label_snapshot ILIKE '%يسار%' OR oi.label_snapshot ILIKE '%اليسر%')`,
  sash_back:     `(oi.label_snapshot ILIKE '%خلف%')`,
  cap_side:      `(oi.label_snapshot ILIKE '%جانب%')`,
  cap_top:       `(oi.label_snapshot ILIKE '%أعلى%' OR oi.label_snapshot ILIKE '%اعلى%')`,
  robe_pleat:    `(oi.label_snapshot ILIKE '%كسرة%' AND oi.customer_text = 'نعم')`,
  robe_no_pleat: `(oi.label_snapshot ILIKE '%كسرة%' AND oi.customer_text = 'لا')`,
  // Wholesaler full-set (طقم) zones — the label set persisted by lib/fullSetOrder.js:
  // «تطريز الوشاح من الأمام/الخلف» · «… القبعة من الجانب/الأعلى» · «… ردن الروب الأيمن/الأيسر» · «شال امريكي».
  sash_front:        `(oi.label_snapshot ILIKE '%وشاح%أمام%')`,
  robe_sleeve_right: `(oi.label_snapshot ILIKE '%ردن%' AND oi.label_snapshot ILIKE '%أيمن%')`,
  robe_sleeve_left:  `(oi.label_snapshot ILIKE '%ردن%' AND oi.label_snapshot ILIKE '%أيسر%')`,
  american_shawl:    `(oi.label_snapshot ILIKE '%شال%امريكي%' OR oi.label_snapshot ILIKE '%شال%أمريكي%')`,
  // ── Merged garment-level zones — التجهيز only (owner 2026-08-14) ──────────────────────
  // The preparer packs GARMENTS, not embroidery positions: يمين/يسار/خلف/أمام are ONE sash in
  // their hands, so three chips is noise. These keys OR the per-position predicates above so
  // «وشاح» is a single chip on قائمة الإنتاج for a المجهز. التطريز is untouched and keeps every
  // position separate — it batches by position (components/staff/station/StationConsole.tsx
  // builds its own chips from the per-piece `zones` payload, not from this table).
  // Measured on the dev DB 2026-08-14: sash-zone lines appear ONLY on product type 'sash'
  // (1,342 lines / 586 orders), cap-zone lines ONLY on 'cap' (749 / 437), كسرة lines ONLY on
  // 'robe' (329). Zero cross-garment matches, so the OR is exact, not a heuristic.
  // «شال امريكي» is deliberately NOT part of sash_any — it is an add-on, not تطريز (same rule
  // as productionController's ZONE_DEFS header).
  sash_any: `(oi.label_snapshot ILIKE '%يمين%' OR oi.label_snapshot ILIKE '%اليمن%'
              OR oi.label_snapshot ILIKE '%يسار%' OR oi.label_snapshot ILIKE '%اليسر%'
              OR oi.label_snapshot ILIKE '%خلف%'
              OR oi.label_snapshot ILIKE '%وشاح%أمام%')`,
  cap_any:  `(oi.label_snapshot ILIKE '%جانب%'
              OR oi.label_snapshot ILIKE '%أعلى%' OR oi.label_snapshot ILIKE '%اعلى%')`,
};
// Embroidery zones additionally require the zone to carry real content (text/image), so
// "بيها تطريز" excludes a plain (سادة) zone. Pleats encode their yes/no in customer_text.
const ZONE_NEEDS_CONTENT = new Set([
  'sash_right', 'sash_left', 'sash_back', 'cap_side', 'cap_top',
  'sash_front', 'robe_sleeve_right', 'robe_sleeve_left', 'american_shawl',
  // Merged garment zones inherit the content rule from their members.
  'sash_any', 'cap_any',
]);

function orderZoneClause(zone, alias = 'o') {
  const match = ORDER_ZONE_MATCH[zone];
  if (!match) return null;
  // Migration 080: a zone whose only content is a generated plate still has content.
  const content = ZONE_NEEDS_CONTENT.has(zone)
    ? ` AND ((oi.customer_text IS NOT NULL AND btrim(oi.customer_text) <> '')
             OR oi.customer_image_url IS NOT NULL OR oi.plate_image_url IS NOT NULL)`
    : '';
  return `EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = ${alias}.id AND ${match}${content})`;
}

async function listOrders(req, res) {
  const { wholesaler_id, batch_id, status, from, to, source, type, group, zone, approval } = req.query;
  // FIELD VISIBILITY (mirrors getOrder): this route is reachable by any staff role
  // (incl. read-only tailor/presser), so cost/profit and intake PII must NOT leak.
  // Only manager/admin see cost/profit + intake; price additionally to embroiderer.
  const myTypes = staffTypesOf(req.user);
  const canSeeMoney = req.user.role === 'admin' || myTypes.includes('manager');
  const canSeePrice = canSeeMoney || myTypes.includes('embroiderer');
  const params = [];
  const where = [];
  // «إرجاع للطالب»: an order handed back to the student leaves the orders list until resubmitted
  // (so it no longer clutters the production/admin queue). ?returned=1 surfaces them for review.
  if (req.query.returned === '1') where.push('o.returned_to_customer = TRUE');
  else where.push('o.returned_to_customer = FALSE');
  if (wholesaler_id) {
    params.push(wholesaler_id);
    where.push(`s.wholesaler_id = $${params.length}`);
  }
  if (batch_id) {
    params.push(batch_id);
    where.push(`o.batch_id = $${params.length}`);
  }
  // Source filter: retail = independent students (no wholesaler), wholesaler = rep-linked.
  if (source === 'retail') where.push('s.wholesaler_id IS NULL');
  else if (source === 'wholesaler') where.push('s.wholesaler_id IS NOT NULL');
  // Embroidery-zone / pleat filter (no bound param — predicate is constant text).
  const zoneClause = zone ? orderZoneClause(zone, 'o') : null;
  if (zoneClause) where.push(zoneClause);
  if (status) {
    params.push(status);
    where.push(`o.status = $${params.length}`);
  } else if (group !== 'bundle') {
    // Cancelled rows remain available through the explicit status filter, but never
    // silently enter default lists or their totals.
    where.push(`o.status <> 'cancelled'`);
  }
  if (from) {
    params.push(from);
    where.push(`o.created_at >= ($${params.length}::date AT TIME ZONE 'Asia/Baghdad')`);
  }
  if (to) {
    params.push(to);
    // A date input means the whole local calendar day, not midnight at its start.
    where.push(`o.created_at < (($${params.length}::date + INTERVAL '1 day') AT TIME ZONE 'Asia/Baghdad')`);
  }
  // Wholesaler approval visibility:
  //  • admin = full oversight (sees pending/rejected) + optional ?approval= filter
  //  • any other role (staff via /api/orders) = gated to approved + retail only (spec: staff see only approved)
  if (req.user.role === 'admin') {
    if (['pending', 'approved', 'rejected'].includes(approval)) {
      params.push(approval);
      where.push(`o.wholesaler_approval = $${params.length}`);
    }
  } else {
    where.push(`(s.wholesaler_id IS NULL OR o.wholesaler_approval = 'approved')`);
  }

  // `type` filter — only applicable in item (flat) mode
  const typeFilter = type && VALID_PRODUCT_TYPES.includes(type) ? type : null;

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  // ── group=bundle: aggregate orders into bundles ──
  if (group === 'bundle') {
    // Pull all matching flat rows (no pagination — bundles group across rows).
    // Note: bundle mode does not apply the `type` filter (bundles span types).
    const bundleSql = `
      SELECT o.id AS order_id, o.checkout_group_id,
             u.name AS student_name, s.university_name,
             o.created_at,
             o.price, COALESCE(o.cost, 0) AS cost, COALESCE(o.profit, 0) AS profit,
             p.name_ar AS product_name, p.type AS product_type, o.status,
             o.wholesaler_approval,
             cg.customer_name AS intake_customer_name, cg.instagram_username AS intake_instagram,
             cg.phone_primary, cg.phone_secondary, cg.governorate, cg.area_details,
             cg.event_date::text AS event_date, cg.deposit, cg.notes AS intake_notes
      FROM orders o
      JOIN students s ON s.id = o.student_id
      JOIN users u ON u.id = s.user_id
      JOIN products p ON p.id = o.product_id
      LEFT JOIN wholesalers w ON w.id = s.wholesaler_id
      LEFT JOIN users wu ON wu.id = w.user_id
      LEFT JOIN checkout_groups cg ON cg.id = o.checkout_group_id
      ${whereSql}
      ORDER BY o.checkout_group_id NULLS LAST, o.created_at ASC`;
    const { rows } = await query(bundleSql, params);
    const calculationByOrder = canSeeMoney ? await moneyCalculations(rows) : new Map();

    // Group by checkout_group_id; NULL rows each become their own single-item bundle
    const bundleMap = new Map();
    for (const row of rows) {
      const key = row.checkout_group_id || `solo:${row.order_id}`;
      if (!bundleMap.has(key)) {
        bundleMap.set(key, {
          checkout_group_id: row.checkout_group_id,
          student_name: row.student_name,
          university_name: row.university_name,
          created_at: row.created_at,
          total_price: 0,
          total_cost: 0,
          total_profit: 0,
          // wholesaler_approval is the same for every row in a bundle (set atomically per checkout_group_id).
          wholesaler_approval: row.wholesaler_approval || null,
          // full-set form bundles carry intake (delivery/phones/event/deposit); cart bundles don't
          intake: row.intake_customer_name ? {
            customer_name: row.intake_customer_name,
            instagram_username: row.intake_instagram,
            phone_primary: row.phone_primary,
            phone_secondary: row.phone_secondary,
            governorate: row.governorate,
            area_details: row.area_details,
            event_date: row.event_date,
            deposit: Number(row.deposit) || 0,
            notes: row.intake_notes,
          } : null,
          items: [],
        });
      }
      const b = bundleMap.get(key);
      // cancelled pieces stay visible as items but must not inflate the bundle money
      if (row.status !== 'cancelled') {
        b.total_price += Number(row.price) || 0;
        b.total_cost += Number(row.cost) || 0;
        b.total_profit += Number(row.profit) || 0;
      }
      b.items.push({
        order_id: row.order_id,
        product_name: row.product_name,
        product_type: row.product_type,
        status: row.status,
        price: Number(row.price) || 0,
        cost: Number(row.cost) || 0,
        profit: Number(row.profit) || 0,
        calculation: canSeeMoney ? calculationFor(row, calculationByOrder) : undefined,
      });
    }

    let bundles = Array.from(bundleMap.values());
    if (!canSeeMoney || !canSeePrice) {
      bundles = bundles.map((b) => {
        const out = { ...b };
        if (!canSeeMoney) { out.intake = null; delete out.total_cost; delete out.total_profit; }
        if (!canSeePrice) delete out.total_price;
        out.items = out.items.map((it) => {
          const i = { ...it };
          if (!canSeeMoney) { delete i.cost; delete i.profit; }
          if (!canSeePrice) delete i.price;
          return i;
        });
        return out;
      });
    }
    return res.json({ data: { bundles } });
  }

  // ── Default flat mode (existing behavior + optional type filter) ──
  if (typeFilter) {
    params.push(typeFilter);
    where.push(`p.type = $${params.length}`);
  }
  const flatWhereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const countRes = await query(
    `SELECT COUNT(*)::int AS total FROM orders o
     JOIN students s ON s.id = o.student_id
     JOIN products p ON p.id = o.product_id
     ${flatWhereSql}`,
    params
  );

  const dataParams = [...params, limit, offset];
  const sql = `
    SELECT o.id, s.id AS student_id, u.name AS student_full_name,
           s.university_name, s.department,
           p.name_ar AS product_name, p.type AS product_type,
           wu.name AS wholesaler_name,
           CASE WHEN s.wholesaler_id IS NULL THEN 'retail' ELSE 'wholesaler' END AS source,
           o.checkout_group_id,
           o.working_staff_id,
           CASE WHEN o.working_since > NOW() - INTERVAL '90 seconds' THEN wk.name END AS working_staff_name,
           o.delivery_method, o.recipient_name, o.delivered_at,
           o.price, o.cost, o.profit, o.status, o.created_at,
           o.wholesaler_approval
    FROM orders o
    JOIN students s ON s.id = o.student_id
    JOIN users u ON u.id = s.user_id
    JOIN products p ON p.id = o.product_id
    LEFT JOIN wholesalers w ON w.id = s.wholesaler_id
    LEFT JOIN users wu ON wu.id = w.user_id
    LEFT JOIN users wk ON wk.id = o.working_staff_id
    ${flatWhereSql}
    ORDER BY o.created_at DESC
    LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`;
  const { rows } = await query(sql, dataParams);
  const calculationByOrder = canSeeMoney ? await moneyCalculations(rows) : new Map();
  const explainedRows = canSeeMoney
    ? rows.map((r) => ({ ...r, calculation: calculationFor(r, calculationByOrder) }))
    : rows;
  const data = (!canSeeMoney || !canSeePrice)
    ? explainedRows.map((r) => {
        const o = { ...r };
        if (!canSeeMoney) { delete o.cost; delete o.profit; delete o.calculation; }
        if (!canSeePrice) delete o.price;
        return o;
      })
    : explainedRows;
  res.json({ data, total: countRes.rows[0].total, limit, offset });
}

async function updateStatus(req, res) {
  const { id } = req.params;
  const { status } = req.body;
  if (!ALL_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'حالة غير صالحة', code: 'ERR_VALIDATION' });
  }
  const cur = await query(
    `SELECT o.id, o.status, s.user_id, s.wholesaler_id
     FROM orders o JOIN students s ON s.id = o.student_id
     WHERE o.id = $1`,
    [id]
  );
  if (!cur.rows.length) {
    return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  }
  // Scope guard: a retail/wholesaler-scoped staffer may only touch orders of their
  // source (manager/admin bypass). Mirrors the /production advance|revert routes —
  // this legacy PATCH must not be an unguarded side door into the state machine.
  if (!staffScopeAllows(req.user, cur.rows[0].wholesaler_id == null)) {
    return res.status(403).json({ error: 'هذا الطلب خارج نطاقك', code: 'ERR_FORBIDDEN' });
  }
  const prev = cur.rows[0].status;
  if (prev !== status && !(TRANSITIONS[prev] || []).includes(status)) {
    return res.status(409).json({ error: 'انتقال حالة غير مسموح', code: 'ERR_INVALID_TRANSITION' });
  }
  // Line staff may only advance their own stage; manager staff_type + admin role bypass.
  if (prev !== status && !canStaffTransition(req.user, prev, status)) {
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  }
  const deliveredSet = status === 'delivered' ? ', delivered_at = NOW()' : '';
  const updated = await tx(async (client) => {
    const { rows } = await client.query(
      `UPDATE orders SET status = $1${deliveredSet} WHERE id = $2 RETURNING id, status`,
      [status, id]
    );
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'status_change', 'order', $2, $3)`,
      [req.user.id, id, JSON.stringify({ from: prev, to: status })]
    );
    // ⚠️ «منو نقلها؟» READS `staff_activity_log`, NOT `audit_log` (2026-09-01). This endpoint is
    // a second door onto the same state machine as /production/orders/:id/advance|revert, and it
    // wrote only the audit row — so a piece moved through here reached التجهيز with NOBODY named
    // on the staff order page, which is precisely the «راح لوحده وما نقله أحد» the stage-history
    // card was built to answer. Measured on prod: every gap in that card traces to a writer that
    // skipped this table. Same shape as performAdvance's row so the card cannot tell them apart;
    // 'advance'/'revert' are chosen by DIRECTION because payroll and staff goals count
    // `action IN ('advance','approve_design')` and a forward move made here is real work.
    const fromIdx = STAGE_ORDER.indexOf(prev);
    const toIdx = STAGE_ORDER.indexOf(status);
    if (prev !== status && fromIdx !== -1 && toIdx !== -1) {
      await client.query(
        `INSERT INTO staff_activity_log (user_id, action, order_id, from_stage, to_stage)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.user.id, toIdx > fromIdx ? 'advance' : 'revert', id, prev, status]
      );
    }
    await client.query(
      `INSERT INTO notifications (user_id, type, title_ar, body_ar, link)
       VALUES ($1, 'status_change', $2, $3, '/')`,
      [cur.rows[0].user_id, 'تحديث حالة الطلب', `حالة طلبك الآن: ${STATUS_LABEL_AR[status]}`]
    );
    return rows[0];
  });
  publish({ type: 'order', orderId: updated.id, status: updated.status });
  res.json({ data: updated });
}

// Validate + price a set of option selections for a product at a price role.
// Shared by the order configurator and the retail cart so pricing/validation lives in
// one place. Returns { ok:true, total, items, hasEmbroidery } or { ok:false, status, error, code }.
async function priceSelections({ productId, role, selections, studentGender }) {
  const prod = await query(
    `SELECT p.id, p.parent_id, p.gender_restriction, COALESCE(ppr.base_price, p.base_price) AS base_price
     FROM products p
     LEFT JOIN product_price_roles ppr ON ppr.product_id = p.id AND ppr.role = $2
     WHERE p.id = $1 AND p.active = TRUE`,
    [productId, role]
  );
  if (!prod.rows.length) {
    return { ok: false, status: 404, error: 'المنتج غير موجود', code: 'ERR_NOT_FOUND' };
  }
  if (prod.rows[0].gender_restriction && prod.rows[0].gender_restriction !== studentGender) {
    return { ok: false, status: 403, error: 'هذا المنتج غير متاح', code: 'ERR_GENDER' };
  }

  // Child products inherit their parent's option groups (same as catalog getProductFull),
  // so validate against own + inherited groups — not just the product's own (else every
  // inherited-group selection on a child product is wrongly rejected as "خيار غير صالح").
  const groupProductIds = prod.rows[0].parent_id
    ? [productId, prod.rows[0].parent_id]
    : [productId];
  // Migration 092 — the group audience filter, and this is the half that ENFORCES it.
  // catalogController hides a restricted group from the configurator; hiding alone still
  // accepts a hand-posted `group_id`, so the price path must refuse it independently.
  // Filtering here (rather than rejecting later) also means a retail-only group that is
  // `required` cannot block a rep-linked student's checkout: the group simply does not
  // exist for them, exactly like a group on another product.
  // ⚠️ `role` is the PRICE role — a rep-linked student resolves to 'wholesaler'
  // (priceRoleForUser), and this path always derives it from the user, never from a
  // `?role=` query param. That is what makes 'retail' mean «الطلاب العاديين فقط» here.
  const groups = await query(
    `SELECT id, name_ar, required, max_select, input_type, gender_restriction,
            requires_customer_image, requires_customer_text, is_embroidery
     FROM option_groups
      WHERE product_id = ANY($1::uuid[]) AND active = TRUE
        AND (price_role_restriction IS NULL OR price_role_restriction = $2::price_role)`,
    [groupProductIds, role]
  );
  const groupMap = new Map(groups.rows.map((g) => [g.id, g]));
  const sel = Array.isArray(selections) ? selections : [];
  const groupCounts = new Map();
  for (const s of sel) {
    const count = (groupCounts.get(s.group_id) || 0) + 1;
    groupCounts.set(s.group_id, count);
    // Every current input type represents one row per group (counter quantity lives in
    // `qty`). Reject duplicates instead of silently charging the same option twice.
    if (count > 1) {
      return { ok: false, status: 400, error: 'خيار مكرر في الطلب', code: 'ERR_VALIDATION' };
    }
  }
  const selectedGroupIds = new Set(sel.map((s) => s.group_id));
  for (const g of groups.rows) {
    if (g.required && !selectedGroupIds.has(g.id)) {
      return { ok: false, status: 400, error: `يرجى اختيار: ${g.name_ar}`, code: 'ERR_REQUIRED_OPTION' };
    }
  }

  // Batch-fetch every selected option in one query (avoids per-option N+1 round-trips).
  const optionIds = sel.map((s) => s.option_id).filter(Boolean);
  const optMap = new Map();
  if (optionIds.length) {
    const opts = await query(
      `SELECT o.id, o.group_id, o.label_ar, o.requires_customer_image, o.requires_customer_text,
              COALESCE(opr.price_delta, o.price_delta) AS price_delta
       FROM options o
       LEFT JOIN option_price_roles opr ON opr.option_id = o.id AND opr.role = $2
       WHERE o.id = ANY($1) AND o.active = TRUE`,
      [optionIds, role]
    );
    for (const o of opts.rows) optMap.set(o.id, o);
  }

  let total = prod.rows[0].base_price;
  const items = [{ label: 'السعر الأساسي', price: total, group_id: null, option_id: null, qty: 1, customer_text: null }];
  let hasEmbroidery = false;

  for (const s of sel) {
    const g = groupMap.get(s.group_id);
    if (!g) return { ok: false, status: 400, error: 'خيار غير صالح', code: 'ERR_VALIDATION' };
    if (g.gender_restriction && g.gender_restriction !== studentGender) {
      return { ok: false, status: 403, error: 'خيار غير متاح', code: 'ERR_GENDER' };
    }
    const qty = g.input_type === 'counter'
      ? Math.min(Math.max(parseInt(s.qty, 10) || 1, 1), g.max_select)
      : 1;
    const opt = optMap.get(s.option_id);
    if (!opt || opt.group_id !== s.group_id) {
      return { ok: false, status: 400, error: 'خيار غير صالح', code: 'ERR_VALIDATION' };
    }
    // customer must upload a reference photo when group or option requires it (e.g. مثلث)
    const needsImage = g.requires_customer_image || opt.requires_customer_image;
    if (needsImage && !s.customer_image_url) {
      return { ok: false, status: 400, error: `يرجى رفع صورة لـ ${g.name_ar}`, code: 'ERR_CUSTOMER_IMAGE_REQUIRED' };
    }
    // customer must provide embroidery text when group or option requires it
    const needsText = g.requires_customer_text || opt.requires_customer_text;
    if (needsText && (!s.customer_text || !String(s.customer_text).trim())) {
      return { ok: false, status: 400, error: `يرجى كتابة التفاصيل المطلوبة لـ ${g.name_ar}`, code: 'ERR_CUSTOMER_TEXT_REQUIRED' };
    }
    // Persist ANY text the customer typed — including OPTIONAL typed fields (e.g. sash
    // «تطريز يمين» / «تطريز من الخلف») whose group isn't flagged required. Without this, a
    // non-required field would silently drop the value the customer entered.
    const providedText =
      s.customer_text != null && String(s.customer_text).trim() !== ''
        ? String(s.customer_text).trim()
        : null;
    const providedImage = s.customer_image_url ? String(s.customer_image_url) : null;
    // Track embroidery/design work: a required image/text — OR any reference photo / text the
    // customer supplied (e.g. an image-only sash zone) — means there's design work, so the
    // piece routes to the staff design stage (design_complete).
    //
    // ⚠️ UNLESS THE GROUP IS A PRODUCT PICKER (migration 096, owner 2026-08-31). «صورة الشال»
    // and «صورة القبعة» ask WHICH product the student wants and record the answer as
    // customer_text — which used to trip this line and route the piece to التصميم → التطريز.
    // 468 شال امريكي orders went that way and none of them carried a single «تطريز» line;
    // they then sat at التطريز showing ZERO zones, because productionController's ZONE_DEFS
    // correctly says the American shawl is not embroidery. The two rules contradicted each
    // other and the pieces fell in the gap. `is_embroidery IS NULL` means unset = yes.
    const groupIsEmbroidery = g.is_embroidery !== false;
    if (groupIsEmbroidery && (needsImage || needsText || providedText || providedImage)) {
      hasEmbroidery = true;
    }

    const line = opt.price_delta * qty;
    total += line;
    items.push({
      label: `${g.name_ar}: ${opt.label_ar}${qty > 1 ? ' ×' + qty : ''}`,
      price: line, group_id: s.group_id, option_id: opt.id, qty,
      customer_image_url: s.customer_image_url || null,
      customer_text: providedText,
    });
  }
  return { ok: true, total, items, hasEmbroidery };
}

// Shared retail robe validation. Staff retail-order edits and the student configurator must
// accept/reject the exact same measurement payload; keeping the rules here prevents the
// privileged editor from becoming a looser side door.
function validateRobeMeasurements(productType, measurements) {
  if (productType !== 'robe') return null;
  const m = measurements || {};
  const { shoulder_cm, chest_cm, robe_length_cm, sleeve_length_cm } = m;
  if (
    !isFinite(Number(shoulder_cm)) || Number(shoulder_cm) <= 0 ||
    !isFinite(Number(robe_length_cm)) || Number(robe_length_cm) <= 0 ||
    !isFinite(Number(sleeve_length_cm)) || Number(sleeve_length_cm) <= 0
  ) {
    return 'يرجى إدخال قياسات الروب';
  }
  const chestNum = Number(chest_cm);
  if (chest_cm != null && chest_cm !== '' && isFinite(chestNum) && chestNum > 0) {
    if (chestNum < 60 || chestNum > 180) {
      return 'قياسات الروب غير صالحة — محيط الصدر يجب أن يكون بين 60 و 180 سم';
    }
  }
  return null;
}

// ---------- Configure order from selected options (retail student) ----------
async function configureOrder(req, res) {
  const { product_id, design_id, batch_id, selections, measurements } = req.body;
  if (!product_id) {
    return res.status(400).json({ error: 'المنتج مطلوب', code: 'ERR_VALIDATION' });
  }
  const st = await query(
    `SELECT id, gender, status, wholesaler_id FROM students WHERE user_id = $1`, [req.user.id]
  );
  if (!st.rows.length) {
    return res.status(404).json({ error: 'حساب الطالب غير موجود', code: 'ERR_NOT_FOUND' });
  }
  const student = st.rows[0];
  if (student.wholesaler_id) {
    return res.status(403).json({
      error: 'استخدم نموذج طلب الممثل حتى تُطبّق التسعيرة والموافقة بصورة صحيحة',
      code: 'ERR_REP_ORDER_FLOW',
    });
  }
  const role = await priceRoleForUser(req.user);

  // Fetch product type for robe validation
  const prodTypeRes = await query(`SELECT type FROM products WHERE id = $1 AND active = TRUE`, [product_id]);
  if (!prodTypeRes.rows.length) {
    return res.status(404).json({ error: 'المنتج غير موجود', code: 'ERR_NOT_FOUND' });
  }
  const productType = prodTypeRes.rows[0].type;

  // Robe requires measurements (قياسات الروب). محيط الصدر is optional.
  const measurementError = validateRobeMeasurements(productType, measurements);
  if (measurementError) {
    return res.status(400).json({ error: measurementError, code: 'ERR_VALIDATION' });
  }

  // auto-attach rep orders to their wholesaler's most recent batch
  let resolvedBatchId = null;
  if (batch_id) {
    // Client-supplied batch must belong to this student's wholesaler (no cross-tenant linkage).
    const owned = await query(
      `SELECT id FROM batches WHERE id = $1 AND wholesaler_id = $2`,
      [batch_id, student.wholesaler_id]
    );
    if (!owned.rows.length) {
      return res.status(403).json({ error: 'الدفعة غير صالحة', code: 'ERR_FORBIDDEN' });
    }
    resolvedBatchId = batch_id;
  } else if (student.wholesaler_id) {
    const b = await query(
      `SELECT id FROM batches WHERE wholesaler_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [student.wholesaler_id]
    );
    resolvedBatchId = b.rows[0]?.id || null;
  }

  const priced = await priceSelections({
    productId: product_id, role, selections, studentGender: student.gender,
  });
  if (!priced.ok) {
    return res.status(priced.status).json({ error: priced.error, code: priced.code });
  }
  const { total, items } = priced;

  // Compute routing flags
  const has_embroidery = !!design_id || priced.hasEmbroidery;
  const needs_pressing = productType !== 'cap';

  // Determine initial status based on routing
  let initialStatus;
  if (design_id) {
    initialStatus = 'design_complete';
  } else if (priced.hasEmbroidery) {
    initialStatus = 'design_complete'; // designer handles design-less embroidery
  } else {
    // المكوجي gets every piece except caps (user 2026-07-15): a plain sash/robe/shawl
    // starts at الكوي; only plain caps go straight to التجهيز.
    initialStatus = productType === 'cap' ? 'preparing' : 'pressing';
  }

  const measurementsJson = (productType === 'robe' && measurements) ? JSON.stringify(measurements) : null;

  // Reconcile with an existing order to avoid duplicates:
  //  - sash: the designer auto-creates a 'designing' order keyed by design_id → update it
  //  - other products: one order per (student, product) without a design → update on re-config
  // `status <> 'cancelled'` matches configurePackage/configureFullSet and
  // uq_orders_student_product_nodesign's own partial-index definition (WHERE design_id IS
  // NULL AND status <> 'cancelled') — without it, a cancelled row for the same product could
  // be the ONLY match (no ORDER BY/LIMIT), silently reviving a piece staff already cancelled
  // instead of starting a fresh order the way every sibling "configure" endpoint does.
  const existing = design_id
    ? await query(`SELECT id FROM orders WHERE student_id = $1 AND design_id = $2 AND status <> 'cancelled'`, [student.id, design_id])
    : await query(`SELECT id FROM orders WHERE student_id = $1 AND product_id = $2 AND design_id IS NULL AND status <> 'cancelled'`, [student.id, product_id]);

  const orderId = await tx(async (client) => {
    let oid;
    // The generated plate is server-side and never in the payload, so the DELETE below
    // would throw away artwork the shop already paid for. See lib/platePreservation.js.
    let preservedPlates;
    if (existing.rows.length) {
      oid = existing.rows[0].id;
      preservedPlates = await capturePlates(client, oid);
      await client.query(
        `UPDATE orders SET price = $1, batch_id = $2, status = $3,
         has_embroidery = $4, needs_pressing = $5, measurements = $6,
         -- Resubmitting a returned order clears the flag so it re-enters the production queue.
         returned_to_customer = FALSE, returned_reason = NULL
         WHERE id = $7`,
        [total, resolvedBatchId, initialStatus, has_embroidery, needs_pressing, measurementsJson, oid]
      );
      await client.query(`DELETE FROM order_items WHERE order_id = $1`, [oid]);
    } else {
      const o = await client.query(
        `INSERT INTO orders (student_id, product_id, design_id, batch_id, price, status,
                             has_embroidery, needs_pressing, measurements)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [student.id, product_id, design_id || null, resolvedBatchId, total, initialStatus,
         has_embroidery, needs_pressing, measurementsJson]
      );
      oid = o.rows[0].id;
    }
    for (const it of items) {
      await client.query(
        `INSERT INTO order_items (order_id, group_id, option_id, label_snapshot, price_snapshot, qty, customer_image_url, customer_text, plate_image_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [oid, it.group_id, it.option_id, it.label, it.price, it.qty,
         it.customer_image_url || null, it.customer_text || null,
         plateFor(preservedPlates, it.label)]
      );
    }
    return oid;
  });

  publish({ type: 'order_new', orderId });
  res.status(201).json({ data: { order_id: orderId, price_role: role, total, breakdown: items } });
}

// ---------- Configure package (wholesaler selection or rep student bundle) ----------
async function configurePackage(req, res) {
  const { package_id, cap_option_id, batch_id } = req.body;
  if (!package_id) {
    return res.status(400).json({ error: 'الباقة مطلوبة', code: 'ERR_VALIDATION' });
  }

  const pkg = await query(
    `SELECT p.id, p.name_ar, p.price, p.active,
            pr.sash_type_option_id,
            o.label_ar AS sash_type_label
     FROM packages p
     LEFT JOIN package_rules pr ON pr.package_id = p.id
     LEFT JOIN options o ON o.id = pr.sash_type_option_id
     WHERE p.id = $1 AND p.active = TRUE`,
    [package_id]
  );
  if (!pkg.rows.length) {
    return res.status(404).json({ error: 'الباقة غير موجودة', code: 'ERR_NOT_FOUND' });
  }
  const packageRow = pkg.rows[0];

  if (cap_option_id) {
    const capOpt = await query(
      `SELECT o.id FROM options o
       JOIN option_groups g ON g.id = o.group_id
       JOIN products p ON p.id = g.product_id AND p.type = 'cap'
       WHERE o.id = $1 AND o.active = TRUE`,
      [cap_option_id]
    );
    if (!capOpt.rows.length) {
      return res.status(400).json({ error: 'خيار القبعة غير صالح', code: 'ERR_VALIDATION' });
    }
  }

  if (req.user.role === 'wholesaler') {
    const w = await query(`SELECT id FROM wholesalers WHERE user_id = $1`, [req.user.id]);
    if (!w.rows.length) {
      return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
    }
    if (batch_id) {
      const owned = await query(
        `SELECT id FROM batches WHERE id = $1 AND wholesaler_id = $2`,
        [batch_id, w.rows[0].id]
      );
      if (!owned.rows.length) {
        return res.status(403).json({ error: 'الدفعة غير صالحة', code: 'ERR_FORBIDDEN' });
      }
    }
    await query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'select_package', 'package', $2, $3)`,
      [
        req.user.id,
        package_id,
        JSON.stringify({
          cap_option_id: cap_option_id || null,
          batch_id: batch_id || null,
          package_name: packageRow.name_ar,
        }),
      ]
    );
    publish({ type: 'order_new', orderId: package_id });
    return res.status(201).json({ data: { order_id: package_id } });
  }

  const st = await query(
    `SELECT id, gender, status, wholesaler_id FROM students WHERE user_id = $1`, [req.user.id]
  );
  if (!st.rows.length) {
    return res.status(404).json({ error: 'حساب الطالب غير موجود', code: 'ERR_NOT_FOUND' });
  }
  const student = st.rows[0];
  if (student.wholesaler_id) {
    return res.status(403).json({
      error: 'استخدم نموذج طلب الممثل حتى تُطبّق التسعيرة والموافقة بصورة صحيحة',
      code: 'ERR_REP_ORDER_FLOW',
    });
  }
  let resolvedBatchId = null;
  if (batch_id) {
    const owned = await query(
      `SELECT id FROM batches WHERE id = $1 AND wholesaler_id = $2`,
      [batch_id, student.wholesaler_id]
    );
    if (!owned.rows.length) {
      return res.status(403).json({ error: 'الدفعة غير صالحة', code: 'ERR_FORBIDDEN' });
    }
    resolvedBatchId = batch_id;
  } else {
    const b = await query(
      `SELECT id FROM batches WHERE wholesaler_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [student.wholesaler_id]
    );
    resolvedBatchId = b.rows[0]?.id || null;
  }

  const prods = await query(
    `SELECT id, type FROM products WHERE type IN ('sash','robe','cap') AND active = TRUE
     ORDER BY type, featured DESC, sort, created_at`
  );
  const byType = {};
  for (const p of prods.rows) if (!byType[p.type]) byType[p.type] = p.id;
  // EDIT STABILITY: an existing package order pins the product per piece type, so a
  // catalog change (e.g. a new featured product) can't fork a duplicate on re-submit —
  // same class as the 2026-07-16 طقم bug. Cart orders (package_id NULL) are never touched.
  const pinnedPkg = await query(
    `SELECT DISTINCT ON (p.type) p.type, o.product_id
     FROM orders o JOIN products p ON p.id = o.product_id
     WHERE o.student_id = $1 AND o.design_id IS NULL AND o.status <> 'cancelled'
       AND o.package_id IS NOT NULL AND p.type IN ('sash','robe','cap')
     ORDER BY p.type, o.created_at DESC`,
    [student.id]
  );
  for (const r of pinnedPkg.rows) byType[r.type] = r.product_id;

  if (!byType.sash || !byType.robe || !byType.cap) {
    return res.status(500).json({ error: 'منتجات الباقة غير مكتملة في النظام', code: 'ERR_CONFIG' });
  }

  const productPrices = {
    [byType.sash]: packageRow.price,
    [byType.robe]: 0,
    [byType.cap]: 0,
  };

  const orderIds = await tx(async (client) => {
    const ids = {};
    for (const [prodId, price] of Object.entries(productPrices)) {
      const existing = await client.query(
        `SELECT id FROM orders WHERE student_id = $1 AND product_id = $2 AND design_id IS NULL AND status <> 'cancelled'`,
        [student.id, prodId]
      );
      // Only the sash is designed by the student; the robe passes through الكوي first
      // (المكوجي gets everything except caps), the cap enters the preparer's queue directly.
      const pkgStatus = prodId === byType.sash ? 'designing' : prodId === byType.cap ? 'preparing' : 'pressing';
      // كوي (pressing) follows embroidery for sashes & robes; caps skip it. (Only the
      // sash actually reaches the embroidery→pressing edge here — robe/cap start at
      // 'preparing' — but keep it type-based for consistency with every other path.)
      const pkgNeedsPressing = prodId === byType.sash || prodId === byType.robe;
      let oid;
      // Server-side plate must survive the DELETE — see lib/platePreservation.js.
      let preservedPlates;
      if (existing.rows.length) {
        oid = existing.rows[0].id;
        preservedPlates = await capturePlates(client, oid);
        await client.query(
          `UPDATE orders SET price = $1, batch_id = $2, package_id = $3, status = $4, needs_pressing = $5 WHERE id = $6`,
          [price, resolvedBatchId, package_id, pkgStatus, pkgNeedsPressing, oid]
        );
        await client.query(`DELETE FROM order_items WHERE order_id = $1`, [oid]);
      } else {
        const o = await client.query(
          `INSERT INTO orders (student_id, product_id, batch_id, package_id, price, status, needs_pressing)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [student.id, prodId, resolvedBatchId, package_id, price, pkgStatus, pkgNeedsPressing]
        );
        oid = o.rows[0].id;
      }
      // SELF-HEAL: never leave a second live package order of the same piece type
      // (cart orders have package_id NULL and are never touched).
      const pieceType = prodId === byType.sash ? 'sash' : prodId === byType.robe ? 'robe' : 'cap';
      await client.query(
        `UPDATE orders o SET status='cancelled'
         FROM products p
         WHERE p.id = o.product_id AND o.student_id = $1 AND p.type = $2 AND o.id <> $3
           AND o.package_id IS NOT NULL AND o.design_id IS NULL AND o.status <> 'cancelled'`,
        [student.id, pieceType, oid]
      );
      await client.query(
        `INSERT INTO order_items (order_id, label_snapshot, price_snapshot, qty, option_id, plate_image_url)
         VALUES ($1, $2, $3, 1, $4, $5)`,
        [
          oid,
          `باقة: ${packageRow.name_ar}`,
          price,
          prodId === byType.cap ? cap_option_id || null : packageRow.sash_type_option_id || null,
          plateFor(preservedPlates, `باقة: ${packageRow.name_ar}`),
        ]
      );
      ids[prodId] = oid;
    }
    return ids;
  });

  publish({ type: 'order_new' });
  res.status(201).json({
    data: {
      order_id: orderIds[byType.sash],
      package_id,
      package_name: packageRow.name_ar,
      total: packageRow.price,
      orders: orderIds,
    },
  });
}

// ---------- Full-set order (طقم كامل: روب + قبعة + وشاح) — the Instagram-form path ----------
// One structured submission = 3 linked orders + a checkout_groups intake row holding what
// the DM form captures per bundle: delivery address, two phones, event date, deposit.

const IRAQ_GOVERNORATES = [
  'بغداد', 'البصرة', 'نينوى', 'أربيل', 'النجف', 'كربلاء', 'كركوك', 'الأنبار', 'ديالى',
  'السليمانية', 'دهوك', 'صلاح الدين', 'بابل', 'واسط', 'ميسان', 'ذي قار', 'المثنى', 'الديوانية',
];

// Customers type phone numbers with Arabic-Indic digits (٠٧٨٣...) — normalize before validating.
function normalizeDigits(s) {
  return String(s ?? '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}
function cleanPhone(s) {
  return normalizeDigits(s).replace(/[\s\-()+]/g, '');
}
const IQ_PHONE_RE = /^07\d{9}$/;

function cleanText(v, max) {
  const t = v == null ? '' : String(v).trim();
  return t ? t.slice(0, max) : null;
}

const FULL_SET_LABEL_AR = { sash: 'الوشاح', robe: 'الروب', cap: 'القبعة' };

async function configureFullSet(req, res) {
  const { package_id, robe, cap, sash, delivery, event_date, notes } = req.body || {};
  if (!package_id) {
    return res.status(400).json({ error: 'الباقة مطلوبة', code: 'ERR_VALIDATION' });
  }

  const st = await query(
    `SELECT id, gender, status, wholesaler_id FROM students WHERE user_id = $1`, [req.user.id]
  );
  if (!st.rows.length) {
    return res.status(404).json({ error: 'حساب الطالب غير موجود', code: 'ERR_NOT_FOUND' });
  }
  const student = st.rows[0];
  if (student.wholesaler_id) {
    return res.status(403).json({
      error: 'استخدم نموذج طلب الممثل حتى تُطبّق التسعيرة والموافقة بصورة صحيحة',
      code: 'ERR_REP_ORDER_FLOW',
    });
  }
  const pkg = await query(
    `SELECT id, name_ar, price FROM packages
     WHERE id = $1 AND active = TRUE AND is_full_set = TRUE`,
    [package_id]
  );
  if (!pkg.rows.length) {
    return res.status(404).json({ error: 'الطقم غير موجود', code: 'ERR_NOT_FOUND' });
  }
  const packageRow = pkg.rows[0];

  // ── delivery / contact (group-level intake) ──
  const d = delivery || {};
  const customerName = cleanText(d.customer_name, 120);
  if (!customerName) {
    return res.status(400).json({ error: 'الاسم الكامل مطلوب', code: 'ERR_VALIDATION' });
  }
  const phonePrimary = cleanPhone(d.phone_primary);
  if (!IQ_PHONE_RE.test(phonePrimary)) {
    return res.status(400).json({ error: 'رقم الهاتف الأول غير صالح (07xxxxxxxxx)', code: 'ERR_VALIDATION' });
  }
  let phoneSecondary = null;
  if (d.phone_secondary && String(d.phone_secondary).trim()) {
    phoneSecondary = cleanPhone(d.phone_secondary);
    if (!IQ_PHONE_RE.test(phoneSecondary)) {
      return res.status(400).json({ error: 'رقم الهاتف الثاني غير صالح (07xxxxxxxxx)', code: 'ERR_VALIDATION' });
    }
  }
  const governorate = cleanText(d.governorate, 40);
  if (!governorate || !IRAQ_GOVERNORATES.includes(governorate)) {
    return res.status(400).json({ error: 'يرجى اختيار المحافظة', code: 'ERR_VALIDATION' });
  }
  const areaDetails = cleanText(d.area_details, 300);
  const instagram = cleanText(String(d.instagram_username || '').replace(/^@+/, ''), 60);

  let eventDate = null;
  if (event_date) {
    const ed = new Date(normalizeDigits(event_date));
    if (Number.isNaN(ed.getTime())) {
      return res.status(400).json({ error: 'تاريخ الحفلة غير صالح', code: 'ERR_VALIDATION' });
    }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (ed < today) {
      return res.status(400).json({ error: 'تاريخ الحفلة لا يمكن أن يكون في الماضي', code: 'ERR_VALIDATION' });
    }
    eventDate = ed.toISOString().slice(0, 10);
  }
  const groupNotes = cleanText(notes, 500);

  // ── robe measurements (قياسات الروب) — shoulder/length/sleeve required; chest optional ──
  const m = (robe && robe.measurements) || {};
  const measNum = (v) => {
    const n = Number(normalizeDigits(v));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const meas = {
    shoulder_cm: measNum(m.shoulder_cm),
    chest_cm: measNum(m.chest_cm),
    robe_length_cm: measNum(m.robe_length_cm),
    sleeve_length_cm: measNum(m.sleeve_length_cm),
    tailor_notes: cleanText(m.tailor_notes, 500),
    receipt_image_url: cleanText(m.receipt_image_url, 500),
  };
  const MEAS_RANGE = { shoulder_cm: [25, 80], chest_cm: [60, 180], robe_length_cm: [70, 190], sleeve_length_cm: [30, 100] };
  const MEAS_LABEL = { shoulder_cm: 'عرض الكتف', chest_cm: 'محيط الصدر', robe_length_cm: 'طول الروب', sleeve_length_cm: 'طول الردن' };
  const REQUIRED_MEAS = ['shoulder_cm', 'robe_length_cm', 'sleeve_length_cm'];
  for (const k of REQUIRED_MEAS) {
    if (meas[k] == null) {
      return res.status(400).json({
        error: `قياسات الروب غير صالحة — ${MEAS_LABEL[k]} مطلوب`,
        code: 'ERR_VALIDATION',
      });
    }
  }
  for (const [k, [lo, hi]] of Object.entries(MEAS_RANGE)) {
    if (meas[k] != null && (meas[k] < lo || meas[k] > hi)) {
      return res.status(400).json({
        error: `قياسات الروب غير صالحة — ${MEAS_LABEL[k]} يجب أن يكون بين ${lo} و ${hi} سم`,
        code: 'ERR_VALIDATION',
      });
    }
  }

  // ── sash text zones (يمين / يسار / خلف) — manufacturing content, not options ──
  const z = (sash && sash.zones) || {};
  const rightText = cleanText(z.right_text, 120);
  if (!rightText) {
    return res.status(400).json({ error: 'اسم الخريج على الجهة اليمنى مطلوب', code: 'ERR_VALIDATION' });
  }
  const leftMode = ['logo_year', 'text', 'plain'].includes(z.left_mode) ? z.left_mode : 'plain';
  const leftText = cleanText(z.left_text, 200);
  const leftLogoUrl = cleanText(z.left_logo_url, 500);
  if (leftMode === 'logo_year' && !leftLogoUrl) {
    return res.status(400).json({ error: 'يرجى رفع شعار الكلية للجهة اليسرى', code: 'ERR_VALIDATION' });
  }
  if (leftMode === 'text' && !leftText) {
    return res.status(400).json({ error: 'يرجى كتابة نص الجهة اليسرى', code: 'ERR_VALIDATION' });
  }
  const backText = cleanText(z.back_text, 300);

  // ── resolve the three products + price each item's selections ──
  // The package's admin-chosen composition (package_products) wins; any type it
  // doesn't pin falls back to the first active product of that type.
  const role = await priceRoleForUser(req.user);
  const byType = {};
  const pinned = await query(
    `SELECT p.id, p.type FROM package_products pl
     JOIN products p ON p.id = pl.product_id
     WHERE pl.package_id = $1 AND p.active = TRUE AND p.type IN ('sash','robe','cap')`,
    [package_id]
  );
  for (const p of pinned.rows) byType[p.type] = p.id;
  const prods = await query(
    `SELECT id, type FROM products WHERE type IN ('sash','robe','cap') AND active = TRUE
     ORDER BY type, featured DESC, sort, created_at`
  );
  for (const p of prods.rows) if (!byType[p.type]) byType[p.type] = p.id;
  // EDIT STABILITY: an existing package order pins the product per piece type on re-submit
  // (same duplicate class as the 2026-07-16 طقم bug; cart orders are never touched).
  const pinnedFs = await query(
    `SELECT DISTINCT ON (p.type) p.type, o.product_id
     FROM orders o JOIN products p ON p.id = o.product_id
     WHERE o.student_id = $1 AND o.design_id IS NULL AND o.status <> 'cancelled'
       AND o.package_id IS NOT NULL AND p.type IN ('sash','robe','cap')
     ORDER BY p.type, o.created_at DESC`,
    [student.id]
  );
  for (const r of pinnedFs.rows) byType[r.type] = r.product_id;
  if (!byType.sash || !byType.robe || !byType.cap) {
    return res.status(500).json({ error: 'منتجات الطقم غير مكتملة في النظام', code: 'ERR_CONFIG' });
  }

  const priced = {};
  for (const type of ['robe', 'cap', 'sash']) {
    const body = { robe, cap, sash }[type] || {};
    const p = await priceSelections({
      productId: byType[type], role,
      selections: body.selections || [],
      studentGender: student.gender,
    });
    if (!p.ok) {
      return res.status(p.status).json({
        error: `${FULL_SET_LABEL_AR[type]} — ${p.error}`, code: p.code,
      });
    }
    // Package pricing: the bundle price replaces the items' base prices; only option
    // deltas (e.g. ردن بكتابة +5000) are added on top.
    p.deltas = p.total - p.items[0].price;
    p.optionLines = p.items.slice(1);
    priced[type] = p;
  }

  const itemPrice = {
    sash: Number(packageRow.price) + priced.sash.deltas,
    robe: priced.robe.deltas,
    cap: priced.cap.deltas,
  };
  const total = itemPrice.sash + itemPrice.robe + itemPrice.cap;

  // Sash always carries name embroidery in the form path; robe/cap only when an
  // option requires text/image. Same routing rules as configureOrder.
  const itemFlags = {
    sash: { has_embroidery: true, status: 'design_complete' },
    // Plain robe → الكوي first (المكوجي gets everything except caps); plain cap → التجهيز.
    robe: { has_embroidery: priced.robe.hasEmbroidery, status: priced.robe.hasEmbroidery ? 'design_complete' : 'pressing' },
    cap: { has_embroidery: priced.cap.hasEmbroidery, status: priced.cap.hasEmbroidery ? 'design_complete' : 'preparing' },
  };

  // rep students auto-attach to their wholesaler's latest batch (same as configureOrder)
  let resolvedBatchId = null;
  if (student.wholesaler_id) {
    const b = await query(
      `SELECT id FROM batches WHERE wholesaler_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [student.wholesaler_id]
    );
    resolvedBatchId = b.rows[0]?.id || null;
  }

  // Synthesized manufacturing lines for the sash zones (group/option NULL is fine —
  // staff views render label + customer_text/image like any other order item).
  const zoneLines = [
    { label: 'الجهة اليمنى — اسم الخريج', customer_text: rightText, customer_image_url: null },
    leftMode === 'logo_year'
      ? { label: 'الجهة اليسرى — شعار الكلية وسنة التخرج', customer_text: leftText, customer_image_url: leftLogoUrl }
      : leftMode === 'text'
        ? { label: 'الجهة اليسرى — كتابة', customer_text: leftText, customer_image_url: null }
        : { label: 'الجهة اليسرى — سادة', customer_text: null, customer_image_url: null },
    backText
      ? { label: 'الوشاح من الخلف — كتابة', customer_text: backText, customer_image_url: null }
      : { label: 'الوشاح من الخلف — سادة', customer_text: null, customer_image_url: null },
  ];

  const result = await tx(async (client) => {
    // Reuse the intake row when the student re-submits the same bundle (their previous
    // full-set orders share a checkout_group_id that exists in checkout_groups).
    const prevGroup = await client.query(
      `SELECT cg.id FROM checkout_groups cg
       JOIN orders o ON o.checkout_group_id = cg.id
       WHERE o.student_id = $1 AND o.status <> 'cancelled'
       ORDER BY cg.created_at DESC LIMIT 1`,
      [student.id]
    );
    let cgId;
    const cgParams = [
      customerName, instagram, phonePrimary, phoneSecondary,
      governorate, areaDetails, eventDate, groupNotes,
    ];
    if (prevGroup.rows.length) {
      cgId = prevGroup.rows[0].id;
      await client.query(
        `UPDATE checkout_groups SET customer_name=$1, instagram_username=$2, phone_primary=$3,
           phone_secondary=$4, governorate=$5, area_details=$6, event_date=$7, notes=$8
         WHERE id = $9`,
        [...cgParams, cgId]
      );
    } else {
      const cg = await client.query(
        `INSERT INTO checkout_groups
           (customer_name, instagram_username, phone_primary, phone_secondary,
            governorate, area_details, event_date, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        cgParams
      );
      cgId = cg.rows[0].id;
    }

    const ids = {};
    for (const type of ['sash', 'robe', 'cap']) {
      const prodId = byType[type];
      const flags = itemFlags[type];
      const needsPressing = type !== 'cap';
      const measurementsJson = type === 'robe' ? JSON.stringify(meas) : null;
      const existing = await client.query(
        `SELECT id FROM orders
         WHERE student_id = $1 AND product_id = $2 AND design_id IS NULL AND status <> 'cancelled'`,
        [student.id, prodId]
      );
      let oid;
      // Server-side plate must survive the DELETE — see lib/platePreservation.js.
      let preservedPlates;
      if (existing.rows.length) {
        oid = existing.rows[0].id;
        preservedPlates = await capturePlates(client, oid);
        await client.query(
          `UPDATE orders SET price=$1, batch_id=$2, package_id=$3, checkout_group_id=$4,
             status=$5, has_embroidery=$6, needs_pressing=$7, measurements=$8
           WHERE id = $9`,
          [itemPrice[type], resolvedBatchId, package_id, cgId, flags.status, flags.has_embroidery, needsPressing, measurementsJson, oid]
        );
        await client.query(`DELETE FROM order_items WHERE order_id = $1`, [oid]);
      } else {
        const o = await client.query(
          `INSERT INTO orders (student_id, product_id, batch_id, package_id, checkout_group_id,
                               price, status, has_embroidery, needs_pressing, measurements)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [student.id, prodId, resolvedBatchId, package_id, cgId,
           itemPrice[type], flags.status, flags.has_embroidery, needsPressing, measurementsJson]
        );
        oid = o.rows[0].id;
      }

      // SELF-HEAL: never leave a second live package order of the same piece type
      // (cart orders have package_id NULL and are never touched).
      await client.query(
        `UPDATE orders o SET status='cancelled'
         FROM products p
         WHERE p.id = o.product_id AND o.student_id = $1 AND p.type = $2 AND o.id <> $3
           AND o.package_id IS NOT NULL AND o.design_id IS NULL AND o.status <> 'cancelled'`,
        [student.id, type, oid]
      );

      // base line: the package price sits on the sash order so bundle totals stay exact
      const baseLine = type === 'sash'
        ? { label: `طقم: ${packageRow.name_ar}`, price: Number(packageRow.price) }
        : { label: `ضمن طقم: ${packageRow.name_ar}`, price: 0 };
      const lines = [
        baseLine,
        ...priced[type].optionLines,
        ...(type === 'sash' ? zoneLines.map((l) => ({ ...l, price: 0 })) : []),
      ];
      for (const it of lines) {
        await client.query(
          `INSERT INTO order_items (order_id, group_id, option_id, label_snapshot, price_snapshot, qty,
                                    customer_image_url, customer_text, plate_image_url)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [oid, it.group_id || null, it.option_id || null, it.label, it.price || 0, it.qty || 1,
           it.customer_image_url || null, it.customer_text || null,
           plateFor(preservedPlates, it.label)]
        );
      }
      ids[type] = oid;
    }
    return { cgId, ids };
  });

  publish({ type: 'order_new', orderId: result.ids.sash });
  res.status(201).json({
    data: {
      checkout_group_id: result.cgId,
      package_id,
      package_name: packageRow.name_ar,
      total,
      items: ['sash', 'robe', 'cap'].map((t) => ({ type: t, order_id: result.ids[t], price: itemPrice[t] })),
      orders: result.ids,
    },
  });
}

// ---------- VIP upgrade (retail) ----------
// A bundle can be upgraded only while every piece is still pre-production.
const VIP_UPGRADEABLE_STATUSES = ['pending_approval', 'designing', 'design_complete', 'preparing'];
const BUNDLE_TYPES = ['sash', 'robe', 'cap'];

// Resolve the retail student's most-recent order group from a locator (package_id /
// checkout_group_id / order_id), with product type + VIP flag joined. Returns the rows
// of the chosen group (one cart checkout or one package bundle), most-recent first.
async function resolveBundleRows(studentId, { from_package_id, checkout_group_id, order_id }) {
  if (from_package_id) {
    return (await query(
      `SELECT o.id, o.status, o.price, o.design_id, o.package_id, o.checkout_group_id,
              p.type AS product_type, pk.is_vip AS pkg_is_vip, pk.name_ar AS pkg_name
       FROM orders o JOIN products p ON p.id = o.product_id
       LEFT JOIN packages pk ON pk.id = o.package_id
       WHERE o.student_id = $1 AND o.package_id = $2 AND o.status <> 'cancelled'
       ORDER BY o.created_at DESC`,
      [studentId, from_package_id]
    )).rows;
  }
  if (checkout_group_id) {
    return (await query(
      `SELECT o.id, o.status, o.price, o.design_id, o.package_id, o.checkout_group_id,
              p.type AS product_type, pk.is_vip AS pkg_is_vip, pk.name_ar AS pkg_name
       FROM orders o JOIN products p ON p.id = o.product_id
       LEFT JOIN packages pk ON pk.id = o.package_id
       WHERE o.student_id = $1 AND o.checkout_group_id = $2 AND o.status <> 'cancelled'
       ORDER BY o.created_at DESC`,
      [studentId, checkout_group_id]
    )).rows;
  }
  if (order_id) {
    const one = (await query(
      `SELECT o.id, o.package_id, o.checkout_group_id FROM orders o
       WHERE o.id = $1 AND o.student_id = $2 AND o.status <> 'cancelled'`,
      [order_id, studentId]
    )).rows[0];
    if (!one) return [];
    if (one.package_id) return resolveBundleRows(studentId, { from_package_id: one.package_id });
    if (one.checkout_group_id) return resolveBundleRows(studentId, { checkout_group_id: one.checkout_group_id });
    return (await query(
      `SELECT o.id, o.status, o.price, o.design_id, o.package_id, o.checkout_group_id,
              p.type AS product_type, pk.is_vip AS pkg_is_vip, pk.name_ar AS pkg_name
       FROM orders o JOIN products p ON p.id = o.product_id
       LEFT JOIN packages pk ON pk.id = o.package_id
       WHERE o.id = $1`,
      [order_id]
    )).rows;
  }
  return [];
}

// GET /orders/vip-upgrade-context — does this student have a bundle worth upgrading?
async function vipUpgradeContext(req, res) {
  const st = await query(`SELECT id FROM students WHERE user_id = $1`, [req.user.id]);
  if (!st.rows.length) return res.json({ data: { upgradeable: false, reason: 'no_student' } });
  const studentId = st.rows[0].id;

  // Most-recent non-cancelled order → its group is the upgrade candidate.
  const latest = (await query(
    `SELECT o.package_id, o.checkout_group_id, o.id
     FROM orders o WHERE o.student_id = $1 AND o.status <> 'cancelled'
     ORDER BY o.created_at DESC LIMIT 1`,
    [studentId]
  )).rows[0];
  if (!latest) return res.json({ data: { upgradeable: false, reason: 'none' } });

  const rows = await resolveBundleRows(studentId, {
    from_package_id: latest.package_id || undefined,
    checkout_group_id: latest.package_id ? undefined : latest.checkout_group_id || undefined,
    order_id: latest.package_id || latest.checkout_group_id ? undefined : latest.id,
  });
  if (!rows.length) return res.json({ data: { upgradeable: false, reason: 'none' } });

  const alreadyVip = rows.some((r) => r.pkg_is_vip);
  const inProduction = rows.some((r) => !VIP_UPGRADEABLE_STATUSES.includes(r.status));
  const presentTypes = new Set(rows.map((r) => r.product_type));
  const missingTypes = BUNDLE_TYPES.filter((t) => !presentTypes.has(t));
  const reason = alreadyVip ? 'already_vip' : inProduction ? 'in_production' : null;

  res.json({
    data: {
      upgradeable: !alreadyVip && !inProduction,
      reason,
      locator: latest.package_id
        ? { from_package_id: latest.package_id }
        : latest.checkout_group_id
          ? { checkout_group_id: latest.checkout_group_id }
          : { order_id: latest.id },
      order_ids: rows.map((r) => r.id),
      current_total: rows.reduce((s, r) => s + Number(r.price || 0), 0),
      package_name: rows.find((r) => r.pkg_name)?.pkg_name || null,
      missing_types: missingTypes,
    },
  });
}

// POST /orders/upgrade-vip — re-stamp the student's existing bundle to a VIP package,
// server-side priced, KEEPING the sash design + embroidery snapshots intact.
async function upgradeToVip(req, res) {
  const { package_id, from_package_id, checkout_group_id, order_id } = req.body;
  if (!package_id) return res.status(400).json({ error: 'باقة VIP مطلوبة', code: 'ERR_VALIDATION' });
  if (!from_package_id && !checkout_group_id && !order_id) {
    return res.status(400).json({ error: 'لا يوجد طلب للترقية', code: 'ERR_VALIDATION' });
  }

  // Target must be an active retail VIP package.
  const vip = (await query(
    `SELECT id, name_ar, price FROM packages
     WHERE id = $1 AND is_vip = TRUE AND active = TRUE AND role = 'retail'`,
    [package_id]
  )).rows[0];
  if (!vip) return res.status(404).json({ error: 'باقة VIP غير موجودة', code: 'ERR_NOT_FOUND' });

  const st = await query(`SELECT id FROM students WHERE user_id = $1`, [req.user.id]);
  if (!st.rows.length) return res.status(404).json({ error: 'حساب الطالب غير موجود', code: 'ERR_NOT_FOUND' });
  const studentId = st.rows[0].id;

  const rows = await resolveBundleRows(studentId, { from_package_id, checkout_group_id, order_id });
  if (!rows.length) return res.status(404).json({ error: 'لا يوجد طلب للترقية', code: 'ERR_NOT_FOUND' });
  if (rows.some((r) => !VIP_UPGRADEABLE_STATUSES.includes(r.status))) {
    return res.status(409).json({ error: 'لا يمكن الترقية بعد بدء الإنتاج', code: 'ERR_VIP_TOO_LATE' });
  }

  await tx(async (client) => {
    for (const o of rows) {
      const newPrice = o.product_type === 'sash' ? Number(vip.price) : 0;
      // Price + package only — never touch design_id/status/measurements/routing flags.
      await client.query(`UPDATE orders SET package_id = $1, price = $2 WHERE id = $3`, [vip.id, newPrice, o.id]);
      // Drop any prior package/VIP marker rows (idempotent re-upgrade); keep real design/option/embroidery lines.
      await client.query(
        `DELETE FROM order_items WHERE order_id = $1
         AND (label_snapshot LIKE 'باقة:%' OR label_snapshot LIKE 'باقة VIP:%' OR label_snapshot LIKE 'مشمول في باقة%')`,
        [o.id]
      );
      const sumRemaining = Number((await client.query(
        `SELECT COALESCE(SUM(price_snapshot), 0) AS s FROM order_items WHERE order_id = $1`,
        [o.id]
      )).rows[0].s);
      // One reconciliation line so order_items always sum to the new bundle price.
      const label = o.product_type === 'sash' ? `باقة VIP: ${vip.name_ar}` : `مشمول في باقة VIP: ${vip.name_ar}`;
      await client.query(
        `INSERT INTO order_items (order_id, label_snapshot, price_snapshot, qty) VALUES ($1, $2, $3, 1)`,
        [o.id, label, newPrice - sumRemaining]
      );
    }
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'upgrade_vip', 'package', $2, $3)`,
      [req.user.id, vip.id, JSON.stringify({
        order_ids: rows.map((r) => r.id),
        from: { from_package_id, checkout_group_id, order_id },
        total: Number(vip.price),
      })]
    );
  });

  for (const o of rows) publish({ type: 'order', orderId: o.id, status: o.status });

  const presentTypes = new Set(rows.map((r) => r.product_type));
  res.json({
    data: {
      order_ids: rows.map((r) => r.id),
      total: Number(vip.price),
      package_name: vip.name_ar,
      missing_types: BUNDLE_TYPES.filter((t) => !presentTypes.has(t)),
    },
  });
}

// ---------- Order price breakdown (owner / staff / admin) ----------
async function getOrderBreakdown(req, res) {
  const { id } = req.params;
  const o = await query(
    `SELECT o.id, o.price, o.status, o.created_at, s.user_id,
            u.name AS student_name, p.name_ar AS product_name
     FROM orders o
     JOIN students s ON s.id = o.student_id
     JOIN users u ON u.id = s.user_id
     JOIN products p ON p.id = o.product_id
     WHERE o.id = $1`,
    [id]
  );
  if (!o.rows.length) return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  const row = o.rows[0];
  if (!['admin', 'staff'].includes(req.user.role) && row.user_id !== req.user.id) {
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  }
  const items = await query(
    `SELECT label_snapshot, price_snapshot, qty, customer_image_url, plate_image_url,
            customer_text
       FROM order_items
      WHERE order_id = $1 ORDER BY created_at`,
    [id]
  );
  res.json({
    data: {
      id: row.id, product_name: row.product_name, student_name: row.student_name,
      total: row.price, status: row.status, created_at: row.created_at,
      breakdown: items.rows,
    },
  });
}

// ── Rep-student self-service full-set order (the WhatsApp form, student-filled) ──
// A wholesaler-linked student fills their OWN طقم order instead of browsing the shop.
// Shares the exact persist/read logic with the rep "fill on behalf" endpoint.

// Form context in one call: is this a rep student? approved? + full-set packages + any existing order.
async function repFullSetContext(req, res) {
  const st = await query(
    `SELECT id, status, wholesaler_id FROM students WHERE user_id = $1`, [req.user.id]
  );
  const student = st.rows[0];
  const isRep = !!(student && student.wholesaler_id);
  const approved = !!(student && student.status === 'approved');
  let packages = [];
  let existing = null;
  let pricing = null;
  // Approval state of the student's existing full-set order (orthogonal to the
  // production state machine). The waiting student's page polls this to flip from
  // "pending" → "approved"/"rejected". All rows of the bundle share one value.
  let wholesalerApproval = null;
  let wholesalerRejectReason = null;
  if (isRep) {
    // Cached sub-reads (60s): identical for every student of the rep — the waiting
    // screen polls this endpoint, so these two reads dominate spike load. The
    // per-student reads below (existing order, approval status) MUST stay live.
    packages = await memoCache.wrap('pkg:fullset', 60_000, async () => {
      const pk = await query(
        `SELECT id, name_ar, price FROM packages
         WHERE active = TRUE AND is_full_set = TRUE ORDER BY sort, created_at`
      );
      return pk.rows;
    });
    // Rep/student-facing pricing only (base + add-ons) — never the admin-private price.
    const p = await memoCache.wrap(`reppricing:${student.wholesaler_id}`, 60_000, () =>
      loadWholesalerPricing(student.wholesaler_id)
    );
    pricing = {
      base: p.wholesalerPrice,
      addons: Object.fromEntries(Object.entries(p.addons).map(([key, pair]) => [key, pair.selling])),
    };
    if (approved) existing = await readFullSetOrder(student.id);
    const ap = await query(
      `SELECT o.wholesaler_approval, o.wholesaler_reject_reason
       FROM orders o JOIN products p ON p.id = o.product_id
       WHERE o.student_id = $1 AND o.status <> 'cancelled' AND o.design_id IS NULL
         AND p.type IN ('sash','robe','cap')
       ORDER BY o.created_at DESC
       LIMIT 1`,
      [student.id]
    );
    if (ap.rows.length) {
      wholesalerApproval = ap.rows[0].wholesaler_approval ?? null;
      wholesalerRejectReason = ap.rows[0].wholesaler_reject_reason ?? null;
    }
  }
  res.json({
    data: {
      is_rep_student: isRep, approved, packages, existing, pricing,
      wholesaler_approval: wholesalerApproval,
      wholesaler_reject_reason: wholesalerRejectReason,
    },
  });
}

// Student creates/updates their own full-set order.
async function configureRepFullSet(req, res) {
  const st = await query(
    `SELECT s.id, s.status, s.wholesaler_id, u.name, u.phone
     FROM students s JOIN users u ON u.id = s.user_id WHERE s.user_id = $1`,
    [req.user.id]
  );
  if (!st.rows.length) return res.status(404).json({ error: 'حساب الطالب غير موجود', code: 'ERR_NOT_FOUND' });
  const student = st.rows[0];
  if (!student.wholesaler_id) {
    return res.status(403).json({ error: 'هذه الخدمة لطلاب الممثلين فقط', code: 'ERR_FORBIDDEN' });
  }
  if (student.status !== 'approved') {
    return res.status(403).json({ error: 'يجب موافقة الممثل أولاً', code: 'ERR_NOT_APPROVED' });
  }
  // Lock: once the rep (or admin) has approved the student's order, the student may not edit it.
  // The rep-fill path (wholesalerController) is NOT locked — only the student self-fill path is.
  const lock = await query(
    `SELECT 1 FROM orders WHERE student_id = $1 AND wholesaler_approval = 'approved' LIMIT 1`,
    [student.id]
  );
  if (lock.rows.length) {
    return res.status(403).json({ error: 'الطلب تمت الموافقة عليه ولا يمكن تعديله', code: 'ERR_LOCKED' });
  }
  const { status, json } = await persistFullSetOrder({
    student, body: req.body, actorUserId: req.user.id,
  });
  res.status(status).json(json);
}

// ---------- Retail student: list MY own orders + their live status ----------
// Powers the student order-tracking view (shown on the cart once it empties).
// Surfaces approval / progress / delivery, and a returned-for-edit note when the
// designer rejected the linked design (the real "بيه خلل/ملاحظة" signal).
async function myOrders(req, res) {
  const stu = await query(`SELECT id FROM students WHERE user_id = $1`, [req.user.id]);
  if (!stu.rows.length) {
    return res.status(403).json({ error: 'هذه الخدمة للطلاب فقط', code: 'ERR_FORBIDDEN' });
  }
  const { rows } = await query(
    `SELECT o.id, o.status, o.created_at, o.delivered_at, o.notes,
            o.delivery_method, o.recipient_name, o.checkout_group_id,
            p.name_ar AS product_name, p.type AS product_type,
            d.approval_status AS design_approval_status, d.rejection_reason
     FROM orders o
     JOIN products p ON p.id = o.product_id
     LEFT JOIN designs d ON d.id = o.design_id
     WHERE o.student_id = $1
     ORDER BY o.created_at DESC
     LIMIT 100`,
    [stu.rows[0].id]
  );
  res.json({ data: rows });
}

// ---------- GET /orders/returned — the student's orders sent back for editing ----------
// Returns each returned order with its product + current spec lines + measurements, so the
// student can edit the values and resubmit via POST /orders/configure (which clears the flag).
async function returnedOrders(req, res) {
  const stu = await query(`SELECT id FROM students WHERE user_id = $1`, [req.user.id]);
  if (!stu.rows.length) {
    return res.status(403).json({ error: 'هذه الخدمة للطلاب فقط', code: 'ERR_FORBIDDEN' });
  }
  const studentId = stu.rows[0].id;
  const { rows: orders } = await query(
    `SELECT o.id, o.product_id, o.design_id, o.status, o.returned_reason, o.returned_at,
            o.measurements,
            p.name_ar AS product_name, p.type AS product_type, p.image_url AS product_image_url
     FROM orders o
     JOIN products p ON p.id = o.product_id
     WHERE o.student_id = $1 AND o.returned_to_customer = TRUE
     ORDER BY o.returned_at DESC NULLS LAST, o.created_at DESC`,
    [studentId]
  );
  if (!orders.length) return res.json({ data: [] });

  const ids = orders.map((o) => o.id);
  // Editable spec lines only (skip the base-price line, which has no group/option).
  const { rows: items } = await query(
    `SELECT oi.order_id, oi.group_id, oi.option_id, oi.label_snapshot, oi.qty,
            oi.customer_text, oi.customer_image_url,
            g.name_ar AS group_name, g.requires_customer_text AS group_requires_text,
            g.requires_customer_image AS group_requires_image,
            opt.requires_customer_text AS option_requires_text,
            opt.requires_customer_image AS option_requires_image
     FROM order_items oi
     LEFT JOIN option_groups g ON g.id = oi.group_id
     LEFT JOIN options opt ON opt.id = oi.option_id
     WHERE oi.order_id = ANY($1) AND oi.group_id IS NOT NULL AND oi.option_id IS NOT NULL
     ORDER BY oi.id`,
    [ids]
  );
  const byOrder = new Map(orders.map((o) => [o.id, []]));
  for (const it of items) {
    byOrder.get(it.order_id)?.push({
      group_id: it.group_id,
      option_id: it.option_id,
      label: it.label_snapshot,
      group_name: it.group_name,
      qty: it.qty,
      customer_text: it.customer_text,
      customer_image_url: it.customer_image_url,
      requires_text: !!it.group_requires_text || !!it.option_requires_text,
      requires_image: !!it.group_requires_image || !!it.option_requires_image,
    });
  }
  const data = orders.map((o) => ({
    id: o.id,
    product_id: o.product_id,
    design_id: o.design_id,
    status: o.status,
    returned_reason: o.returned_reason,
    returned_at: o.returned_at,
    measurements: o.measurements,
    product_name: o.product_name,
    product_type: o.product_type,
    product_image_url: o.product_image_url,
    selections: byOrder.get(o.id) || [],
  }));
  res.json({ data });
}

module.exports = {
  listOrders, myOrders, returnedOrders, updateStatus, configureOrder, configurePackage, configureFullSet, getOrderBreakdown,
  vipUpgradeContext, upgradeToVip, repFullSetContext, configureRepFullSet,
  priceSelections, validateRobeMeasurements, canStaffTransition, TRANSITIONS, STATUS_LABEL_AR, ALL_STATUSES, LINE_STAFF,
  orderZoneClause,
};
