// backend/routes/calligraphy.js
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { authRequired, requireRole } = require('../middleware/auth');
const c = require('../controllers/calligraphyController');

router.use(authRequired, requireRole('admin'));

// generation is the expensive path — cap it
const genLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 120 });

router.get('/wholesalers', c.listWholesalers);
router.get('/wholesalers/:id/names', c.wholesalerNames);
router.post('/jobs', c.createJob);
router.post('/jobs/:jobId/process', genLimit, c.processNext);
router.get('/jobs/:jobId', c.getJob);
router.get('/jobs/:jobId/download', c.downloadZip);
router.post('/plates/:id/reroll', genLimit, c.reroll);
router.post('/plates/:id/link', c.linkToOrder);

module.exports = router;
