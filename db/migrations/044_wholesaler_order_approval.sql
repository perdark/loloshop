-- Migration 044: wholesaler order-approval gate (orthogonal column, mirrors tailor_status).
-- orders.wholesaler_approval = NULL (retail, always visible)
--                            | 'pending'  (waiting for rep approval)
--                            | 'approved' (approved — enters staff queue)
--                            | 'rejected' (sent back to student for correction)
-- Apply: from backend/ run `node migrate.js ../db/migrations/044_wholesaler_order_approval.sql`

DO $$ BEGIN
  CREATE TYPE wholesaler_approval_status AS ENUM ('pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS wholesaler_approval     wholesaler_approval_status;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS wholesaler_approved_at  TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS wholesaler_approved_by  UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS wholesaler_reject_reason TEXT;

-- Backfill: grandfather EXISTING wholesaler orders to 'approved' so live work doesn't vanish.
-- Scoped to orders whose student belongs to a rep (s.wholesaler_id IS NOT NULL).
UPDATE orders o SET wholesaler_approval = 'approved'
  FROM students s
 WHERE s.id = o.student_id AND s.wholesaler_id IS NOT NULL AND o.wholesaler_approval IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_wholesaler_approval ON orders(wholesaler_approval);
