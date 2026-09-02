'use strict';
// One query behind «النشاط» on /staff/team (admin) and /staff/me (the worker). Two sources,
// because the embroiderer's real work is zone ticks in audit_log, not stage moves:
// staff_activity_log only records stage MOVES (advance/return/etc), but a large slice of daily
// work — ticking an embroidery zone — is written to audit_log (action 'embroidery_zone') and
// never touches staff_activity_log. Before this builder, that under-reported the embroiderer
// badly: he could work all day and the activity log would show almost nothing. UNION both.
const { query } = require('./db');
const { localParts, DEFAULT_TZ } = require('./shopTime');

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Resolve a 'YYYY-MM' key (or the current month at the shop, Asia/Baghdad) into the half-open
 * range [from, next) used to filter created_at. Throws { code: 'ERR_VALIDATION' } on a bad key —
 * callers must catch that and respond 400, never let it become a 500.
 */
function monthBounds(month) {
  const key = month || localParts(new Date(), DEFAULT_TZ).date.slice(0, 7);
  if (!MONTH_RE.test(key)) {
    const e = new Error('شهر غير صالح');
    e.code = 'ERR_VALIDATION';
    throw e;
  }
  const [y, m] = key.split('-').map(Number);
  const from = `${key}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { key, from, next };
}

/**
 * A staff member's activity for one month, newest first — stage moves and embroidery-zone
 * ticks together. Never returns money, price, cost, profit, phone or email columns: this is
 * read by the worker looking at their own log AND by an admin looking at someone else's.
 *
 * @returns {Promise<Array<{id, source: 'stage'|'audit', action, from_stage, to_stage, zone,
 *   created_at, order_id, product_name, student_name, month}>>}
 */
async function activityFor(userId, { month, limit = 500 } = {}) {
  const { key, from, next } = monthBounds(month);
  const { rows } = await query(
    `WITH src AS (
       SELECT sal.id::text AS id, 'stage' AS source, sal.action, sal.from_stage, sal.to_stage,
              NULL::text AS zone, sal.created_at, sal.order_id
         FROM staff_activity_log sal
        WHERE sal.user_id = $1
       UNION ALL
       SELECT al.id::text, 'audit', al.action, NULL, NULL, al.details->>'zone', al.created_at,
              al.entity_id
         FROM audit_log al
        WHERE al.actor_id = $1 AND al.entity = 'order'
          AND al.action IN ('embroidery_zone', 'tailor_complete', 'tailor_reopen', 'return_to_customer')
     )
     SELECT s.*, p.name_ar AS product_name, u.name AS student_name
       FROM src s
       LEFT JOIN orders o   ON o.id = s.order_id
       LEFT JOIN products p ON p.id = o.product_id
       LEFT JOIN students st ON st.id = o.student_id
       LEFT JOIN users u    ON u.id = st.user_id
      WHERE (s.created_at AT TIME ZONE 'Asia/Baghdad') >= $2::timestamp
        AND (s.created_at AT TIME ZONE 'Asia/Baghdad') <  $3::timestamp
      ORDER BY s.created_at DESC
      LIMIT $4`,
    [userId, from, next, limit]
  );
  return rows.map((r) => ({ ...r, month: key }));
}

module.exports = { activityFor, monthBounds };
