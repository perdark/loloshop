const router = require('express').Router();
const { authRequired, requireRole } = require('../middleware/auth');
const c = require('../controllers/cartController');

// Retail shopping cart (students). Wholesaler-students are funnelled to the package form
// in the UI, but the endpoints stay role-scoped to retail.
router.use(authRequired, requireRole('retail'));

router.get('/', c.getCart);
router.post('/items', c.addItem);
router.patch('/items/:id', c.updateItem);
router.delete('/items/:id', c.removeItem);
router.post('/checkout', c.checkout);

module.exports = router;
