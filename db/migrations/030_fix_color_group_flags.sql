-- Migration 030 — fix retail full-package ordering bug.
-- The sash color group «اللون» had group-level requires_customer_image = TRUE (and a
-- stray option-level requires_customer_text on a color). A color SWATCH picker must not
-- demand a customer-uploaded image or typed instruction — the package form has no upload
-- field for it, so every retail full-package order was falsely blocked with
-- "يرجى رفع صورة لـ اللون". Clear the flags on all color-picker groups (idempotent).
UPDATE option_groups
   SET requires_customer_image = FALSE,
       requires_customer_text  = FALSE
 WHERE input_type = 'single_select'
   AND name_ar IN ('اللون', 'لون الروب', 'لون القبعة', 'لون الوشاح', 'لون التطريز');

UPDATE options
   SET requires_customer_image = FALSE,
       requires_customer_text  = FALSE
 WHERE group_id IN (
   SELECT id FROM option_groups
    WHERE input_type = 'single_select'
      AND name_ar IN ('اللون', 'لون الروب', 'لون القبعة', 'لون الوشاح', 'لون التطريز')
 );
