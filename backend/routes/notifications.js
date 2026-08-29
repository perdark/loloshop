const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { authRequired, optionalAuth } = require('../middleware/auth');
const c = require('../controllers/notificationController');

/**
 * The device endpoints below are reachable WITHOUT a session, so they need their own bound.
 *
 * ⚠️ GENEROUS ON PURPOSE — Iraqi carriers CGNAT, the same trap `joinLimit` documents. A rep
 * drops a WhatsApp link and a hundred students open the app behind one egress address within
 * an hour, each registering once per launch. 200/15min leaves room for that and still stops a
 * script filling `device_tokens` with junk rows. Every row it can create is an unowned handset
 * that no push will ever reach, so the damage ceiling is table size, not delivery.
 */
const deviceLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });

// ── DEVICE ENDPOINTS — deliberately ABOVE `authRequired`, on `optionalAuth` ─────────────────
//
// ⚠️ THIS ORDER IS THE FEATURE, NOT AN OVERSIGHT (migration 095). `router.use(authRequired)`
// below applies to everything declared after it, so moving any of these three under that line
// silently re-breaks anonymous push: a phone that granted notification permission before it
// ever had an account would 401 on register and its token — the thing an iOS install can only
// buy once — would be dropped on the floor. That was the state of the world until 2026-08-29.
//
// `optionalAuth` still loads `req.user` when a Bearer token IS present, so a signed-in
// registration behaves exactly as it always did and binds the handset to that account.
//
// Each of the three is scoped by the device token the caller already holds, which is the only
// identity an anonymous handset has. See the controller for why that trade is safe: the worst
// a leaked token buys is turning someone's offers OFF.
router.post('/devices', deviceLimit, optionalAuth, c.registerDevice);
router.post('/devices/unregister', deviceLimit, optionalAuth, c.unregisterDevice);
// «العروض» for a handset with no account — the in-app opt-out Apple 4.5.4 requires from
// someone who cannot reach /account because they have none.
router.get('/devices/prefs', deviceLimit, optionalAuth, c.getDeviceMarketing);
router.patch('/devices/prefs', deviceLimit, optionalAuth, c.deviceMarketing);

router.use(authRequired);
router.get('/', c.list);
router.post('/read-all', c.markAllRead);

// «شنو تريد يوصلك؟» — the in-app opt-in/opt-out Apple 4.5.4 requires for promotional push.
// Account-level, so a person's consent follows them onto their next phone.
router.get('/prefs', c.getPrefs);
router.patch('/prefs', c.updatePrefs);

router.post('/:id/read', c.markRead);

module.exports = router;
