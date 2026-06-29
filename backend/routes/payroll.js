/**
 * Payroll self-service routes — staff (or admin) reads their own salary + activity.
 * Mounted at /api/payroll in server.js.
 *
 * Final paths:
 *   GET /api/payroll/me/salary
 *   GET /api/payroll/me/activity
 *
 * Attendance now lives under /api/staff/attendance/*.
 * The /payroll/me/attendance/* aliases remain for older frontend builds only.
 */

const router = require('express').Router();
const { authRequired, requireRole } = require('../middleware/auth');
const salary = require('../controllers/salaryController');
const attendance = require('../controllers/attendanceController');

router.use(authRequired, requireRole('admin', 'staff'));

router.get('/me/salary', salary.getMySalary);
router.get('/me/activity', salary.getMyActivity);
router.get('/me/goal', salary.getMyGoal);
router.get('/me/attendance/today', attendance.getToday);
router.post('/me/attendance/check-in', attendance.checkIn);
router.post('/me/attendance/check-out', attendance.checkOut);

module.exports = router;
