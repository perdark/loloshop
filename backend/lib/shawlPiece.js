'use strict';
/**
 * الشال الأمريكي كقطعة — the rep-sold American shawl, on the production line.
 *
 * ⚠️ READ THIS BEFORE CHANGING ANYTHING HERE.
 *
 * A شال امريكي is a WHOLE GARMENT and the workshop treats it as one: it is cut, closed,
 * pressed and bagged exactly like a retail شال. The owner's rule, verbatim: «the stages for
 * shawl for wholesaler staff are same for retail staff».
 *
 * But for a rep-linked student it is not SOLD as a piece — it is an ADD-ON PRICE on the
 * وشاح. `lib/fullSetOrder.js:119` writes «إضافة: شال امريكي» (the money) and `:375` writes
 * «شال امريكي» (the note + reference photo), both onto the SASH order, and no shawl order is
 * ever created. Measured on the dev DB: 253 carriers, every one a sash, every one a rep
 * student. That is why «الشالات ما دا تطلع، دا تطلع أوشحة» — the sash row IS the shawl's row.
 *
 * ⚠️ AND IT MAY NOT BECOME AN `orders` ROW. Owner: «i dont want to change anything for
 * wholesalers or wholesalers students». A row there is visible to the rep even at price 0 —
 * `wholesalerController.js:429` STRING_AGGs product names into their own order list, `:126`
 * shows the newest order as «آخر حالة» — and it collides with
 * `uq_orders_student_product_nodesign` the moment a student has two sashes carrying a shawl.
 *
 * So the piece's STAGE lives in `sash_shawl_pieces` (migration 100) and nowhere else, and
 * the queue synthesises a row from it. Not one rep-facing query reads this table, so the
 * money, the طقم count, the rep app and the rep console are all untouched by design.
 *
 * ── THE ID SPACE IS DELIBERATELY TRANSPARENT ────────────────────────────────────────────
 * A piece id is a real uuid from `sash_shawl_pieces`, and `productionController`'s advance /
 * revert / detail / claim fall back to this module when an id is not an order. That is what
 * lets every existing caller — the station consoles, bulk advance, «السابق»/«التالي» — work
 * on a shawl with NO client-side branching. Never encode the kind into the id (`<uuid>#shawl`
 * and friends): the moment an id needs parsing, every consumer needs to know the rule.
 *
 * ⚠️ NO MONEY LIVES HERE and none ever may. The shawl is already paid for on its carrier;
 * a price on the piece would be counted twice by `lib/counts.js` the day someone joins them.
 */

const { query, tx } = require('./db');

/** The spec line the full-set form writes. NOT «إضافة: شال امريكي» — that one is the PRICE
 *  line, and matching it too would double-count a carrier. */
const SHAWL_SPEC_LINE = `(
  (oi.label_snapshot ILIKE '%شال%امريكي%' OR oi.label_snapshot ILIKE '%شال%أمريكي%')
  AND oi.label_snapshot NOT ILIKE 'إضافة:%'
)`;

/** EXISTS predicate: does this order carry a شال امريكي add-on? */
function carriesShawl(alias = 'o') {
  return `EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = ${alias}.id AND ${SHAWL_SPEC_LINE})`;
}

/**
 * Keep the piece in step with the طقم that sells it. Called from the full-set save path
 * INSIDE its transaction, so a rolled-back order never leaves an orphan piece.
 *
 * ⚠️ Un-ticking DELETEs the piece and with it whatever stage it had reached. That is the
 * honest reading — the student no longer wants a shawl, so there is no shawl to press — and
 * it matches how un-selecting a قبعة cancels its order. It is also why this is the ONLY
 * writer of that DELETE: a station must never be able to make a piece disappear.
 *
 * Re-ticking creates a FRESH piece at الكوي rather than resurrecting the old stage. A shawl
 * that was un-ticked and re-added is a new garment; claiming it is already pressed would be
 * a lie the line cannot check.
 */
async function syncForOrder(client, orderId, enabled) {
  const run = client ? client.query.bind(client) : query;
  if (!enabled) {
    await run(`DELETE FROM sash_shawl_pieces WHERE order_id = $1`, [orderId]);
    return null;
  }
  const { rows } = await run(
    `INSERT INTO sash_shawl_pieces (order_id, status) VALUES ($1, 'pressing')
     ON CONFLICT (order_id) DO NOTHING
     RETURNING id, status::text AS status`,
    [orderId]
  );
  return rows[0] || null;
}

