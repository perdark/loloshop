-- 072: workshop piece rates differ by who the finished piece is for.
--
-- A rate was keyed (operation, product) and applied to every garment regardless of
-- customer. The shop pays a different per-piece wage for retail-student work than for
-- ممثل work, so `audience` joins the key and is stamped onto each production entry.
--
-- DEFAULT 'wholesale' is the backfill: every existing rate and entry was ممثل work.

ALTER TABLE workshop_piece_rates
  ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'wholesale'
  CHECK (audience IN ('wholesale','retail'));

-- Name verified live 2026-07-29 against the dev DB: the inline UNIQUE (operation, product)
-- from CREATE TABLE is named workshop_piece_rates_operation_product_key.
ALTER TABLE workshop_piece_rates
  DROP CONSTRAINT IF EXISTS workshop_piece_rates_operation_product_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_workshop_rate
  ON workshop_piece_rates(operation, product, audience);

-- Day-one safety: give every job a retail price equal to its current wholesale price so
-- no job is worth 0 the moment this ships. The admin then edits only what differs.
INSERT INTO workshop_piece_rates (operation, product, audience, amount)
SELECT operation, product, 'retail', amount
  FROM workshop_piece_rates WHERE audience = 'wholesale'
ON CONFLICT DO NOTHING;

ALTER TABLE workshop_production_entries
  ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'wholesale'
  CHECK (audience IN ('wholesale','retail'));
