-- Migration 104 — one «ملاحظة» per product, enforced by the database.
--
-- WHAT HAPPENED. Migration 103 shipped on 2026-09-06 and every active قبعة/وشاح on production
-- came out with **TWO** identical note groups — measured through the public catalog API, 16 of
-- 16 products, both rows carrying the same prompt, the same sort 900, the same
-- `is_embroidery = FALSE`. Two note boxes, one above the other, on every sash and cap page.
--
-- WHY IT IS NOT UNDERSTOOD, AND WHY THIS FIX IS SHAPED THE WAY IT IS. 103's seed is guarded by
-- `NOT EXISTS (… name_ar = 'ملاحظة')` and it is genuinely idempotent: run once against a
-- database with no note groups it produces exactly one per product (reproduced on the local
-- copy — cleared the groups, replayed the block from `db/schema.sql`, got 18 products × 1), and
-- run twice it adds nothing (19 → 19). `scripts/deploy.sh` applies `db/schema.sql` exactly once
-- and the deploy log for run 34040303839 shows exactly one «apply schema». `db/schema.sql` on
-- `origin/main` carries the block once. Every one of those was checked, and none of them
-- explains the second row.
--
-- So this migration does NOT try to out-argue the evidence. A guard that reads before it writes
-- is a race by construction: two connections both see «no group exists» and both insert, and no
-- amount of re-reading the SQL makes that impossible. A UNIQUE INDEX does. The lesson worth
-- keeping: for a seed that must be singular, the guard belongs in the SCHEMA, not in the
-- statement — the statement's guard is an optimisation, the index is the rule.
--
-- ⚠️ ORDER OF THE TWO STEPS IS LOAD-BEARING: de-duplicate first, then add the index. Creating
-- the index first fails on the existing duplicates and takes the whole deploy down with it.

-- ── STEP 1: keep ONE note group per product ──────────────────────────────────────────────
-- ⚠️ WHICH ONE IS KEPT IS A DATA DECISION, NOT A COIN FLIP. `order_items.group_id` is
-- ON DELETE SET NULL, so deleting the wrong row does not delete a student's note — it silently
-- unhooks it from its group, leaving the typed text in `order_items.customer_text` pointing at
-- nothing. The note group has been live on production for about an hour, which is long enough
-- for a real student to have typed into it. So: keep whichever row ORDERS ACTUALLY REFERENCE,
-- and only fall back to the oldest when neither has been used.
WITH ranked AS (
    SELECT g.id,
           g.product_id,
           row_number() OVER (
             PARTITION BY g.product_id
             ORDER BY (SELECT count(*) FROM order_items oi WHERE oi.group_id = g.id) DESC,
                      g.created_at ASC,
                      g.id ASC
           ) AS rn
      FROM option_groups g
     WHERE g.name_ar = 'ملاحظة'
)
DELETE FROM option_groups g
 USING ranked r
 WHERE g.id = r.id
   AND r.rn > 1;

-- ── STEP 2: make a second one impossible ─────────────────────────────────────────────────
-- Partial on purpose. A product legitimately carries many groups, and other groups repeat a
-- name across products; this says only «a product has at most one ملاحظة». Any future re-run
-- of 103's seed — from `db/schema.sql`, from a replayed migration, from two of them at once —
-- now fails loudly on the constraint instead of quietly doubling the box, and the seed's own
-- NOT EXISTS keeps that from ever being reached on the normal path.
CREATE UNIQUE INDEX IF NOT EXISTS option_groups_one_note_per_product
    ON option_groups (product_id)
 WHERE name_ar = 'ملاحظة';
