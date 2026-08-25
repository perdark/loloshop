const router = require('express').Router();
const { authRequired } = require('../middleware/auth');
const c = require('../controllers/notificationController');

router.use(authRequired);
router.get('/', c.list);
router.post('/read-all', c.markAllRead);

// Push device registration (migration 077). Deliberately below `authRequired`: a device token
// is bound to the signed-in account, so an unauthenticated register would let anyone attach
// any phone to any user — and unregister anyone else's.
// «شنو تريد يوصلك؟» — the in-app opt-in/opt-out Apple 4.5.4 requires for promotional push.
router.get('/prefs', c.getPrefs);
router.patch('/prefs', c.updatePrefs);

router.post('/devices', c.registerDevice);
router.post('/devices/unregister', c.unregisterDevice);

router.post('/:id/read', c.markRead);

module.exports = router;
