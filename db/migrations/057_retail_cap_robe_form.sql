-- 057: Retail cap/robe form improvements.
--
-- • Deactivate «صورة القبعة» (migration 050) — too generic; side/top groups carry optional photos instead.
-- • Deactivate «ردن الروب» single-select — replaced by optional left/right sleeve toggles.
-- • Add «تطريز ردن الروب الأيمن» / «تطريز ردن الروب الأيسر» toggle groups (+5000 each, text required when checked).
--
-- Top-level products ONLY (parent_id IS NULL); children inherit via catalog merge (migration 040 gotcha).
-- Idempotent.

-- ── Deactivate superseded groups ─────────────────────────────────────────────
UPDATE option_groups SET active = FALSE
 WHERE name_ar = 'صورة القبعة'
   AND product_id IN (SELECT id FROM products WHERE type = 'cap' AND parent_id IS NULL AND active = TRUE);

UPDATE option_groups SET active = FALSE
 WHERE name_ar = 'ردن الروب'
   AND product_id IN (SELECT id FROM products WHERE type = 'robe' AND parent_id IS NULL AND active = TRUE);

-- ── Robe sleeve toggles ──────────────────────────────────────────────────────
INSERT INTO option_groups (
  product_id, name_ar, input_type, sort, required,
  requires_customer_text, requires_customer_image, active,
  customer_text_prompt_ar, customer_text_placeholder_ar
)
SELECT p.id, 'تطريز ردن الروب الأيمن', 'toggle'::option_input,
       COALESCE((SELECT MAX(sort) + 1 FROM option_groups WHERE product_id = p.id), 90),
       FALSE, FALSE, FALSE, TRUE,
       'نص التطريز على الردن الأيمن', 'اكتب النص المطلوب تطريزه على الردن الأيمن'
FROM products p
WHERE p.type = 'robe' AND p.parent_id IS NULL AND p.active = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM option_groups x WHERE x.product_id = p.id AND x.name_ar = 'تطريز ردن الروب الأيمن'
  );

INSERT INTO option_groups (
  product_id, name_ar, input_type, sort, required,
  requires_customer_text, requires_customer_image, active,
  customer_text_prompt_ar, customer_text_placeholder_ar
)
SELECT p.id, 'تطريز ردن الروب الأيسر', 'toggle'::option_input,
       COALESCE((SELECT MAX(sort) + 2 FROM option_groups WHERE product_id = p.id), 91),
       FALSE, FALSE, FALSE, TRUE,
       'نص التطريز على الردن الأيسر', 'اكتب النص المطلوب تطريزه على الردن الأيسر'
FROM products p
WHERE p.type = 'robe' AND p.parent_id IS NULL AND p.active = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM option_groups x WHERE x.product_id = p.id AND x.name_ar = 'تطريز ردن الروب الأيسر'
  );

-- One option per toggle group (text required when the student checks the box).
INSERT INTO options (
  group_id, label_ar, price_delta, sort, requires_customer_text, requires_customer_image, active
)
SELECT og.id, 'تطريز الردن الأيمن', 5000, 0, TRUE, FALSE, TRUE
FROM option_groups og
JOIN products p ON p.id = og.product_id
WHERE p.type = 'robe' AND p.parent_id IS NULL
  AND og.name_ar = 'تطريز ردن الروب الأيمن'
  AND NOT EXISTS (SELECT 1 FROM options o WHERE o.group_id = og.id);

INSERT INTO options (
  group_id, label_ar, price_delta, sort, requires_customer_text, requires_customer_image, active
)
SELECT og.id, 'تطريز الردن الأيسر', 5000, 0, TRUE, FALSE, TRUE
FROM option_groups og
JOIN products p ON p.id = og.product_id
WHERE p.type = 'robe' AND p.parent_id IS NULL
  AND og.name_ar = 'تطريز ردن الروب الأيسر'
  AND NOT EXISTS (SELECT 1 FROM options o WHERE o.group_id = og.id);
