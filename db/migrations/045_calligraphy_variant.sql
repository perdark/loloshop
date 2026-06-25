-- db/migrations/045_calligraphy_variant.sql
-- Calligraphy back/cap support: each plate now records which embroidery zone it renders.
-- Generation picks the prompt by variant (front = full ornament, back = reduced <50%),
-- and the proof grid / wholesaler grab can group & badge by zone. The two zones also must
-- never share one sheet (one sheet = one prompt) — the controller batches by variant.
-- Existing rows are all front plates → the DEFAULT backfills them.
DO $$ BEGIN
  CREATE TYPE calligraphy_variant AS ENUM ('front','back','cap');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE calligraphy_plates
  ADD COLUMN IF NOT EXISTS variant calligraphy_variant NOT NULL DEFAULT 'front';
