// Shared helper: flip a wholesaler order bundle's approval state + audit + notify.
// Used by wholesalerController (rep approve/reject) and adminController (admin override).
//
// setBundleApproval({ checkoutGroupId, decision, actorUserId, reason, repWholesalerId })
//   → { ok, count, studentUserId, wholesalerUserId, studentName }
//
// notifyUser(userId, type, title, body, link)
//   → inserts one notification row + publishes eventBus event (fire-and-forget safe).
const { query } = require('./db');
const { publish } = require('./eventBus');

/**
 * Flip every order in a checkout_group to approved/rejected.
 *
 * @param {object} opts
 * @param {string}  opts.checkoutGroupId  - the bundle key
 * @param {string}  opts.decision         - 'approved' | 'rejected'
 * @param {string}  opts.actorUserId      - who is performing the action (UUID)
 * @param {string}  [opts.reason]         - rejection reason (required when decision='rejected')
 * @param {string}  [opts.repWholesalerId]- when set, scopes UPDATE to bundles owned by this rep
 *
 * @returns {{ ok:boolean, count:number, studentUserId:string|null, wholesalerUserId:string|null, studentName:string|null }}
 */
async function setBundleApproval({ checkoutGroupId, decision, actorUserId, reason = null, repWholesalerId = null }) {
  if (!['approved', 'rejected'].includes(decision)) {
    const e = new Error('قرار غير صالح'); e.status = 400; e.expose = true; e.code = 'ERR_VALIDATION'; throw e;
  }

  // Build the UPDATE. Alias syntax for UPDATE with a subquery ownership clause.
  // `wholesaler_approval IS NOT NULL` ensures we never touch retail orders (NULL = retail).
  const params = [checkoutGroupId, decision, actorUserId, decision === 'rejected' ? reason : null];
  let ownClause = '';
  if (repWholesalerId) {
    params.push(repWholesalerId);
    ownClause = `AND student_id IN (SELECT id FROM students WHERE wholesaler_id = $5)`;
  }

  const upd = await query(
    `UPDATE orders
        SET wholesaler_approval      = $2::wholesaler_approval_status,
            wholesaler_approved_at   = CASE WHEN $2='approved' THEN NOW() ELSE wholesaler_approved_at END,
            wholesaler_approved_by   = $3,
            wholesaler_reject_reason = $4,
            updated_at               = NOW()
      WHERE checkout_group_id = $1
        AND wholesaler_approval IS NOT NULL
        ${ownClause}
      RETURNING id, student_id`,
    params
  );

  if (!upd.rows.length) {
    const e = new Error('الطلب غير موجود'); e.status = 404; e.expose = true; e.code = 'ERR_NOT_FOUND'; throw e;
  }

  // Resolve student + rep user_ids for notifications (uses first row's student_id — all rows share it).
  const studentId = upd.rows[0].student_id;
  const info = await query(
    `SELECT s.user_id      AS student_user_id,
            u.name         AS student_name,
            w.user_id      AS wholesaler_user_id
       FROM students  s
       JOIN users     u ON u.id = s.user_id
       LEFT JOIN wholesalers w ON w.id = s.wholesaler_id
      WHERE s.id = $1`,
    [studentId]
  );
  const row = info.rows[0] || {};

  // Write audit entry (first order id representative of the bundle).
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id)
     VALUES ($1, $2, 'order', $3)`,
    [actorUserId, decision === 'approved' ? 'approve_order' : 'reject_order', upd.rows[0].id]
  );

  // Publish event for real-time listeners (non-blocking; failure here doesn't abort the response).
  publish({ type: decision === 'approved' ? 'order_approved' : 'order_rejected', checkoutGroupId });

  return {
    ok: true,
    count: upd.rows.length,
    studentUserId: row.student_user_id || null,
    wholesalerUserId: row.wholesaler_user_id || null,
    studentName: row.student_name || null,
  };
}

/**
 * Insert a single in-app notification for a user.
 * Safe to call with a null/undefined userId (no-op).
 *
 * @param {string|null} userId
 * @param {string} type
 * @param {string} title   - Arabic title (title_ar)
 * @param {string} body    - Arabic body (body_ar)
 * @param {string} [link]  - relative URL, defaults to '/'
 */
async function notifyUser(userId, type, title, body, link = '/') {
  if (!userId) return;
  await query(
    `INSERT INTO notifications (user_id, type, title_ar, body_ar, link)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, type, title, body, link]
  );
}

module.exports = { setBundleApproval, notifyUser };
