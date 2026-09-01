-- 101 — رجّع القطع القديمة اللي انفتحت على «قيد التجهيز» قبل ما يصير الكوي جزء من مسارها
--
-- THE MEASUREMENT (prod, 2026-09-01). 293 pieces sit at التجهيز/جاهز/تم التسليم carrying
-- needs_pressing = TRUE with NO trace of الكوي anywhere — not one row in `staff_activity_log`,
-- not one `status_change` in `audit_log`. 290 different students. The shop read that as «راحت
-- لوحدها ومحمد عادل ما نقلها», and it is not what happened: commit 4176fb3 (2026-07-15,
-- «route every plain non-cap piece through الكوي») changed where a plain robe/sash OPENS. Before
-- that day it was created directly at 'preparing'; الكوي was never on its route, so nobody
-- skipped a step. The cut-off proves it — the newest affected order was created 2026-07-15 and
-- there is not a single one after it:
--
--   oldest affected 2026-06-25  ·  newest affected 2026-07-15  ·  created after 07-15: 0
--
-- WHAT THIS MIGRATION DOES, AND THE THREE THINGS IT REFUSES TO TOUCH.
-- It moves the 248 still sitting at 'preparing' back to 'pressing' so they enter المكوجي's
-- queue. It deliberately leaves alone:
--
--   · 43 at 'ready' and 1 'delivered' — a delivered garment cannot be un-delivered, and pulling
--     «جاهز» backwards would tell a student their finished order regressed. If any of those were
--     genuinely never pressed it is a physical problem in the shop, not a row to rewrite.
--   · every cap — caps skip الكوي by design (needs_pressing = FALSE), so التجهيز IS their first
--     stage and there is nothing behind it.
--   · anything created after 2026-07-15 — the date guard is belt-and-braces. Even if a future
--     bug produces a piece with this exact shape, this file must never quietly move it; that
--     would hide the live defect the way this one hid behind a routing change for six weeks.
--
-- ⚠️ IDEMPOTENT AND REPEATED IN db/schema.sql, the 077/080/093 pattern. `scripts/deploy.sh` runs
-- `npm run migrate` (which applies schema.sql) on EVERY deploy, so the guard clauses are what
-- stop a second deploy from dragging a piece back out of الكوي after محمد عادل has pressed it:
-- once it advances to 'preparing' again it carries a `from_stage='pressing'` activity row, and
-- the NOT EXISTS below excludes it forever after. Do not "tidy" these predicates into a plain
-- `status = 'preparing'`.

BEGIN;

-- A move nobody made needs a row nobody owns. `staff_activity_log.user_id` was NOT NULL, which
-- is right for every writer that exists today (all of them pass `req.user.id`) but leaves no way
-- to record «the system corrected a route». NULL now means exactly that, and nothing else has to
-- change: `getOrder`'s stage-history LEFT JOINs `users` already, and every per-person reader
-- (payroll goals, the staff activity feed, staffPresence) filters `WHERE user_id = $1`, which a
-- NULL can never match. ⚠️ Do NOT backfill this to a real admin id to "clean it up" — naming a
-- person here is the exact mistake this whole finding was about.
ALTER TABLE staff_activity_log ALTER COLUMN user_id DROP NOT NULL;

-- The undo. Keyed by batch so one UPDATE puts every row back exactly where it was, which
-- matters because 248 orders is 248 students who can see their own status.
CREATE TABLE IF NOT EXISTS legacy_pressing_restore_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id    uuid NOT NULL,
  order_id    uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  old_status  text NOT NULL,
  new_status  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_legacy_pressing_restore_batch
  ON legacy_pressing_restore_log (batch_id);

DO $$
DECLARE
  v_batch uuid := gen_random_uuid();
  v_moved int;
BEGIN
  CREATE TEMP TABLE _legacy_unpressed ON COMMIT DROP AS
    SELECT o.id
      FROM orders o
      JOIN products p ON p.id = o.product_id
     WHERE o.status = 'preparing'
       AND o.needs_pressing = TRUE
       AND p.type <> 'cap'
       -- The routing change. Nothing created after it may ever be caught here.
       AND o.created_at < DATE '2026-07-16'
       -- Never visited الكوي by either ledger. Both are checked because they are written by
       -- different paths: performAdvance writes both, the legacy PATCH used to write only the
       -- audit row, and the 2026-08-31 `script:stranded-orders` run wrote only the audit row too.
       AND NOT EXISTS (
             SELECT 1 FROM staff_activity_log l
              WHERE l.order_id = o.id
                AND (l.from_stage = 'pressing' OR l.to_stage = 'pressing'))
       AND NOT EXISTS (
             SELECT 1 FROM audit_log a
              WHERE a.entity = 'order' AND a.entity_id = o.id
                AND a.action IN ('status_change', 'status_revert')
                AND (a.details->>'to' = 'pressing' OR a.details->>'from' = 'pressing'));

  SELECT count(*) INTO v_moved FROM _legacy_unpressed;
  IF v_moved = 0 THEN
    RAISE NOTICE '101: nothing to move — already applied, or no legacy rows on this database';
    RETURN;
  END IF;

  INSERT INTO legacy_pressing_restore_log (batch_id, order_id, old_status, new_status)
  SELECT v_batch, id, 'preparing', 'pressing' FROM _legacy_unpressed;

  UPDATE orders o
     SET status = 'pressing', working_staff_id = NULL, working_since = NULL
    FROM _legacy_unpressed t
   WHERE o.id = t.id;

  -- The trail. `actor_id` is NULL because no human did this and none should be named — the whole
  -- point of the finding was that a routing change was being read as a worker's mistake.
  INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
  SELECT NULL, 'status_change', 'order', id,
         jsonb_build_object(
           'by', 'migration:101-legacy-unpressed',
           'from', 'preparing', 'to', 'pressing',
           'reason', 'opened_at_preparing_before_2026_07_15_routing_change',
           'batch_id', v_batch)
    FROM _legacy_unpressed;

  -- «منو نقلها؟» reads THIS table, not audit_log. A row with a NULL user renders as «غير معروف»
  -- — the worst possible answer here, since the card exists precisely so nobody is blamed for a
  -- move they did not make. `route_fix` is its own action so the card can say so in words; see
  -- StageHistoryCard. It is NOT 'advance': payroll and staff goals count
  -- `action IN ('advance','approve_design')` and this is not anybody's work.
  INSERT INTO staff_activity_log (user_id, action, order_id, from_stage, to_stage)
  SELECT NULL, 'route_fix', id, 'preparing', 'pressing' FROM _legacy_unpressed;

  RAISE NOTICE '101: moved % legacy piece(s) back to الكوي — undo batch %', v_moved, v_batch;
END $$;

COMMIT;

-- UNDO (one statement, run it against the batch_id printed above):
--
--   UPDATE orders o SET status = l.old_status::order_status
--     FROM legacy_pressing_restore_log l
--    WHERE o.id = l.order_id AND l.batch_id = '<batch>' AND o.status::text = l.new_status;
--   DELETE FROM staff_activity_log
--    WHERE action = 'route_fix'
--      AND order_id IN (SELECT order_id FROM legacy_pressing_restore_log WHERE batch_id = '<batch>');
