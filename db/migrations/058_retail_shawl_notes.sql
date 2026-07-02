-- 058: Retail shawl photo + optional notes (ملاحظات).
--
-- Adds or updates an option group on every TOP-LEVEL shawl (parent_id IS NULL) so
-- students can attach a reference photo AND optional notes when ordering standalone
-- shawl products (e.g. «الشال الأمريكي للمفرد وجملة»). Children inherit via
-- catalogController.getProductFull's parent+own group merge — must live ONLY on parent.
-- Idempotent.

-- Existing image groups: add optional notes prompts.
UPDATE option_groups og
   SET customer_text_prompt_ar = 'ملاحظات',
       customer_text_placeholder_ar = 'أي تفاصيل إضافية للشال…',
       requires_customer_text = FALSE
 WHERE og.product_id IN (
         SELECT id FROM products WHERE type = 'shawl' AND parent_id IS NULL AND active = TRUE
       )
   AND og.active = TRUE
   AND (og.requires_customer_image = TRUE OR og.name_ar ILIKE '%شال%' OR og.name_ar ILIKE '%صورة%');

-- Products with no suitable group: insert «صورة الشال» with optional image + notes.
DO $$
DECLARE
  shawl RECORD;
  gid UUID;
BEGIN
  FOR shawl IN SELECT id FROM products WHERE type = 'shawl' AND parent_id IS NULL AND active = TRUE LOOP
    IF NOT EXISTS (
      SELECT 1 FROM option_groups
       WHERE product_id = shawl.id AND active = TRUE
    ) THEN
      INSERT INTO option_groups (
        product_id, name_ar, input_type, sort, required,
        requires_customer_text, requires_customer_image, active,
        customer_text_prompt_ar, customer_text_placeholder_ar
      )
      VALUES (
        shawl.id, 'صورة الشال', 'single_select', 50, FALSE,
        FALSE, FALSE, TRUE,
        'ملاحظات', 'أي تفاصيل إضافية للشال…'
      )
      RETURNING id INTO gid;
      INSERT INTO options (group_id, label_ar, price_delta, sort)
      VALUES (gid, 'شال', 0, 0);
    END IF;
  END LOOP;
END $$;
