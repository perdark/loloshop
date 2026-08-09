const router = require('express').Router();
const { authRequired, requireRole, requireStaffType } = require('../middleware/auth');
const c = require('../controllers/staffController');
const attendance = require('../controllers/attendanceController');
const attendanceBreaks = require('../controllers/attendanceBreakController');
const customOrders = require('../controllers/adminCustomOrderController');
const edit = require('../controllers/orderEditController');
const { imageUpload, imageUploadLimit, validateUploadedImage } = require('../lib/upload');

router.use(authRequired, requireRole('staff'));

router.get('/attendance/today', attendance.getToday);
router.post('/attendance/check-in', attendance.checkIn);
router.post('/attendance/check-out', attendance.checkOut);

// الخروج المؤقت — request → leave → return. The worker owns these rows; the
// controller scopes every query by req.user.id.
router.get('/attendance/breaks/mine', attendanceBreaks.myBreaks);
router.post('/attendance/breaks', attendanceBreaks.requestBreak);
router.post('/attendance/breaks/:id/leave', attendanceBreaks.leaveBreak);
router.post('/attendance/breaks/:id/return', attendanceBreaks.returnBreak);
router.delete('/attendance/breaks/:id', attendanceBreaks.cancelBreak);
router.get('/wholesalers', c.listWholesalers);
router.get('/wholesalers/:id/students', c.wholesalerStudents);
router.get('/wholesalers/:id/orders', c.wholesalerOrders);

// «طلب مخصص» for مدير الإنتاج — mirrors the /api/admin/custom-order endpoints.
// requireStaffType() with no types → only the manager staff_type passes here
// (admin role uses the /api/admin mounts; requireRole('staff') above blocks admin).
router.get('/custom-order/config', requireStaffType(), customOrders.customOrderConfig);
router.post('/custom-order', requireStaffType(), customOrders.createCustomOrder);
router.post('/custom-order/uploads/image', requireStaffType(), imageUploadLimit, imageUpload.single('file'), validateUploadedImage, customOrders.uploadImage);
router.get('/custom-order/students-search', requireStaffType(), edit.studentsSearch);

module.exports = router;
