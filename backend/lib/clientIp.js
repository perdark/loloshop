// backend/lib/clientIp.js — a stable, non-identifying fingerprint of where a request came from.
//
// The AI ledger records this so a flood is visible after the fact. It deliberately does NOT
// record the address itself: that table is kept for accounting, a raw IP is personal data, and
// the only question anyone will ever ask it is "were these four thousand rows one client?" —
// which a hash answers exactly as well.
//
// The salt is the app's own secret, so the hash cannot be reversed with a rainbow table of the
// ~4 billion IPv4 addresses (an unsalted SHA-256 of an IP is trivially reversible — that is the
// mistake this exists to avoid). Rotating JWT_SECRET deliberately breaks correlation with older
// rows, which is the right behaviour for a key rotation.

const crypto = require('node:crypto');

/**
 * Express already computes req.ip correctly when `trust proxy` is set, which server.js does for
 * the nginx in front of it. Falling back to the socket address keeps this working in tests and
 * in any deployment without a proxy.
 */
function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || null;
}

/**
 * Salted hash of the caller's address, or null when there is none to hash.
 * Truncated to 32 hex chars: collision risk across a shop's traffic is nil, and a shorter
 * value keeps the ledger small and stays clearly a fingerprint rather than a stored secret.
 */
function ipHash(req) {
  const ip = clientIp(req);
  if (!ip) return null;
  const salt = process.env.JWT_SECRET || '';
  return crypto.createHash('sha256').update(`loloshop:ip:${salt}:${ip}`).digest('hex').slice(0, 32);
}

module.exports = { clientIp, ipHash };
