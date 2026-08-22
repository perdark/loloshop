// backend/controllers/discountController.js — «إنهاء الخصومات»: read the round, then end it.
//
// Two endpoints, deliberately in that order. GET writes nothing and is the only way to learn
// what a discount round actually did to prices; POST writes only cells the caller sent back
// after seeing that report. The reasoning for the split — and for why this is not a migration —
// is at the top of lib/discountRestore.js.
//
// Both are admin-only (routes/admin.js applies authRequired + requireRole('admin') to the
// whole router).

const memoCache = require('../lib/memoCache');
const restore = require('../lib/discountRestore');

// ---------- ADMIN: what is discounted right now ----------
async function report(req, res) {
  const [data, promo] = await Promise.all([restore.buildReport(), restore.readPromo()]);
  res.json({ data: { ...data, promo } });
}

// ---------- ADMIN: end the round ----------
// body: {
//   products: [{ id, expected_compare_at_price, scopes: ['product'|'retail'|'wholesaler'] }],
//   deactivate_promo?: boolean,   // default true — the site-wide badge switch
//   note?: string
// }
// An EMPTY `scopes` is meaningful and supported: it clears «السعر قبل الخصم» without touching
// any price, which is the correct answer when the round was a strike-through and the real
// prices never moved.
async function end(req, res) {
  const selection = req.body && req.body.products;
  const report = await restore.buildReport();

  const planned = restore.planFrom(selection, report);
  if (!planned.ok) {
    const status = planned.code === 'ERR_STALE' ? 409 : planned.code === 'ERR_NOT_FOUND' ? 404 : 400;
    return res.status(status).json({ error: planned.error, code: planned.code });
  }

  const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 300) : null;
  const result = await restore.applyPlan(planned.plan, {
    adminId: req.user && req.user.id,
    note,
  });

  // Default true: leaving the popup shouting «أسعار مخفّضة» after the prices went back up is
  // the one outcome nobody wants. Passing false is allowed for a partial round.
  let promo = null;
  if (req.body.deactivate_promo !== false) {
    const off = await restore.deactivatePromo();
    promo = off.promo;
  } else {
    promo = await restore.readPromo();
  }

  // Both storefront reads bake the discount into their cached payload (isPromoLive is folded
  // in at build time, not read per request), so a price change is invisible for up to 120s
  // unless both caches are dropped — the same pair adminController.updatePromo clears.
  memoCache.del('settings:promo');
  memoCache.del('cat:');

  res.json({
    data: {
      batch_id: result.batch_id,
      products_cleared: planned.plan.length,
      prices_restored: result.written.length,
      written: result.written,
      promo,
    },
  });
}

module.exports = { report, end };
