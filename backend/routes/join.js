const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const c = require('../controllers/joinController');
const { normalizePhoneBody } = require('../lib/otp');

// Default a leading 0 onto a typed phone (7713644460 → 07713644460) at signup.
router.use(normalizePhoneBody);

const joinLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 10 });
// Throttle referral-code lookups to blunt enumeration of valid wholesaler codes.
const lookupLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 60 });

router.get('/:code', lookupLimit, c.getReferral);
router.post('/:code', joinLimit, c.joinReferral);

module.exports = router;
