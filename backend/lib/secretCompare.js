const crypto = require('crypto');

/**
 * Compare URL/API secrets without leaking a useful prefix or length timing signal.
 * Both values are hashed to a fixed-size buffer before timingSafeEqual is called.
 * An absent configured secret always fails closed.
 */
function secretMatches(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || expected.length === 0) {
    return false;
  }
  const digest = (value) => crypto.createHash('sha256').update(value, 'utf8').digest();
  return crypto.timingSafeEqual(digest(provided), digest(expected));
}

module.exports = { secretMatches };
