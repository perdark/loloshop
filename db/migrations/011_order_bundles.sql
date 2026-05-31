-- Migration 011: checkout_group_id — links all orders created in a single cart checkout
-- so staff/admin can view the full package or individual components without merging orders.
-- Single-item checkouts leave checkout_group_id NULL (no bundle).

ALTER TABLE orders ADD COLUMN IF NOT EXISTS checkout_group_id UUID;
CREATE INDEX IF NOT EXISTS idx_orders_checkout_group ON orders(checkout_group_id);
