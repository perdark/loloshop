const router = require('express').Router();
const { authRequired, requireRole } = require('../middleware/auth');
const c = require('../controllers/staffController');
const attendance = require('../controllers/attendanceController');

router.use(authRequired, requireRole('staff'));

router.get('/attendance/today', attendance.getToday);
router.post('/attendance/check-in', attendance.checkIn);
router.post('/attendance/check-out', attendance.checkOut);
router.get('/wholesalers', c.listWholesalers);
router.get('/wholesalers/:id/students', c.wholesalerStudents);
router.get('/wholesalers/:id/orders', c.wholesalerOrders);

module.exports = router;
