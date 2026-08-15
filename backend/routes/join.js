const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const c = require('../controllers/joinController');
const { normalizePhoneBody } = require('../lib/otp');

// Default a leading 0 onto a typed phone (7713644460 → 07713644460) at signup.
router.use(normalizePhoneBody);

// ⚠️ EVERY LIMIT ON THIS ROUTER IS PER EGRESS IP, AND IRAQI CARRIERS CGNAT.
// Zain/Asiacell/Korek put whole regions behind a handful of public addresses, so "one IP" here
// is not one student — it is routinely a whole cohort of 100+ opening the same WhatsApp link
// within minutes of each other. A number that looks generous per-person is a lockout
// per-cohort, and the failure is invisible from our side: the student just sees an error.
// Raised 10 → 100/hour on 2026-08-15 (owner approved) ahead of a large intake. The old value
// was the accepted bound on approval-queue spam, recorded 2026-08-07 — but at 10/hour a single
// cohort of 100+ students sharing one carrier IP cannot sign up, and the eleventh student sees
// an error indistinguishable from a broken link.
//
// What makes raising it safe: **`POST /join/:code` sends no WhatsApp message.** joinController
// validates the phone shape, checks it is not already registered (:119) and inserts (:138) —
// there is no createOtp call on this path. So this limit has NO bearing on the sender device's
// ban risk, which was the only reason to keep it tight.
//
// What abuse still costs the attacker: one UNIQUE, valid-format Iraqi mobile per signup
// (isValidIqMobile + the uniqueness check), and every row still has to be approved by the
// rep one at a time — or simply not approved. The damage is bounded and reversible.
//
// Env-tunable so it drops straight back to 10 with `pm2 restart loloshop-api --update-env`
// if junk signups ever appear — no deploy required.
const joinMaxPerHour = (() => {
  const n = parseInt(process.env.JOIN_MAX_PER_HOUR || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 100;
})();
const joinLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: joinMaxPerHour });

// Referral-code lookups: `GET /join/:code`, one per student who opens a rep's link.
//
// This used to be shared with the directory below, which made a cohort browsing «ادخل مع
// ممثلك» eat the budget that the actual link-tap needed. They are separate limiters now so
// one cannot starve the other.
//
// 200/15min is deliberately far above the old 60. The enumeration defence it was tuned for is
// already spent — `/representatives` publishes every referral code in one unauthenticated
// response (accepted 2026-08-07, see the ⚠️ block on getRepresentatives) — so what remains is
// only a brake on automated scraping, and the real bound on abuse is `joinLimit` plus the
// rep's one-by-one approval. Reads disclose nothing a student cannot already see.
const lookupLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });

// The public rep directory. One request per /join page load, and a student who cannot find
// their قسم on the first try reloads — so budget for several per person, not one.
const directoryLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 300 });

// ⚠️ MUST STAY ABOVE `/:code` — Express 5 matches in registration order, so registering this
// after the param route makes `/:code` swallow it and the directory 404s as «الرابط غير صالح».
// Pinned by backend/test/joinRouteOrder.test.js, which also proves the test would catch a flip.
//
// ⚠️ This endpoint publishes every referral code at once, which makes the enumeration defence
// on `lookupLimit` above largely moot. Accepted 2026-08-07: knowing a code only lets someone
// reach the join form, and a student is worth nothing until the rep approves them one by one.
// What it does cost is that a rep's approval queue can now be spammed without the link having
// leaked — `joinLimit` (10/hour/IP) and the unique-phone check are what bound that.
router.get('/representatives', directoryLimit, c.getRepresentatives);

router.get('/:code', lookupLimit, c.getReferral);
router.post('/:code', joinLimit, c.joinReferral);

module.exports = router;
