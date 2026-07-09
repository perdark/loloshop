-- 059: Fix retail shawl note + photo intake.
--
-- Migration 058 created the correct «صورة الشال» group on every top-level shawl: ONE group
-- carrying an OPTIONAL reference photo AND an OPTIONAL note (customer_text_prompt 'ملاحظات',
-- both requires_* = FALSE, one auto-select option «شال»). Children inherit it via
-- catalogController.getProductFull's parent+own merge.
--
-- A stray «ملاحظة» group (single_select, NO options, requires_customer_text = TRUE) was later
-- added by accident on the shawl parent. It can NEVER render — a typed field needs an option to
-- attach the customer text to — and its requires_customer_text = TRUE would force a *required*
-- note. That is the "can't type a note / can't upload a photo" bug. Deactivate it; «صورة الشال»
-- is the single source for both, and the frontend renders both fields as optional. Idempotent.

UPDATE option_groups og
   SET active = FALSE
 WHERE og.active = TRUE
   AND og.name_ar = 'ملاحظة'
   AND og.product_id IN (SELECT id FROM products WHERE type = 'shawl' AND parent_id IS NULL)
   AND NOT EXISTS (SELECT 1 FROM options o WHERE o.group_id = og.id AND o.active = TRUE);

-- Belt-and-suspenders: «صورة الشال» stays optional for BOTH photo and note.
UPDATE option_groups og
   SET requires_customer_image = FALSE,
       requires_customer_text  = FALSE
 WHERE og.name_ar = 'صورة الشال'
   AND og.product_id IN (SELECT id FROM products WHERE type = 'shawl' AND parent_id IS NULL);
