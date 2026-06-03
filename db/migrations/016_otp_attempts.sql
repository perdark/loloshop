-- OTP brute-force protection: count wrong guesses per code so verifyOtp can burn a
-- code after MAX_OTP_ATTEMPTS misses (a 6-digit code must not be grindable).
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
