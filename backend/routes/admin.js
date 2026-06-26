const router = require('express').Router();
const { authRequired, requireRole } = require('../middleware/auth');
const c = require('../controllers/adminController');
const orders = require('../controllers/orderController');
const salary = require('../controllers/salaryController');
const staff = require('../controllers/staffController');

router.use(authRequired, requireRole('admin'));

router.get('/analytics', c.analytics);
router.get('/accounting', c.accounting);
router.get('/orders', orders.listOrders);
router.patch('/orders/:id/cost', c.updateOrderCost);
router.patch('/checkout-groups/:id', c.updateCheckoutGroup);
router.get('/reps-overview', c.repsOverview);
router.get('/wholesalers', c.listWholesalers);
router.post('/wholesalers', c.createWholesaler);
router.patch('/wholesalers/:id', c.updateWholesaler);
router.patch('/wholesalers/:id/deadline', c.updateDeadline);
router.patch('/wholesalers/:id/pricing', c.updatePricing);
router.get('/wholesalers/:id/sash-config', c.getWholesalerSashConfig);
router.put('/wholesalers/:id/sash-config', c.updateWholesalerSashConfig);
router.get('/wholesalers/:id/students', c.wholesalerStudents);
router.get('/wholesalers/:id/orders', staff.wholesalerOrders);
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

// Site settings — discount popup promo config
router.patch('/promo', c.updatePromo);

// Site settings — maintenance mode flag
router.patch('/maintenance', c.updateMaintenance);

// Order-approval override (T5) — admin can approve/reject any bundle regardless of rep ownership.
// POST verb, suffix /approve|/reject — does NOT shadow PATCH /orders/:id/cost (different verb + suffix).
router.post('/orders/:checkoutGroupId/approve', c.approveOrderAdmin);
router.post('/orders/:checkoutGroupId/reject', c.rejectOrderAdmin);

// Dashboard pending-approval count (T7).
router.get('/orders-pending-count', c.pendingApprovalCount);

module.exports = router;
