-- Migration 086 — one ledger, both halves of a discount round's life.
--
-- 085 created `discount_restore_log` when only ENDING a round existed, so every row in it meant
-- "a price was raised back". Starting a round (backend/lib/discountRound.js) writes to the same
-- table and needs the opposite meaning, and the rows are otherwise indistinguishable: both are
-- {product, scope, old_price, new_price}, and a rollback of either is the same UPDATE from
-- old_price on one batch_id.
--
-- `direction` names which press produced the row. The default is 'end' ON PURPOSE: every row
-- that already exists was written by «إنهاء الخصومات», so backfilling them is what the default
-- does, and no separate UPDATE is needed.
--
-- ⚠️ A 'start' row's `old_compare_at_price` is always NULL, and that is not missing data —
-- discountRound refuses to start a round on a product that already carries a compare-at
-- (ERR_ALREADY_DISCOUNTED), so there is never a previous value to keep.

ALTER TABLE discount_restore_log
  ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'end'
  CHECK (direction IN ('start', 'end'));

CREATE INDEX IF NOT EXISTS idx_discount_restore_direction
  ON discount_restore_log(direction, restored_at DESC);
