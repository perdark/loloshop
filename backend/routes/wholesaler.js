const router = require('express').Router();
const { authRequired, requireRole } = require('../middleware/auth');
const { imageUpload } = require('../lib/upload');
const c = require('../controllers/wholesalerController');

router.use(authRequired, requireRole('wholesaler'));

router.get('/dashboard', c.dashboard);
router.get('/pending-students', c.pendingStudents);
router.get('/students', c.listStudents);
router.post('/approve/:studentId', c.approve);
router.post('/reject/:studentId', c.reject);
router.post('/students/bulk', c.bulkSetStatus);
router.get('/sash-config', c.getSashConfig);
router.put('/sash-config', c.updateSashConfig);

// Rep self-edits their own «لون التطريز» (embroidery/thread color for their students' full-set orders).
router.patch('/embroidery-color', c.updateEmbroideryColor);

// Order approval — bulk MUST come before /:checkoutGroupId/... so 'bulk' isn't captured as a param
router.get('/orders', c.listOrdersForApproval);
router.post('/orders/bulk', c.bulkOrders);
router.post('/orders/:checkoutGroupId/approve', c.approveOrder);
router.post('/orders/:checkoutGroupId/reject', c.rejectOrder);

// Rep-entered full-set order (WhatsApp intake form → الطقم الكامل)
router.get('/full-set-packages', c.fullSetPackages);
// Quick custom order — name-only student; order pending until rep confirms.
// Declared BEFORE the '/students/:studentId/...' param routes (distinct static path → no collision).
router.post('/quick-full-set-order', c.quickFullSetOrder);
router.get('/students/:studentId', c.getStudent);
router.get('/students/:studentId/full-set-order', c.getStudentOrder);
router.post('/students/:studentId/full-set-order', c.createFullSetOrder);
router.post('/uploads/image', imageUpload.single('file'), c.uploadImage);

module.exports = router;
