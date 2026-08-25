const bcrypt = require('bcrypt');
const { query, tx } = require('../lib/db');
const { DEFAULT_ADDONS, normalizeSettlementAddons } = require('../lib/fullSetOrder');
const { normalizeIqPhone } = require('../lib/otp');
const { setBundleApproval, notifyUser } = require('../lib/orderApproval');
const memoCache = require('../lib/memoCache');
const counts = require('../lib/counts');
// Money-gate reveal logic lives in tvBoardController (single source of truth for the
// 'money_gate' site_settings row + the sha256 compare). No circular dep: tvBoardController
// requires only lib/*, never adminController.
const { moneyRevealOk, moneyGateConfigured, setMoneyGate, rankFor, RANKS } = require('./tvBoardController');
const { assertPasswordOk } = require('../lib/password');
const { revokeUserDevices } = require('../lib/trustedDevice');
const appPresence = require('../lib/appPresence');
const pushBroadcast = require('../lib/pushBroadcast');

const SALT_ROUNDS = 10;

// «التسعيرة» — a base price is a non-negative integer (IQD). null = invalid.
/**
 * Drop the public /join caches. Call after ANY write that changes what a student sees there.
 *
 * WHY THIS EXISTS: joinController caches `join:representatives` for 5 minutes and each
 * `join:<code>` for 60 seconds, both keyed off the `wholesalers` table this controller edits.
 * Nothing invalidated them, so an admin who created a rep in front of the owner watched the
 * new entry NOT appear in «ادخل مع ممثلك» for five minutes and reasonably concluded it had
 * not saved. Same for a corrected جامعة/قسم, an extended deadline, or a deleted rep whose
 * link kept working.
 *
 * The `join:` prefix deliberately clears BOTH caches, not just the directory: a deadline or
 * جامعة edit changes `getReferral`'s payload too, and the referral page is where a student
 * reads the deadline they are racing.
 */
function invalidateJoinCaches() {
  memoCache.del('join:');
}

