-- LoloShop — product media + catalog display control (admin-managed)
-- Additive. Run: psql $DATABASE_URL -f db/migrations/002_product_media.sql (or node runner).

ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;          -- main card photo
ALTER TABLE products ADD COLUMN IF NOT EXISTS featured  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sort      INTEGER NOT NULL DEFAULT 0;

-- gallery: many photos per product (the "20 sashes with pics" live here or as featured products)
CREATE TABLE IF NOT EXISTS product_images (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id);

-- packages can also carry a photo
ALTER TABLE packages ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS sort      INTEGER NOT NULL DEFAULT 0;
