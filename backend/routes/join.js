const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const c = require('../controllers/joinController');
const { normalizePhoneBody } = require('../lib/otp');

// Default a leading 0 onto a typed phone (7713644460 → 07713644460) at signup.
router.use(normalizePhoneBody);

const joinLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 10 });
// Throttle referral-code lookups to blunt enumeration of valid wholesaler codes.
const lookupLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 60 });

// ⚠️ MUST STAY ABOVE `/:code` — Express 5 matches in registration order, so registering this
// after the param route makes `/:code` swallow it and the directory 404s as «الرابط غير صالح».
//
// ⚠️ This endpoint publishes every referral code at once, which makes the enumeration defence on
// `lookupLimit` below largely moot. Accepted 2026-08-07: knowing a code only lets someone reach
// the join form, and a student is worth nothing until the rep approves them one by one. What it
// does cost is that a rep's approval queue can now be spammed without the link having leaked —
// `joinLimit` (10/hour/IP) and the unique-phone check are what bound that.
router.get('/representatives', lookupLimit, c.getRepresentatives);

router.get('/:code', lookupLimit, c.getReferral);
router.post('/:code', joinLimit, c.joinReferral);

module.exports = router;