/**
 * The piece's stages — IDENTICAL to a plain non-cap piece's, which is the owner's rule.
 * `orderController.js:664` starts one at الكوي; `productionController.nextStageFor` walks
 * pressing → preparing → ready → delivered. Kept as its own tiny map rather than calling
 * nextStageFor, because that function branches on design/embroidery flags a shawl piece does
 * not have and never will — passing it a fake order would be the start of a second, subtly
 * different state machine.
 */
const NEXT_STAGE = { pressing: 'preparing', preparing: 'ready', ready: 'delivered' };
const PREV_STAGE = { preparing: 'pressing', ready: 'preparing', delivered: 'ready' };

const nextStageFor = (piece) => NEXT_STAGE[piece.status] || null;
const revertTargetFor = (piece) => PREV_STAGE[piece.status] || null;

/** Product name shown on every screen. The shawl has no `products` row — it is not sold as
 *  one — so the label is the vocabulary, kept in one place. */
const SHAWL_PRODUCT_NAME = 'شال امريكي';

/**
 * The carrier context every synthetic row needs. One join, shared by the queue and the
 * detail page so the two can never describe the same piece differently.
 *
 * ⚠️ THE VISIBILITY GATE IS THE CARRIER'S, INHERITED — never a copy. An unapproved rep order
 * is hidden by `wholesaler_approval`, and a returned one by `returned_to_customer`; both are
 * read off the sash at query time. Storing an approval on the piece would need syncing, and
 * the day it drifted the shop would be working on a طقم its ممثل has not approved — the
 * exact failure `advanceBlockReason` exists to prevent.
 */
const PIECE_SELECT = `
  SELECT sp.id, sp.status::text AS status, sp.created_at, sp.working_staff_id, sp.working_since,
         o.id AS carrier_order_id, o.checkout_group_id, o.student_id,
         o.wholesaler_approval::text AS wholesaler_approval, o.returned_to_customer,
         s.wholesaler_id, s.user_id, s.university_name, s.department, s.study_type,
         u.name AS student_name,
         b.name_ar AS batch_name, b.deadline,
         wu.name AS wholesaler_name,
         wk.name AS working_staff_name_raw,
         (SELECT oi.customer_text FROM order_items oi
           WHERE oi.order_id = o.id AND ${SHAWL_SPEC_LINE} LIMIT 1) AS shawl_note,
         (SELECT oi.customer_image_url FROM order_items oi
           WHERE oi.order_id = o.id AND ${SHAWL_SPEC_LINE} LIMIT 1) AS shawl_image
    FROM sash_shawl_pieces sp
    JOIN orders o   ON o.id = sp.order_id
    JOIN students s ON s.id = o.student_id
    JOIN users u    ON u.id = s.user_id
    LEFT JOIN batches b     ON b.id = o.batch_id
    LEFT JOIN wholesalers w ON w.id = s.wholesaler_id
    LEFT JOIN users wu      ON wu.id = w.user_id
    LEFT JOIN users wk      ON wk.id = sp.working_staff_id`;

/**
 * ⚠️ A CANCELLED وشاح HAS NO SHAWL, AND THIS PREDICATE IS THE ONLY THING THAT SAYS SO.
 *
 * `syncForOrder` is the only writer that DELETEs a piece, and it only runs for `type === 'sash'`
 * inside `persistFullSetOrder`'s `for (const type of selectedPieces)` loop. Deselect the وشاح and
 * that loop never reaches sash at all — the order is cancelled by the separate deselect pass
 * (`fullSetOrder.js:437-446`) and the piece is left pointing at it. Without this clause the shawl
 * stands in المكوجي's queue forever for a طقم that no longer has a وشاح, and `advance` would
 * happily walk it down the line.
 *
 * It is a READ-side guard on purpose, not a DELETE in the deselect loop: an order reaches
 * 'cancelled' from FOUR places — the deselect pass and the self-heal in `fullSetOrder.js`
 * (:441, :506) and two more in `orderController.js` (:915, :1258) — and a writer-side fix would
 * have to be repeated in each, which is how the next one gets missed. Migration 100's backfill
 * already says the same thing (`WHERE o.status <> 'cancelled'`); this makes the running queries
 * agree with it instead of only the seed.
 *
 * The piece ROW is deliberately left in place rather than deleted here: reads must never destroy
 * production history, and if the student re-adds the وشاح the ordinary `syncForOrder` path
 * decides what happens to it.
 */
