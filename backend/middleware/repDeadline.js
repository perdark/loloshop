const { query } = require('../lib/db');

/**
 * A rep-linked student may not create, add to, or edit an order once their rep's
 * deadline (`wholesalers.deadline`) has passed. Owner ruling 2026-11-08.
 *
 * `ERR_DEADLINE_PASSED` sat in API.md from the very first commit and was never wired:
 * the deadline only ever drove a countdown and the staff sort order, so 109 rep orders
 * were placed after it (measured on the 2026-09-12 prod restore, 6 reps).
 *
 * - The deadline is a CALENDAR DATE. The admin picks it with `<input type="date">`, so
 *   the stored instant lands anywhere from 00:00 to 03:00 Baghdad depending on how it was
 *   saved. Comparing instants would lock the student out on the morning of their last
 *   day; this compares Baghdad dates, so the whole deadline day stays open.
 * - Only the STUDENT is locked (role 'retail' with a wholesaler). Staff/admin edit through
 *   /production/* and /staff/*, which never pass through this guard — that is how the shop
 *   finishes orders for students who missed the deadline. The rep's own
 *   `configure-package` (role 'wholesaler') is not gated either.
 * - Reopening: the admin extends the rep's deadline («تمديد الموعد»), or flips the
 *   per-student `edit_exception` on /admin, which already means «let this one edit».
 * - Viewing, removing a cart line and cancelling stay open on purpose.
 */
async function repDeadlineOpen(userId) {
  const { rows } = await query(
    `SELECT s.edit_exception,
            w.deadline IS NOT NULL
              AND (NOW() AT TIME ZONE 'Asia/Baghdad')::date
                  > (w.deadline AT TIME ZONE 'Asia/Baghdad')::date AS passed
       FROM students s
       JOIN wholesalers w ON w.id = s.wholesaler_id
      WHERE s.user_id = $1`,
    [userId]
  );
  const r = rows[0];
  // No row = not rep-linked (or no student yet) → nothing to enforce here.
  return !r || !r.passed || !!r.edit_exception;
}

async function requireRepDeadlineOpen(req, res, next) {
  if (req.user?.role !== 'retail') return next();
  if (await repDeadlineOpen(req.user.id)) return next();
  return res.status(403).json({
    error: 'انتهى الموعد النهائي لدفعتك، لا يمكن إضافة طلب أو تعديله. تواصل مع ممثلك أو مع المحل.',
    code: 'ERR_DEADLINE_PASSED',
  });
}

module.exports = { requireRepDeadlineOpen, repDeadlineOpen };
