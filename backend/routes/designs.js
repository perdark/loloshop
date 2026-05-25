const router = require('express').Router();
const { authRequired, requireRole } = require('../middleware/auth');
const { logoUpload, imageUpload } = require('../lib/upload');
const c = require('../controllers/designController');

router.get('/me', authRequired, requireRole('retail'), c.getMyDesign);
router.post('/save', authRequired, requireRole('retail'), c.saveDesign);
router.post('/complete', authRequired, requireRole('retail'), c.completeDesign);

router.post('/uploads/logo', authRequired, requireRole('retail'), logoUpload.single('file'), c.uploadLogo);
router.post('/uploads/image', authRequired, requireRole('retail'), imageUpload.single('file'), c.uploadImage);

router.get('/student/:studentId', authRequired, requireRole('admin', 'staff'), c.getDesignByStudent);

module.exports = router;
