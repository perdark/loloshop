-- Migration 022 — package composition: admin CHOOSES which products make up a package
-- (e.g. the full-set طقم picks a specific robe + cap + sash from the catalog instead of
-- the system defaulting to the first active product per type).
-- Idempotent: safe to re-run and mirrored into db/schema.sql.

CREATE TABLE IF NOT EXISTS package_products (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  UNIQUE (package_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_package_products_pkg ON package_products(package_id);
