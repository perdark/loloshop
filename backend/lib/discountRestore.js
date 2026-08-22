// backend/lib/discountRestore.js — reading, and then ENDING, a storefront discount round.
//
// ── WHY THIS IS NOT A MIGRATION ────────────────────────────────────────────────────────────
// Ending a discount is the only catalogue edit that RAISES a live price, and it does it to
// many products at once. Every other backfill in db/migrations/ could be written blind because
// it moved data whose correct destination was knowable from the code; this one cannot, because
// only the owner knows which of two things happened when the round started:
//
//   A. the real prices were LOWERED and `compare_at_price` kept the old one   → restore prices
//   B. the prices never moved and `compare_at_price` is a marketing strike-through
//                                                                             → clear it only
//
// The two are indistinguishable from the data — in both, `compare_at_price > base_price` by the
// same amount. Guessing A when it was B raises every price in the shop; guessing B when it was
// A leaves the shop selling at the discount forever. So this reports first and writes second,
// and the two-way choice is a parameter, per product, taken by a human looking at the numbers.
//
// ── WHAT AN "EFFECTIVE PRICE" IS ───────────────────────────────────────────────────────────
// catalogController.buildShopFeed prices a product as
//     COALESCE(product_price_roles.base_price [for the viewer's role], products.base_price)
// so a price lives in one of two places and a product can have up to three cells worth
// restoring: the product-level base, the retail row, the wholesaler row. `scope` names which.
//
// ⚠️ A wholesaler row sitting BELOW compare_at_price is usually not a discount at all — it is
// the normal wholesale margin. That is why nothing here selects rows for the caller: the
// report marks each cell and the caller sends back exactly the ones to write.
//
// ── WHAT THIS NEVER TOUCHES ────────────────────────────────────────────────────────────────
// Orders. `orders.price`, `order_items.price` and the cart's `price_snapshot` are SNAPSHOTS
// taken at checkout — that is the point of the word — so restoring a catalogue price cannot
// reprice anything a student already bought or is holding in a cart. Verified against the
// schema, not assumed: nothing in the order path re-reads products.base_price after checkout.

const crypto = require('crypto');
const { query, tx } = require('./db');

const SCOPE_PRODUCT = 'product';
const ROLE_SCOPES = ['retail', 'wholesaler'];
const VALID_SCOPES = [SCOPE_PRODUCT, ...ROLE_SCOPES];

/**
 * Every price cell of every product that currently carries a «السعر قبل الخصم».
 *
 * Returns one entry per PRODUCT, each carrying its cells. A cell is `discounted` when its
 * price is genuinely below the compare-at (i.e. the storefront would draw a badge for that
 * audience) — `false` cells are reported, never selected by default, and stay editable by
 * hand on /admin/products.
 */
async function buildReport() {
  const { rows } = await query(
    `SELECT p.id, p.name_ar, p.type, p.active, p.base_price, p.compare_at_price,
            r.role, r.base_price AS role_price
       FROM products p
       LEFT JOIN product_price_roles r ON r.product_id = p.id
      WHERE p.compare_at_price IS NOT NULL
      ORDER BY p.active DESC, p.type, p.sort, p.name_ar`
  );

  const byId = new Map();
  for (const row of rows) {
    let product = byId.get(row.id);
    if (!product) {
      product = {
        id: row.id,
        name_ar: row.name_ar,
        type: row.type,
        active: row.active,
        compare_at_price: Number(row.compare_at_price),
        cells: [
          {
            scope: SCOPE_PRODUCT,
            current_price: Number(row.base_price),
            compare_at_price: Number(row.compare_at_price),
            delta: Number(row.compare_at_price) - Number(row.base_price),
            discounted: Number(row.base_price) < Number(row.compare_at_price),
          },
        ],
      };
      byId.set(row.id, product);
    }
    if (row.role) {
      product.cells.push({
        scope: row.role,
        current_price: Number(row.role_price),
        compare_at_price: Number(row.compare_at_price),
        delta: Number(row.compare_at_price) - Number(row.role_price),
        discounted: Number(row.role_price) < Number(row.compare_at_price),
      });
    }
  }

  const products = [...byId.values()].map((p) => ({
    ...p,
    cells: p.cells.sort((a, b) => VALID_SCOPES.indexOf(a.scope) - VALID_SCOPES.indexOf(b.scope)),
  }));

  // The one number the owner asked about ("i think 5000 change in price"): if every cell a
  // discount round would have touched moved by the same amount, say so. A mixed round reports
  // null rather than an average — an average would read like a fact and be true of no product.
  //
  // ⚠️ Wholesaler cells are excluded from this figure ON PURPOSE. A wholesale price sits below
  // the retail compare-at by the normal margin whether or not any discount was ever run, so
  // counting it would make the gap look mixed on a shop where every real discount was the same
  // 5,000 — the exact question this number exists to answer. It is a HEADLINE, not the plan:
  // every cell, wholesaler ones included, is still listed and still selectable by hand.
  const deltas = new Set();
  for (const p of products) {
    for (const c of p.cells) if (c.discounted && c.scope !== 'wholesaler') deltas.add(c.delta);
  }
  const uniform_delta = deltas.size === 1 ? [...deltas][0] : null;

  return {
    products,
    summary: {
      products: products.length,
      discounted_cells: products.reduce(
        (n, p) => n + p.cells.filter((c) => c.discounted).length,
        0
      ),
      uniform_delta,
    },
  };
}

