const router = require('express').Router();
const { authRequired, requireRole } = require('../middleware/auth');
const { imageUpload } = require('../lib/upload');
const c = require('../controllers/catalogController');

// Public-ish (auth optional for role pricing)
router.get('/shop', optionalAuth, c.getShop);                      // packages + products grouped by type
router.get('/products/:id/full', optionalAuth, c.getProductFull);  // full config for configurator

// Everything below is admin-only
router.use(authRequired, requireRole('admin'));

router.get('/products', c.listProductsAdmin);
router.post('/products', c.createProduct);
router.patch('/products/:id', c.updateProduct);
router.delete('/products/:id', c.deleteProduct);
router.put('/products/:id/price-role', c.setProductPriceRole);
router.post('/products/:id/groups', c.createGroup);
router.post('/products/:id/images', c.addProductImage);
router.delete('/images/:id', c.deleteProductImage);

router.patch('/groups/:id', c.updateGroup);
router.delete('/groups/:id', c.deleteGroup);
router.post('/groups/:id/options', c.createOption);

router.patch('/options/:id', c.updateOption);
router.delete('/options/:id', c.deleteOption);
router.put('/options/:id/price-role', c.setOptionPriceRole);

router.post('/uploads/image', imageUpload.single('file'), c.uploadImage);

module.exports = router;

// Resolve req.user when a token is present, but don't reject anonymous (retail price fallback)
function optionalAuth(req, res, next) {
  if (req.headers.authorization) return authRequired(req, res, next);
  next();
}
