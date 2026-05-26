BEGIN;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS package_id UUID REFERENCES packages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_package ON orders(package_id);

COMMIT;
