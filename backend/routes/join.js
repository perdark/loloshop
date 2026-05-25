const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const c = require('../controllers/joinController');

const joinLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 10 });

router.get('/:code', c.getReferral);
router.post('/:code', joinLimit, c.joinReferral);

module.exports = router;
