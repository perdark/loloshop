const router = require('express').Router();
const { authRequired, requireRole } = require('../middleware/auth');
const c = require('../controllers/adminController');
const orders = require('../controllers/orderController');

router.use(authRequired, requireRole('admin'));

router.get('/analytics', c.analytics);
router.get('/accounting', c.accounting);
router.get('/orders', orders.listOrders);
router.patch('/orders/:id/cost', c.updateOrderCost);
router.get('/wholesalers', c.listWholesalers);
router.post('/wholesalers', c.createWholesaler);
router.patch('/wholesalers/:id/deadline', c.updateDeadline);
router.patch('/wholesalers/:id/commission', c.updateCommission);
router.get('/wholesalers/:id/students', c.wholesalerStudents);
router.delete('/wholesalers/:id', c.deleteWholesaler);
router.post('/students/:id/edit-exception', c.toggleEditException);

// Staff management (admin only)
router.get('/staff', c.listStaff);
router.post('/staff', c.createStaff);
router.patch('/staff/:id/password', c.updateStaffPassword);
router.delete('/staff/:id', c.deleteStaff);

module.exports = router;
