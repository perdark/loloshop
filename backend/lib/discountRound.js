// backend/lib/discountRound.js — STARTING a storefront discount round.
//
// The mirror of lib/discountRestore.js, which ends one. Read that file's header first: it
// explains what an "effective price" is and why a price can live in two places. This file
// assumes all of it.
//
// ── WHY IT EXISTS ──────────────────────────────────────────────────────────────────────────
// Ending a round shipped first, so for three months the shop could stop a discount but not
// start one. Starting meant hand-editing every product on /admin/products — lower base_price,
// then retype the old price into «السعر قبل الخصم» — two edits per product, 51 products, no
// preview and no undo. Every round therefore needed a developer.
//
// ── THE WRITE ──────────────────────────────────────────────────────────────────────────────
//   compare_at_price ← the product's effective RETAIL price right now
//   base_price       ← that price − amount, on each selected cell
//
// which is exactly the shape discountRestore reverses, so the two halves are inverses over the
// same two columns and ending keeps working untouched.
//
// ⚠️ WHY `compare_at_price` IS THE RETAIL EFFECTIVE PRICE AND NOT THE PRODUCT'S OWN base_price.
// `compare_at_price` is a single product-level column, but the storefront draws its badge by
// comparing it against whatever the VIEWER's effective price is (buildShopFeed:
// COALESCE(product_price_roles.base_price, products.base_price)). A product with a retail row
// therefore needs the retail number here, or the struck-through price shown to students is one
// they were never charged.
//
// ⚠️ RUNNING THIS TWICE ON ONE PRODUCT DESTROYS THE REAL PRICE, AND NO LEDGER CAN UNDO IT.
// The second press writes the already-discounted price into compare_at_price as "the old
// price". discount_restore_log does not save you: the damage is in what was written to it, not
// in what products lost. So `already_discounted` is a REFUSAL (ERR_ALREADY_DISCOUNTED), never a
// silent skip — the admin is sent to «إنهاء الخصومات» first, the only order that preserves it.
//
// ── WHAT THIS NEVER TOUCHES ────────────────────────────────────────────────────────────────
// Orders and carts, for the same reason discountRestore does not: `orders.price`,
// `order_items.price` and the cart's `price_snapshot` are snapshots taken at checkout. Lowering
// a catalogue price cannot retroactively discount an order already placed.

const crypto = require('crypto');
const { query, tx } = require('./db');

const SCOPE_PRODUCT = 'product';
const VALID_SCOPES = [SCOPE_PRODUCT, 'retail', 'wholesaler'];

/**
 * The cells a round ticks by default, PER PRODUCT — see `defaultScopesFor`. There is no single
 * list, and the reason is measured, not stylistic: see the comment on that function.
 */
function defaultScopesFor(product) {
  // The retail row, when it exists, IS the price a student pays; `products.base_price` is then
  // a different audience's price entirely (a rep-linked student with no wholesaler row) that
  // simply happens to sit above it. Discounting both would advertise one discount and give two.
  //
  // ⚠️ AND IT WOULD NOT SURVIVE A ROUND-TRIP. Ending a round restores every selected cell to
  // the single `compare_at_price` column, so a product whose base (30,000) sat above its retail
  // (28,000) comes back from start→end with BOTH at 28,000 — the base silently, permanently
  // lowered by a discount that has been ended. That is the same shape as the four product-level
  // cells the August 2026 round left stranded below their real price (see HANDOFF). Not
  // discounting the base is what keeps the cycle lossless; the tick is still offered.
  const hasRetail = product.cells.some((c) => c.scope === 'retail');
  return hasRetail ? ['retail'] : [SCOPE_PRODUCT];
}

/**
 * Every product a round could be applied to, with its price cells.
 *
 * Unlike buildReport (which lists only products already carrying a compare-at), this lists the
 * whole active catalogue — including products that are `already_discounted`, because the panel
 * has to SHOW them as unavailable rather than hide them. A product that silently vanishes from
 * the list reads as a bug; one marked «مخصوم أصلاً» explains itself.
 */
async function buildCandidates() {
  const { rows } = await query(
    `SELECT p.id, p.name_ar, p.type, p.active, p.base_price, p.compare_at_price,
            r.role, r.base_price AS role_price
       FROM products p
       LEFT JOIN product_price_roles r ON r.product_id = p.id
      WHERE p.active = TRUE
      ORDER BY p.type, p.sort, p.name_ar`
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
        already_discounted: row.compare_at_price !== null,
        compare_at_price: row.compare_at_price === null ? null : Number(row.compare_at_price),
        // Provisional: the product's own base, replaced below if a retail row exists.
        retail_price_now: Number(row.base_price),
        cells: [{ scope: SCOPE_PRODUCT, current_price: Number(row.base_price) }],
      };
      byId.set(row.id, product);
    }
    if (row.role) {
      product.cells.push({ scope: row.role, current_price: Number(row.role_price) });
      if (row.role === 'retail') product.retail_price_now = Number(row.role_price);
    }
  }

  const products = [...byId.values()].map((p) => {
    const cells = p.cells.sort(
      (a, b) => VALID_SCOPES.indexOf(a.scope) - VALID_SCOPES.indexOf(b.scope)
    );
    const withCells = { ...p, cells };
    return { ...withCells, default_scopes: defaultScopesFor(withCells) };
  });

  return {
    products,
    summary: {
      products: products.length,
      available: products.filter((p) => !p.already_discounted).length,
      already_discounted: products.filter((p) => p.already_discounted).length,
    },
  };
}