function parsePrice(v) {
  if (v == null || v === '') return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function pricingOrderIsValid(adminPrice, sellingPrice, addons) {
  return sellingPrice >= adminPrice && Object.values(addons).every((pair) => pair.selling >= pair.admin);
}

// The settlement filter + the money vocabulary it feeds now live in lib/counts.js, so the
// dashboard and every other reader compute revenue the SAME way. The AI analytics assistant
// reads the identical definitions from there — two "revenue" definitions that disagree would
// be worse than no assistant. See the block comments there before changing what «دخل المحل»
// or «ربح الممثلين» mean.
const { billableOrderSql, shopIncomeExpr, repMarginExpr } = counts;

const STAFF_TYPES = ['designer', 'embroiderer', 'presser', 'preparer', 'manager', 'digitizer', 'tailor'];
const STAFF_SCOPES = ['retail', 'wholesaler', 'both'];

// Multi-role (Migration 029): accept either staff_types[] (preferred) or a single
// staff_type (legacy clients). Returns a de-duped list; the PRIMARY role (index 0) is
// mirrored into users.staff_type for backward-compatible single-role reads.
function normalizeStaffTypes(body) {
  const list = Array.isArray(body.staff_types)
    ? body.staff_types
    : body.staff_type != null
      ? [body.staff_type]
      : [];
  return [...new Set(list.filter(Boolean))];
}

async function analytics(req, res) {
  // MONEY (2026-08-13, bug 11): `totals` no longer reports SUM(price)/SUM(cost)/SUM(profit)
  // under the words إيراد/تكلفة/ربح. On a rep's order those three mean «what the student paid
  // the REP» / «the shop's own income» / «the REP's margin» — so the old «إجمالي الربح» was
  // literally the representatives' earnings, and «إجمالي التكلفة» was the shop's revenue.
  // counts.settledMoney returns the honest split; the whole vocabulary is documented there.
  const money = await counts.settledMoney();
  // Pipeline funnel = OPERATIONAL, not settlement (decision locked 2026-07-17): count every
  // active order (incl. pending/rejected rep bundles awaiting approval) so WIP isn't
  // understated. Only the MONEY aggregates (money/topWholesalers/accounting) stay on
  // billableOrderSql — this is the one place that deliberately does NOT gate on approval.
  //
  // UNITS (2026-07-21): the funnel is counted in PIECES (قطعة) because only pieces have a
  // stage — 76% of bundles span 2-3 statuses at once, so a bundle funnel overcounted by 79%.
  // `students` rides along as a MEMBERSHIP count (a student with pieces in two stages is in
  // both rows); it deliberately does NOT sum to totals.students. See lib/counts.js.
  //
  // WORKABLE (2026-08-13, bug 9): each stage row now also splits into what a station can
  // actually pick up vs what is blocked, so the admin total and the staff queue stop
  // disagreeing by 365 pieces with no way to see why. stageFunnelSplit mirrors getQueue.
  const scope = counts.buildScope();
  const [funnel, headline, retailOrders] = await Promise.all([
    counts.stageFunnelSplit(scope),
    counts.summary(scope),
    // The rank ladder climbs on RETAIL طلب (owner goal: 3000). Same ladder the TV
    // board shows, so the two screens can never disagree about the current rung.
    counts.countBundles(counts.buildScope({ source: 'retail' })),
  ]);
  // DAILY (2026-08-13, bug 10): `orders` counted EVERY live bundle while `revenue` was
  // filtered to settled ones, so one bar mixed two populations — 10 Aug read 32 orders
  // against revenue that only 18 of them produced, throwing average-per-order off by 3×.
  // Both counts now ride on the row so the chart can show them explicitly instead of
  // silently dividing one population by the other.
  const daily = await query(
    `SELECT DATE(o.created_at AT TIME ZONE 'Asia/Baghdad') AS date,
            COUNT(DISTINCT COALESCE(o.checkout_group_id, o.id))::int AS orders,
            COUNT(DISTINCT COALESCE(o.checkout_group_id, o.id))
              FILTER (WHERE ${billableOrderSql('o')})::int AS billable_orders,
            COALESCE(SUM(o.price) FILTER (WHERE ${billableOrderSql('o')}), 0)::bigint AS revenue,
            ${shopIncomeExpr('o', billableOrderSql('o'))} AS shop_income
     FROM orders o
     WHERE o.created_at > NOW() - INTERVAL '30 days'
       AND o.status <> 'cancelled'
     GROUP BY 1 ORDER BY 1`
  );
  const topWholesalers = await query(
    `SELECT w.id, u.name,
            COUNT(DISTINCT COALESCE(o.checkout_group_id, o.id))::int AS order_count
     FROM wholesalers w
     JOIN users u ON u.id = w.user_id
     LEFT JOIN students s ON s.wholesaler_id = w.id
     LEFT JOIN orders o ON o.student_id = s.id
       AND o.status <> 'cancelled'
       AND o.wholesaler_approval = 'approved'
     GROUP BY w.id, u.name
     ORDER BY order_count DESC LIMIT 5`
  );
  // by_status stays for backward compatibility (pieces, as it always was); `funnel`
  // is the new dual-unit shape the dashboard renders.
  const status = {};
  funnel.forEach((r) => (status[r.stage] = r.pieces));
  res.json({
    money,
    by_status: status,
    funnel,
    headline,
    rank: { ...rankFor(retailOrders), ladder: RANKS },
    daily: daily.rows,
    top_wholesalers: topWholesalers.rows,
  });
}

async function accounting(req, res) {
  // Same money vocabulary as analytics (bug 11): every bucket reports what the SHOP takes
  // in — حصة الإدارة on a rep's order, the full price on a retail one — and reports the
  // reps' own margin beside it, never inside it. `shop_income` is the column that sums:
  // by_wholesaler + independent_retail + orphaned_billable == totals.shop_income.
  const totals = await counts.settledMoney();
  const byBatch = await query(
    `SELECT b.id, b.name_ar, wu.name AS wholesaler_name,
            ${shopIncomeExpr('o')} AS shop_income,
            ${repMarginExpr('o')} AS rep_margin,
            COALESCE(SUM(o.price),0)::bigint AS revenue,
            COALESCE(SUM(o.cost),0)::bigint AS cost,
            COUNT(DISTINCT COALESCE(o.checkout_group_id, o.id))::int AS orders
     FROM batches b
     LEFT JOIN wholesalers w ON w.id = b.wholesaler_id
     LEFT JOIN users wu ON wu.id = w.user_id
     LEFT JOIN orders o ON o.batch_id = b.id
       AND o.status <> 'cancelled'
       AND o.wholesaler_approval = 'approved'
     GROUP BY b.id, wu.name ORDER BY shop_income DESC`
  );
  const byWholesaler = await query(
    `SELECT w.id, u.name AS wholesaler_name, w.commission_rate,
            ${shopIncomeExpr('o')} AS shop_income,
            ${repMarginExpr('o')} AS rep_margin,
            COALESCE(SUM(o.price),0)::bigint AS revenue,
            COALESCE(SUM(o.cost),0)::bigint AS cost,
            -- «العمولة» IS the rep's margin (price − حصة الإدارة). Same number as
            -- staffController's representative_profit — the rep's, not the shop's.
            ${repMarginExpr('o')} AS commission,
            COUNT(DISTINCT COALESCE(o.checkout_group_id, o.id))::int AS orders
     FROM wholesalers w
     JOIN users u ON u.id = w.user_id
     LEFT JOIN students s ON s.wholesaler_id = w.id
     LEFT JOIN orders o ON o.student_id = s.id
       AND o.status <> 'cancelled'
       AND o.wholesaler_approval = 'approved'
     GROUP BY w.id, u.name, w.commission_rate ORDER BY shop_income DESC`
  );
  const retail = await query(
    `SELECT ${shopIncomeExpr('o')} AS shop_income,
            ${repMarginExpr('o')} AS rep_margin,
            COALESCE(SUM(o.price),0)::bigint AS revenue,
            COALESCE(SUM(o.cost),0)::bigint AS cost,
            COUNT(DISTINCT COALESCE(o.checkout_group_id, o.id))::int AS orders
     FROM orders o
     JOIN students s ON s.id = o.student_id
     WHERE s.wholesaler_id IS NULL
       AND o.status <> 'cancelled'
       AND o.wholesaler_approval IS NULL`
  );
  // Defensive bucket (0 live rows today): a deleted wholesaler SETs its students'
  // wholesaler_id to NULL (FK ON DELETE SET NULL), but the orders they already approved
  // keep wholesaler_approval='approved' — so they'd fall out of BOTH by_wholesaler (no
  // matching w.id anymore) and independent_retail (requires wholesaler_approval IS NULL)
  // and the breakdown would stop summing to `totals`. Catch them here so
  // by_wholesaler + independent_retail + orphaned_billable == totals always holds.
  const orphaned = await query(
    `SELECT ${shopIncomeExpr('o')} AS shop_income,
            ${repMarginExpr('o')} AS rep_margin,
            COALESCE(SUM(o.price),0)::bigint AS revenue,
            COALESCE(SUM(o.cost),0)::bigint AS cost,
            COUNT(DISTINCT COALESCE(o.checkout_group_id, o.id))::int AS orders
     FROM orders o
     JOIN students s ON s.id = o.student_id
     WHERE s.wholesaler_id IS NULL
       AND o.status <> 'cancelled'
       AND o.wholesaler_approval = 'approved'`
  );
  res.json({
    totals,
    by_batch: byBatch.rows,
    by_wholesaler: byWholesaler.rows,
    independent_retail: retail.rows[0],
    orphaned_billable: orphaned.rows[0],
  });
}

async function updateOrderCost(req, res) {
  const { id } = req.params;
  const cost = Number(req.body.cost);
  if (!Number.isFinite(cost) || !Number.isInteger(cost) || cost < 0) {
    return res.status(400).json({ error: 'تكلفة غير صالحة', code: 'ERR_VALIDATION' });
  }
  const { rows } = await query(
    `UPDATE orders SET cost = $1 WHERE id = $2 RETURNING id, price, cost, profit`,
    [cost, id]
  );
  if (!rows.length) return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'update_cost', 'order', $2, $3)`,
    [req.user.id, id, JSON.stringify({ cost })]
  );
  res.json({ data: rows[0] });
}

// Edit a full-set bundle's intake row — record the deposit (واصل) as cash arrives,
// fix phones/address, adjust the event date. Whitelisted columns only.
async function updateCheckoutGroup(req, res) {
  const { id } = req.params;
  if (req.body.deposit !== undefined && (!isFinite(Number(req.body.deposit)) || Number(req.body.deposit) < 0)) {
    return res.status(400).json({ error: 'عربون غير صالح', code: 'ERR_VALIDATION' });
  }
  const ALLOWED = [
    'customer_name', 'instagram_username', 'phone_primary', 'phone_secondary',
    'governorate', 'area_details', 'event_date', 'deposit', 'notes',
  ];
  const sets = [];
  const params = [];
  for (const col of ALLOWED) {
    if (req.body[col] !== undefined) {
      params.push(req.body[col] === '' ? null : req.body[col]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (!sets.length) return res.status(400).json({ error: 'لا تغييرات', code: 'ERR_VALIDATION' });
  params.push(id);
  const { rows } = await query(
    `UPDATE checkout_groups SET ${sets.join(', ')} WHERE id = $${params.length}
     RETURNING id, customer_name, instagram_username, phone_primary, phone_secondary,
               governorate, area_details, event_date::text AS event_date, deposit, notes,
               created_at, updated_at`,
    params
  );
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'update_checkout_group', 'checkout_group', $2, $3)`,
    [req.user.id, id, JSON.stringify({ fields: Object.keys(req.body) })]
  );
  res.json({ data: rows[0] });
}

