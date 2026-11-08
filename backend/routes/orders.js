const router = require('express').Router();
const { authRequired, requireRole } = require('../middleware/auth');
const c = require('../controllers/orderController');
const { requireRepDeadlineOpen: deadline } = require('../middleware/repDeadline');

// Retail student: list MY own orders + their status (order tracking)
router.get('/mine', authRequired, requireRole('retail'), c.myOrders);
// Retail student: orders sent back by admin/staff for editing (with spec lines to re-edit)
router.get('/returned', authRequired, requireRole('retail'), c.returnedOrders);

// Staff/admin: list + status transitions
router.get('/', authRequired, requireRole('admin', 'staff'), c.listOrders);
router.patch('/:id/status', authRequired, requireRole('admin', 'staff'), c.updateStatus);

// Retail student: configure an order from selected options
router.post('/configure', authRequired, requireRole('retail'), deadline, c.configureOrder);

// Wholesaler package selection or rep student package bundle
router.post('/configure-package', authRequired, requireRole('wholesaler', 'retail'), deadline, c.configurePackage);

// Retail student: full-set order (طقم كامل روب+قبعة+وشاح) via the structured form wizard
router.post('/configure-full-set', authRequired, requireRole('retail'), deadline, c.configureFullSet);

// Rep-linked student: fill THEIR OWN full-set order via the WhatsApp form (no shop/cart)
router.get('/rep-full-set', authRequired, requireRole('retail'), c.repFullSetContext);
router.post('/rep-full-set', authRequired, requireRole('retail'), deadline, c.configureRepFullSet);

// Retail student: VIP upgrade of an existing bundle (+ context probe for the upsell)
router.get('/vip-upgrade-context', authRequired, requireRole('retail'), c.vipUpgradeContext);
router.post('/upgrade-vip', authRequired, requireRole('retail'), deadline, c.upgradeToVip);

// Owner (student) or staff/admin: price breakdown
router.get('/:id/breakdown', authRequired, c.getOrderBreakdown);

module.exports = router;
