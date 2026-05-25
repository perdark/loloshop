const router = require('express').Router();
const { authRequired, requireRole } = require('../middleware/auth');
const c = require('../controllers/wholesalerController');

router.use(authRequired, requireRole('wholesaler'));

router.get('/dashboard', c.dashboard);
router.get('/pending-students', c.pendingStudents);
router.get('/students', c.listStudents);
router.post('/approve/:studentId', c.approve);
router.post('/reject/:studentId', c.reject);

module.exports = router;