async function listWholesalers(req, res) {
  const { rows } = await query(
    `SELECT w.id, u.name, u.phone, u.email, w.referral_code, w.deadline, w.commission_rate, w.created_at,
       w.university_name, w.department, w.admin_price, w.wholesaler_price, w.pricing_addons,
       (SELECT COUNT(*)::int FROM students s WHERE s.wholesaler_id = w.id) AS student_count,
       (SELECT COUNT(*)::int FROM students s WHERE s.wholesaler_id = w.id AND s.status = 'pending_approval') AS pending_count,
       -- «المستحق» = approved price-gap profit only. Pending/rejected orders are not settled.
       COALESCE((
         SELECT SUM(o.profit)::bigint
         FROM students s JOIN orders o ON o.student_id = s.id
         WHERE s.wholesaler_id = w.id AND o.status <> 'cancelled'
           AND o.wholesaler_approval = 'approved'
       ), 0) AS earned_commission
     FROM wholesalers w JOIN users u ON u.id = w.user_id
     ORDER BY w.created_at DESC`
  );
  const data = rows.map((r) => ({
    ...r,
    admin_price: Number(r.admin_price || 0),
    wholesaler_price: Number(r.wholesaler_price || 0),
    pricing_addons: normalizeSettlementAddons(r.pricing_addons),
    referral_url: `${process.env.FRONTEND_URL}/join/${r.referral_code}`,
  }));
  res.json({ data });
}

