-- Migration 037 — «لون التطريز» (embroidery/thread color) as a REQUIRED TYPED TEXT field.
-- Mirrors the «اللون» (sash color, migration 031) mechanism but text-only (no photo).
--
-- (a) INSERT the «لون التطريز» option group on every sash product that ALREADY has an active
--     «اللون» group (currently only product 5bcab8b6-686c-44e9-85ec-75e80c4d2de6 «وشاح»).
--     Guarded by NOT EXISTS so re-running is safe.
--     required=TRUE, requires_customer_text=TRUE, requires_customer_image=FALSE, sort=1.
--
-- (b) INSERT one auto-select option for each new group:
--     active=TRUE, requires_customer_text=TRUE, requires_customer_image=FALSE, label_ar='لون التطريز'.
--     Guarded by NOT EXISTS.
--
-- (c) ALTER TABLE designs ADD COLUMN IF NOT EXISTS embroidery_color TEXT.

-- (a) Insert the option group on every sash product that already has an «اللون» group.
INSERT INTO option_groups (
  product_id,
  name_ar,
  input_type,
  sort,
  required,
  requires_customer_text,
  requires_customer_image,
  active,
  customer_text_prompt_ar,
  customer_text_placeholder_ar
)
SELECT DISTINCT
  og.product_id,
  'لون التطريز',
  'single_select'::option_input,
  1,
  TRUE,
  TRUE,
  FALSE,
  TRUE,
  'لون التطريز',
  'مثال: ذهبي، أبيض، أسود'
FROM option_groups og
JOIN products p ON p.id = og.product_id
WHERE p.type = 'sash'
  AND og.name_ar = 'اللون'
  AND og.active = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM option_groups x
    WHERE x.product_id = og.product_id
      AND x.name_ar = 'لون التطريز'
  );

-- (b) Insert one auto-select option for each newly inserted (or already present) «لون التطريز» group.
INSERT INTO options (
  group_id,
  label_ar,
  price_delta,
  sort,
  requires_customer_text,
  requires_customer_image,
  active
)
SELECT
  og.id,
  'لون التطريز',
  0,
  0,
  TRUE,
  FALSE,
  TRUE
FROM option_groups og
JOIN products p ON p.id = og.product_id
WHERE p.type = 'sash'
  AND og.name_ar = 'لون التطريز'
  AND og.active = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM options o WHERE o.group_id = og.id
  );

-- (c) Add embroidery_color column to designs (parallels designs.sash_color).
ALTER TABLE designs ADD COLUMN IF NOT EXISTS embroidery_color TEXT;
