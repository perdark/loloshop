-- 067: invalidate existing JWTs when a password changes (security finding LS-09)

ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

