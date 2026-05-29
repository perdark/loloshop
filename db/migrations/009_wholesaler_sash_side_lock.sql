-- Migration 009: per-wholesaler sash side lock
-- Students who joined via a wholesaler may design only ONE sash side.
-- The wholesaler/admin picks which side the student edits and draws a default
-- Fabric.js design for the OTHER (locked) side.
--   editable_sash_side: 'left' | 'right' | NULL (NULL = no lock, both editable)
--   locked_side_design: Fabric.js JSON for the locked side (admin/wholesaler default)

BEGIN;

ALTER TABLE wholesalers
  ADD COLUMN IF NOT EXISTS editable_sash_side TEXT,
  ADD COLUMN IF NOT EXISTS locked_side_design JSONB;

DO $$ BEGIN
  ALTER TABLE wholesalers
    ADD CONSTRAINT chk_wholesalers_editable_side
    CHECK (editable_sash_side IS NULL OR editable_sash_side IN ('left', 'right'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
