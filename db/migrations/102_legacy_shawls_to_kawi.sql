-- 102 — الشالات القديمة اللي فاتها الكوي، وعلّة العلم (needs_pressing) اللي خلّتها تفوته
--
-- WHAT 101 MISSED, AND WHY. Migration 101 moved every stuck piece carrying
-- `needs_pressing = TRUE` back into الكوي — 248 robes and 1 sash. It filtered on that column
-- because that is exactly what keeps CAPS out: a cap has never been pressed and التجهيز IS its
-- first stage (`orderController.js:655` — `needs_pressing = productType !== 'cap'`). Pulling
-- 452 caps into المكوجي's queue would have been the worse mistake.
--
-- But the same filter silently excluded 57 شال امريكي, because THEIR flag is wrong. Measured on
-- prod 2026-09-02:
--
--   shawl  needs_pressing = FALSE     60   created 2026-06-24 → 2026-07-15
--   shawl  needs_pressing = TRUE     566   created 2026-06-29 → 2026-09-01
--
-- Every shawl made since the 2026-07-15 routing change (4176fb3) is TRUE, and 500+ of them are
-- standing in الكوي right now. A شال is pressed. So those 60 are not a different product with a
-- different route — they are the same product carrying a stale flag, and the newest of them was
-- created on the cutoff day itself. Same root cause as 101, one layer deeper: 101 corrected the
-- STATUS of rows whose flag was right; this corrects the FLAG too.
--
-- ⚠️ THE FLAG IS THE HALF THAT MATTERS MORE THAN THE MOVE. `nextStageFor` reads
-- `needs_pressing` on every advance out of التطريز, and `resolveRevertTarget` reads it on every
-- step back. Move a shawl to الكوي and leave the flag FALSE and it is right once and wrong
-- forever after: the next advance sends it التطريز → التجهيز again, skipping الكوي, and «رجّع
-- خطوة» from التجهيز finds nothing behind it. Correcting the status without the flag would put
-- these 57 straight back where they started.
--
-- ⚠️ CAPS ARE STILL EXCLUDED AND MUST STAY EXCLUDED. `type = 'shawl'` is spelled out rather
-- than `type <> 'cap'` on purpose: this file makes a claim about ONE garment whose flag was
-- measured to be wrong. It is not a licence to normalise `needs_pressing` across the catalogue.
--
-- ⚠️ IDEMPOTENT AND REPEATED IN db/schema.sql (the 077/080/093/101 pattern). Once a piece has
-- moved it carries a `pressing` row in `staff_activity_log`, and the NOT EXISTS below excludes
-- it forever — so a later deploy cannot drag it back out of محمد عادل's hands after he has
-- pressed it. Do not simplify those predicates into a plain `status = 'preparing'`.

BEGIN;

-- 101 recorded only the status it changed. This one also changes a flag, so the undo needs to
-- know what that flag was — NULL on every row 101 wrote, which is the honest reading: 101 did
-- not touch `needs_pressing`.
ALTER TABLE legacy_pressing_restore_log
  ADD COLUMN IF NOT EXISTS old_needs_pressing BOOLEAN;

DO $legacy102$
DECLARE
  -- ⚠️ ONE batch for the whole run. `gen_random_uuid()` is VOLATILE, so writing this as
  -- `SELECT gen_random_uuid(), …` evaluates it PER ROW — that is exactly what happened on 101's
  -- first prod run (249 rows, 249 batch ids) and it broke the rollback recipe. Hence the DO block.
  v_batch uuid := gen_random_uuid();
  v_moved int;
BEGIN
  CREATE TEMP TABLE _legacy_shawls ON COMMIT DROP AS
    SELECT o.id
      FROM orders o
      JOIN products p ON p.id = o.product_id
     WHERE o.status = 'preparing'
       AND p.type = 'shawl'
       AND o.needs_pressing = FALSE
       -- The routing change. A shawl created after it already carries the right flag; if one
       -- ever appears here again that is a LIVE bug and must stay visible, not be swept up.
       AND o.created_at < DATE '2026-07-16'
       AND NOT EXISTS (
             SELECT 1 FROM staff_activity_log l
              WHERE l.order_id = o.id
                AND (l.from_stage = 'pressing' OR l.to_stage = 'pressing'))
       AND NOT EXISTS (
             SELECT 1 FROM audit_log a
              WHERE a.entity = 'order' AND a.entity_id = o.id
                AND a.action IN ('status_change', 'status_revert')
                AND (a.details->>'to' = 'pressing' OR a.details->>'from' = 'pressing'));

  SELECT count(*) INTO v_moved FROM _legacy_shawls;
  IF v_moved = 0 THEN
    RAISE NOTICE '102: nothing to move — already applied, or no legacy shawls on this database';
    RETURN;
  END IF;

  INSERT INTO legacy_pressing_restore_log (batch_id, order_id, old_status, new_status, old_needs_pressing)
  SELECT v_batch, id, 'preparing', 'pressing', FALSE FROM _legacy_shawls;

  UPDATE orders o
     SET status = 'pressing',
         needs_pressing = TRUE,
         working_staff_id = NULL, working_since = NULL
    FROM _legacy_shawls t
   WHERE o.id = t.id;

  -- No human did this, and none may be named — the whole finding was that a routing change was
  -- being read as a worker's mistake.
  INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
  SELECT NULL, 'status_change', 'order', id,
         jsonb_build_object(
           'by', 'migration:102-legacy-shawls',
           'from', 'preparing', 'to', 'pressing',
           'needs_pressing', 'false→true',
           'reason', 'shawl_flagged_no_pressing_before_2026_07_15_routing_change',
           'batch_id', v_batch)
    FROM _legacy_shawls;

  -- `route_fix`, not 'advance': payroll and staff goals count
  -- `action IN ('advance','approve_design')`, and this is nobody's work. StageHistoryCard prints
  -- it as «تصحيح مسار آلي» so the NULL user never renders as «غير معروف».
  INSERT INTO staff_activity_log (user_id, action, order_id, from_stage, to_stage)
  SELECT NULL, 'route_fix', id, 'preparing', 'pressing' FROM _legacy_shawls;

  RAISE NOTICE '102: moved % legacy شال back to الكوي and corrected its flag — batch %', v_moved, v_batch;
END
$legacy102$;

COMMIT;

-- UNDO — keyed on the flag column, which is what tells 102's rows apart from 101's. Not on
-- batch_id: 101's live rows each carry their own (see that file's header), so batch is a
-- grouping here and never the key to a rollback.
--
--   UPDATE orders o
--      SET status = l.old_status::order_status, needs_pressing = l.old_needs_pressing
--     FROM legacy_pressing_restore_log l
--    WHERE o.id = l.order_id AND l.old_needs_pressing IS NOT NULL
--      AND o.status::text = l.new_status;
--   DELETE FROM staff_activity_log
--    WHERE action = 'route_fix'
--      AND order_id IN (SELECT order_id FROM legacy_pressing_restore_log
--                        WHERE old_needs_pressing IS NOT NULL);
