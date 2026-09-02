// backend/routes/calligraphy.js
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const { authRequired, staffTypesOf } = require('../middleware/auth');
const { query } = require('../lib/db');
const { imageUploadLimit } = require('../lib/upload');
const c = require('../controllers/calligraphyController');

const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Who may use the AI calligraphy tool:
//   • admin role (full access), and manager/designer staff (the production designers), AND
//   • أيادي التصميم — an ACTIVE design_team member (محمد هيثم + his helpers). The design-team
//     crew's whole job is running this AI, so it is deliberately opened to role='design_helper'.
//     Membership must be active (a deactivated helper's still-valid JWT is rejected), mirroring
//     designTeamController.attachTeamMember's fail-closed rule.
async function allowCalligraphyUser(req, res, next) {
  try {
    const u = req.user;
    if (!u) return res.status(401).json({ error: 'غير مصرح', code: 'ERR_AUTH' });
    if (u.role === 'admin') return next();
    if (u.role === 'staff') {
      const mine = staffTypesOf(u);
      if (mine.includes('manager') || mine.includes('designer')) return next();
    }
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
// itself: admin or staff manager/designer only. design_helper can generate/compose plates
// but never push orders — the أيادي التصميم flow keeps going through محمد هيثم's approval.
function requireDesignerOrAdmin(req, res, next) {
  const u = req.user;
  if (u && u.role === 'admin') return next();
  if (u && u.role === 'staff') {
    const mine = staffTypesOf(u);
    if (mine.includes('manager') || mine.includes('designer')) return next();
  }
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

// ملف التطريز (migration 097) — the mechanical Wilcom step, done on the server.
// ⚠️ Rate-limited on the SAME bucket as generation even though it costs no money: it is
// CPU-bound image work on the box that also serves RevoArt, so an unbounded loop here
// degrades two production sites. It is not a paid path, but it is an expensive one.
router.post('/plates/dst', genLimit, c.generateDstBatch);
router.post('/plates/:id/dst', genLimit, c.generateDst);
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
