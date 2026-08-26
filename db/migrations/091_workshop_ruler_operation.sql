-- Migration 091: «مسطرة» — a new workshop operation, on the CAP only.
--
-- Owner request 2026-08-26. The operation list is a hardcoded array in
-- backend/controllers/workshopController.js (OPERATIONS / PRODUCT_OPS / OP_LABEL_AR), not a
-- table, so this migration only carries the RATE row — the code half of the change ships in
-- the same commit and one is useless without the other.
--
-- ⚠️ Seeded at 0 ON PURPOSE. A wrong wage that looks entered is worse than an obvious zero:
-- the workshop screen shows 0 until an admin types the real amount at
-- /admin/workshop → أسعار القطع. `updated_by` stays NULL so the schema.sql retail-alignment
-- UPDATE keeps treating it as unset (it is a no-op here — both audiences are 0).
INSERT INTO workshop_piece_rates (operation, product, audience, amount)
VALUES ('ruler','cap','wholesale',0), ('ruler','cap','retail',0)
ON CONFLICT (operation, product, audience) DO NOTHING;
