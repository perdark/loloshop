const router = require('express').Router();
const { authRequired, requireRole } = require('../middleware/auth');
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

module.exports = router;
