// backend/routes/assistant.js — AI assistant surfaces.
//   POST /api/assistant/support   — public storefront chatbot (anon allowed, tighter cap)
//   POST /api/assistant/analytics — admin-only, closed metric set
//
// Two layers of protection, deliberately: express-rate-limit bounds request VOLUME per IP
// (cheap, in-memory, resets on restart), while lib/aiChat.js bounds SPEND per user/session/day
// in the database (survives restarts, shared across workers). The limiter here is the coarse
// outer wall; the caps are the thing that actually protects the bill.

const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { authRequired, requireRole, optionalAuth } = require('../middleware/auth');
const support = require('../controllers/supportChatController');
const analytics = require('../controllers/adminAnalyticsChatController');

// Per-IP burst guard. Iraqi carriers CGNAT, so a whole cohort can share one address — this
// is set high enough that normal shared use never trips it, because the real per-person
// bound is the DB cap in aiChat.js (which is keyed on user/session, not IP).
const supportLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });

// Admins are a handful of known people on the shop's own devices; a low cap is fine.
const analyticsLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 60 });

router.post('/support', supportLimit, optionalAuth, support.ask);
router.post('/analytics', analyticsLimit, authRequired, requireRole('admin'), analytics.ask);

module.exports = router;
