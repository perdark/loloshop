const router = require('express').Router();
const { authRequired, requireRole, optionalAuth } = require('../middleware/auth');
const c = require('../controllers/productsController');
const { clearCatalogCache } = require('../controllers/catalogController');

// These legacy admin writes touch the products table too — same cache invalidation
// hook as routes/catalog.js so the storefront cache never serves a stale catalog.
function invalidateOnSuccess(req, res, next) {
  res.on('finish', () => {
    if (res.statusCode < 400) clearCatalogCache();
  });
  next();
}

router.get('/', optionalAuth, c.list);
router.get('/:id', optionalAuth, c.getOne);
router.post('/', authRequired, requireRole('admin'), invalidateOnSuccess, c.createProduct);
router.post('/:id/variants', authRequired, requireRole('admin'), invalidateOnSuccess, c.createVariant);

module.exports = router;
