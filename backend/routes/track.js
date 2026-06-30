// Public, unauthenticated storefront visit beacon → feeds the TV board's live
// audience metric. Rate-limited per IP; the controller also dedups per session.
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const c = require('../controllers/trackController');

// generous but abuse-bounded: a normal visitor pings on load + a ~5-min heartbeat
const visitLimit = rateLimit({ windowMs: 60 * 1000, max: 60 });

router.post('/visit', visitLimit, c.visit);

module.exports = router;
