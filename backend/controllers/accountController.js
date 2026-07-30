'use strict';
// Self-service account deletion — Apple App Store guideline 5.1.1(v).
//
// The first iOS submission was rejected on 2026-07-29: the app supports account
// creation but offered no way to delete an account from inside it. /delete-account
// only said "message @lolo_shop96", and Apple does not accept a customer-service
// route outside highly-regulated industries. This is the in-app flow.
//
// See db/migrations/076_account_deletion.sql for why deletion ANONYMISES the row
// instead of removing it (short version: orders.student_id is ON DELETE RESTRICT,
// so a row delete is refused the moment the student has one order, and forcing it
// would destroy the shop's own sales records).

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { query, tx } = require('../lib/db');

// ONLY self-registered students may erase their own account (owner decision,
// 2026-07-30). Deliberately an ALLOW-list, so a role added later cannot become
// self-deletable by accident:
//   • wholesaler — deleting a rep mid-season detaches their whole student group
//     and kills the referral link 100+ students joined through.
//   • staff / worker / design_helper / admin — the account is a payroll identity
//     tied to attendance records, wage ledgers and payout history.
// Everyone outside this list is removed by an admin, from the admin screens.
const SELF_DELETE_ROLES = ['retail'];

// What the account's name becomes. Staff screens that still reference a retained
// order will show this instead of a blank, so a deleted account reads as deleted
// rather than as missing data.
const DELETED_NAME = 'حساب محذوف';

/** Orders that still need the shop to do something. Cancelled is over; delivered is done. */
const ACTIVE_ORDER_SQL = `o.status NOT IN ('cancelled', 'delivered')`;

async function orderCounts(userId) {
  const { rows } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE ${ACTIVE_ORDER_SQL})::int AS active,
       COUNT(*) FILTER (WHERE o.status <> 'cancelled')::int AS total
     FROM orders o
     JOIN students s ON s.id = o.student_id
     WHERE s.user_id = $1`,
    [userId]
  );
  return rows[0] || { active: 0, total: 0 };
}

/**
 * GET /auth/account/deletion-preview
 * Powers the confirmation screen. Apple allows confirmation steps, and a student
 * with a sash already on the embroidery machine deserves to know that deleting
 * the account does NOT cancel the order before they commit to it.
 */
async function deletionPreview(req, res) {
  const eligible = SELF_DELETE_ROLES.includes(req.user.role);
  if (!eligible) {
    return res.json({
      eligible: false,
      reason_ar:
        'هذا الحساب مرتبط بعمل داخل المتجر، لذلك يُحذف من قبل الإدارة. راجع مدير المتجر لحذف الحساب.',
      active_orders: 0,
      total_orders: 0,
    });
  }
  const counts = await orderCounts(req.user.id);
  res.json({
    eligible: true,
    active_orders: counts.active,
    total_orders: counts.total,
  });
}

/**
 * POST /auth/account/delete   { password }
 *
 * Re-asks for the password because the phone in a student's hand is usually
 * unlocked and already signed in — without it, anyone holding the device could
 * destroy the account. This is a confirmation step, not a support barrier: the
 * account holder always knows their own password, and nobody has to be contacted.
 */
async function deleteAccount(req, res) {
  if (!SELF_DELETE_ROLES.includes(req.user.role)) {
    return res.status(403).json({
      error:
        'هذا الحساب مرتبط بعمل داخل المتجر، لذلك يُحذف من قبل الإدارة. راجع مدير المتجر لحذف الحساب.',
      code: 'ERR_ROLE_NOT_SELF_DELETABLE',
    });
  }

  const { password } = req.body || {};
  if (!password) {
    return res
      .status(400)
      .json({ error: 'أدخل كلمة المرور لتأكيد الحذف', code: 'ERR_VALIDATION', field: 'password' });
  }

  const { rows } = await query(`SELECT password_hash FROM users WHERE id = $1`, [req.user.id]);
  if (!rows.length) {
    return res.status(401).json({ error: 'غير مصرح', code: 'ERR_AUTH' });
  }
  const ok = await bcrypt.compare(password, rows[0].password_hash);
  if (!ok) {
    return res
      .status(401)
      .json({ error: 'كلمة المرور غير صحيحة', code: 'ERR_INVALID_CREDENTIALS', field: 'password' });
  }

  // Counted BEFORE the scrub so the response can tell the student what was kept.
  const counts = await orderCounts(req.user.id);

  // A real bcrypt hash of an unguessable secret: no password anyone can type will
  // ever match it, and every code path that expects a valid hash keeps working.
  const deadHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);

  const erased = await tx(async (client) => {
    // `AND deleted_at IS NULL` makes this idempotent: a double-tap, a retried
    // request, or two tabs racing can only ever erase the account once.
    const upd = await client.query(
      `UPDATE users
          SET name = $2,
              phone = NULL,
              email = NULL,
              password_hash = $3,
              phone_verified = FALSE,
              token_version = token_version + 1,
              deleted_at = NOW(),
              updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id`,
      [req.user.id, DELETED_NAME, deadHash]
    );
    if (!upd.rows.length) return false; // already deleted by a concurrent request

    // The student PROFILE is account data and goes. The order's own delivery
    // snapshot on checkout_groups is a transaction record and deliberately stays,
    // which is what lets an in-flight sash still be finished and delivered.
    await client.query(
      `UPDATE students
          SET full_name_third = $2,
              instagram_username = NULL,
              university_name = NULL,
              department = NULL
        WHERE user_id = $1`,
      [req.user.id, DELETED_NAME]
    );

    // An abandoned cart is not a business record — it goes entirely (cart_items
    // cascades off carts).
    await client.query(`DELETE FROM carts WHERE user_id = $1`, [req.user.id]);
    await client.query(`DELETE FROM notifications WHERE user_id = $1`, [req.user.id]);
    // Live credentials: any unused OTP, any pending reset, and every 90-day
    // trusted-device token that would otherwise skip the OTP on a future login.
    await client.query(`DELETE FROM otp_codes WHERE user_id = $1`, [req.user.id]);
    await client.query(`DELETE FROM password_resets WHERE user_id = $1`, [req.user.id]);
    await client.query(`DELETE FROM trusted_devices WHERE user_id = $1`, [req.user.id]);

    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'account_self_delete', 'user', $1, $2)`,
      [
        req.user.id,
        // No name/phone here — an audit row that copies the data we just erased
        // would put it straight back into the database.
        JSON.stringify({
          role: req.user.role,
          active_orders: counts.active,
          total_orders: counts.total,
          source: 'self_service',
        }),
      ]
    );
    return true;
  });

  // token_version was incremented, so the caller's JWT is already dead — every
  // other signed-in device for this account is signed out at the same instant.
  res.json({
    data: {
      deleted: true,
      already_deleted: !erased,
      retained_orders: counts.total,
      message_ar: 'تم حذف حسابك نهائياً.',
    },
  });
}

module.exports = { deleteAccount, deletionPreview, SELF_DELETE_ROLES, DELETED_NAME };