const LIVE_CARRIER = `o.status::text <> 'cancelled'`;

/** Same freshness rule as the order queue's working_staff_name. */
const PRESENCE_TTL_SECONDS = 90;

/**
 * Synthetic queue rows for the stages this viewer is looking at.
 *
 * Shaped to match `productionController.getQueue`'s row exactly, so the console renders it
 * with no special case. The fields a shawl genuinely does not have are NULL/false rather
 * than absent — `design_id`, `has_embroidery`, `final_design_url` — because an absent key
 * and a false one read differently on the client.
 *
 * @param {string[]} stages   the stages the caller is showing
 * @param {string}   source   '', 'retail' or 'wholesaler' — every shawl piece is a rep
 *                            piece, so a 'retail' filter must return none.
 */
async function queueRows(stages, source = '') {
  const live = (stages || []).filter((st) => st in NEXT_STAGE || st === 'delivered');
  if (!live.length) return [];
  // Every carrier is a rep order (measured: 253/253), so a تجزئة filter excludes all of them.
  if (source === 'retail') return [];
  const { rows } = await query(
    `${PIECE_SELECT}
      WHERE sp.status::text = ANY($1)
        AND ${LIVE_CARRIER}
        AND (s.wholesaler_id IS NULL OR o.wholesaler_approval = 'approved')
        AND o.returned_to_customer = FALSE
      ORDER BY b.deadline ASC NULLS LAST, sp.created_at ASC`,
    [live]
  );
  return rows.map(toQueueRow);
}

function toQueueRow(r) {
  const fresh =
    r.working_since && Date.now() - new Date(r.working_since).getTime() < PRESENCE_TTL_SECONDS * 1000;
  return {
    id: r.id,
    status: r.status,
    created_at: r.created_at,
    design_id: null,
    checkout_group_id: r.checkout_group_id,
    student_id: r.student_id,
    // A shawl is pressed, so this is TRUE — it is what makes الكوي its first stage, exactly
    // as `orderController.js:655` decides for a retail one.
    needs_pressing: true,
    has_embroidery: false,
    working_staff_id: r.working_staff_id,
    working_since: r.working_since,
    working_staff_name: fresh ? r.working_staff_name_raw : null,
    final_design_url: null,
    has_design_images: !!r.shawl_image,
    student_name: r.student_name,
    university_name: r.university_name,
    department: r.department,
    study_type: r.study_type,
    product_name: SHAWL_PRODUCT_NAME,
    product_type: 'shawl',
    // The student's own words about this shawl — the same haystack the order queue builds,
    // so the console's search finds a shawl by what was asked for on it.
    search_text: r.shawl_note || null,
    measurements: null,
    product_image_url: null,
    batch_name: r.batch_name,
    deadline: r.deadline,
    approval_status: null,
    rejection_reason: null,
    source: 'wholesaler',
    wholesaler_name: r.wholesaler_name,
    // ⚠️ NO `price` / `group_price`. The shawl's money is on the carrier sash and is already
    // reported there; a figure here would read as a second sale of the same garment.
    // The marker the client renders «شال امريكي — إضافة على الوشاح» from.
    piece_kind: 'shawl_addon',
    carrier_order_id: r.carrier_order_id,
    shawl_note: r.shawl_note || null,
    shawl_image_url: r.shawl_image || null,
  };
}

/**
 * One piece by id, or null when the id is not a shawl piece (i.e. it is an order) — or when its
 * carrier وشاح has been cancelled. See LIVE_CARRIER for why the cancelled half is here.
 */
async function loadPiece(id) {
  const { rows } = await query(`${PIECE_SELECT} WHERE sp.id = $1 AND ${LIVE_CARRIER}`, [id]);
  return rows[0] || null;
}

module.exports = {
  SHAWL_PRODUCT_NAME,
  carriesShawl,
  syncForOrder,
  nextStageFor,
  revertTargetFor,
  queueRows,
  loadPiece,
  toQueueRow,
};