async function createWholesaler(req, res) {
  // Normalize phone before duplicate-check + insert so stored numbers are always canonical.
  req.body.phone = normalizeIqPhone(req.body.phone);
  const { name, phone, email, password, referral_code, deadline, university_name, department } = req.body;
  // «التسعيرة» — two base prices + editable add-ons (defaults applied; admin tweaks per rep later).
  const adminPrice = parsePrice(req.body.admin_price);
  const wholesalerPrice = parsePrice(req.body.wholesaler_price);
  if (adminPrice === null || wholesalerPrice === null) {
    return res.status(400).json({ error: 'سعر غير صالح', code: 'ERR_VALIDATION' });
  }
  const pricingAddons = normalizeSettlementAddons(req.body.pricing_addons);
  if (!pricingOrderIsValid(adminPrice, wholesalerPrice, pricingAddons)) {
    return res.status(400).json({ error: 'سعر البيع يجب أن يساوي أو يتجاوز مبلغ الإدارة', code: 'ERR_VALIDATION' });
  }
  if (!name || !phone || !password || !referral_code) {
    return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  }
  // The wholesaler's جامعة/قسم are inherited by every student who joins via their link,
  // so they are required at creation.
  if (!university_name || !String(university_name).trim()) {
    return res.status(400).json({ error: 'اسم الجامعة مطلوب', code: 'ERR_VALIDATION' });
  }
  if (!department || !String(department).trim()) {
    return res.status(400).json({ error: 'القسم/التخصص مطلوب', code: 'ERR_VALIDATION' });
  }
  const slugOk = /^[a-z0-9-]+$/.test(referral_code);
  if (!slugOk) {
    return res.status(400).json({ error: 'الرابط يجب أن يحتوي على حروف صغيرة وأرقام وشرطات', code: 'ERR_VALIDATION' });
  }
  // «لون التطريز» — optional per-wholesaler embroidery/thread color (max 120 chars; '' → null).
  const rawEmbColor = req.body.embroidery_color;
  const embroideryColor = rawEmbColor != null ? String(rawEmbColor).trim().slice(0, 120) || null : null;

  const exists = await query(`SELECT id FROM users WHERE phone = $1`, [phone]);
  if (exists.rows.length) {
    return res.status(409).json({ error: 'الرقم مستخدم', code: 'ERR_PHONE_TAKEN' });
  }
  const codeExists = await query(`SELECT id FROM wholesalers WHERE referral_code = $1`, [referral_code]);
  if (codeExists.rows.length) {
    return res.status(409).json({ error: 'الرمز مستخدم', code: 'ERR_VALIDATION' });
  }
  assertPasswordOk(password, 'privileged');
  const hash = await bcrypt.hash(password, 10);
  const result = await tx(async (client) => {
    const u = await client.query(
      `INSERT INTO users (name, phone, email, password_hash, role, phone_verified)
       VALUES ($1, $2, $3, $4, 'wholesaler', TRUE) RETURNING id`,
      [name, phone, email || null, hash]
    );
    const w = await client.query(
      `INSERT INTO wholesalers (user_id, referral_code, deadline, approved_by_admin, university_name, department,
                               admin_price, wholesaler_price, pricing_addons, embroidery_color)
       VALUES ($1, $2, $3, TRUE, $4, $5, $6, $7, $8::jsonb, $9) RETURNING id, referral_code`,
      [u.rows[0].id, referral_code, deadline || null, String(university_name).trim(), String(department).trim(),
       adminPrice, wholesalerPrice, JSON.stringify(pricingAddons), embroideryColor]
    );
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'create_wholesaler', 'wholesaler', $2, $3)`,
      [req.user.id, w.rows[0].id, JSON.stringify({ name, referral_code })]
    );
    return w.rows[0];
  });
  invalidateJoinCaches(); // the new rep must be pickable on /join immediately
  res.status(201).json({
    data: {
      id: result.id,
      referral_url: `${process.env.FRONTEND_URL}/join/${result.referral_code}`,
    },
  });
}

// Edit a wholesaler's جامعة/قسم + «لون التطريز» (so existing reps can be filled in / corrected).
// جامعة/قسم flow to every student who joins via the rep's link; embroidery_color stamps
// all that rep's future full-set orders.
async function updateWholesaler(req, res) {
  const { id } = req.params;
  const { university_name, department } = req.body;
  if (!university_name || !String(university_name).trim()) {
    return res.status(400).json({ error: 'اسم الجامعة مطلوب', code: 'ERR_VALIDATION' });
  }
  if (!department || !String(department).trim()) {
    return res.status(400).json({ error: 'القسم/التخصص مطلوب', code: 'ERR_VALIDATION' });
  }
  // «لون التطريز» — optional; '' → null.
  const rawEmbColor = req.body.embroidery_color;
  const embroideryColor = rawEmbColor != null ? String(rawEmbColor).trim().slice(0, 120) || null : undefined;

  // Build the update dynamically so passing no embroidery_color field is a no-op.
  let sql, params;
  if (embroideryColor !== undefined) {
    sql = `UPDATE wholesalers SET university_name = $1, department = $2, embroidery_color = $3
           WHERE id = $4 RETURNING id, university_name, department, embroidery_color`;
    params = [String(university_name).trim(), String(department).trim(), embroideryColor, id];
  } else {
    sql = `UPDATE wholesalers SET university_name = $1, department = $2
           WHERE id = $3 RETURNING id, university_name, department, embroidery_color`;
    params = [String(university_name).trim(), String(department).trim(), id];
  }
  const { rows } = await query(sql, params);
  if (!rows.length) {
    return res.status(404).json({ error: 'الممثل غير موجود', code: 'ERR_NOT_FOUND' });
  }
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'update_wholesaler', 'wholesaler', $2, $3)`,
    [req.user.id, id, JSON.stringify({
      university_name: rows[0].university_name,
      department: rows[0].department,
      embroidery_color: rows[0].embroidery_color,
    })]
  );
  invalidateJoinCaches(); // جامعة/قسم are exactly what the /join picker groups and labels by
  res.json({ data: rows[0] });
}

async function updateDeadline(req, res) {
  const { id } = req.params;
  const { deadline, extend_days } = req.body;
  let sql, params;
  if (deadline) {
    sql = `UPDATE wholesalers SET deadline = $1 WHERE id = $2 RETURNING id, deadline`;
    params = [deadline, id];
  } else if (extend_days) {
    sql = `UPDATE wholesalers SET deadline = COALESCE(deadline, NOW()) + ($1 || ' days')::interval
           WHERE id = $2 RETURNING id, deadline`;
    params = [extend_days, id];
  } else {
    return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  }
  const { rows } = await query(sql, params);
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'extend_deadline', 'wholesaler', $2, $3)`,
    [req.user.id, id, JSON.stringify({ deadline, extend_days })]
  );
  invalidateJoinCaches(); // /join/<code> shows the deadline the student is racing
  res.json({ data: rows[0] });
}

// «التسعيرة»: set a rep's two base prices + editable add-on surcharges.
async function updatePricing(req, res) {
  const { id } = req.params;
  const adminPrice = parsePrice(req.body.admin_price);
  const wholesalerPrice = parsePrice(req.body.wholesaler_price);
  if (adminPrice === null || wholesalerPrice === null) {
    return res.status(400).json({ error: 'سعر غير صالح', code: 'ERR_VALIDATION' });
  }
  const pricingAddons = normalizeSettlementAddons(req.body.pricing_addons);
  if (!pricingOrderIsValid(adminPrice, wholesalerPrice, pricingAddons)) {
    return res.status(400).json({ error: 'سعر البيع يجب أن يساوي أو يتجاوز مبلغ الإدارة', code: 'ERR_VALIDATION' });
  }
  const { rows } = await query(
    `UPDATE wholesalers SET admin_price = $1, wholesaler_price = $2, pricing_addons = $3::jsonb
     WHERE id = $4 RETURNING id, admin_price, wholesaler_price, pricing_addons`,
    [adminPrice, wholesalerPrice, JSON.stringify(pricingAddons), id]
  );
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  memoCache.del(`reppricing:${id}`); // التسعيرة edits must show in the rep form immediately
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'update_pricing', 'wholesaler', $2, $3)`,
    [req.user.id, id, JSON.stringify({ admin_price: adminPrice, wholesaler_price: wholesalerPrice, pricing_addons: pricingAddons })]
  );
  res.json({
    data: {
      id: rows[0].id,
      admin_price: Number(rows[0].admin_price || 0),
      wholesaler_price: Number(rows[0].wholesaler_price || 0),
      pricing_addons: normalizeSettlementAddons(rows[0].pricing_addons),
    },
  });
}

