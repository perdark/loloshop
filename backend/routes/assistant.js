// backend/routes/assistant.js — AI assistant surfaces.
//   POST /api/assistant/session   — mint a signed anonymous identity (public, tightly limited)
//   POST /api/assistant/support   — public storefront chatbot (anon allowed)
//   POST /api/assistant/react     — tap-react to one of لولو's own answers (anon allowed)
//   POST /api/assistant/analytics — admin-only, closed metric set
//
// ── THE DEFENCE, IN LAYERS ─────────────────────────────────────────────────────────────────
// There is no per-person daily quota any more (owner decision 2026-08-12). The one that
// existed was keyed on an identity the client chose, so rotating it cost nothing — measured:
// 25 requests with 25 fresh keys, all granted. It therefore bounded honest students and nobody
// else, and on what is now the shop's main marketing surface, «وصلت للحد اليومي» is the worst
// sentence the assistant could say. What bounds abuse instead, outermost first:
//
//   1. THIS FILE — per-IP request volume, and a much tighter limit on minting identities.
//   2. lib/anonSession.js — the identity is HMAC-signed by us, so it cannot be forged or worn.
//      With minting limited, "be a new person" finally costs something.
//   3. lib/aiChat.js — a burst throttle keyed on that identity ("are you a person"), replacing
//      the quota ("how much have you had today"). Cache hits never reach it, so repetition is
//      free rather than throttled.
//   4. lib/aiChat.js — the daily USD ceiling, which does not care who you are, plus a warning
//      to the owner at a third of it.
//   5. lib/answerGuard.js — nothing wrong leaves, whatever the model was talked into.
//
// ⚠️ NONE OF THIS IS DDoS PROTECTION. express-rate-limit runs after the traffic has already
// reached the VPS and consumed its bandwidth and event loop. Volumetric defence belongs in
// front of nginx (Cloudflare) — tracked as an owner action in HANDOFF.md, not solvable here.

const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { authRequired, requireRole, optionalAuth } = require('../middleware/auth');
const anonSession = require('../lib/anonSession');
const support = require('../controllers/supportChatController');
const analytics = require('../controllers/adminAnalyticsChatController');

// A tripped limiter must still speak the API's language. express-rate-limit's default is the
// plain-text «Too many requests», which reaches an Iraqi student as raw English through a
// generic fallback message — and the request that trips it is most likely an innocent one
// sharing a carrier NAT with a hundred classmates.
const limitHandler = (req, res) =>
  res.status(429).json({
    error: 'ضغط على المساعد هسه، جرّب بعد شوية',
    code: 'ERR_AI_RATE_LIMITED',
  });

// Per-IP burst guard on asking. Iraqi carriers CGNAT, so a whole cohort can share one address —
// this is set high enough that normal shared use never trips it, because the per-person bound
// is the throttle in aiChat.js (keyed on the signed identity, not on IP).
const supportLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, handler: limitHandler });

// Reacting costs no model call and no ledger write of its own, but shares supportLimit's shape:
// same CGNAT reasoning, and there is no per-person cost cap to lean on here the way /support
// leans on aiChat.js's throttle, so the per-IP limit is the whole defence.
const reactLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, handler: limitHandler });

// Minting bounds identity HARVESTING, and nothing else — which is why it is generous.
//
// The instinct is to make this tight, and that instinct is wrong here twice over. First, it
// buys almost nothing: supportLimit already caps one address at 100 requests per 15 minutes no
// matter how many identities it holds, so rotating them cannot raise anyone's throughput.
// Second, it is the one limit CGNAT makes dangerous — a rep drops a WhatsApp link and a hundred
// students open the site within the hour on one carrier NAT, each browser minting exactly once.
// A tight cap would lock most of that cohort out of the shop's main marketing surface, which is
// the same trap documented for joinLimit in HANDOFF.md. Measured 2026-08-12: 30/hour was tight
// enough that the project's own 44-scenario harness tripped it.
//
// So: high enough that no real cohort can reach it, low enough that farming tokens for later
// use elsewhere is not free. A minted identity lasts 30 days, so a real person mints once.
const sessionLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.AI_CHAT_SESSION_MINTS_PER_HOUR || 300),
  handler: limitHandler,
});

// Admins are a handful of known people on the shop's own devices; a low cap is fine.
const analyticsLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, handler: limitHandler });

// Deliberately unauthenticated and deliberately boring: it returns a random signed string and
// reads nothing. Minting one is not permission to do anything — it only names a caller so the
// throttle and the conversation history have something trustworthy to key on.
router.post('/session', sessionLimit, (req, res) => {
  try {
    return res.json({ sessionToken: anonSession.mint(), expiresInMs: anonSession.MAX_AGE_MS });
  } catch (err) {
    // Only reachable with JWT_SECRET unset, which is a misconfigured server, not a bad request.
    console.error('anon session mint failed:', err.message);
    return res.status(503).json({ error: 'المساعد مو متوفر حالياً', code: 'ERR_AI_SESSION' });
  }
});

router.post('/support', supportLimit, optionalAuth, support.ask);
// optionalAuth so an authenticated caller's user_id is available for ownership — but signing in
// is not required, since an anonymous visitor's own signed session_key is just as valid an
// identity for reacting to their own answer. See supportChatController.react.
router.post('/react', reactLimit, optionalAuth, support.react);
router.post('/analytics', analyticsLimit, authRequired, requireRole('admin'), analytics.ask);

module.exports = router;
