// Server-side password policy (LS-10).
//
// Before this, several account-creation paths hashed whatever arrived — retail signup and
// referral join enforced NOTHING server-side, and privileged paths (staff, wholesaler,
// workshop, design-team) accepted six characters. Client-side checks don't protect a direct
// API call, so the rule has to live here and be applied at every hashing site.
//
// ONE minimum for everybody: 8 characters (owner decision, 2026-07-19 — the audit
// suggested 12 for privileged accounts, rejected as too much friction). Both constants
// are kept so call sites stay explicit about who they're validating, and so raising the
// bar for staff later is a one-line change rather than a hunt through six controllers.
//
// This is enforced only when a password is SET (registration, join, admin-created
// accounts, resets). It is never applied at LOGIN — existing accounts with older, shorter
// passwords must keep working, and bcrypt.compare doesn't care how long the original was.

const CUSTOMER_MIN = 8;
const PRIVILEGED_MIN = 8;

// ONLY the credentials this repo has itself shipped as defaults. Owner decision
// (2026-07-19): keep the rule easy — `abcdefgh`, `qwertyui`, `12345678` are all fine for a
// student signing up on a phone. What must never be re-enterable is a password that was
// literally printed in our own source, because anyone who reads the repo knows it.
// Brute-force over the network is handled by rate limiting, not by password shape.
const BANNED = new Set([
  'admin123', 'staff123', 'cust123', 'test1234', 'lolo2026',
]);

function fail(message) {
  const err = new Error(message);
  err.status = 400;
  err.code = 'ERR_WEAK_PASSWORD';
  err.expose = true;
  throw err;
}

/**
 * Throw a 400 (Arabic, `ERR_WEAK_PASSWORD`) unless `password` meets the policy.
 * `tier` is 'customer' or 'privileged'. Call this BEFORE bcrypt.hash, everywhere.
 */
function assertPasswordOk(password, tier = 'customer') {
  const min = tier === 'privileged' ? PRIVILEGED_MIN : CUSTOMER_MIN;
  if (typeof password !== 'string' || !password) {
    fail('كلمة المرور مطلوبة');
  }
  // Length in code points: an Arabic or emoji password shouldn't be measured in UTF-16
  // units, which would let a shorter string pass or a legitimate one fail.
  if ([...password].length < min) {
    fail(`كلمة المرور يجب أن تكون ${min} أحرف على الأقل`);
  }
  // No upper bound below bcrypt's: bcrypt silently truncates past 72 BYTES, so a longer
  // passphrase is not more secure and a user who thinks it is would be misled.
  if (Buffer.byteLength(password, 'utf8') > 72) {
    fail('كلمة المرور طويلة جداً (72 بايت كحد أقصى)');
  }
  if (BANNED.has(password.toLowerCase())) {
    fail('كلمة المرور شائعة جداً، اختر كلمة أقوى');
  }
  // Deliberately NO shape rules beyond this (owner decision, 2026-07-19): no
  // repeated-character or sequence check, so `abcdefgh`, `qwertyui` and `erererer` all
  // pass. Every extra rule is another student who fails signup on a phone keyboard during
  // joining season, and the accounts these protect hold an order, not the business.
  return password;
}

// Which tier an existing account falls under. Used by the reset flows, where the caller
// doesn't say who they are — the account's own role decides.
const PRIVILEGED_ROLES = ['admin', 'staff', 'wholesaler', 'worker', 'design_helper'];
function tierForRole(role) {
  return PRIVILEGED_ROLES.includes(role) ? 'privileged' : 'customer';
}

module.exports = { assertPasswordOk, tierForRole, CUSTOMER_MIN, PRIVILEGED_MIN };
