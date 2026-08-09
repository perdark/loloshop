-- 074: SuperQi account numbers are NOT a fixed length.
--
-- 073 pinned account_number to exactly 9 digits. Owner correction (2026-07-30):
-- real account numbers come in 9, 10 and 12 digits, so any fixed length would
-- reject valid ones. The rule is now only "digits, not empty". The upper bound
-- of 24 is a storage sanity guard, not a format rule — it is far above any
-- account number in use and exists so a pasted paragraph cannot land in the
-- column.

ALTER TABLE payout_accounts
  DROP CONSTRAINT IF EXISTS payout_accounts_account_number_format;
ALTER TABLE payout_accounts
  ADD CONSTRAINT payout_accounts_account_number_format
  CHECK (account_number IS NULL OR account_number ~ '^[0-9]{1,24}$');

ALTER TABLE manual_payouts
  DROP CONSTRAINT IF EXISTS manual_payouts_account_number_snapshot_format;
ALTER TABLE manual_payouts
  ADD CONSTRAINT manual_payouts_account_number_snapshot_format
  CHECK (account_number_snapshot IS NULL OR account_number_snapshot ~ '^[0-9]{1,24}$');