/** The site-wide switch that gates every badge (see catalogController.isPromoLive). */
async function readPromo() {
  const { rows } = await query(
    `SELECT value FROM site_settings WHERE key = 'discount_popup'`
  );
  const cfg = (rows[0] && rows[0].value) || null;
  if (!cfg) return { configured: false, active: false, deadline: null, live: false };
  const live =
    cfg.active === true &&
    (!cfg.deadline || Date.now() < new Date(cfg.deadline).getTime());
  return {
    configured: true,
    active: cfg.active === true,
    deadline: cfg.deadline || null,
    live,
    title_ar: cfg.title_ar || '',
    message_ar: cfg.message_ar || '',
  };
}

/**
 * Validate the caller's selection against the CURRENT rows.
 *
 * The client sends back the numbers it displayed. If any of them has moved since — another
 * admin edited a price, a second tab already pressed this — the whole operation is refused
 * rather than partially applied to data nobody looked at. Same reasoning as the confirmation
 * signature in lib/adminActions.js: what executes must be what the human was shown.
 *
 * @returns {{ok: true, plan: Array}|{ok: false, error: string, code: string}}
 */
function planFrom(selection, report) {
  if (!Array.isArray(selection) || selection.length === 0) {
    return { ok: false, error: 'لم يتم اختيار أي منتج', code: 'ERR_VALIDATION' };
  }
  const known = new Map(report.products.map((p) => [p.id, p]));
  const plan = [];

  for (const item of selection) {
    const product = known.get(item && item.id);
    if (!product) {
      return { ok: false, error: 'منتج غير موجود أو لا يحمل سعراً قبل الخصم', code: 'ERR_NOT_FOUND' };
    }
    if (Number(item.expected_compare_at_price) !== product.compare_at_price) {
      return { ok: false, error: 'تغيّرت الأسعار منذ آخر تحديث — افتح الصفحة من جديد', code: 'ERR_STALE' };
    }
    const scopes = Array.isArray(item.scopes) ? item.scopes : [];
    const cells = [];
    for (const scope of scopes) {
      if (!VALID_SCOPES.includes(scope)) {
        return { ok: false, error: 'نطاق سعر غير صالح', code: 'ERR_VALIDATION' };
      }
      const cell = product.cells.find((c) => c.scope === scope);
      if (!cell) {
        return { ok: false, error: 'نطاق سعر غير موجود لهذا المنتج', code: 'ERR_NOT_FOUND' };
      }
      // Refuse to LOWER a price here. This operation exists to undo a discount; a cell already
      // at or above the compare-at needs no write, and writing it would be a price cut nobody
      // asked for.
      if (!cell.discounted) continue;
      cells.push(cell);
    }
    plan.push({ product, cells });
  }
  return { ok: true, plan };
}

/**
 * Apply a validated plan in ONE transaction: log the old value, write the new one, clear the
 * compare-at. Every product named in the selection has its compare_at_price cleared even when
 * no cell was selected — that is case B above ("the discount was display only"), and it is the
 * whole point of allowing an empty `scopes`.
 */
async function applyPlan(plan, { adminId, note }) {
  const batchId = crypto.randomUUID();
  const written = await tx(async (client) => {
    const out = [];
    for (const { product, cells } of plan) {
      for (const cell of cells) {
        const newPrice = cell.compare_at_price;
        if (cell.scope === SCOPE_PRODUCT) {
          await client.query(`UPDATE products SET base_price = $1 WHERE id = $2`, [
            newPrice,
            product.id,
          ]);
        } else {
          await client.query(
            `UPDATE product_price_roles SET base_price = $1 WHERE product_id = $2 AND role = $3`,
            [newPrice, product.id, cell.scope]
          );
        }
        await client.query(
          `INSERT INTO discount_restore_log
             (batch_id, admin_id, product_id, product_name, scope,
              old_price, new_price, old_compare_at_price, note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            batchId,
            adminId || null,
            product.id,
            product.name_ar,
            cell.scope,
            cell.current_price,
            newPrice,
            product.compare_at_price,
            note || null,
          ]
        );
        out.push({ product_id: product.id, scope: cell.scope, from: cell.current_price, to: newPrice });
      }

      // Clearing the compare-at is what removes the «خصم ٪N» badge and the struck price for
      // this product for good, independent of the site-wide promo switch.
      await client.query(`UPDATE products SET compare_at_price = NULL WHERE id = $1`, [
        product.id,
      ]);
      if (!cells.length) {
        await client.query(
          `INSERT INTO discount_restore_log
             (batch_id, admin_id, product_id, product_name, scope,
              old_price, new_price, old_compare_at_price, note)
           VALUES ($1,$2,$3,$4,'compare_at_only',NULL,NULL,$5,$6)`,
          [batchId, adminId || null, product.id, product.name_ar, product.compare_at_price, note || null]
        );
      }
    }
    return out;
  });
  return { batch_id: batchId, written };
}

/** Turn the site-wide promo off, leaving its copy intact so it can be switched back on. */
async function deactivatePromo() {
  const promo = await readPromo();
  if (!promo.configured) return { changed: false, promo };
  await query(
    `UPDATE site_settings
        SET value = value || '{"active": false}'::jsonb, updated_at = now()
      WHERE key = 'discount_popup'`
  );
  return { changed: promo.active, promo: { ...promo, active: false, live: false } };
}

module.exports = {
  buildReport,
  readPromo,
  planFrom,
  applyPlan,
  deactivatePromo,
  VALID_SCOPES,
};
