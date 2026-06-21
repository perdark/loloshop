-- 042: Allow staff with no phone number.
-- Some staff have no phone and log in via the private staff portal (name + password,
-- no WhatsApp OTP). Phone was NOT NULL, blocking their creation. Drop NOT NULL.
-- The existing users_phone_key UNIQUE constraint already permits multiple NULLs
-- (Postgres treats NULLs as distinct), so real phone numbers stay unique.
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;
