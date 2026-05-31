const router = require('express').Router();
const { authRequired, requireRole, requireStaffType } = require('../middleware/auth');
const { logoUpload, imageUpload } = require('../lib/upload');
const c = require('../controllers/designController');

router.get('/me', authRequired, requireRole('retail'), c.getMyDesign);
router.post('/save', authRequired, requireRole('retail'), c.saveDesign);
router.post('/complete', authRequired, requireRole('retail'), c.completeDesign);

function uploadMiddleware(uploader) {
  return (req, res, next) => {
    uploader.single('file')(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'حجم الملف أكبر من المسموح', code: 'ERR_VALIDATION' });
      }
      return res.status(400).json({
        error: err.message || 'تعذر رفع الملف',
        code: 'ERR_VALIDATION',
      });
    });
  };
}

router.post('/uploads/logo', authRequired, requireRole('retail'), uploadMiddleware(logoUpload), c.uploadLogo);
router.post('/uploads/image', authRequired, requireRole('retail'), uploadMiddleware(imageUpload), c.uploadImage);

// Full design (canvas) — every staff_type EXCEPT presser (المكوجي never sees the design).
router.get('/student/:studentId', authRequired, requireStaffType('designer', 'embroiderer', 'preparer'), c.getDesignByStudent);

module.exports = router;
