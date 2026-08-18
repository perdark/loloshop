-- 082: stop the reroll geometry ratchet, and give calligraphy spend a ledger with a ceiling.
--
-- THE RATCHET. `calligraphyController.reroll` handed `matchPlateGeometry` the plate it was
-- about to overwrite, so reroll N+1 anchored on reroll N's OUTPUT. The target ink height is
-- min(reference ink height, canvas) and a wide name scales down further to fit the width, so
-- the height is monotone non-increasing across presses and can never recover — reproduced with
-- sharp at 700×140 → 1024×73 → 365×73 → 73. Designers press again chasing quality that cannot
-- come back, and every press is a paid image. `original_plate_path` pins the FIRST generated
-- plate (whose file is never pruned from /uploads) as the permanent geometry anchor: reroll 7
-- matches the same band reroll 1 did.
--
-- The backfill pins today's plate as the anchor for existing rows. For plates already rerolled
-- the true original file name is gone (plate_path was overwritten), so the current plate is the
-- best anchor that exists — it stops FURTHER shrinking, which is all that can still be done.
--
-- THE LEDGER. Measured on prod 2026-08-18: $59.43 lifetime, $40.53 in the first 17 days of
-- August, and the feature had NO daily ceiling — REROLL_LIMIT bounds one plate, nothing bounds
-- a day. cost_usd on calligraphy_plates cannot serve as a daily ledger because a reroll adds
-- money to a row created weeks earlier, and the element endpoint stored its cost nowhere at
-- all. One row per paid OpenRouter image, whatever bought it; lib/calligraphySpend.js reads
-- the last 24h and refuses the next generation past CALLIG_DAILY_USD_MAX (warning the admins
-- at CALLIG_DAILY_USD_WARN, same pattern as the assistant's ai_budget_warning).

BEGIN;

-- The first plate ever generated for this row — the permanent geometry anchor for rerolls.
ALTER TABLE calligraphy_plates ADD COLUMN IF NOT EXISTS original_plate_path TEXT;

-- Pin existing plates on their current artwork (best surviving anchor; see header).
UPDATE calligraphy_plates
   SET original_plate_path = plate_path
 WHERE original_plate_path IS NULL AND plate_path IS NOT NULL;

-- One row per paid image: kind 'sheet' | 'reroll' | 'element'.
CREATE TABLE IF NOT EXISTS calligraphy_spend_log (
  id         BIGSERIAL PRIMARY KEY,
  kind       TEXT NOT NULL,
  cost_usd   NUMERIC(10,5) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_callig_spend_created ON calligraphy_spend_log(created_at);

COMMIT;
