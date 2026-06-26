-- Migration 048: trusted devices (skip the login OTP on a known device)
--
-- After a user completes a login/signup OTP we mint a random device token, store its
-- sha-256 hash here, and hand the raw token to the client (localStorage). On the next
-- login the client sends the token back; if a non-expired row matches THIS user, the
-- login skips the WhatsApp OTP entirely (the password is still required). This cuts
-- WhatsApp OTP volume to ~zero for returning users, which is what was getting the
-- unofficial-gateway sender number banned.
--
-- The token only skips the OTP, never the password. A password reset deletes all of a
-- user's rows (a leaked token can't outlive a password change). 90-day expiry.
--
-- Idempotent: table + indexes are IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS trusted_devices (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL,                 -- sha-256 hex of the raw device token
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL
);

-- Lookups are always (user_id, token_hash); a plain token_hash index covers the join too.
CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_trusted_devices_token ON trusted_devices(token_hash);
