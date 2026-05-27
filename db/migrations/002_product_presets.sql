-- Migration 002: product preset options
-- Pre-selected options for child products (presets applied when student enters the designer)

CREATE TABLE IF NOT EXISTS product_preset_options (
  product_id         UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  option_id          UUID NOT NULL REFERENCES options(id)  ON DELETE CASCADE,
  customer_image_url TEXT,
  PRIMARY KEY (product_id, option_id)
);
CREATE INDEX IF NOT EXISTS idx_product_preset_options_product ON product_preset_options(product_id);
