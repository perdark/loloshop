-- 066: bind every OTP to a server-issued challenge (security finding LS-01)
--
-- Before this, an OTP was addressed by { phone, purpose } — both caller-controlled.
-- Anyone could POST /auth/resend-otp {phone, purpose:'login'} for a victim's number and
-- then POST /auth/login-verify {phone, code} to mint a JWT with NO password check and no
-- role restriction, collapsing password+OTP to OTP-only for every role including admin.
--
-- The OTP row now IS the challenge: `challenge_id` is a secret handed out only by a
-- server flow that already proved something (a correct password for login, a just-created
-- account for verify), and `user_id` pins which account the code may authenticate. Verify
-- looks the row up BY CHALLENGE, never by phone, so the caller can no longer choose the
-- target account or the purpose.
--
-- Additive + backward compatible on purpose: challenge_id has a default and user_id is
-- nullable, so the currently-deployed backend keeps inserting valid rows until this
-- branch ships (dev and prod share one Neon database).

ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS challenge_id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- Unique: the challenge id is a bearer secret, so two rows must never share one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_otp_challenge ON otp_codes(challenge_id);

-- Resending re-uses the SAME challenge row rather than issuing a new id. Rotating the id
-- meant that if the resend response was lost in transit (routine on the slow Android/
-- network mix this app targets) the client kept a superseded id while the code the user
-- actually received belonged to the new one — an unrecoverable dead end. Re-using the row
-- creates no new row, so this counter is what keeps the per-phone hourly send budget
-- honest and stops a challenge from pumping unlimited WhatsApp messages.
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS sends INTEGER NOT NULL DEFAULT 1;
