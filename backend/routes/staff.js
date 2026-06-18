const router = require('express').Router();
const { authRequired, requireRole } = require('../middleware/auth');
const c = require('../controllers/staffController');

router.use(authRequired, requireRole('staff'));

router.get('/wholesalers/:id/students', c.wholesalerStudents);
router.get('/wholesalers/:id/orders', c.wholesalerOrders);

module.exports = router;

