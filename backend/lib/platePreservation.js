// ───────────────────────────────────────────────────────────────────────────
// platePreservation.js — keep the calligraphy plate alive across an order rebuild.
//
// WHY THIS FILE EXISTS (2026-08-14)
//
// Several "configure" endpoints edit an order by DELETEing every `order_items` row and
// re-INSERTing from the request payload. That is fine for anything the client sent — and
// fatal for anything it did not.
//
// The generated calligraphy plate (`order_items.plate_image_url`, migration 080) is a
// SERVER-SIDE artifact. It is produced by the calligraphy engine, paid for in real API
// credits, and is NEVER part of the payload. So the rebuild dropped it: a student or rep
// re-saving an order — changing one measurement, toggling one piece — silently destroyed
// artwork a designer had already generated, with no error and nothing in the UI to say so.
//
// `lib/fullSetOrder.js:453-470` closed this for the طقم path in Track B. The same defect
// stayed open in `orderController` (configureOrder · configurePackage · configureFullSet),
// where a review panel refuted it on REACHABILITY — `orderController.js:727` 403s rep-linked
// students and plates live overwhelmingly on rep orders. That is an argument about who can
// reach the path today, not about the path being safe, and it stops being true the moment
// an admin or a route change reaches it. Closed the same way instead.
//
// ⚠️ Deliberately NOT round-tripped through the client. If the plate came back as a form
// field, a browser could clear already-paid-for artwork by posting an empty value. It is
// read from the database and written back by the server, and the client is never consulted.
//
// ⚠️ Keyed by `label_snapshot`, matching fullSetOrder. A rebuild that renames a line loses
// the plate for that line — the label IS the identity here, because the rows are destroyed
// and recreated with fresh ids. `upgradeToVip` needs none of this: its DELETE is scoped to
// package marker rows and deliberately keeps the real design lines.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Snapshot every generated plate on an order, keyed by the line's label.
 * Call BEFORE `DELETE FROM order_items`.
 *
 * @param {import('pg').PoolClient} client transaction client — must be the same tx as the delete
 * @param {string} orderId
 * @returns {Promise<Map<string, string>>} label_snapshot → plate_image_url
 */
async function capturePlates(client, orderId) {
  const { rows } = await client.query(
    `SELECT label_snapshot, plate_image_url FROM order_items
      WHERE order_id = $1 AND plate_image_url IS NOT NULL`,
    [orderId]
  );
  return new Map(rows.map((r) => [r.label_snapshot, r.plate_image_url]));
}

/**
 * The plate for a rebuilt line, or null. Pass straight into the re-INSERT.
 *
 * Takes the Map defensively (`?.`) so a caller that skipped capture — the "new order" branch,
 * where no previous rows exist — can pass `undefined` without a guard at every call site.
 */
function plateFor(preserved, label) {
  return preserved?.get(label) || null;
}

module.exports = { capturePlates, plateFor };
