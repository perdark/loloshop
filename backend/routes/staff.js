const router = require('express').Router();
const { authRequired, requireRole, requireStaffType } = require('../middleware/auth');
const c = require('../controllers/staffController');
const attendance = require('../controllers/attendanceController');
const attendanceBreaks = require('../controllers/attendanceBreakController');
const customOrders = require('../controllers/adminCustomOrderController');
const edit = require('../controllers/orderEditController');
const counterSignup = require('../controllers/counterSignupController');
const { normalizePhoneBody } = require('../lib/otp');
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

// Signup at the counter: a staff member creates a student's account in person, no OTP.
// Guarded with the SAME requireStaffType() as the custom-order endpoints above, because it is
// the same physical workflow — the person serving a customer at the shop. Deliberately not
// looser: the staff session is the entire authorisation for skipping the OTP, so who holds
// that session is the whole security boundary.
//
// normalizePhoneBody is applied here specifically (this router does not mount it globally) so
// a student who says "٧٧١٢..." or "7712..." still lands on the canonical 07… form and cannot
// end up with a duplicate account under a second spelling of the same number.
router.post('/counter-signup', requireStaffType(), normalizePhoneBody, counterSignup.counterSignup);

module.exports = router;
