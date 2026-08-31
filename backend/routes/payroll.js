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
const payouts = require('../controllers/payoutController');

router.use(authRequired, requireRole('admin', 'staff'));

router.get('/me/salary', salary.getMySalary);
router.get('/me/activity', salary.getMyActivity);
router.get('/me/goal', salary.getMyGoal);
// «راتبي ونشاطي» — the whole month in one call. See salaryController.getMySummary.
router.get('/me/summary', salary.getMySummary);
router.get('/me/payout-account', payouts.getMyAccount);
router.put('/me/payout-account', payouts.saveMyAccount);
// ⚠️ Read-only since 2026-08-30 — the K40 is the only thing that writes دخول/خروج now.
// This was the SECOND door onto the same controller (the staff router had the first), so
// removing only one of them would have left the phone punching through here with nothing on
// screen to explain how. See the note in routes/staff.js.
router.get('/me/attendance/today', attendance.getToday);

module.exports = router;
