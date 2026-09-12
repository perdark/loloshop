-- 109 — رجّع القطع اللي الديپلوي سحبها من «التجهيز» إلى «الكوي» بلا ما يرجّعها أحد
--
-- THE DEFECT (fixed the same day in db/schema.sql, pinned by
-- test/legacyPressingIdempotent.test.js). 101's copy inside db/schema.sql was restructured into
-- three separate statements, and the last one drove its UPDATE off the WHOLE
-- `legacy_pressing_restore_log` table — 307 permanent rows — guarded by nothing but
-- `o.status = 'preparing'`. `scripts/deploy.sh` applies that file on EVERY deploy, so every
-- deploy pulled back to الكوي every one of those orders that المكوجي had since pressed and sent
-- to التجهيز. Nothing recorded it: the route_fix INSERT above it is guarded on
-- `NOT EXISTS(action='route_fix')`, so the second move was never logged, and no audit row was
-- written either. That is the whole of «صارت تم الكوي، بعدين اتسكنت بالتجهيز، وفجأة رجعت للكوي»
-- and of «محد رجّعها ولا محد نطاها تم».
--
-- THE MEASUREMENT (prod, 2026-09-12). 49 orders are sitting at 'pressing' although a HUMAN had
-- already advanced them out of الكوي; 46 of them are physically in a bin on رف التجهيز right now
-- (a live `shelf_placements` row), which is why المكوجي kept seeing pressed garments come back.
-- The batches are visible as identical-microsecond `orders.updated_at` groups a minute or two
-- after each deploy: 11 rows 2026-09-07 23:51 · 6 rows 2026-09-08 16:55 · 14 rows 2026-09-08 23:29.
--
-- ⚠️ THIS FILE IS **NOT** REPEATED IN db/schema.sql, and that is deliberate — the opposite of the
-- 077/080/101 pattern. It is a one-time repair of damage that a re-runnable statement caused; a
-- second re-runnable statement over the same rows is how the next one happens. Run it once:
--     npm run migrate:file db/migrations/109_undo_deploy_pressing_revert.sql
--
-- WHAT IT REFUSES TO TOUCH. Only orders whose own history proves a person moved them past الكوي:
-- a non-`route_fix` row in `staff_activity_log` leaving 'pressing', whose latest such row put
-- them at 'preparing'. The other 201 restore-log orders still at 'pressing' were never pressed by
-- anybody and belong exactly where they are. Nothing at 'ready' or 'delivered' is walked back.

BEGIN;

DO $undo109$
DECLARE
  v_batch uuid := gen_random_uuid();
  v_moved int;
BEGIN
  CREATE TEMP TABLE _deploy_reverted ON COMMIT DROP AS
    SELECT o.id
      FROM legacy_pressing_restore_log l
      JOIN orders o ON o.id = l.order_id
     WHERE o.status = 'pressing'
       -- A person took it out of الكوي at some point…
       AND EXISTS (SELECT 1 FROM staff_activity_log s
                    WHERE s.order_id = o.id AND s.action <> 'route_fix'
                      AND s.from_stage = 'pressing')
       -- …and the last thing a person did with it was put it at التجهيز.
       AND (SELECT s.to_stage FROM staff_activity_log s
             WHERE s.order_id = o.id AND s.to_stage IS NOT NULL AND s.action <> 'route_fix'
             ORDER BY s.created_at DESC LIMIT 1) = 'preparing';

  SELECT count(*) INTO v_moved FROM _deploy_reverted;
  IF v_moved = 0 THEN
    RAISE NOTICE '109: nothing to repair — already applied, or this database never ran the broken file';
    RETURN;
  END IF;

  INSERT INTO legacy_pressing_restore_log (batch_id, order_id, old_status, new_status)
  SELECT v_batch, id, 'pressing', 'preparing' FROM _deploy_reverted;

  UPDATE orders o
     SET status = 'preparing', working_staff_id = NULL, working_since = NULL
    FROM _deploy_reverted t
   WHERE o.id = t.id;

  -- No human did this either, so none is named. `route_fix` renders as «تصحيح مسار آلي»;
  -- 'advance' would credit somebody's payroll for work the deploy undid and this file redid.
  INSERT INTO staff_activity_log (user_id, action, order_id, from_stage, to_stage)
  SELECT NULL, 'route_fix', id, 'pressing', 'preparing' FROM _deploy_reverted;

  INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
  SELECT NULL, 'status_change', 'order', id,
         jsonb_build_object(
           'by', 'migration:109-undo-deploy-revert',
           'from', 'pressing', 'to', 'preparing',
           'reason', 'schema_sql_101_unguarded_update_pulled_it_back_on_deploy',
           'batch_id', v_batch)
    FROM _deploy_reverted;

  RAISE NOTICE '109: returned % piece(s) to التجهيز — undo batch %', v_moved, v_batch;
END
$undo109$;

-- ─── AND THE OTHER HALF OF «أكو قطع ما تتسكن صح»: placements left live after the piece left ───
-- `revert` has freed a خانة since the shelf shipped; `performAdvance` never did, so a preparer
-- who pressed «جاهز» anywhere other than the shelf's own «تسليم» left the placement open and the
-- bin went on counting a garment that had already gone out the door. Fixed in code the same day
-- (productionController.performAdvance → shelf.collectForOrder, pinned in test/shelf.test.js);
-- this closes the rows that leaked before it.
--
-- ⚠️ COLLECTED, NOT DELETED. The piece really was picked up — deleting the row would erase the
-- placement history the board's «تم تغليفها» list reads. `collected_by` stays NULL because
-- nobody can now say who carried it; a guessed name is worse than an honest blank.
-- Measured on prod 2026-09-12: 14 live placements on orders already at «جاهز» / «تم التسليم».
DO $stale109$
DECLARE v_closed int;
BEGIN
  UPDATE shelf_placements sp
     SET collected_at = now()
    FROM orders o
   WHERE o.id = sp.order_id
     AND sp.collected_at IS NULL
     AND o.status IN ('ready', 'delivered');
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  UPDATE shelf_slot_occupancy so SET closed_at = now()
   WHERE so.closed_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM shelf_placements sp
                      WHERE sp.occupancy_id = so.id AND sp.collected_at IS NULL);

  RAISE NOTICE '109: closed % stale placement(s) on pieces that had already left التجهيز', v_closed;
END
$stale109$;

COMMIT;

-- UNDO — keyed on this file's own rows, which are the only ones in the log written
-- 'pressing' → 'preparing' (101 and 102 both wrote 'preparing' → 'pressing'):
--
--   UPDATE orders o SET status = 'pressing'
--     FROM legacy_pressing_restore_log l
--    WHERE o.id = l.order_id AND l.old_status = 'pressing' AND l.new_status = 'preparing'
--      AND o.status = 'preparing';
--   DELETE FROM staff_activity_log
--    WHERE action = 'route_fix' AND from_stage = 'pressing' AND to_stage = 'preparing';
