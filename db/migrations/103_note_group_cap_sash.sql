-- Migration 103 — «ملاحظة» : an optional free-text note on every قبعة and وشاح, retail only.
--
-- Owner ask, 2026-09-06: «on cap and sash we want to add a ملاحظة … for retail students».
--
-- WHY THIS IS A MIGRATION AND NOT ADMIN CLICKS. It is 20 products on the dev copy, so it is
-- 20 groups + 20 options done by hand, twice (once per environment), with the is_embroidery
-- tick below to remember on every single one. One missed tick routes that product's orders
-- into التطريز with nothing to stitch — see the warning on that column.
--
-- ⚠️ `is_embroidery = FALSE` IS THE WHOLE SAFETY OF THIS MIGRATION (migration 096).
-- `orderController.priceSelections` (`orderController.js:577`) reads ANY group carrying
-- customer text as design work and routes the piece التصميم → التطريز. A note is a message to
-- the shop, never artwork. The column is nullable and **NULL means YES, embroidery**, so the
-- flag has to be written explicitly FALSE here — leaving it unset would repeat the شال امريكي
-- incident exactly: 468 orders sent to التطريز where the embroiderer's checklist correctly
-- showed zero zones, and they sat there for two months.
--
-- ⚠️ `price_role_restriction = 'retail'` MEANS «الطلاب العاديين فقط» (migration 092), which is
-- what the owner asked for. It is not a display filter — `catalogController` hides the group
-- from the configurator AND `orderController` refuses it on the order path, so a hand-posted
-- group_id from a rep-linked student is rejected too. A rep-linked student's price role is
-- 'wholesaler', which is precisely why 'retail' is the value that means «not them».
--
-- ⚠️ `required = FALSE`. A required note would block checkout for every student with nothing
-- to say, on every sash and cap in the shop.
--
-- IDEMPOTENCE, AND WHY IT IS BY NAME. This block is repeated in `db/schema.sql`, which
-- `scripts/deploy.sh` re-applies on EVERY deploy (the 077/080/093 pattern). The guard is
-- «this product has no group called ملاحظة», deliberately ignoring `active` — so if an admin
-- later switches the note off, or renames its prompt, the next deploy leaves that decision
-- alone instead of silently recreating or reverting it. Same reasoning as 093's seed.
--
-- NOTE FOR A FUTURE PRODUCT. This runs once. A قبعة or وشاح added AFTER this migration gets no
-- note group; the admin adds it on `/admin/products` (tick «كتابة مطلوبة من الزبون», tick
-- «صورة منتج فقط — ما تروح للتصميم/التطريز», set «يظهر لـ» = الطلاب العاديين فقط).

WITH targets AS (
    SELECT p.id
      FROM products p
     WHERE p.type IN ('cap', 'sash')
       AND p.active = TRUE
       AND NOT EXISTS (
             SELECT 1 FROM option_groups g
              WHERE g.product_id = p.id AND g.name_ar = 'ملاحظة'
           )
), created AS (
    INSERT INTO option_groups
        (product_id, name_ar, input_type, sort, required, requires_customer_text,
         customer_text_prompt_ar, customer_text_placeholder_ar, price_role_restriction,
         is_embroidery)
    SELECT t.id, 'ملاحظة', 'single_select', 900, FALSE, TRUE,
           'ملاحظة للمحل (اختياري)',
           'مثال: أريد الاسم بخط أعرض',
           'retail'::price_role,
           FALSE
      FROM targets t
    RETURNING id
)
-- The sole option exists so the typed text has a row to hang on: `order_items` is keyed by
-- (group_id, option_id), and the configurator auto-selects this option rather than showing it
-- (see OptionGroupField's typed-field list). price_delta 0 — a note is never a paid extra.
INSERT INTO options (group_id, label_ar, price_delta, sort)
SELECT c.id, 'ملاحظة', 0, 0 FROM created c;
