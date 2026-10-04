// backend/routes/calligraphy.js
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const { authRequired } = require('../middleware/auth');
const { imageUploadLimit } = require('../lib/upload');
const { mayPushOrder, allowToolUser } = require('../lib/calligraphyAccess');
const c = require('../controllers/calligraphyController');

const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Who may use the AI calligraphy tool — moved to lib/calligraphyAccess.js as `allowToolUser`
// on 2026-10-04 so the Studio tool (routes/studio.js) shares the exact same gate: admin role,
// staff manager/designer/embroiderer (embroiderer added 2026-09-02 so محمد عماد can generate,
// reroll and download his own plates without waiting on a designer), plus أيادي التصميم — an
// ACTIVE design_team member. Behaviour here is unchanged.

// «تحويل للتطريز» (advance an order out of بانتظار التصميم) is STRICTER than the tool
// itself, and stays that way on purpose: `mayPushOrder` admits only admin + staff
// manager/designer — NOT embroiderer, and NOT design_helper. محمد عماد can generate and
// download plates for his own station but never pushes an order into التطريز; that keeps
// going through the designer/أيادي التصميم flow via محمد هيثم's approval, same as before.
function requireDesignerOrAdmin(req, res, next) {
  if (mayPushOrder(req.user)) return next();
  return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
}

router.use(authRequired, allowToolUser);

// generation is the expensive path — cap it
const genLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 120 });

router.get('/wholesalers', c.listWholesalers);
router.get('/wholesalers/:id/names', c.wholesalerNames);
router.post('/jobs', c.createJob);
router.post('/jobs/:jobId/process', genLimit, c.processNext);
router.get('/jobs/:jobId', c.getJob);
router.get('/jobs/:jobId/download', c.downloadZip);
router.post('/plates/:id/reroll', genLimit, c.reroll);
// «ربط بالطلب» removed 2026-07-15 — plates auto-attach on generation; the only manual
// action is the order-level send below.
router.post('/plates/zip', c.platesZip);
router.get('/orders-zones', c.ordersZones);
router.post('/orders/:orderId/send', requireDesignerOrAdmin, c.sendOrder);

// Queue endpoints
// /retail-queue is the «تجزئة» review board — read-only; generation goes through POST /jobs
// with source='retail' once the designer has cleaned the text and picked a variant per zone.
router.get('/retail-queue', c.retailQueue);
router.get('/queue', c.getQueue);
router.post('/queue/generate', genLimit, c.queueGenerate);
router.get('/recent', c.recentPlates);

// The AI reading layer: proposes what to embroider, generates nothing. Rate-limited like the
// paid path even though it costs ~$0.00006 a line — a loop that calls it a million times is
// still a bill, and the daily ledger it writes to is shared with the image spend.
router.post('/suggest', genLimit, c.suggestText);
router.get('/styles', c.listStyles);
// «ولّد الكل» (lib/calligraphyPipeline.js). The plan spends text-model money, so it sits
// behind the same limiter as every other paid call; the run starts paid image generation.
router.post('/smart/plan', genLimit, c.smartPlan);
router.post('/smart/run', genLimit, c.smartRun);
router.get('/ornaments', c.listOrnaments);

// Compositor endpoints
router.post('/plates/:id/compose', imageUploadLimit, memUpload.single('image'), c.composePlate);
router.post('/element', genLimit, c.generateElement);

module.exports = router;