async function deleteWholesaler(req, res) {
  const { id } = req.params;
  const { rows } = await query(
    `SELECT user_id FROM wholesalers WHERE id = $1`,
    [id]
  );
  if (!rows.length) {
    return res
      .status(404)
      .json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  }
  const userId = rows[0].user_id;
  await tx(async (client) => {
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'delete_wholesaler', 'wholesaler', $2, $3)`,
      [req.user.id, id, JSON.stringify({ user_id: userId })]
    );
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  });
  invalidateJoinCaches(); // a deleted rep's link must stop resolving now, not in 60 seconds
  res.json({ data: { id } });
}
// ── Sash side lock config (per wholesaler) ──
// editable_sash_side: 'left' | 'right' | null (null = both editable)
// locked_side_design: Fabric JSON for the locked (non-editable) side.
function validateSashSide(side) {
  return side === null || side === 'left' || side === 'right';
}

async function getWholesalerSashConfig(req, res) {
  const { id } = req.params;
  const { rows } = await query(
    `SELECT id, editable_sash_side, locked_side_design FROM wholesalers WHERE id = $1`,
    [id]
  );
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  res.json({ data: rows[0] });
}

async function updateWholesalerSashConfig(req, res) {
  const { id } = req.params;
  const side = req.body.editable_sash_side ?? null;
  if (!validateSashSide(side)) {
    return res.status(400).json({ error: 'جانب غير صالح', code: 'ERR_VALIDATION' });
  }
  // When unlocking (side = null) we also clear the saved locked-side design.
  const design = side === null ? null : (req.body.locked_side_design ?? null);
  const { rows } = await query(
    `UPDATE wholesalers SET editable_sash_side = $1, locked_side_design = $2
     WHERE id = $3 RETURNING id, editable_sash_side, locked_side_design`,
    [side, design, id]
  );
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'update_sash_side', 'wholesaler', $2, $3)`,
    [req.user.id, id, JSON.stringify({ editable_sash_side: side })]
  );
  res.json({ data: rows[0] });
}

async function wholesalerStudents(req, res) {
  const { id } = req.params;
  const { rows } = await query(
    `SELECT s.id, u.name, u.phone, s.status, s.university_name, s.department,
       lo.status AS order_status,
       (lo.status IN ('design_complete', 'staff_review', 'printing', 'embroidery', 'pressing', 'preparing', 'ready', 'delivered')) AS is_completed
     FROM students s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN LATERAL (
       SELECT status FROM orders WHERE student_id = s.id ORDER BY created_at DESC LIMIT 1
     ) lo ON TRUE
     WHERE s.wholesaler_id = $1
     ORDER BY s.created_at DESC`,
    [id]
  );
  res.json({ data: rows });
}

async function toggleEditException(req, res) {
  const { id } = req.params;
  const { rows } = await query(
    `UPDATE students SET edit_exception = NOT edit_exception WHERE id = $1 RETURNING id, edit_exception`,
    [id]
  );
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'toggle_edit_exception', 'student', $2, $3)`,
    [req.user.id, id, JSON.stringify({ edit_exception: rows[0].edit_exception })]
  );
  res.json({ data: rows[0] });
}

// Reps drill-down: every wholesaler with their batches + total order count, for the
// admin orders «ممثلين» landing grid (click a rep → filter orders to their students).
async function repsOverview(req, res) {
  const { rows } = await query(
    `SELECT w.id, u.name,
            COALESCE(
              json_agg(DISTINCT jsonb_build_object('id', b.id, 'name_ar', b.name_ar, 'deadline', b.deadline))
                FILTER (WHERE b.id IS NOT NULL),
              '[]'
            ) AS batches,
            COUNT(DISTINCT COALESCE(o.checkout_group_id, o.id))
              FILTER (WHERE o.wholesaler_approval = 'approved')::int AS order_count
     FROM wholesalers w
     JOIN users u ON u.id = w.user_id
     LEFT JOIN batches b ON b.wholesaler_id = w.id
     LEFT JOIN students s ON s.wholesaler_id = w.id
     LEFT JOIN orders o ON o.student_id = s.id AND o.status <> 'cancelled'
     GROUP BY w.id, u.name
     ORDER BY u.name ASC`
  );
  res.json({ data: rows });
}

async function listStaff(req, res) {
  const { rows } = await query(
    `SELECT id, name, phone, email, staff_type, staff_types, order_scope, phone_verified
     FROM users
     WHERE role = 'staff'
     ORDER BY name ASC`
  );
  res.json({ data: rows });
}

async function createStaff(req, res) {
  // Phone is OPTIONAL: staff with no phone log in via the private staff portal
  // (name + password, no OTP). Treat empty/missing as NULL; normalize when present.
  const rawPhone = req.body.phone;
  const phone =
    rawPhone != null && String(rawPhone).trim() !== ''
      ? normalizeIqPhone(rawPhone)
      : null;
  const { name, email, password, order_scope } = req.body;
  if (!name || !password) {
    return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'كلمة المرور قصيرة', code: 'ERR_VALIDATION' });
  }
  const staffTypes = normalizeStaffTypes(req.body);
  if (staffTypes.some((t) => !STAFF_TYPES.includes(t))) {
    return res.status(400).json({ error: 'نوع موظف غير صالح', code: 'ERR_VALIDATION' });
  }
  if (order_scope && !STAFF_SCOPES.includes(order_scope)) {
    return res.status(400).json({ error: 'نطاق طلبات غير صالح', code: 'ERR_VALIDATION' });
  }
  if (phone) {
    const exists = await query(`SELECT id FROM users WHERE phone = $1`, [phone]);
    if (exists.rows.length) {
      return res.status(409).json({ error: 'الرقم مستخدم', code: 'ERR_PHONE_TAKEN' });
    }
  }
  const primaryType = staffTypes[0] || null;
  const typesParam = staffTypes.length ? staffTypes : null;
  assertPasswordOk(password, 'privileged');
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const { rows } = await query(
    `INSERT INTO users (name, phone, email, password_hash, role, staff_type, staff_types, order_scope, phone_verified)
     VALUES ($1, $2, $3, $4, 'staff', $5::staff_type, $6::staff_type[], COALESCE($7::staff_order_scope, 'both'), TRUE)
     RETURNING id, name, phone, email, staff_type, staff_types, order_scope, phone_verified`,
    [name, phone, email || null, hash, primaryType, typesParam, order_scope || null]
  );
  const staff = rows[0];
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'create_staff', 'user', $2, $3)`,
    [req.user.id, staff.id, JSON.stringify({ role: 'staff', staff_types: staffTypes, order_scope: order_scope || 'both', phone })]
  );
  res.status(201).json({ data: staff });
}

