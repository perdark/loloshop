const router = require('express').Router();
const { authRequired, requireRole } = require('../middleware/auth');
const c = require('../controllers/batchController');

// admin + wholesaler can read (wholesaler scoped to own)
router.get('/', authRequired, requireRole('admin', 'wholesaler'), c.listBatches);
router.get('/:id', authRequired, requireRole('admin', 'wholesaler'), c.getBatch);

// admin only: write
router.post('/', authRequired, requireRole('admin'), c.createBatch);
router.patch('/:id', authRequired, requireRole('admin'), c.updateBatch);

module.exports = router;
