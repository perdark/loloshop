const router = require('express').Router();
const { authRequired } = require('../middleware/auth');
const c = require('../controllers/notificationController');

router.use(authRequired);
router.get('/', c.list);
router.post('/read-all', c.markAllRead);
router.post('/:id/read', c.markRead);

module.exports = router;
