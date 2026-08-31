-- Migration 096 — «هذي مجموعة تطريز؟» : mark an option group that is NOT embroidery work.
--
-- WHY. `orderController.priceSelections` decided an order needed the design/embroidery
-- stages from a single line:
--     if (needsImage || needsText || providedText || providedImage) hasEmbroidery = true;
-- i.e. ANY option group that carried text or a photo meant «there is artwork on this piece».
-- That is true of «تطريز يمين» and «تطريز القبعة من الجانب». It is NOT true of «صورة الشال»
-- and «صورة القبعة», which are PRODUCT-IMAGE PICKERS (owner, 2026-08-31): the student is
-- choosing which shawl/cap they want, and the picker records that choice as customer_text.
--
-- The cost, measured on prod the day this was written: 468 شال امريكي orders had been routed
-- to التصميم → التطريز on the strength of that picker (272 waiting at التصميم, 196 at
-- التطريز), and NOT ONE of them carried a single line with «تطريز» in it. Worse, the two
-- halves of the app disagreed: productionController's ZONE_DEFS deliberately excludes
-- «شال امريكي» («the American shawl is an add-on, not embroidery»), so each of those orders
-- arrived at التطريز showing ZERO zones — nothing to tick, nothing to finish, and no screen
-- said why. They sat from 2026-06-29 until this migration.
--
-- ⚠️ NULLABLE ON PURPOSE, and NULL means «yes, embroidery». Two reasons:
--   · every existing group keeps its current behaviour without a backfill, and
--   · the seed below only fills NULLs, so `npm run migrate` (which re-applies db/schema.sql
--     on EVERY deploy) can never revert an admin who later sets one of these back to TRUE.
--     Same trap 093's schedule seed guards against with ON CONFLICT DO NOTHING.
ALTER TABLE option_groups ADD COLUMN IF NOT EXISTS is_embroidery BOOLEAN;

COMMENT ON COLUMN option_groups.is_embroidery IS
  'FALSE = this group is a product picker, not embroidery work; it must not route an order to التصميم/التطريز. NULL = unset = treated as TRUE.';

-- Seed: the two product-image pickers the owner named. Only NULLs are touched.
UPDATE option_groups SET is_embroidery = FALSE
 WHERE is_embroidery IS NULL
   AND name_ar IN ('صورة الشال', 'صورة القبعة');
