-- 111: «طلبك جاهز للاستلام» — one notification per SET, sent once.
--
-- WHY THIS EXISTS. On 2026-09-14 the per-stage notification to the student was paused
-- (backend/lib/studentOrderNotices.js): it fired once per PIECE for every internal move and
-- spoke the shop's own stage vocabulary. Pausing it left a hole — «طلباتي» promises
-- «راح نعلمك أول ما يخلص كامل» and nothing was going to. This column is what makes the
-- honest version possible: ONE notification, for the whole طقم, when every live piece in it
-- has reached ready.
--
-- ⚠️ THE BACKFILL IS NOT OPTIONAL, AND IT IS THE SAME TRAP AS 077's. The column starts NULL
-- and NULL means «not told yet», so without it the first order that completes after this
-- deploy would drag every student whose set was ALREADY ready into the same check and
-- notify them about garments they collected weeks ago. Measured on the 2026-09-12 restore
-- before writing this: 1,000+ orders already sit at ready/delivered.
--
-- ⚠️ AND THE BACKFILL RUNS EXACTLY ONCE, WHICH IS WHY IT IS INSIDE THE `IF NOT EXISTS`
-- BRANCH RATHER THAN BESIDE IT. This file is repeated in db/schema.sql, and
-- scripts/deploy.sh applies that file on EVERY deploy (the 2026-09-12 landmine: an
-- unguarded one-time UPDATE copied into schema.sql dragged 49 pressed orders back to الكوي,
-- every deploy, silently). A bare `UPDATE ... WHERE ready_notified_at IS NULL AND status IN
-- ('ready','delivered')` would look idempotent and would instead SUPPRESS the notification
-- for every set that went ready between two deploys. Keyed on the column's own creation,
-- it can never run a second time.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'orders' AND column_name = 'ready_notified_at'
  ) THEN
    -- When the student was told their SET is ready. NULL = not told. Stamped on every row of
    -- the set at once, so any row of it answers «هل انلغت الرسالة؟».
    ALTER TABLE orders ADD COLUMN ready_notified_at TIMESTAMPTZ;

    -- Everything already finished is retired as «already told», exactly like 077 retires
    -- pre-existing notification rows to 'skipped'. These students collected their orders
    -- long ago; there is nothing to announce.
    UPDATE orders SET ready_notified_at = now()
     WHERE status IN ('ready', 'delivered');
  END IF;
END $$;

COMMIT;
