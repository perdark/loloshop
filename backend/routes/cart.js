const router = require('express').Router();
const { authRequired, requireRole } = require('../middleware/auth');
const c = require('../controllers/cartController');
const { requireRepDeadlineOpen: deadline } = require('../middleware/repDeadline');

// Retail shopping cart (students). Wholesaler-students are funnelled to the package form
// in the UI, but the endpoints stay role-scoped to retail.
router.use(authRequired, requireRole('retail'));

router.get('/', c.getCart);
router.post('/items', deadline, c.addItem);
router.patch('/items/:id', deadline, c.updateItem);
router.delete('/items/:id', c.removeItem);
router.post('/checkout', deadline, c.checkout);

module.exports = router;
