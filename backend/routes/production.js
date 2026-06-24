const router = require('express').Router();
const { authRequired, authQuery, requireRole, requireStaffType } = require('../middleware/auth');
const c = require('../controllers/productionController');
const designs = require('../controllers/designController');
const { imageUpload } = require('../lib/upload');

// SSE live-events stream — auth via ?token= (EventSource can't set headers).
// Must be declared BEFORE the blanket Bearer guard below.
router.get('/events', authQuery, requireRole('admin', 'staff'), c.streamEvents);

// All other production endpoints are staff/admin only; per-stage scoping is in the controllers.
router.use(authRequired, requireRole('admin', 'staff'));

router.get('/queue', c.getQueue);
router.get('/monitor', requireStaffType(), c.monitor); // no types → manager staff_type + admin only
router.get('/completed', c.completed);
router.get('/orders/:id', c.getOrder);
router.post('/orders/:id/advance', c.advance);
// Per-zone embroidery checklist — embroiderer ticks each zone (all-done auto-advances).
// Permission (embroiderer OR manager/admin) is enforced inside the controller.
router.post('/orders/:id/embroidery-zone', c.markEmbroideryZone);
// Bulk "إكمال" — advance many orders one stage (per-order guards inside the controller).
router.post('/advance-bulk', c.advanceBulk);
router.post('/orders/:id/deliver', c.deliver);
router.post('/orders/:id/revert', c.revert);
router.post('/orders/:id/claim', c.claim);
router.post('/orders/:id/release', c.release);

// «الفصال» (tailor) — parallel, independent track over RETAIL orders. Permission
// (tailor staff_type OR manager/admin) is enforced inside each controller.
router.get('/tailor-queue', c.tailorQueue);
router.get('/tailor-summary', c.tailorSummary);
router.post('/tailor-complete-bulk', c.tailorCompleteBulk);
router.post('/orders/:id/tailor-complete', c.tailorComplete);
router.post('/orders/:id/tailor-reopen', c.tailorReopen);
// Final artwork is produced by the design/embroidery roles — not the read-only tailor/presser.
// (requireStaffType also auto-passes manager + admin.)
router.post('/orders/:id/final-design', requireStaffType('designer', 'digitizer', 'embroiderer'), imageUpload.single('file'), c.uploadFinalDesign);

// Individual design approval gate — designer (+ manager/admin).
router.post('/designs/:id/approve', requireStaffType('designer'), designs.approveDesign);
router.post('/designs/:id/reject', requireStaffType('designer'), designs.rejectDesign);

module.exports = router;
