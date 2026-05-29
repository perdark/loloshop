const router = require('express').Router();
const { authRequired, requireRole, optionalAuth } = require('../middleware/auth');
const c = require('../controllers/productsController');

router.get('/', optionalAuth, c.list);
router.get('/:id', optionalAuth, c.getOne);
router.post('/', authRequired, requireRole('admin'), c.createProduct);
router.post('/:id/variants', authRequired, requireRole('admin'), c.createVariant);

module.exports = router;
