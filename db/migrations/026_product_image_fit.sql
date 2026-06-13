-- Migration 026: per-product image fit for catalog tiles + detail gallery.
-- 'cover' (default) crops the photo to fill the frame; 'contain' zooms out to
-- show the whole photo (letterboxed in the warm frame). Lets the admin flip a
-- panoramic/odd-aspect photo (e.g. شال امريكي family) without cropping it.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS image_fit TEXT NOT NULL DEFAULT 'cover'
  CHECK (image_fit IN ('cover', 'contain'));
