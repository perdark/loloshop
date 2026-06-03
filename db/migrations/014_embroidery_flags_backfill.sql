-- Migration 014 — data backfill for already-seeded catalogs.
-- seed-v2.js encodes the desired end-state for FRESH seeds; this flips the flags
-- and renames on EXISTING databases by Arabic label match. Idempotent.

BEGIN;

-- Cap embroidery: side/top now require a typed instruction + a reference image.
UPDATE options o
   SET requires_customer_text = TRUE, requires_customer_image = TRUE
  FROM option_groups g, products p
 WHERE o.group_id = g.id AND g.product_id = p.id
   AND p.type = 'cap' AND g.name_ar = 'تطريز القبعة'
   AND o.label_ar IN ('من الجانب', 'من الأعلى');

-- Robe sleeve embroidery: same requirement.
UPDATE options o
   SET requires_customer_text = TRUE, requires_customer_image = TRUE
  FROM option_groups g, products p
 WHERE o.group_id = g.id AND g.product_id = p.id
   AND p.type = 'robe' AND g.name_ar = 'تطريز الأكمام (ردان)'
   AND o.label_ar = 'تطريز ردن';

-- Pleat → pleats rename on the robe (label only; behaviour unchanged).
UPDATE option_groups g
   SET name_ar = 'كسرات'
  FROM products p
 WHERE g.product_id = p.id AND p.type = 'robe' AND g.name_ar = 'كسرة';
UPDATE options o
   SET label_ar = 'كسرات'
  FROM option_groups g, products p
 WHERE o.group_id = g.id AND g.product_id = p.id
   AND p.type = 'robe' AND g.name_ar = 'كسرات' AND o.label_ar = 'مع كسرة';

-- Add the cap pleats group (owner can rename) if it does not already exist.
INSERT INTO option_groups (product_id, name_ar, input_type, sort, required)
SELECT p.id, 'كسرات القبعة', 'toggle', 90, FALSE
  FROM products p
 WHERE p.type = 'cap'
   AND NOT EXISTS (
     SELECT 1 FROM option_groups g WHERE g.product_id = p.id AND g.name_ar = 'كسرات القبعة'
   );
INSERT INTO options (group_id, label_ar, price_delta, sort)
SELECT g.id, 'مع كسرات', 0, 0
  FROM option_groups g JOIN products p ON p.id = g.product_id
 WHERE p.type = 'cap' AND g.name_ar = 'كسرات القبعة'
   AND NOT EXISTS (
     SELECT 1 FROM options o WHERE o.group_id = g.id AND o.label_ar = 'مع كسرات'
   );

COMMIT;
