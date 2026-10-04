// backend/lib/studioCaps.js — الاستوديو's daily spend ceiling, per user AND shop-wide.
//
// Same shape as lib/calligraphySpend.js and lib/aiChat.js's cap: a ledger row per paid call
// (studio_messages.cost_usd), a 24h rolling sum checked BEFORE the next call, and a 429 with
// an Arabic message when a ceiling is hit. Two ceilings because the two failure modes are
// different: STUDIO_USER_DAILY_USD stops one chatty person from burning the whole shop's
// budget alone; STUDIO_DAILY_USD is the hard backstop even if every user stays under their
// own line (3-4 people each a little under the per-user cap can still add up).
//
// Env (read per call so a pm2 --update-env restart is enough):
//   STUDIO_USER_DAILY_USD — per-person ceiling, default $2/day.
//   STUDIO_DAILY_USD      — shop-wide ceiling, default $10/day.
const { query } = require('./db');

const DEFAULT_USER_MAX_USD = 2;
const DEFAULT_SHOP_MAX_USD = 10;

function caps() {
  const user = Number(process.env.STUDIO_USER_DAILY_USD);
  const shop = Number(process.env.STUDIO_DAILY_USD);
  return {
    userMaxUsd: Number.isFinite(user) && user > 0 ? user : DEFAULT_USER_MAX_USD,
    shopMaxUsd: Number.isFinite(shop) && shop > 0 ? shop : DEFAULT_SHOP_MAX_USD,
  };
}

async function spentLast24h(userId) {
  const { rows } = await query(
    `SELECT
       COALESCE(SUM(m.cost_usd), 0)                                   AS shop_spent,
       COALESCE(SUM(m.cost_usd) FILTER (WHERE c.user_id = $1), 0)      AS user_spent
     FROM studio_messages m
     JOIN studio_conversations c ON c.id = m.conversation_id
     WHERE m.created_at > NOW() - INTERVAL '24 hours'`,
    [userId]
  );
  const r = rows[0] || {};
  return { shopSpent: Number(r.shop_spent || 0), userSpent: Number(r.user_spent || 0) };
}

/**
 * Pure cap decision over already-measured spend. Split out from the SQL so the boundaries
 * are testable without a database. Returns a tagged-shape error object, or null when allowed.
 * The shop ceiling is checked first — it is the backstop that must win regardless of who is
 * asking, same ordering as lib/aiChat.js's evaluateCaps.
 */
function evaluateCaps({ userSpent, shopSpent }, { userMaxUsd, shopMaxUsd } = caps()) {
  if (Number(shopSpent || 0) >= shopMaxUsd) {
    return {
      status: 429,
      code: 'ERR_STUDIO_CAP',
      message: `الاستوديو وصل سقف الإنفاق اليومي للمحل كامل (${shopMaxUsd}$) — جرّب بعد شوية`,
    };
  }
  if (Number(userSpent || 0) >= userMaxUsd) {
    return {
      status: 429,
      code: 'ERR_STUDIO_CAP',
      message: `وصلت سقف استخدامك اليومي من الاستوديو (${userMaxUsd}$) — جرّب باچر أو اطلب رفع الحد من الإدارة`,
    };
  }
  return null;
}

/** May the next call be made? Returns { allowed, error, userSpent, shopSpent, userMaxUsd, shopMaxUsd }. */
async function checkBudget(userId) {
  const { userMaxUsd, shopMaxUsd } = caps();
  const { userSpent, shopSpent } = await spentLast24h(userId);
  const error = evaluateCaps({ userSpent, shopSpent }, { userMaxUsd, shopMaxUsd });
  return { allowed: !error, error, userSpent, shopSpent, userMaxUsd, shopMaxUsd };
}

module.exports = {
  checkBudget,
  evaluateCaps,
  spentLast24h,
  caps,
  _internals: { DEFAULT_USER_MAX_USD, DEFAULT_SHOP_MAX_USD },
};
