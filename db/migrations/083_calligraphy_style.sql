-- 083 — per-plate style knob (owner decision 2026-08-21).
--
-- Students ask for «حرف ممدود» / «خط أعرض» / «بدون زخرفة». Until now the only answer was the
-- default Thuluth, so the request either got ignored or the designer paid for a private image.
--
-- The style is a property of the SHEET: the batcher groups pending plates by (variant, style),
-- so ten «مد» names still ride ONE $0.10 image (~$0.01 each) exactly like ten default ones. The
-- column exists so that grouping is possible at all — a style held only in the request would be
-- lost the moment the plate waits in the queue, and the hitchhiker top-up (which pulls pending
-- plates from OTHER jobs onto a paid sheet) would happily mix styles into one image and ruin it.
--
-- NULL = the shop default. Values are ids from backend/lib/calligraphyStyles.js and NEVER free
-- text: nothing a student typed may reach the image prompt. Unknown ids normalize back to NULL
-- in the application, so a stale value can only ever degrade to the default.
BEGIN;

ALTER TABLE calligraphy_plates ADD COLUMN IF NOT EXISTS style TEXT;

-- The batcher's lookup: "oldest pending plate of this variant AND style".
CREATE INDEX IF NOT EXISTS idx_callig_plates_pending_batch
  ON calligraphy_plates (variant, style, created_at)
  WHERE status = 'pending';

COMMIT;
