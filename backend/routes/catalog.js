const router = require('express').Router();
const { authRequired, requireRole, optionalAuth } = require('../middleware/auth');
const { imageUpload } = require('../lib/upload');
const c = require('../controllers/catalogController');

// Public-ish (auth optional for role pricing)
router.get('/shop', optionalAuth, c.getShop);                      // packages + products grouped by type
router.get('/products/:id/full', optionalAuth, c.getProductFull);  // full config for configurator
router.get('/packages', optionalAuth, c.listPackages);             // active packages for wholesaler students

// Everything below is admin-only
router.use(authRequired, requireRole('admin'));

router.get('/products', c.listProductsAdmin);
router.post('/products', c.createProduct);
router.patch('/products/:id', c.updateProduct);
router.delete('/products/:id', c.deleteProduct);
router.put('/products/:id/price-role', c.setProductPriceRole);
router.put('/products/:id/presets', c.upsertPresets);
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

// Package CRUD (admin) — GET uses public route above (with ?role= override)
router.post('/packages', c.createPackage);
router.patch('/packages/:id', c.updatePackage);
router.delete('/packages/:id', c.deletePackage);
router.put('/packages/:id/rule', c.setPackageRule);

module.exports = router;
