const crypto = require('crypto');
const { rateLimit } = require('express-rate-limit');

// Complement the IP limiter with an account-identifier limiter so rotating proxies cannot
// brute-force one password. Successful logins are removed from this counter, avoiding a
// lockout during normal use. Keys are hashed so phone/user identifiers are not retained in
// the in-process limiter store.
const accountLoginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const body = req.body || {};
    const identifier = body.phone || body.staff_id || body.worker_id || body.user_id || 'missing';
    return crypto
      .createHash('sha256')
      .update(`${req.baseUrl}:${req.path}:${String(identifier).trim().toLowerCase()}`)
      .digest('hex');
  },
});

module.exports = { accountLoginLimit };
