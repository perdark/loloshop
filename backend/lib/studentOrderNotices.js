'use strict';

/**
 * ⚠️ STAGE-CHANGE NOTIFICATIONS TO THE STUDENT ARE **PAUSED** (owner 2026-09-14).
 *
 * Until today three writers pushed a notification to the student on every internal move:
 * `orderController.updateStatus`, `productionController.performAdvance` and
 * `productionController.revert`, all of them sending
 * «حالة طلبك الآن: ${STATUS_LABEL_AR[to]}». Two things were wrong with that at once, and
 * they are why this file exists rather than three deleted INSERTs:
 *
 *  1. **It was noise.** A طقم is several `orders` rows, so one garment walking the line fired
 *     one notification PER PIECE — the student's phone buzzed three times to be told the same
 *     sentence. `updateStatus` did not even guard `prev !== status`: re-saving an order on the
 *     stage it was already at (X → X) wrote a notification for a move that never happened.
 *     That is literally what was reported from the floor.
 *  2. **It leaked an internal stage word**, which the 2026-09-14 «قيد التنفيذ» work had just
 *     finished removing from every screen the customer can see (`MyOrdersList.tsx`,
 *     `supportContext.customerStatusAr`). Pushing «قيد الكوي» to a phone re-opened the exact
 *     door those two closed — and a notification cannot be un-sent.
 *
 * So the pause is a boolean, not a deletion: the owner asked to «pause it for now», and the
 * body below is the shape the shop will want when it comes back. Note what it sends — the
 * CUSTOMER phrase, never `STATUS_LABEL_AR`. Turning `STAGE_NOTICES_ENABLED` on must not be
 * able to leak a stage word, whatever the enum grows next.
 *
 * What replaces it is `notifySetReady` below: ONE notification when the whole SET is done.
 * That is the promise `MyOrdersList.tsx` makes in words («راح نعلمك أول ما يخلص كامل»), and it
 * is deliberately NOT what flipping the flag back on would give you — the flag is per piece
 * and per stage, this is per order and only once.
 *
 * Still live and deliberately untouched — these are events, not stages, and each is something
 * the student must act on or turn up for:
 *   · «تم تسليم طلبك»            — productionController.confirmDelivery
 *   · «تم إرجاع طلبك للتعديل»    — productionController.returnToCustomer
 *   · design approved / rejected — designController, designTeamController
 *   · rep approval               — lib/orderApproval.js
 */

const STAGE_NOTICES_ENABLED = false;

/** The only words a customer may hear. Mirrors `supportContext.customerStatusAr` and
 *  `MyOrdersList.SET_LABEL` on purpose — three surfaces, one vocabulary. */
const CUSTOMER_STATE_AR = {
  pending_approval: 'بانتظار الموافقة',
  ready: 'جاهز للاستلام',
  delivered: 'تم التسليم',
  cancelled: 'ملغي',
};

/** Every production stage collapses to one phrase. Unknown is in-flight, not raw. */
function customerStateAr(status) {
  return CUSTOMER_STATE_AR[status] || 'قيد التنفيذ';
}

/**
 * Tell the student their order moved. Currently a no-op — see the header.
 *
 * @param {object} client  a `tx` client (the caller is always inside a transaction)
 * @param {{ userId: string, status: string }} what
 * @returns {Promise<boolean>} whether a notification row was written
 */
async function notifyStageChange(client, { userId, status }) {
  if (!STAGE_NOTICES_ENABLED) return false;
  if (!userId) return false;
  await client.query(
    `INSERT INTO notifications (user_id, type, title_ar, body_ar, link)
     VALUES ($1, 'status_change', $2, $3, '/')`,
    [userId, 'تحديث حالة الطلب', `حالة طلبك الآن: ${customerStateAr(status)}`]
  );
  return true;
}


