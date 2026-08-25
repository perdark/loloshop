// backend/lib/notificationPrefs.js — «شنو تريد يوصلك؟» (migration 089).
//
// ⚠️ THIS IS THE FILE THAT KEEPS THE APP INSIDE APPLE'S GUIDELINE 4.5.4. Push may not carry
// advertising, promotions or direct marketing unless the user explicitly opted in through
// consent language in the app AND can opt out from inside the app. Every push before migration
// 088 was transactional, so the rule never bit; the admin composer is the first thing that can
// send an offer.
//
// The rule is enforced in ONE place — `marketingFilterSql()` — which lib/pushBroadcast.js
// applies to every send flagged as marketing. Do not add a second path that sends promotional
// copy without going through it.

/** The only two categories. Flat and closed on purpose — see the migration's header. */
const DEFAULTS = Object.freeze({ orders: true, marketing: false });

/**
 * Read a stored value into a complete, safe preferences object.
 *
 * ⚠️ Anything unrecognised degrades to the DEFAULTS rather than throwing. This is read on a
 * student's phone in the middle of a checkout; a malformed JSONB written by some future bug
 * must not be able to 500 the account page. Note which way the defaults fall: an unreadable
 * value means orders ON (they still hear about their sash) and marketing OFF (we do not assume
 * consent we cannot prove).
 */
function normalize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULTS };
  return {
    orders: typeof raw.orders === 'boolean' ? raw.orders : DEFAULTS.orders,
    marketing: typeof raw.marketing === 'boolean' ? raw.marketing : DEFAULTS.marketing,
  };
}

/**
 * Validate a client-sent patch. Only the two known keys, only booleans — an unknown key is
 * rejected rather than ignored, so a typo'd toggle fails loudly in development instead of
 * silently never saving.
 */
function validatePatch(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'قيمة غير صالحة', code: 'ERR_VALIDATION' };
  }
  const patch = {};
  for (const [key, value] of Object.entries(body)) {
    if (!(key in DEFAULTS)) {
      return { ok: false, error: 'خيار غير معروف', code: 'ERR_VALIDATION' };
    }
    if (typeof value !== 'boolean') {
      return { ok: false, error: 'قيمة غير صالحة', code: 'ERR_VALIDATION' };
    }
    patch[key] = value;
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: 'ما في شي للتغيير', code: 'ERR_VALIDATION' };
  }
  return { ok: true, patch };
}

/**
 * The SQL predicate that limits a MARKETING send to people who asked for it.
 *
 * ⚠️ `->>'marketing' = 'true'` and NOT a truthiness test: the column is JSONB, a missing key
 * yields SQL NULL, and NULL is not true — which is exactly the behaviour we want. Every account
 * that existed before migration 089 takes the column DEFAULT, so nobody is enrolled by history.
 */
function marketingFilterSql(alias = 'u') {
  return `${alias}.notification_prefs->>'marketing' = 'true'`;
}

/** The same, for order/transactional sends. Kept separate so the two can never be confused. */
function ordersFilterSql(alias = 'u') {
  return `COALESCE(${alias}.notification_prefs->>'orders', 'true') = 'true'`;
}

module.exports = {
  DEFAULTS,
  normalize,
  validatePatch,
  marketingFilterSql,
  ordersFilterSql,
};
