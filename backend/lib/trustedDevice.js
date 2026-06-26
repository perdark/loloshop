const crypto = require('crypto');
const { query } = require('./db');

// How long a device stays trusted (skips the login OTP). 90 days by default.
const DEVICE_TTL_DAYS = parseInt(process.env.TRUSTED_DEVICE_DAYS || '90', 10);

// We only ever store the sha-256 of the token, never the raw value — a DB leak can't
// be replayed as a login bypass (and the password is still required regardless).
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// Mint a new trusted-device token after a successful login/signup OTP. Stores the hash,
// returns the RAW token (handed to the client once, kept in localStorage). On the next
// login the client sends it back to skip the WhatsApp OTP. This only skips the OTP — the
// password is still verified every login — so cutting OTP volume protects the WhatsApp
// sender number from spam bans without weakening login to a single bearer secret.
async function issueDeviceToken(userId, userAgent) {
  const token = crypto.randomBytes(32).toString('hex');
  await query(
    `INSERT INTO trusted_devices (user_id, token_hash, user_agent, expires_at)
     VALUES ($1, $2, $3, NOW() + make_interval(days => $4))`,
    [userId, hashToken(token), userAgent ? String(userAgent).slice(0, 300) : null, DEVICE_TTL_DAYS]
  );
  return token;
}

// True iff `token` matches a non-expired trusted device for THIS user. Bumps last_used_at
// in the same statement (single round-trip). Bound to user_id so a token can't be reused
// against another account.
async function isTrustedDevice(userId, token) {
  if (!token || typeof token !== 'string') return false;
  const { rows } = await query(
    `UPDATE trusted_devices SET last_used_at = NOW()
     WHERE user_id = $1 AND token_hash = $2 AND expires_at > NOW()
     RETURNING id`,
    [userId, hashToken(token)]
  );
  return rows.length > 0;
}

// Revoke ALL of a user's trusted devices — called on password reset so a leaked/stolen
// device token can never outlive a password change.
async function revokeUserDevices(userId) {
  await query(`DELETE FROM trusted_devices WHERE user_id = $1`, [userId]);
}

module.exports = { issueDeviceToken, isTrustedDevice, revokeUserDevices };
