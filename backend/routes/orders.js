const router = require('express').Router();
const { authRequired, requireRole } = require('../middleware/auth');
const c = require('../controllers/orderController');

// Staff/admin: list + status transitions
router.get('/', authRequired, requireRole('admin', 'staff'), c.listOrders);
router.patch('/:id/status', authRequired, requireRole('admin', 'staff'), c.updateStatus);

// Retail student: configure an order from selected options
router.post('/configure', authRequired, requireRole('retail'), c.configureOrder);

// Owner (student) or staff/admin: price breakdown
router.get('/:id/breakdown', authRequired, c.getOrderBreakdown);

module.exports = router;
