-- Migration 047: كوي (pressing) routing + embroidery-zone checklist column
--
-- Adds `orders.embroidery_zones` — a JSONB map the embroiderer ticks off per zone
-- (keyed by zone key, e.g. {"sash_right": true, "sash_back": true}) to track per-zone
-- embroidery progress.
--
-- Also backfills the NEW كوي (pressing) routing onto in-flight orders so they get the
-- same embroidery → كوي → تجهيز path going forward: embroidered sashes & robes that have
-- not yet left the embroidery stage are flagged needs_pressing = TRUE, while caps (which
-- never need كوي) are flipped back to FALSE unless they are already downstream of pressing.
--
-- Idempotent: column add is IF NOT EXISTS; backfill UPDATEs only touch rows that are not
-- already in the target state, so re-running is a no-op.

-- 1. Embroiderer per-zone checklist progress.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS embroidery_zones JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 2. Sashes & robes that are embroidered and still at/before the embroidery stage
--    must route through كوي.
UPDATE orders o SET needs_pressing = TRUE
  FROM products p
 WHERE p.id = o.product_id AND p.type IN ('sash','robe')
   AND o.has_embroidery = TRUE
   AND o.status::text IN ('designing','design_complete','converting','embroidery')
   AND o.needs_pressing = FALSE;

-- 3. Caps never need كوي — only flip ones not already downstream of pressing.
UPDATE orders o SET needs_pressing = FALSE
  FROM products p
 WHERE p.id = o.product_id AND p.type = 'cap'
   AND o.needs_pressing = TRUE
   AND o.status::text NOT IN ('pressing','preparing','ready','delivered');
