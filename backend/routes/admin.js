const router = require('express').Router();
const { authRequired, requireRole } = require('../middleware/auth');
const c = require('../controllers/adminController');
const orders = require('../controllers/orderController');
const salary = require('../controllers/salaryController');
const staff = require('../controllers/staffController');
const attendance = require('../controllers/attendanceController');
const customOrders = require('../controllers/adminCustomOrderController');
const payouts = require('../controllers/payoutController');
const { imageUpload, imageUploadLimit, validateUploadedImage } = require('../lib/upload');

router.use(authRequired, requireRole('admin'));

router.get('/analytics', c.analytics);
router.get('/accounting', c.accounting);
router.get('/payouts', payouts.adminDashboard);
router.post('/payouts', payouts.recordManualPayout);
router.put('/payout-accounts/:userId', payouts.adminSaveAccount);
router.get('/orders', orders.listOrders);
router.get('/custom-order/config', customOrders.customOrderConfig);
router.post('/custom-order', customOrders.createCustomOrder);
router.post('/custom-order/uploads/image', imageUploadLimit, imageUpload.single('file'), validateUploadedImage, customOrders.uploadImage);
router.get('/custom-order/students-search', require('../controllers/orderEditController').studentsSearch);
router.patch('/orders/:id/cost', c.updateOrderCost);
router.delete('/orders/:id', c.deleteOrder);
router.patch('/checkout-groups/:id', c.updateCheckoutGroup);
router.get('/reps-overview', c.repsOverview);
router.get('/visitors', c.visitorsStats);
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
router.delete('/staff/:id/salary/transactions/:txnId', salary.removeTransaction);
router.get('/staff/:id/activity', salary.getStaffActivity);
router.get('/staff/:id/goal', salary.getStaffGoal);
router.post('/staff/:id/goal', salary.setStaffGoal);

// Staff attendance / بصمة الموظفين (admin only)
router.get('/attendance/settings', attendance.getSettings);
router.patch('/attendance/settings', attendance.updateSettings);
router.get('/attendance/staff-settings', attendance.listUserSettings);
router.put('/attendance/staff-settings/:userId', attendance.setUserSettings);
router.delete('/attendance/staff-settings/:userId', attendance.deleteUserSettings);
router.get('/attendance/calendar', attendance.calendar);
router.get('/attendance/records', attendance.listRecords);
router.patch('/attendance/records/:id/override', attendance.overrideRecord);

// Site settings — discount popup promo config
router.patch('/promo', c.updatePromo);

// Site settings — maintenance mode flag
router.patch('/maintenance', c.updateMaintenance);

// Money gate — reveal secret for TV/dashboard IQD amounts (hidden by default).
router.get('/money-gate', c.getMoneyGate);
router.post('/money-gate/verify', c.verifyMoneyGate);
router.put('/money-gate', c.setMoneyGateSecret);

// Order-approval override (T5) — admin can approve/reject any bundle regardless of rep ownership.
// POST verb, suffix /approve|/reject — does NOT shadow PATCH /orders/:id/cost (different verb + suffix).
router.post('/orders/:checkoutGroupId/approve', c.approveOrderAdmin);
router.post('/orders/:checkoutGroupId/reject', c.rejectOrderAdmin);

// Dashboard pending-approval count (T7).
router.get('/orders-pending-count', c.pendingApprovalCount);

module.exports = router;
