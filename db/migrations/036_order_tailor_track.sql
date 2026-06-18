-- 036: parallel «الفصال» (tailor) track for RETAIL orders.
-- The مفصل (e.g. ابو عبدو) works retail orders in PARALLEL with the designer/embroidery
-- pipeline. This status is INDEPENDENT of orders.status — completing the tailor track
-- never advances the production pipeline, and advancing production never changes this.
-- The tailor queue + admin parallel view filter to retail (students.wholesaler_id IS NULL).
DO $$ BEGIN
  CREATE TYPE tailor_track_status AS ENUM ('pending', 'done');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS tailor_status tailor_track_status NOT NULL DEFAULT 'pending';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tailor_done_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tailor_done_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Don't flood the tailor's to-do with orders that are already handed over / cancelled.
UPDATE orders SET tailor_status = 'done', tailor_done_at = COALESCE(delivered_at, updated_at)
  WHERE tailor_status = 'pending' AND status IN ('ready', 'delivered', 'cancelled');

CREATE INDEX IF NOT EXISTS idx_orders_tailor_pending ON orders(tailor_status) WHERE tailor_status = 'pending';
