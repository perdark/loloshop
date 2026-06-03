/**
 * Payroll self-service routes — staff (or admin) reads their own salary + activity.
 * Mounted at /api/payroll in server.js.
 *
 * Final paths:
 *   GET /api/payroll/me/salary
 *   GET /api/payroll/me/activity
 */

const router = require('express').Router();
const { authRequired, requireRole } = require('../middleware/auth');
const salary = require('../controllers/salaryController');

router.use(authRequired, requireRole('admin', 'staff'));

router.get('/me/salary', salary.getMySalary);
router.get('/me/activity', salary.getMyActivity);
router.get('/me/goal', salary.getMyGoal);

module.exports = router;
