-- Migration 010 (data backfill) — production pipeline.
-- Run AFTER `npm run migrate` has committed the new order_status enum values:
--   cd backend && npm run migrate:file db/migrations/010_pipeline_backfill.sql
-- Postgres forbids using a freshly-added enum value in the same transaction that adds
-- it, so this backfill lives in its own migrate:file invocation (separate connection).

BEGIN;

-- Old holding/printing states map onto the new production pipeline.
UPDATE orders SET status = 'embroidery' WHERE status IN ('staff_review', 'printing');

-- Non-design orders (robe / cap / shawl, incl. package extras) have nothing to embroider
-- or press — send them straight to the preparer's queue.
UPDATE orders SET status = 'preparing' WHERE design_id IS NULL AND status = 'embroidery';

-- Legacy completed designs whose orders are already past design_complete predate the
-- approval gate — mark them approved so they don't clog the designer's pending queue.
UPDATE designs SET approval_status = 'approved', approved_at = COALESCE(approved_at, NOW())
WHERE completed = TRUE AND approval_status = 'pending'
  AND EXISTS (
    SELECT 1 FROM orders o
    WHERE o.design_id = designs.id
      AND o.status IN ('embroidery', 'pressing', 'preparing', 'ready', 'delivered')
  );

COMMIT;
