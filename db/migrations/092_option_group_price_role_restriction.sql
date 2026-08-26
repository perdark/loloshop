-- Migration 092: hide an option GROUP from one price audience.
--
-- Owner request 2026-08-26: «إضافة إطار» is a 5,000 IQD toggle on the sash that must be
-- offered to a plain retail student and NEVER to a student who joined through a ممثل.
--
-- Products already have this idea (`products.wholesaler_only` / `products.retail_only`) and
-- option groups already have a sibling of it (`gender_restriction`). This is the same thing
-- one level down, spelled with the existing `price_role` enum so it cannot drift from the
-- vocabulary `option_price_roles` and `product_price_roles` already use.
--
-- NULL = shown to everyone. That is the default, so every existing group is unaffected.
--
-- ⚠️ A rep-linked student's price role IS 'wholesaler' (catalogController.priceRoleForUser:
-- a student row with a `wholesaler_id` resolves to 'wholesaler', not 'retail'). So
-- `price_role_restriction = 'retail'` is exactly «الطلاب العاديين فقط» — that is not a
-- coincidence to tidy up later, it is the whole mechanism.
ALTER TABLE option_groups
  ADD COLUMN IF NOT EXISTS price_role_restriction price_role;

COMMENT ON COLUMN option_groups.price_role_restriction IS
  'NULL = every audience. Otherwise the ONLY price_role that may see or buy this group.';
