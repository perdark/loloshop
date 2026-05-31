const router = require('express').Router();
const { authRequired, requireRole, requireStaffType } = require('../middleware/auth');
const c = require('../controllers/productionController');
const designs = require('../controllers/designController');

// All production endpoints are staff/admin only; per-stage scoping is in the controllers.
router.use(authRequired, requireRole('admin', 'staff'));

router.get('/queue', c.getQueue);
router.get('/monitor', requireStaffType(), c.monitor); // no types → manager staff_type + admin only
router.get('/orders/:id', c.getOrder);
router.post('/orders/:id/advance', c.advance);

// Individual design approval gate — designer (+ manager/admin).
router.post('/designs/:id/approve', requireStaffType('designer'), designs.approveDesign);
router.post('/designs/:id/reject', requireStaffType('designer'), designs.rejectDesign);

module.exports = router;
