const router = require('express').Router();
const rateLimit = require('express-rate-limit');
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

// «هل فتح التطبيق اليوم؟» — the presence beacon (migration 084). Rate-limited because it is
// called from the ROOT layout on every mount and every return-to-foreground, and answers 204
// unconditionally so a tripped limit is invisible to the employee using the app.
const appOpenLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  handler: (req, res) => res.status(204).end(),
});
router.post('/app-open', appOpenLimit, c.appOpen);

// ⚠️ THE PHONE CAN READ ATTENDANCE BUT NO LONGER WRITE IT — owner decision 2026-08-30.
// دخول/خروج come from the K40 at the shop and nowhere else, so `check-in`/`check-out` are
// gone from here and from routes/payroll.js. `getToday` stays: the worker still needs to see
// their own day, and `/staff/attendance` still shows it — it just cannot punch any more.
// The escape hatch when the device is down is the admin's
// `PATCH /admin/attendance/records/:id/override`, deliberately NOT a worker-facing one.
// ⚠️ `attendanceController.checkIn`/`checkOut` are intentionally left in place and unrouted:
// the break flow and the tests still call them, and re-exposing them is a route line, not a
// rewrite. Do not delete the controller half thinking it is dead.
router.get('/attendance/today', attendance.getToday);

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
