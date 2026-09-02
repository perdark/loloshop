-- 100 — الشال الأمريكي صار قطعة على خط الإنتاج (2026-09-01)
--
-- ⚠️ WHY THIS IS NOT A ROW IN `orders`, AND MUST NEVER BECOME ONE.
--
-- الشال الأمريكي is a WHOLE GARMENT — the workshop cuts it, closes it, presses it and bags
-- it exactly like a retail شال (owner: «the stages for shawl for wholesaler staff are same
-- for retail staff»). But for a rep-linked student it is sold as an ADD-ON PRICE on the
-- وشاح: `lib/fullSetOrder.js:119` writes «إضافة: شال امريكي» and `:375` writes the spec line
-- «شال امريكي», both onto the SASH order, and no shawl order is ever created. Measured on
-- the dev DB: 253 carriers, every one a sash, every one a rep student.
--
-- The obvious fix — create a real شال order — was REFUSED by the owner: «i dont want to
-- change anything for wholesalers or wholesalers students». And it really would, even at
-- price 0:
--   · `wholesalerController.js:429` builds the rep's own order list with
--     STRING_AGG(p.name_ar), so every طقم would start reading «روب، قبعة، وشاح، شال».
--   · `wholesalerController.js:126` shows «آخر حالة» as the student's NEWEST order, so a new
--     row would become the status the rep sees.
--   · `uq_orders_student_product_nodesign` would collide the moment one student has two
--     sashes carrying a shawl.
--   · `configureFullSet` DELETEs and rebuilds a طقم's rows — the same path that destroyed
--     the calligraphy plates (migration 080) — so the piece would have to survive it.
--
-- So the piece's own stage lives HERE and nowhere else. Not one rep-facing query changes,
-- because not one of them reads this table. The money stays entirely on the sash.
--
-- ⚠️ THIS TABLE HOLDS A STAGE, NOT A PRICE. It has no price/cost column and must never grow
-- one: the shawl is already paid for on its carrier, and a second money row would double it
-- in `lib/counts.js`'s shop income the day someone joins the two.

CREATE TABLE IF NOT EXISTS sash_shawl_pieces (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The carrier وشاح. UNIQUE: one شال per sash, which is what the form offers (a yes/no
  -- toggle, `fullSetOrder.js:213`). CASCADE so deleting the sash takes its shawl with it —
  -- the piece has no meaning without the order that sold it.
  order_id         UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  -- Same enum as `orders.status` on purpose: the piece walks the same stages as a retail
  -- شال, so every label, chip and state-machine rule reads one vocabulary.
  status           order_status NOT NULL DEFAULT 'pressing',
  working_staff_id UUID REFERENCES users(id) ON DELETE SET NULL,
  working_since    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sash_shawl_pieces_status ON sash_shawl_pieces(status);
CREATE INDEX IF NOT EXISTS idx_sash_shawl_pieces_working
  ON sash_shawl_pieces(working_staff_id) WHERE working_staff_id IS NOT NULL;

-- ── BACKFILL ──────────────────────────────────────────────────────────────────────────
-- ⚠️ REPEATED IN db/schema.sql ON PURPOSE — the 077/080/093 pattern. `npm run migrate`
-- applies schema.sql to a database that ALREADY holds these 253 carriers, so the table
-- would be created empty and every existing shawl would stay invisible. Do not tidy it out.
--
-- `status = 'pressing'` for every one of them, because that is where a plain non-cap piece
-- is born (`orderController.js:664`, commit 4176fb3) and the owner's rule is that these
-- follow the retail شال exactly. A cancelled carrier gets NO piece — there is nothing to
-- make. Approval is deliberately NOT considered here: the queue inherits the carrier's
-- `wholesaler_approval` gate at read time, so an unapproved shawl is hidden by the same
-- rule that hides its sash rather than by a status this table would have to keep in sync.
INSERT INTO sash_shawl_pieces (order_id, status)
SELECT o.id, 'pressing'::order_status
  FROM orders o
 WHERE o.status <> 'cancelled'
   AND EXISTS (
     SELECT 1 FROM order_items oi
      WHERE oi.order_id = o.id
        AND (oi.label_snapshot ILIKE '%شال%امريكي%' OR oi.label_snapshot ILIKE '%شال%أمريكي%')
        AND oi.label_snapshot NOT ILIKE 'إضافة:%'
   )
ON CONFLICT (order_id) DO NOTHING;
