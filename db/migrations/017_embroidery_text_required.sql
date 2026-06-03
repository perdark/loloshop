-- Migration 017 — enable the typed embroidery instruction (customer_text) on the
-- robe sleeve + cap embroidery options so the configurator shows a text box when
-- the student picks one. Migration 014 also forced a reference image; here we want
-- the TEXT field only (no mandatory image upload). Idempotent — match by label.

BEGIN;

-- Robe sleeve embroidery (تطريز الأكمام / ردان): typing the embroidery text is required.
UPDATE options o
   SET requires_customer_text = TRUE
  FROM option_groups g, products p
 WHERE o.group_id = g.id AND g.product_id = p.id
   AND p.type = 'robe' AND g.name_ar = 'تطريز الأكمام (ردان)'
   AND o.label_ar = 'تطريز ردن';

-- Cap embroidery (تطريز القبعة): side/top placements require the typed text.
-- 'بدون' (none) stays text-free.
UPDATE options o
   SET requires_customer_text = TRUE
  FROM option_groups g, products p
 WHERE o.group_id = g.id AND g.product_id = p.id
   AND p.type = 'cap' AND g.name_ar = 'تطريز القبعة'
   AND o.label_ar IN ('من الجانب', 'من الأعلى');

COMMIT;
