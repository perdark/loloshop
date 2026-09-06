-- Migration 105 — «ملاحظة» belongs to the PARENT product only.
--
-- THE REAL BUG BEHIND «two note boxes on every sash and cap», and the one 104 did not fix.
--
-- `catalogController.buildProductFull` loads a product's option groups as **parent groups
-- first, then the child's own** — a variant inherits everything its parent offers. 103 seeded
-- the note onto every active قبعة/وشاح, parents and variants alike, so وشاح الفراشة ended up
-- showing وشاح's note (inherited) AND its own. Two identical boxes, one under the other.
--
-- ⚠️ NOTHING WAS EVER DUPLICATED IN THE DATABASE, and that is the part worth remembering. Every
-- product held exactly one row (measured on prod: 19 groups, 19 products, one each). 104 was
-- written from the API's output and chased a duplicate that did not exist — its DELETE matched
-- nothing. The lesson: `/api/catalog/products/:id/full` is a COMPOSED view, not a table dump,
-- so a count taken from it is a count of what the configurator renders, never of what is
-- stored. Read the table before writing a migration against a symptom seen through an endpoint.
-- 104's unique index is kept: still true, still cheap, and it does bound the real table.
--
-- Measured before writing this: 16 child groups are redundant, **0 of them carry a single
-- order_item** — so nothing a student has typed is affected. The `NOT EXISTS … order_items`
-- guard below is kept anyway, because `order_items.group_id` is ON DELETE SET NULL: if this
-- ever runs somewhere a note HAS been used, the row is left alone (one visible duplicate) in
-- preference to silently unhooking a student's text from its group.

-- ── STEP 1: drop the note from any product that already inherits one ─────────────────────
DELETE FROM option_groups g
 USING products p
 WHERE g.product_id = p.id
   AND g.name_ar = 'ملاحظة'
   AND p.parent_id IS NOT NULL
   AND EXISTS (
         SELECT 1 FROM option_groups pg
          WHERE pg.product_id = p.parent_id AND pg.name_ar = 'ملاحظة'
       )
   AND NOT EXISTS (
         SELECT 1 FROM order_items oi WHERE oi.group_id = g.id
       );

-- ── STEP 2: teach 103's seed the same rule ──────────────────────────────────────────────
-- 103's copy in `db/schema.sql` runs on EVERY deploy. Without this the next deploy re-adds a
-- note to every variant and the second box comes back — the seed's own guard only asks whether
-- THIS product has one, which was exactly the blind spot. Patched at the source in schema.sql;
-- this comment is here so a reader of the migration history knows where the rule now lives.
--
-- A variant whose parent is NOT a قبعة/وشاح (so the parent never got a note) still gets its own
-- here — inheritance gives it nothing to inherit.
