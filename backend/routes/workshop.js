const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { authRequired, requireRole } = require('../middleware/auth');
const c = require('../controllers/workshopController');

// The workshop portal is a public, key-gated (WORKSHOP_PORTAL_KEY) login — no OTP.
const portalLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

router.get('/portal/members', portalLimit, c.portalMembers);
router.post('/portal-login', loginLimit, c.portalLogin);

// Everything below requires a JWT; attachWorker adds req.worker (the caller's roster row).
router.use(authRequired, c.attachWorker);

// Worker self (Syrian-dialect screens): direct daily quantities, no batches.
router.get('/me/summary', c.requireWorkerSelf, c.mySummary);
router.post('/me/production', c.requireWorkerSelf, c.myProduction);

// Roster — read for lead/admin, writes admin-only
router.get('/workers', c.requireLead, c.listWorkers);
router.get('/link-candidates', requireRole('admin'), c.linkCandidates);
router.post('/workers', requireRole('admin'), c.createWorker);
router.patch('/workers/:id', requireRole('admin'), c.updateWorker);

// Rates — read for lead/admin, write admin-only
router.get('/rates', c.requireLead, c.listRates);
router.put('/rates', requireRole('admin'), c.upsertRate);

// Direct production — lead/admin may record for a worker. Money adjustments are admin-only.
router.post('/production', c.requireLead, c.createProduction);
router.post('/adjustments', requireRole('admin'), c.createAdjustment);
router.get('/workers/:id/ledger', c.requireLead, c.workerLedger);

// Dashboard — lead/admin
router.get('/dashboard', c.requireLead, c.dashboard);

module.exports = router;