/**
 * «طلبك جاهز للاستلام» — sent ONCE, for the whole طقم, and re-armed if the set stops being done.
 *
 * This is the same rule `MyOrdersList.tsx` renders, in the same words, deliberately: the set is
 * `checkout_group_id` (falling back to the order's own id for legacy rows with none), and it is
 * ready only when EVERY live piece in it has reached ready/delivered. Measured on the prod
 * restore the day that screen changed: 180 students had one piece at `ready` with others still
 * in production, 176 of them inside one `checkout_group_id`. A per-PIECE notification would be
 * the same wrong answer as the per-piece label — a student walking to the shop for an order
 * that is not finished — only this time it would arrive on their phone and could not be taken
 * back.
 *
 * ⚠️ IT IS ALSO THE RE-ARM, AND THAT IS WHY IT RUNS ON EVERY STATUS CHANGE, NOT ONLY ON
 * `ready`. Three things un-finish a set that was already announced: a staff member reverting a
 * piece out of ready, a returned piece being resubmitted, and a new piece joining the group.
 * In all three the student was told something that stopped being true, so the stamp is cleared
 * and the next completion announces again — which is correct: they came, it was not there, it
 * was pulled back, now it really is ready. Clearing here rather than at each of those call
 * sites is what keeps the rule in ONE place; the alternative is three writers that have to
 * agree forever, which is how «بانتظار موافقة الممثل» and `available_actions` drifted twice.
 *
 * ⚠️ A RETURNED PIECE IS NOT PART OF THE SET. `orderController.myOrders` filters
 * `returned_to_customer = FALSE`, so the student cannot see it on «طلباتي» at all — counting it
 * would hold the notification back for a garment that is not on the screen it refers to. When
 * it is resubmitted it re-enters the set as an in-flight piece and the paragraph above applies.
 *
 * @returns {Promise<boolean>} whether a notification row was written
 */
async function notifySetReady(client, orderId) {
  if (!orderId) return false;
  const { rows } = await client.query(
    `WITH me AS (SELECT student_id, checkout_group_id FROM orders WHERE id = $1),
     peers AS (
       SELECT o.id, o.status::text AS status, o.ready_notified_at, o.student_id
         FROM orders o, me
        WHERE o.student_id = me.student_id
          AND o.returned_to_customer = FALSE
          AND (CASE WHEN me.checkout_group_id IS NULL
                    THEN o.id = $1
                    ELSE o.checkout_group_id = me.checkout_group_id END)
     )
     SELECT s.user_id,
            count(*) FILTER (WHERE p.status <> 'cancelled')::int      AS live,
            count(*) FILTER (WHERE p.status IN ('ready','delivered'))::int AS done,
            bool_or(p.ready_notified_at IS NOT NULL)                  AS told,
            array_agg(p.id)                                           AS ids
       FROM peers p JOIN students s ON s.id = p.student_id
      GROUP BY s.user_id`,
    [orderId]
  );
  const set = rows[0];
  if (!set) return false;

  const complete = set.live > 0 && set.done === set.live;
  if (!complete) {
    // Re-arm: something in this set is moving again, so an earlier «جاهز» no longer holds.
    if (set.told) {
      await client.query(`UPDATE orders SET ready_notified_at = NULL WHERE id = ANY($1)`, [set.ids]);
    }
    return false;
  }
  if (set.told || !set.user_id) return false;

  // Stamp BEFORE the insert: both statements are inside the caller's transaction, so if the
  // advance rolls back so does the notification, and two concurrent advances of the last two
  // pieces cannot both see `told = false` and write twice.
  await client.query(`UPDATE orders SET ready_notified_at = now() WHERE id = ANY($1)`, [set.ids]);
  await client.query(
    `INSERT INTO notifications (user_id, type, title_ar, body_ar, link)
     VALUES ($1, 'order_ready', $2, $3, '/cart')`,
    [set.user_id, 'طلبك جاهز للاستلام',
     set.live > 1
       ? 'خلصت كل قطع طلبك — تكدر تجي تستلمه.'
       : 'خلص طلبك — تكدر تجي تستلمه.']
  );
  return true;
}

module.exports = { notifyStageChange, notifySetReady, customerStateAr, STAGE_NOTICES_ENABLED };
