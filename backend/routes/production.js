const router = require('express').Router();
const { authRequired, authQuery, requireRole, requireStaffType } = require('../middleware/auth');
const c = require('../controllers/productionController');
const designs = require('../controllers/designController');
const { imageUpload, imageUploadLimit, validateUploadedImage, validateUploadedArtwork } = require('../lib/upload');

// EventSource cannot set headers. Exchange the normal bearer token for a 60-second,
// stream-only ticket, then put only that scoped ticket in the SSE URL.
// Must be declared BEFORE the blanket Bearer guard below.
router.post('/events-ticket', authRequired, requireRole('admin', 'staff'), c.issueEventsTicket);
router.get('/events', authQuery, requireRole('admin', 'staff'), c.streamEvents);

// All other production endpoints are staff/admin only; per-stage scoping is in the controllers.
router.use(authRequired, requireRole('admin', 'staff'));

router.get('/queue', c.getQueue);
router.get('/monitor', requireStaffType(), c.monitor); // no types → manager staff_type + admin only
// «يعمل الآن» alone, for the admin dashboard's 30s poll. SAME guard as /monitor —
// it is a slice of the same data, so it must not be reachable by anyone /monitor isn't.
router.get('/presence', requireStaffType(), c.presence);
router.get('/completed', c.completed);
router.get('/orders/:id', c.getOrder);
router.post('/orders/:id/advance', c.advance);
// Per-zone embroidery checklist — embroiderer ticks each zone (all-done auto-advances).
// Permission (embroiderer OR manager/admin) is enforced inside the controller.
router.post('/orders/:id/embroidery-zone', c.markEmbroideryZone);
// Bulk zone tick — «عرض بالقطع» batch mode: one zone across many pieces (guards inside).
router.post('/embroidery-zone-bulk', c.markEmbroideryZoneBulk);
// Bulk "إكمال" — advance many orders one stage (per-order guards inside the controller).
router.post('/advance-bulk', c.advanceBulk);
router.post('/orders/:id/deliver', c.deliver);
router.post('/orders/:id/revert', c.revert);
// «إرجاع للطالب» — hand an early-stage RETAIL order back to the student (admin + scoped staff).
router.post('/orders/:id/return-to-customer', c.returnToCustomer);
router.post('/orders/:id/claim', c.claim);
router.post('/orders/:id/release', c.release);
// Permanent single-piece deletion is intentionally manager/admin-only.
router.delete('/orders/:id', requireStaffType(), c.deleteOrder);

// Admin/مدير الإنتاج order editing (full طقم re-save + per-piece quick edits) — no
// types listed → manager staff_type + admin only.
const edit = require('../controllers/orderEditController');
router.get('/students-search', requireStaffType(), edit.studentsSearch);
router.get('/students/:studentId/full-set-order', requireStaffType(), edit.getStudentFullSet);
router.get('/orders/:id/edit-context', requireStaffType(), edit.editContext);
router.post('/students/:studentId/full-set-order', requireStaffType(), edit.saveFullSetOrder);
// «طلب مخصص» for a self-registered تجزئة student — the exact complement of the طقم path
// above (retail pricing, always a NEW checkout_group, never touches existing orders).
router.post('/students/:studentId/retail-order', requireStaffType(), edit.createRetailOrder);
// Multi-piece «طلب مخصص» — one bundle, N pieces, retail pricing. Serves BOTH an existing
// تجزئة student (`student_id`) and a brand-new independent one (`student`), which is what
// makes «طلب مستقل بدون ممثل» a real retail order instead of a rep طقم.
router.post('/retail-orders', requireStaffType(), edit.createRetailOrders);
router.put('/orders/:id/retail-configuration', requireStaffType(), edit.saveRetailConfiguration);
router.patch('/orders/:id/details', requireStaffType(), edit.patchOrderDetails);
router.post('/uploads/image', requireStaffType(), imageUploadLimit, imageUpload.single('file'), validateUploadedImage, edit.uploadImage);

// رف التجهيز — retail staging bins between الكوي and التجهيز. requireStaffType auto-passes
// manager + admin, so this is presser + preparer + manager + admin. The presser needs it to
// shelve what he just pressed; the preparer to shelve caps/شال (which skip الكوي) and to pack.
const shelfC = require('../controllers/shelfController');
router.get('/shelf', requireStaffType('presser', 'preparer'), shelfC.getBoard);
router.post('/shelf/place', requireStaffType('presser', 'preparer'), shelfC.place);
router.post('/shelf/collect', requireStaffType('presser', 'preparer'), shelfC.collect);
router.post('/shelf/close-set', requireStaffType('presser', 'preparer'), shelfC.closeSet);
router.delete('/shelf/placement/:orderId', requireStaffType('presser', 'preparer'), shelfC.releasePlacement);
// Shelf layout config (عدد الخانات / الحد الأقصى) — manager + admin only.
router.patch('/shelf/sections/:id', requireStaffType(), shelfC.patchSection);

// «الفصال» (tailor) — parallel, independent track over RETAIL orders. Permission
// (tailor staff_type OR manager/admin) is enforced inside each controller.
router.get('/tailor-queue', c.tailorQueue);
router.get('/tailor-summary', c.tailorSummary);
router.post('/tailor-complete-bulk', c.tailorCompleteBulk);
router.post('/orders/:id/tailor-complete', c.tailorComplete);
router.post('/orders/:id/tailor-reopen', c.tailorReopen);
// Final artwork is produced by the design/embroidery roles — not the read-only tailor/presser.
// (requireStaffType also auto-passes manager + admin.)
router.post('/orders/:id/final-design', requireStaffType('designer', 'digitizer', 'embroiderer'), imageUploadLimit, imageUpload.single('file'), validateUploadedArtwork, c.uploadFinalDesign);

// Individual design approval gate — designer (+ manager/admin).
router.post('/designs/:id/approve', requireStaffType('designer'), designs.approveDesign);
router.post('/designs/:id/reject', requireStaffType('designer'), designs.rejectDesign);

module.exports = router;
