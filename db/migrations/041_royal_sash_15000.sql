-- Migration 041: update royal_sash add-on from 10000 → 15000 for all wholesalers.
-- Handles: (a) key present with value 10000 → update to 15000,
--          (b) key present with other value → leave unchanged (admin customised it),
--          (c) key missing or pricing_addons is null → insert/set it to 15000.
-- Idempotent: running a second time is a no-op (the value is already 15000).

UPDATE wholesalers
SET pricing_addons = CASE
  -- NULL column → seed it with just the royal_sash key
  WHEN pricing_addons IS NULL
    THEN jsonb_build_object('royal_sash', 15000)
  -- key missing → add it
  WHEN NOT (pricing_addons ? 'royal_sash')
    THEN pricing_addons || jsonb_build_object('royal_sash', 15000)
  -- key present with old value 10000 → bump it
  WHEN (pricing_addons->>'royal_sash')::numeric = 10000
    THEN jsonb_set(pricing_addons, '{royal_sash}', '15000')
  -- key present with any other value → admin customised; leave alone
  ELSE pricing_addons
END;

-- Verify
SELECT id, pricing_addons->>'royal_sash' AS royal_sash FROM wholesalers;
