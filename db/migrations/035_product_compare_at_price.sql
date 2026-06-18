-- 035: «السعر قبل الخصم» — optional compare-at (old) price per product.
-- When set AND greater than the effective price, the storefront strikes it through and
-- shows a discount badge. NULL = no discount. Admin sets it on /admin/products.
ALTER TABLE products ADD COLUMN IF NOT EXISTS compare_at_price BIGINT
  CHECK (compare_at_price IS NULL OR compare_at_price >= 0);