async function updateStaffScope(req, res) {
  const { id } = req.params;
  const { order_scope } = req.body;
  if (!STAFF_SCOPES.includes(order_scope)) {
    return res.status(400).json({ error: 'نطاق طلبات غير صالح', code: 'ERR_VALIDATION' });
  }
  const { rows } = await query(
    `UPDATE users SET order_scope = $1 WHERE id = $2 AND role = 'staff'
     RETURNING id, name, order_scope`,
    [order_scope, id]
  );
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'update_staff_scope', 'user', $2, $3)`,
    [req.user.id, id, JSON.stringify({ order_scope })]
  );
  res.json({ data: rows[0] });
}

async function updateStaffType(req, res) {
  const { id } = req.params;
  const staffTypes = normalizeStaffTypes(req.body);
  if (staffTypes.some((t) => !STAFF_TYPES.includes(t))) {
    return res.status(400).json({ error: 'نوع موظف غير صالح', code: 'ERR_VALIDATION' });
  }
  const primaryType = staffTypes[0] || null;
  const typesParam = staffTypes.length ? staffTypes : null;
  const { rows } = await query(
    `UPDATE users SET staff_type = $1::staff_type, staff_types = $2::staff_type[]
     WHERE id = $3 AND role = 'staff'
     RETURNING id, name, staff_type, staff_types`,
    [primaryType, typesParam, id]
  );
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'update_staff_type', 'user', $2, $3)`,
    [req.user.id, id, JSON.stringify({ staff_types: staffTypes })]
  );
  res.json({ data: rows[0] });
}

async function updateStaffPassword(req, res) {
  const { id } = req.params;
  const { password } = req.body;
  assertPasswordOk(password, 'privileged');
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const { rows } = await query(
    `UPDATE users
     SET password_hash = $1, token_version = token_version + 1
     WHERE id = $2 AND role = 'staff'
     RETURNING id`,
    [hash, id]
  );
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  await revokeUserDevices(rows[0].id);
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'reset_staff_password', 'user', $2, $3)`,
    [req.user.id, id, JSON.stringify({ role: 'staff' })]
  );
  res.json({ data: { id } });
}

async function deleteStaff(req, res) {
  const { id } = req.params;
  const { rows } = await query(
    `DELETE FROM users WHERE id = $1 AND role = 'staff' RETURNING id`,
    [id]
  );
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'delete_staff', 'user', $2, $3)`,
    [req.user.id, id, JSON.stringify({ role: 'staff' })]
  );
  res.json({ data: { id } });
}

// ---------- Admin: discount popup promo config ----------
async function updatePromo(req, res) {
  const { active, title_ar, message_ar, deadline } = req.body;

  // active: coerce to boolean
  const activeVal = !!active;

  // title_ar: required, trimmed, max 120 chars
  const titleTrimmed = typeof title_ar === 'string' ? title_ar.trim() : '';
  if (!titleTrimmed) {
    return res.status(400).json({ error: 'العنوان مطلوب', code: 'ERR_VALIDATION' });
  }
  if (titleTrimmed.length > 120) {
    return res.status(400).json({ error: 'العنوان طويل جداً (الحد 120 حرف)', code: 'ERR_VALIDATION' });
  }

  // message_ar: required, trimmed, max 600 chars
  const msgTrimmed = typeof message_ar === 'string' ? message_ar.trim() : '';
  if (!msgTrimmed) {
    return res.status(400).json({ error: 'الرسالة مطلوبة', code: 'ERR_VALIDATION' });
  }
  if (msgTrimmed.length > 600) {
    return res.status(400).json({ error: 'الرسالة طويلة جداً (الحد 600 حرف)', code: 'ERR_VALIDATION' });
  }

  // deadline: null/'' → null; otherwise must be a valid ISO date
  let deadlineVal = null;
  if (deadline != null && deadline !== '') {
    const d = new Date(deadline);
    if (isNaN(d.getTime())) {
      return res.status(400).json({ error: 'تاريخ غير صالح', code: 'ERR_VALIDATION' });
    }
    deadlineVal = d.toISOString();
  }

  const cfg = { active: activeVal, title_ar: titleTrimmed, message_ar: msgTrimmed, deadline: deadlineVal };

  await query(
    `INSERT INTO site_settings (key, value, updated_at)
     VALUES ('discount_popup', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(cfg)]
  );

  // Promo flips must show immediately: the setting itself + the catalog payloads
  // that baked promoLive into their discount fields.
  memoCache.del('settings:promo');
  memoCache.del('cat:');

  res.json({ data: cfg });
}

// ---------- Admin: maintenance mode flag ----------
async function updateMaintenance(req, res) {
  const { active, message_ar } = req.body;

  // active: coerce to boolean
  const activeVal = !!active;

  // message_ar: optional, trimmed, max 300 chars; falls back to the default.
  let msgTrimmed = typeof message_ar === 'string' ? message_ar.trim() : '';
  if (msgTrimmed.length > 300) {
    return res.status(400).json({ error: 'الرسالة طويلة جداً (الحد 300 حرف)', code: 'ERR_VALIDATION' });
  }
  if (!msgTrimmed) msgTrimmed = 'الموقع قيد الصيانة';

  const cfg = { active: activeVal, message_ar: msgTrimmed };

  await query(
    `INSERT INTO site_settings (key, value, updated_at)
     VALUES ('maintenance_mode', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(cfg)]
  );

  res.json({ data: cfg });
}