/**
 * Validate a selection against the CURRENT catalogue.
 *
 * Every refusal below aborts the WHOLE round rather than dropping one product. Same contract as
 * discountRestore.planFrom and the confirmation signature in lib/adminActions.js: what executes
 * must be what the human was shown. A partially-applied round is worse than none, because the
 * admin has no way to tell which half landed.
 *
 * @returns {{ok: true, plan: Array}|{ok: false, error: string, code: string}}
 */
function planStart(selection, candidates, { amount } = {}) {
  const cut = Number(amount);
  if (!Number.isInteger(cut) || cut <= 0) {
    return { ok: false, error: 'مبلغ الخصم غير صالح', code: 'ERR_VALIDATION' };
  }
  if (!Array.isArray(selection) || selection.length === 0) {
    return { ok: false, error: 'لم يتم اختيار أي منتج', code: 'ERR_VALIDATION' };
  }

  const known = new Map(candidates.products.map((p) => [p.id, p]));
  const plan = [];

  for (const item of selection) {
    const product = known.get(item && item.id);
    if (!product) {
      return { ok: false, error: 'منتج غير موجود', code: 'ERR_NOT_FOUND' };
    }
    if (product.already_discounted) {
      return {
        ok: false,
        error: `«${product.name_ar}» مخصوم أصلاً — أنهِ الخصم الحالي أولاً`,
        code: 'ERR_ALREADY_DISCOUNTED',
      };
    }
    if (Number(item.expected_price) !== product.retail_price_now) {
      return {
        ok: false,
        error: 'تغيّرت الأسعار منذ آخر تحديث — افتح الصفحة من جديد',
        code: 'ERR_STALE',
      };
    }

    const scopes = Array.isArray(item.scopes) ? item.scopes : [];
    // Unlike ENDING a round, an empty selection of scopes is not a meaningful instruction here:
    // it would set a compare-at equal to the current price, i.e. paint a «خصم» badge on a
    // product whose price never moved. That is a lie on the storefront, not a no-op.
    if (scopes.length === 0) {
      return { ok: false, error: 'اختر سعراً واحداً على الأقل لتخفيضه', code: 'ERR_VALIDATION' };
    }

    const cells = [];
    for (const scope of scopes) {
      if (!VALID_SCOPES.includes(scope)) {
        return { ok: false, error: 'نطاق سعر غير صالح', code: 'ERR_VALIDATION' };
      }
      const cell = product.cells.find((c) => c.scope === scope);
      if (!cell) {
        return { ok: false, error: 'نطاق سعر غير موجود لهذا المنتج', code: 'ERR_NOT_FOUND' };
      }
      if (cut >= cell.current_price) {
        return {
          ok: false,
          error: `الخصم أكبر من سعر «${product.name_ar}» — لا يمكن أن ينزل السعر إلى الصفر`,
          code: 'ERR_AMOUNT_TOO_BIG',
        };
      }
      cells.push({ ...cell, new_price: cell.current_price - cut });
    }

    plan.push({ product, compare_at: product.retail_price_now, cells });
  }

  return { ok: true, plan };
}

/**
 * Apply a validated plan in ONE transaction: log the old value, lower the price, set the
 * compare-at. Every write is recorded in `discount_restore_log` with `direction = 'start'`, so
 * one ledger holds both halves of a round's life and a wrong press is one UPDATE from undone.
 */
async function applyStart(plan, { adminId, note, amount }) {
  const batchId = crypto.randomUUID();
  const written = await tx(async (client) => {
    const out = [];
    for (const { product, compare_at, cells } of plan) {
      for (const cell of cells) {
        if (cell.scope === SCOPE_PRODUCT) {
          await client.query(`UPDATE products SET base_price = $1 WHERE id = $2`, [
            cell.new_price,
            product.id,
          ]);
        } else {
          await client.query(
            `UPDATE product_price_roles SET base_price = $1 WHERE product_id = $2 AND role = $3`,
            [cell.new_price, product.id, cell.scope]
          );
        }
        await client.query(
          `INSERT INTO discount_restore_log
             (batch_id, admin_id, product_id, product_name, scope,
              old_price, new_price, old_compare_at_price, note, direction)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,'start')`,
          [
            batchId,
            adminId || null,
            product.id,
            product.name_ar,
            cell.scope,
            cell.current_price,
            cell.new_price,
            note || null,
          ]
        );
        out.push({
          product_id: product.id,
          product_name: product.name_ar,
          scope: cell.scope,
          from: cell.current_price,
          to: cell.new_price,
        });
      }

      // Last, and only after every price for this product is down: the compare-at is what makes
      // the badge appear, so writing it first would advertise a discount that does not exist yet.
      await client.query(`UPDATE products SET compare_at_price = $1 WHERE id = $2`, [
        compare_at,
        product.id,
      ]);
    }
    return out;
  });
  return { batch_id: batchId, amount, written };
}

module.exports = {
  buildCandidates,
  planStart,
  applyStart,
  defaultScopesFor,
  VALID_SCOPES,
};
