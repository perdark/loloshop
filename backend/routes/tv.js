// Admin TV command board — key-gated, read-only (+ board-config write).
// No JWT: the secret key (?key=) in the URL is the only credential. Wrong key → 404.
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const c = require('../controllers/tvBoardController');

// Lenient throttle on the snapshot route so brute-forcing the money reveal is capped,
// while a legitimate board (3s poll ≈ 20 req/min) is never blocked. NOT applied to the
// long-lived SSE `events` stream.
const snapLimit = rateLimit({ windowMs: 5 * 60 * 1000, max: 400, standardHeaders: true, legacyHeaders: false });
const keyProbeLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });

router.get('/events', keyProbeLimit, c.keyGate, c.events);       // SSE live push (key in ?key=)
router.get('/snapshot', snapLimit, c.keyGate, c.snapshot);   // the whole board, cached ~2s
router.put('/settings', keyProbeLimit, c.keyGate, c.updateSettings); // board config only (goal/threshold/sound)

module.exports = router;
