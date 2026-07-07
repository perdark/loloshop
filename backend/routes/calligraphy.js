// backend/routes/calligraphy.js
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const { authRequired, requireStaffType } = require('../middleware/auth');
const c = require('../controllers/calligraphyController');

const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// admin role + manager/designer staff can use the calligraphy tool.
// requireStaffType auto-passes admin role and manager staff_type; designer is added explicitly.
router.use(authRequired, requireStaffType('designer'));

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

// Queue endpoints
router.get('/queue', c.getQueue);
router.post('/queue/generate', genLimit, c.queueGenerate);
router.get('/recent', c.recentPlates);

// Compositor endpoints
router.post('/plates/:id/compose', memUpload.single('image'), c.composePlate);
router.post('/element', genLimit, c.generateElement);

module.exports = router;
