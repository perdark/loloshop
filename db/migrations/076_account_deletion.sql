-- 076: in-app account deletion (Apple guideline 5.1.1(v)).
--
-- Apple rejected the first iOS submission on 2026-07-29 because the app supports
-- account creation but offered no way to DELETE an account from inside the app —
-- /delete-account only told the student to message @lolo_shop96, and pointing a
-- user at customer service is explicitly not acceptable outside highly-regulated
-- industries.
--
-- WHY THIS IS AN ANONYMISE, NOT A `DELETE FROM users`:
--   orders.student_id is ON DELETE RESTRICT and students.user_id is ON DELETE
--   CASCADE, so deleting the row is refused outright the moment the student has a
--   single order — and if it were allowed it would erase the shop's own sales and
--   settlement records along with the account.
--   So the ACCOUNT is destroyed (name, phone, e-mail, password, sessions, cart,
--   notifications) while the ORDER stays. That is safe because checkout_groups
--   already carries its own delivery snapshot (customer_name / phone_primary /
--   address), so an in-flight sash can still be embroidered and delivered after
--   the student is gone — the retained copy is the transaction record, not the
--   account. Existing behaviour, not something this migration adds.
--
-- Login becomes impossible on two independent counts: phone is NULLed (login
-- looks the account up BY phone) and password_hash is replaced with a value no
-- password can produce. token_version is bumped, which invalidates every JWT and
-- every SSE ticket already issued for the account, immediately.

BEGIN;

-- Marks the account as erased. Nullable: NULL = a live account.
-- Purely a tombstone/audit marker — nothing reads it to grant access, so a row
-- that somehow escaped the scrub still cannot be logged into.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Partial index: deleted accounts are a tiny minority and are only ever queried
-- as a set (support asking "was this account deleted, and when?").
CREATE INDEX IF NOT EXISTS idx_users_deleted_at
  ON users(deleted_at) WHERE deleted_at IS NOT NULL;

COMMIT;
