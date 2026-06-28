-- Migration 051: wholesaler partial-order cap prices.
-- Full package pricing still uses wholesalers.wholesaler_price; these keys apply only
-- when a rep-linked student orders cap as a single/partial piece.
UPDATE wholesalers
SET pricing_addons =
  COALESCE(pricing_addons, '{}'::jsonb)
  || jsonb_build_object(
    'piece_cap_normal', 15000,
    'piece_cap_royal', 20000
  );

