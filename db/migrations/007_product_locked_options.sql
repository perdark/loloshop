-- Migration 007: admin can lock a child product's option group to a single fixed option.
-- The lock is keyed by the CHILD product_id, so an inherited (parent) group can be
-- locked at the child level without affecting the parent.
CREATE TABLE IF NOT EXISTS product_locked_options (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  group_id   UUID NOT NULL REFERENCES option_groups(id) ON DELETE CASCADE,
  option_id  UUID NOT NULL REFERENCES options(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, group_id)
);
CREATE INDEX IF NOT EXISTS idx_product_locked_options_product ON product_locked_options(product_id);
