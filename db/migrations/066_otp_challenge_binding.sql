-- 066: bind every OTP to a server-issued challenge (security finding LS-01)
--
-- Before this, an OTP was addressed by { phone, purpose } -- both caller-controlled.
-- Anyone could start a login OTP for a victim and exchange it for a JWT without first
-- proving the password. Challenges now pin the purpose and user chosen by the server.

ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS challenge_id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_otp_challenge ON otp_codes(challenge_id);

-- Resends update one challenge in place. `sends` records actual messages so the hourly
-- budget cannot be bypassed merely because a resend does not insert a new row.
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS sends INTEGER NOT NULL DEFAULT 1;
