// Admin TV command board — key-gated, read-only (+ board-config write).
// No JWT: the secret key (?key=) in the URL is the only credential. Wrong key → 404.
const router = require('express').Router();
const c = require('../controllers/tvBoardController');

router.get('/events', c.keyGate, c.events);       // SSE live push (key in ?key=)
router.get('/snapshot', c.keyGate, c.snapshot);   // the whole board, cached ~2s
router.put('/settings', c.keyGate, c.updateSettings); // board config only (goal/threshold/sound)

module.exports = router;
