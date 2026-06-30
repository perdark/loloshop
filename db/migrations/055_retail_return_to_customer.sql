-- Migration 055: «إرجاع للطالب» — return a RETAIL order to the student for editing.
--
-- Orthogonal flag (mirrors the tailor_status / wholesaler_approval pattern): admin/staff can
-- return an early-stage RETAIL order to the student. While returned_to_customer = TRUE the order
-- LEAVES the production queue + the admin/staff orders list, and the student sees it as editable
-- in /returned-orders. Resubmitting (re-running POST /orders/configure) clears the flag and the
-- order re-enters the pipeline at its initial stage.
--
-- Idempotent: column adds are IF NOT EXISTS; default FALSE means existing rows are untouched.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS returned_to_customer BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS returned_reason      TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS returned_at          TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS returned_by          UUID REFERENCES users(id) ON DELETE SET NULL;

-- Cheap lookup of a student's returned orders + queue exclusion.
CREATE INDEX IF NOT EXISTS idx_orders_returned ON orders(returned_to_customer) WHERE returned_to_customer = TRUE;
