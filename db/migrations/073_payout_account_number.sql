-- 073: SuperQi account number (9 digits) beside the 16-digit Mastercard number.
--
-- Owner rule (2026-07-29): a payout destination is BOTH numbers — the 16-digit
-- card and the 9-digit SuperQi account. "Both required" is enforced by the
-- application on every save (payoutController.validateAccountBody) rather than
-- by NOT NULL, because rows written before this migration hold only a card and
-- nobody can invent the missing account number for them. Such a row cannot be
-- re-saved without supplying the account number, and cannot receive a recorded
-- transfer until it does.

ALTER TABLE payout_accounts
  ADD COLUMN IF NOT EXISTS account_number TEXT;

ALTER TABLE payout_accounts
  DROP CONSTRAINT IF EXISTS payout_accounts_account_number_format;
ALTER TABLE payout_accounts
  ADD CONSTRAINT payout_accounts_account_number_format
  CHECK (account_number IS NULL OR account_number ~ '^[0-9]{9}$');

-- The manual-transfer log snapshots what the admin actually copied, so it gains
-- the account number too. Nullable for rows recorded before this migration.
ALTER TABLE manual_payouts
  ADD COLUMN IF NOT EXISTS account_number_snapshot TEXT;

ALTER TABLE manual_payouts
  DROP CONSTRAINT IF EXISTS manual_payouts_account_number_snapshot_format;
ALTER TABLE manual_payouts
  ADD CONSTRAINT manual_payouts_account_number_snapshot_format
  CHECK (account_number_snapshot IS NULL OR account_number_snapshot ~ '^[0-9]{9}$');
