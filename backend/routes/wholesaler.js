const router = require('express').Router();
const { authRequired, requireRole } = require('../middleware/auth');
const { imageUpload } = require('../lib/upload');
const c = require('../controllers/wholesalerController');

router.use(authRequired, requireRole('wholesaler'));

router.get('/dashboard', c.dashboard);
router.get('/pending-students', c.pendingStudents);
router.get('/students', c.listStudents);
router.post('/approve/:studentId', c.approve);
router.post('/reject/:studentId', c.reject);
router.post('/students/bulk', c.bulkSetStatus);
router.get('/sash-config', c.getSashConfig);
router.put('/sash-config', c.updateSashConfig);

// Rep-entered full-set order (WhatsApp intake form → الطقم الكامل)
router.get('/full-set-packages', c.fullSetPackages);
router.get('/students/:studentId', c.getStudent);
router.post('/students/:studentId/full-set-order', c.createFullSetOrder);
router.post('/uploads/image', imageUpload.single('file'), c.uploadImage);

module.exports = router;
