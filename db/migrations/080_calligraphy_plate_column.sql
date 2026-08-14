-- 080: give the AI calligraphy plate its OWN column, and stop it eating the student's photo.
--
-- THE BUG THIS CLOSES. `order_items.customer_image_url` held two different things under one
-- name: the reference photo the STUDENT uploaded, and the plate the calligraphy generator
-- produced. `lib/calligraphyEngine.autoLinkPlate` wrote it unconditionally —
--
--     UPDATE order_items SET customer_image_url = $2 WHERE id = $1
--
-- — so every generate / reroll / compose overwrote the photo, and the old URL was saved
-- nowhere. Measured on prod 2026-08-13: 459 order lines now hold a plate where a photo was,
-- across 628 link events (169 lines overwritten more than once). 27 of them carry text that
-- refers to the photo that was deleted — «نفس الصوره» · «تطريز هذه الصورة فقط» · «نفس الي
-- بالصورة بس اصغر». The generator rendered those WORDS as calligraphy and deleted the image
-- they pointed at.
--
-- After this migration the two meanings are two columns:
--   · customer_image_url — what the STUDENT uploaded. Only the order/cart/edit paths write it.
--   · plate_image_url    — what the GENERATOR produced. Only the calligraphy paths write it.
-- Readers that want "the artwork to embroider" take COALESCE(plate_image_url,
-- customer_image_url); readers that want "what the student sent us" take customer_image_url.
--
-- THE BACKFILL IS THE POINT, not a convenience. Without it the 459 damaged lines keep a plate
-- sitting in the customer's column, every reader keeps showing a machine plate labelled as the
-- student's reference, and the recovery report cannot tell a surviving photo from a plate. The
-- move is safe because it only fires when the column's value is EXACTLY equal to a plate_path
-- this line's own calligraphy_plates row recorded — a real photo can never match that.
--
-- ⚠️ NOTHING HERE RECOVERS THE DELETED PHOTOS. The files are still on disk
-- (/var/www/loloshop/uploads/images — 5,240 files, 3,365 unreferenced) but which file belonged
-- to which line is not in the database any more. `backend/scripts/calligraphy-photo-recovery.js`
-- proposes matches by mtime for the owner to confirm. It deletes nothing, and neither does this.

BEGIN;

-- The generated calligraphy plate for this order line. NULL = no plate yet.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS plate_image_url TEXT;

-- Move every linked plate out of the customer's column.
-- Idempotent twice over: the `plate_image_url IS NULL` guard skips lines already migrated, and
-- after the first run customer_image_url is NULL so the equality can never match again.
UPDATE order_items oi
   SET plate_image_url    = oi.customer_image_url,
       customer_image_url = NULL
  FROM calligraphy_plates cp
 WHERE cp.order_item_id = oi.id
   AND cp.plate_path IS NOT NULL
   AND cp.plate_path = oi.customer_image_url
   AND oi.plate_image_url IS NULL;

-- «إعادة التوليد» was uncapped: each press was a fresh paid image on the same plate row, with
-- nothing recording how many had been spent. cost_usd already accumulated; this counts the
-- presses so calligraphyController.reroll can refuse the eleventh.
ALTER TABLE calligraphy_plates ADD COLUMN IF NOT EXISTS reroll_count INTEGER NOT NULL DEFAULT 0;

COMMIT;