// ---------- Admin: order-approval override (T5) ----------

// POST /api/admin/orders/:checkoutGroupId/approve
// No ownership check — admin overrides regardless of which rep owns the bundle.
// Notifies BOTH the student and the owning rep.
async function approveOrderAdmin(req, res) {
  const r = await setBundleApproval({
    checkoutGroupId: req.params.checkoutGroupId,
    decision: 'approved',
    actorUserId: req.user.id,
  });
  await notifyUser(
    r.studentUserId,
    'order_approved',
    'تمت الموافقة على طلبك',
    'طلبك الآن قيد الإنتاج',
    '/my-order'
  );
  await notifyUser(
    r.wholesalerUserId,
    'order_approved',
    'تمت الموافقة على طلب',
    `وافق المدير على طلب ${r.studentName || ''}`.trim(),
    '/wholesaler/orders'
  );
  res.json({ data: { ok: true } });
}

// POST /api/admin/orders/:checkoutGroupId/reject  { reason }
// No ownership check — admin overrides regardless of which rep owns the bundle.
// Notifies BOTH the student and the owning rep.
async function rejectOrderAdmin(req, res) {
  const reason = String((req.body && req.body.reason) || '').trim();
  if (!reason) {
    return res.status(400).json({ error: 'سبب الإرجاع مطلوب', code: 'ERR_VALIDATION' });
  }
  const r = await setBundleApproval({
    checkoutGroupId: req.params.checkoutGroupId,
    decision: 'rejected',
    actorUserId: req.user.id,
    reason,
  });
  await notifyUser(
    r.studentUserId,
    'order_rejected',
    'أعاد المدير طلبك',
    `السبب: ${reason} — يرجى التعديل`,
    '/my-order'
  );
  await notifyUser(
    r.wholesalerUserId,
    'order_rejected',
    'أعاد المدير طلبًا',
    `طلب ${r.studentName || ''} — السبب: ${reason}`.trim(),
    '/wholesaler/orders'
  );
  res.json({ data: { ok: true } });
}

// ---------- Admin: pending-approval dashboard count (T7) ----------

// GET /api/admin/orders-pending-count
// Returns the number of distinct bundles awaiting rep approval.
async function pendingApprovalCount(req, res) {
  const { rows } = await query(
    `SELECT COUNT(DISTINCT checkout_group_id)::int AS n
       FROM orders
      WHERE wholesaler_approval = 'pending'`
  );
  res.json({ data: { pending_bundles: rows[0].n } });
}

// DELETE /api/admin/orders/:id — permanently remove ONE piece (order row). Sibling
// pieces of the bundle survive; the empty checkout_group goes with the last piece.
async function deleteOrder(req, res) {
  const { id } = req.params;
  const result = await tx(async (client) => {
    const found = await client.query(
      `SELECT id, checkout_group_id, student_id, price, cost FROM orders WHERE id=$1 FOR UPDATE`, [id]
    );
    if (!found.rows.length) return null;
    const order = found.rows[0];

    // Lock every row in the bundle BEFORE counting/reassigning siblings so two concurrent
    // piece-deletes in the same checkout_group serialize instead of racing each other.
    if (order.checkout_group_id) {
      await client.query(`SELECT id FROM orders WHERE checkout_group_id=$1 FOR UPDATE`, [order.checkout_group_id]);
    }

    // Re-anchor the deleted piece's price/cost onto a surviving sibling in the SAME bundle
    // so settled revenue doesn't vanish when the SASH (which carries the whole طقم price)
    // is the piece being deleted while robe/cap siblings survive. Prefer robe, then cap,
    // then any surviving live sibling (deterministic tie-break by created_at).
    let priceReanchoredTo = null;
    if (order.checkout_group_id && (Number(order.price) > 0 || Number(order.cost) > 0)) {
      const survivor = await client.query(
        `SELECT o2.id
           FROM orders o2
           JOIN products p2 ON p2.id = o2.product_id
          WHERE o2.checkout_group_id = $1
            AND o2.design_id IS NULL
            AND o2.status <> 'cancelled'
            AND o2.id <> $2
          ORDER BY CASE p2.type WHEN 'robe' THEN 0 WHEN 'cap' THEN 1 ELSE 2 END ASC, o2.created_at ASC
          LIMIT 1`,
        [order.checkout_group_id, id]
      );
      if (survivor.rows.length) {
        priceReanchoredTo = survivor.rows[0].id;
        await client.query(
          `UPDATE orders SET price = price + $1, cost = cost + $2 WHERE id = $3`,
          [Number(order.price) || 0, Number(order.cost) || 0, priceReanchoredTo]
        );
      }
    }

    await client.query(`DELETE FROM staff_activity_log WHERE order_id=$1`, [id]);
    await client.query(`DELETE FROM orders WHERE id=$1`, [id]);
    let remaining = [];
    let groupDeleted = false;
    if (order.checkout_group_id) {
      const sib = await client.query(`SELECT id FROM orders WHERE checkout_group_id=$1`, [order.checkout_group_id]);
      remaining = sib.rows.map((row) => row.id);
      if (!remaining.length) {
        await client.query(`DELETE FROM checkout_groups WHERE id=$1`, [order.checkout_group_id]);
        groupDeleted = true;
      }
    }
    await client.query(
      `INSERT INTO audit_log(actor_id,action,entity,entity_id,details)
       VALUES($1,'delete_order','order',$2,$3)`,
      [req.user.id, order.id, JSON.stringify({ piece_only: true, remaining_order_ids: remaining, checkout_group_id: order.checkout_group_id, student_id: order.student_id, price_reanchored_to: priceReanchoredTo })]
    );
    return { remaining, groupDeleted };
  });
  if (result == null) return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  res.json({ data: { deleted: 1, remaining: result.remaining.length, checkout_group_deleted: result.groupDeleted } });
}

