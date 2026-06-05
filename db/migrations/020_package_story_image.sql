-- Migration 020 — second package image: editorial "story" photo
-- The VIP showcase shows TWO photos: the cinematic hero (image_url) and a lower
-- full-bleed "story" band. This adds the admin-managed second image so both are
-- editable from Admin → باقات VIP. Idempotent + mirrored into db/schema.sql.

ALTER TABLE packages ADD COLUMN IF NOT EXISTS story_image_url TEXT;   -- editorial story-band photo on the VIP page
