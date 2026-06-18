-- Migration 034: storefront packages can carry MULTIPLE photos that auto-rotate.
-- `gallery` is an ordered JSON array of image URLs the admin sets; the storefront
-- package card cycles through them on a timer. `image_url` stays the single cover
-- (the first frame / fallback when the gallery is empty).
BEGIN;

ALTER TABLE packages ADD COLUMN IF NOT EXISTS gallery JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
