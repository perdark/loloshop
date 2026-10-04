// backend/routes/studio.js — «الاستوديو»: ChatGPT-like tool for design staff, on SmartAPI.
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const { authRequired, requireRole } = require('../middleware/auth');
const { allowToolUser } = require('../lib/calligraphyAccess');
const c = require('../controllers/studioController');

// memoryStorage: studioController re-encodes with sharp before anything touches disk, so
// nothing an attacker names or MIME-labels a file reaches the filesystem unvalidated.
const memUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 4 },
});

router.use(authRequired, allowToolUser);

// The only endpoint that spends money or calls out to SmartAPI. Everything else here is a
// plain DB read/write, so it is the one route worth its own limiter.
const messageLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `user:${req.user.id}`,
});

router.get('/conversations', c.listConversations);
router.post('/conversations', c.createConversation);
router.get('/conversations/:id', c.getConversation);
router.patch('/conversations/:id', c.updateConversation);
router.delete('/conversations/:id', c.deleteConversation);
router.post('/conversations/:id/messages', messageLimit, memUpload.array('images', 4), c.sendMessage);

// Admin-only consumption panel — «الاستهلاك» on /admin/studio.
router.get('/usage', requireRole('admin'), c.getUsage);

module.exports = router;
