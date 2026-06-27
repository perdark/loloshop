-- 050: Retail cap photo — optional reference photo upload on cap products.
--
-- Adds a single-option, OPTIONAL-image option group «صورة القبعة» to every TOP-LEVEL cap
-- (parent_id IS NULL). Children inherit it via catalogController.getProductFull's
-- parent+own group merge — so it must live ONLY on the parent (adding to children too would
-- render the field twice, per the sash inheritance gotcha in migration 040).
--
-- requires_customer_image = FALSE → the photo is OPTIONAL (a plain «قبعة سادة» needs none).
-- The retail product page renders it like a sash embroidery zone: the sole option is
-- auto-selected and the selector hidden, leaving just the photo picker. The wholesaler
-- full-set cap is UNAFFECTED — that path (lib/fullSetOrder.js) builds cap spec lines by hand
-- and never reads cap option groups. Idempotent.
DO $$
DECLARE
  cap RECORD;
  gid UUID;
BEGIN
  FOR cap IN SELECT id FROM products WHERE type = 'cap' AND parent_id IS NULL LOOP
    IF NOT EXISTS (
      SELECT 1 FROM option_groups WHERE product_id = cap.id AND name_ar = 'صورة القبعة'
    ) THEN
      INSERT INTO option_groups (product_id, name_ar, input_type, sort, required, requires_customer_image)
      VALUES (cap.id, 'صورة القبعة', 'single_select', 50, FALSE, FALSE)
      RETURNING id INTO gid;
      INSERT INTO options (group_id, label_ar, price_delta, sort)
      VALUES (gid, 'قبعة', 0, 0);
    END IF;
  END LOOP;
END $$;