// GET /api/admin/visitors → { now, today, total } — distinct storefront sessions
// (first-party site_visits, same source the TV board counts). Not money → not gated.
async function visitorsStats(req, res) {
  const { rows } = await query(
    `SELECT
       COUNT(DISTINCT session_id) FILTER (WHERE created_at > now() - INTERVAL '30 minutes')::int AS now,
       COUNT(DISTINCT session_id) FILTER (
         WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Baghdad') AT TIME ZONE 'Asia/Baghdad'
       )::int AS today,
       COUNT(DISTINCT session_id)::int AS total
     FROM site_visits`
  );
  const r = rows[0] || {};
  res.json({ data: { now: r.now || 0, today: r.today || 0, total: r.total || 0 } });
}

// ---------- Admin: money gate (reveal secret for TV/dashboard IQD amounts) ----------

// GET /api/admin/money-gate → { configured } — whether a reveal passphrase is set
// (site_settings row OR env MONEY_GATE_SECRET fallback).
async function getMoneyGate(req, res) {
  res.json({ data: { configured: await moneyGateConfigured() } });
}

// POST /api/admin/money-gate/verify { secret } → { ok } — same compare the TV uses.
async function verifyMoneyGate(req, res) {
  const secret = req.body && typeof req.body.secret === 'string' ? req.body.secret : '';
  res.json({ data: { ok: await moneyRevealOk(secret) } });
}

// PUT /api/admin/money-gate { secret } — hash (sha256) + UPSERT the passphrase.
async function setMoneyGateSecret(req, res) {
  const secret = req.body && typeof req.body.secret === 'string' ? req.body.secret.trim() : '';
  if (!secret || secret.length < 8) {
    return res.status(400).json({ error: 'كلمة السر قصيرة جداً (٨ أحرف على الأقل)', code: 'ERR_WEAK_SECRET' });
  }
  await setMoneyGate(secret);
  res.json({ data: { ok: true } });
}

/**
 * GET /api/admin/app-stats — «إحصائيات التطبيق على المنصتين».
 *
 * ⚠️ Two sources that measure DIFFERENT things and are never summed: `device_tokens` is a floor
 * on installs (it needs push permission and a signed-in install), `app_opens` is real usage but
 * only since migration 087 deployed. lib/appPresence.js carries the full warning.
 */
async function appStats(req, res) {
  const raw = Number(req.query.days);
  const days = Number.isInteger(raw) && raw > 0 && raw <= 180 ? raw : 30;
  const data = await appPresence.buildStats({ days });
  res.json({ data });
}

/**
 * GET /api/admin/push/audience — how far a message would reach, BEFORE it can be sent.
 *
 * Read-only. The two numbers are always shown together: someone with no device token still gets
 * the in-app bell, so «٣١٢ شخص · ١٩٤ جهاز» is the honest reach, not an error.
 */
async function pushAudience(req, res) {
  const resolved = await pushBroadcast.resolveAudience({
    kind: req.query.kind,
    value: req.query.value,
  });
  if (!resolved.ok) {
    return res.status(400).json({ error: resolved.error, code: resolved.code });
  }
  res.json({ data: { people: resolved.people, devices: resolved.devices, label: resolved.label } });
}

/**
 * POST /api/admin/push — send it.
 *
 * Writes `notifications` rows and stops; lib/pushOutbox.js delivers them, so this inherits the
 * flood guard, the freshness window and dead-token handling rather than re-earning them.
 * ⚠️ A push cannot be recalled — see the three guards at the top of lib/pushBroadcast.js.
 */
async function pushSend(req, res) {
  const result = await pushBroadcast.send({
    audience: (req.body && req.body.audience) || {},
    titleAr: req.body && req.body.title_ar,
    bodyAr: req.body && req.body.body_ar,
    link: req.body && req.body.link,
    confirmedCount: req.body && req.body.confirmed_count,
    adminId: req.user && req.user.id,
  });
  if (!result.ok) {
    const status = result.code === 'ERR_CONFIRM_COUNT' ? 409 : 400;
    return res.status(status).json({ error: result.error, code: result.code });
  }
  res.json({ data: result });
}

/** The last broadcasts, newest first — the only record that a human-sent push happened. */
async function pushHistory(req, res) {
  const { rows } = await query(
    `SELECT b.id, b.sent_at, b.audience_kind, b.audience_value, b.title_ar, b.body_ar,
            b.link, b.people, b.devices, u.name AS admin_name
       FROM push_broadcasts b
       LEFT JOIN users u ON u.id = b.admin_id
      ORDER BY b.sent_at DESC
      LIMIT 20`
  );
  res.json({ data: { broadcasts: rows } });
}

module.exports = {
  appStats, pushAudience, pushSend, pushHistory,
  analytics, accounting, updateOrderCost, updateCheckoutGroup,
  listWholesalers, createWholesaler, updateWholesaler, updateDeadline, updatePricing, deleteWholesaler,
  getWholesalerSashConfig, updateWholesalerSashConfig,
  wholesalerStudents, toggleEditException,
  listStaff, createStaff, updateStaffType, updateStaffScope, updateStaffPassword, deleteStaff,
  repsOverview, updatePromo, updateMaintenance,
  approveOrderAdmin, rejectOrderAdmin, pendingApprovalCount,
  deleteOrder, visitorsStats,
  getMoneyGate, verifyMoneyGate, setMoneyGateSecret,
};
