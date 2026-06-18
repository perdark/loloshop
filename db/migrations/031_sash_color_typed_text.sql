-- Migration 031 — sash color becomes a TYPED free-text color + OPTIONAL photo.
-- Product decision: the sash «اللون» is no longer a fixed swatch list — the customer/rep
-- types the exact color (required) and may optionally attach a reference photo. This is
-- captured through the existing customer_text / customer_image_url plumbing (same mechanism
-- as embroidery zones), so no new columns are needed.
--
-- Scope: SASH color only (group name «اللون» on type='sash'). Robe/cap color groups keep
-- their real multi-swatch pickers — do NOT touch them.
--
-- requires_customer_text = TRUE  → the typed color is required and persisted to order_items.
-- requires_customer_image = FALSE → the photo stays optional (migration 030's fix preserved).
-- The single option on the group auto-selects in the UI so the pipeline always has an
-- option to attach the typed color + optional photo to.

UPDATE option_groups og
   SET requires_customer_text = TRUE,
       requires_customer_image = FALSE,
       customer_text_prompt_ar =
         COALESCE(NULLIF(og.customer_text_prompt_ar, ''), 'لون الوشاح'),
       customer_text_placeholder_ar =
         COALESCE(NULLIF(og.customer_text_placeholder_ar, ''),
                  'اكتب اللون بالضبط، مثال: أخضر زيتي غامق')
  FROM products p
 WHERE og.product_id = p.id
   AND p.type = 'sash'
   AND og.name_ar = 'اللون';

-- Mirror the flags onto the group's option(s) too — the full-set wizard validates/renders
-- customer-text at the OPTION level, so set both to keep every consumer consistent.
UPDATE options o
   SET requires_customer_text = TRUE,
       requires_customer_image = FALSE
  FROM option_groups og
  JOIN products p ON p.id = og.product_id
 WHERE o.group_id = og.id
   AND p.type = 'sash'
   AND og.name_ar = 'اللون';
