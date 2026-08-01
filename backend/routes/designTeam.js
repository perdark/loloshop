const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { authRequired, requireRole } = require('../middleware/auth');
const { imageUpload, imageUploadLimit, validateUploadedArtwork } = require('../lib/upload');
const { accountLoginLimit } = require('../lib/accountLoginLimit');
const c = require('../controllers/designTeamController');

// The private URL is only a discovery gate; name + password remain required.
const portalLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

// Public, key-gated portal endpoints. They must precede the JWT middleware.
router.get('/portal/members', portalLimit, c.portalMembers);
router.post('/portal/login', loginLimit, accountLoginLimit, c.portalLogin);

// All workspace endpoints use a JWT. attachTeamMember only loads roster state;
// each route below selects the required capability explicitly.
router.use(authRequired, c.attachTeamMember);

router.get('/session', c.requireTeamAccess, c.session);

// Admin creates/replaces the dedicated lead account. The lead/admin then manage
// the two helper accounts; lead authority never extends outside this module.
router.post('/lead', requireRole('admin'), c.createOrSetLead);
router.get('/members', c.requireTeamLead, c.listMembers);
router.post('/members', c.requireTeamLead, c.createHelper);
router.patch('/members/:userId', c.requireTeamLead, c.updateMember);
router.delete('/members/:userId', c.requireTeamLead, c.deactivateMember);

// Retail first-stage design work only. Jobs are keyed on the order id.
router.get('/jobs', c.requireTeamAccess, c.listJobs);
router.get('/jobs/:orderId', c.requireTeamAccess, c.getJob);
router.post('/jobs/:orderId/claim', c.requireTeamWorker, c.claimJob);
router.post('/jobs/:orderId/ready', c.requireTeamWorker, c.markReady);
router.post('/jobs/:orderId/final-design', c.requireTeamWorker, imageUploadLimit, imageUpload.single('file'), validateUploadedArtwork, c.uploadFinalDesign);
router.post('/jobs/:orderId/approve', c.requireTeamLead, c.approveJob);
router.post('/jobs/:orderId/reject', c.requireTeamLead, c.rejectJob);

module.exports = router;
