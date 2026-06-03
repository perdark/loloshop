const router = require('express').Router();
const { authRequired, requireRole } = require('../middleware/auth');
const c = require('../controllers/adminController');
const orders = require('../controllers/orderController');
const salary = require('../controllers/salaryController');

router.use(authRequired, requireRole('admin'));

router.get('/analytics', c.analytics);
router.get('/accounting', c.accounting);
router.get('/orders', orders.listOrders);
router.patch('/orders/:id/cost', c.updateOrderCost);
router.get('/wholesalers', c.listWholesalers);
router.post('/wholesalers', c.createWholesaler);
router.patch('/wholesalers/:id/deadline', c.updateDeadline);
router.patch('/wholesalers/:id/commission', c.updateCommission);
router.get('/wholesalers/:id/sash-config', c.getWholesalerSashConfig);
router.put('/wholesalers/:id/sash-config', c.updateWholesalerSashConfig);
router.get('/wholesalers/:id/students', c.wholesalerStudents);
router.delete('/wholesalers/:id', c.deleteWholesaler);
router.post('/students/:id/edit-exception', c.toggleEditException);

// Staff management (admin only)
router.get('/staff', c.listStaff);
router.post('/staff', c.createStaff);
router.patch('/staff/:id/type', c.updateStaffType);
router.patch('/staff/:id/scope', c.updateStaffScope);
router.patch('/staff/:id/password', c.updateStaffPassword);
router.delete('/staff/:id', c.deleteStaff);

// Staff payroll + activity (admin only)
router.get('/staff/:id/salary', salary.getStaffSalary);
router.post('/staff/:id/salary', salary.setStaffSalary);
router.post('/staff/:id/salary/bonus', salary.addBonus);
router.post('/staff/:id/salary/deduction', salary.addDeduction);
router.get('/staff/:id/activity', salary.getStaffActivity);
router.get('/staff/:id/goal', salary.getStaffGoal);
router.post('/staff/:id/goal', salary.setStaffGoal);

module.exports = router;
