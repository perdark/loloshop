// backend/routes/calligraphy.js
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const { authRequired, staffTypesOf } = require('../middleware/auth');
const { query } = require('../lib/db');
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
router.post('/plates/:id/link', c.linkToOrder);

// Queue endpoints
router.get('/queue', c.getQueue);
router.post('/queue/generate', genLimit, c.queueGenerate);
router.get('/recent', c.recentPlates);

// Compositor endpoints
router.post('/plates/:id/compose', memUpload.single('image'), c.composePlate);
router.post('/element', genLimit, c.generateElement);

module.exports = router;
