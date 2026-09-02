// backend/routes/calligraphy.js
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const { authRequired } = require('../middleware/auth');
const { query } = require('../lib/db');
const { imageUploadLimit } = require('../lib/upload');
const { mayUseTool, mayPushOrder } = require('../lib/calligraphyAccess');
const c = require('../controllers/calligraphyController');

const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Who may use the AI calligraphy tool:
//   • `mayUseTool` (lib/calligraphyAccess.js) — admin role, and staff manager/designer/
//     embroiderer. embroiderer was added 2026-09-02 so محمد عماد (المطرّز) can generate,
//     reroll and download his own plates without waiting on a designer — التطريز has a
//     backlog and used to have to queue behind التصميم for this. AND
//   • أيادي التصميم — an ACTIVE design_team member (محمد هيثم + his helpers), checked here
//     rather than in the shared predicate because it needs a DB lookup, not a role/staff_type
//     check. The design-team crew's whole job is running this AI, so it is deliberately opened
//     to role='design_helper'. Membership must be active (a deactivated helper's still-valid
//     JWT is rejected), mirroring designTeamController.attachTeamMember's fail-closed rule.
async function allowCalligraphyUser(req, res, next) {
  try {
    const u = req.user;
    if (!u) return res.status(401).json({ error: 'غير مصرح', code: 'ERR_AUTH' });
    if (mayUseTool(u)) return next();
    if (u.role === 'design_helper') {
      const { rows } = await query(
        `SELECT 1 FROM design_team_members WHERE user_id = $1 AND active = TRUE LIMIT 1`,
        [u.id]
      );
      if (rows.length) return next();
    }
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  } catch (err) {
    return next(err);
  }
}

// «تحويل للتطريز» (advance an order out of بانتظار التصميم) is STRICTER than the tool
// itself, and stays that way on purpose: `mayPushOrder` admits only admin + staff
// manager/designer — NOT embroiderer, and NOT design_helper. محمد عماد can generate and
// download plates for his own station but never pushes an order into التطريز; that keeps
// going through the designer/أيادي التصميم flow via محمد هيثم's approval, same as before.
function requireDesignerOrAdmin(req, res, next) {
  if (mayPushOrder(req.user)) return next();
  return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
}

router.use(authRequired, allowCalligraphyUser);

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

// Compositor endpoints
router.post('/plates/:id/compose', imageUploadLimit, memUpload.single('image'), c.composePlate);
router.post('/element', genLimit, c.generateElement);

module.exports = router;
