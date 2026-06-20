-- Migration 040 — RETAIL SASH becomes a typed-spec order (no more Fabric designer).
-- The retail sash designer (/design) is removed; students now order a sash like any product
-- and type its spec, exactly like the wholesaler sashes. The actual artwork is produced by
-- staff (who design every order and upload the final image) — these orders auto-route to
-- 'design_complete' because every sash carries required customer text (priceSelections sets
-- hasEmbroidery=TRUE → status 'design_complete').
--
-- This reuses the SAME customer_text / customer_image_url plumbing as migrations 031 («اللون»)
-- and 037 («لون التطريز»): one auto-select option per group, the typed value rides on
-- order_items.customer_text (+ optional order_items.customer_image_url). No backend changes.
--
-- Field set on EVERY sash product (identical across all sashes). Only the color is required:
--   • اللون            — REQUIRED typed color       + optional photo  (031 already set this on «وشاح»)
--   • لون التطريز      — OPTIONAL typed thread color (no photo)        (037 added it on «وشاح»)
--   • تطريز يسار       — OPTIONAL typed text         + optional photo
--   • تطريز يمين       — OPTIONAL typed text         + optional photo
--   • تطريز من الخلف   — OPTIONAL typed text         + optional photo
--
-- Labels embed يسار / يمين / خلف so the staff zone filters (orderController ORDER_ZONE_MATCH:
-- sash_left / sash_right / sash_back, ILIKE '%يسار%' / '%يمين%' / '%خلف%') match automatically.
--
-- INHERITANCE GOTCHA: sash "types" are sub-products (parent_id → a top-level sash), and the
-- catalog API (catalogController.getProductFull) MERGES a child's groups with its parent's
-- (`[...parentGroups, ...ownGroups]`). So the groups must live on the TOP-LEVEL sash ONLY
-- (`parent_id IS NULL`); children inherit them. Adding them to children too would render each
-- field TWICE. Hence every group INSERT below is scoped to `p.parent_id IS NULL`.
--
-- Idempotent: every INSERT is guarded by NOT EXISTS, so re-running is safe.

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper pattern (repeated per group): insert the option_group on every sash product
-- that lacks it, then insert its single auto-select option on every group that lacks one.
-- requires_customer_text / requires_customer_image are mirrored onto BOTH the group and the
-- option (the full-set wizard validates at the option level — see migration 031 note).
-- ─────────────────────────────────────────────────────────────────────────────

-- ===== (1) «اللون» — required typed color + optional photo =====
INSERT INTO option_groups (
  product_id, name_ar, input_type, sort, required,
  requires_customer_text, requires_customer_image, active,
  customer_text_prompt_ar, customer_text_placeholder_ar
)
SELECT p.id, 'اللون', 'single_select'::option_input, 2, TRUE,
       TRUE, FALSE, TRUE,
       'لون الوشاح', 'اكتب اللون بالضبط، مثال: أخضر زيتي غامق'
FROM products p
WHERE p.type = 'sash'
  AND p.parent_id IS NULL          -- top-level sashes ONLY; children inherit via the catalog API
  AND NOT EXISTS (
    SELECT 1 FROM option_groups x WHERE x.product_id = p.id AND x.name_ar = 'اللون'
  );

-- ===== (2) «لون التطريز» — required typed thread color (no photo) =====
INSERT INTO option_groups (
  product_id, name_ar, input_type, sort, required,
  requires_customer_text, requires_customer_image, active,
  customer_text_prompt_ar, customer_text_placeholder_ar
)
SELECT p.id, 'لون التطريز', 'single_select'::option_input, 3, FALSE,
       FALSE, FALSE, TRUE,
       'لون التطريز', 'مثال: ذهبي، أبيض، أسود'
FROM products p
WHERE p.type = 'sash'
  AND p.parent_id IS NULL          -- top-level sashes ONLY; children inherit via the catalog API
  AND NOT EXISTS (
    SELECT 1 FROM option_groups x WHERE x.product_id = p.id AND x.name_ar = 'لون التطريز'
  );

-- ===== (3) «تطريز يسار» — required typed text + optional photo =====
INSERT INTO option_groups (
  product_id, name_ar, input_type, sort, required,
  requires_customer_text, requires_customer_image, active,
  customer_text_prompt_ar, customer_text_placeholder_ar
)
SELECT p.id, 'تطريز يسار', 'single_select'::option_input, 4, FALSE,
       FALSE, FALSE, TRUE,
       'تطريز الجهة اليسرى', 'اكتب النص/الاسم المطلوب تطريزه على اليسار'
FROM products p
WHERE p.type = 'sash'
  AND p.parent_id IS NULL          -- top-level sashes ONLY; children inherit via the catalog API
  AND NOT EXISTS (
    SELECT 1 FROM option_groups x WHERE x.product_id = p.id AND x.name_ar = 'تطريز يسار'
  );

-- ===== (4) «تطريز يمين» — OPTIONAL typed text + optional photo =====
INSERT INTO option_groups (
  product_id, name_ar, input_type, sort, required,
  requires_customer_text, requires_customer_image, active,
  customer_text_prompt_ar, customer_text_placeholder_ar
)
SELECT p.id, 'تطريز يمين', 'single_select'::option_input, 5, FALSE,
       FALSE, FALSE, TRUE,
       'تطريز الجهة اليمنى', 'اكتب النص/الاسم المطلوب تطريزه على اليمين'
FROM products p
WHERE p.type = 'sash'
  AND p.parent_id IS NULL          -- top-level sashes ONLY; children inherit via the catalog API
  AND NOT EXISTS (
    SELECT 1 FROM option_groups x WHERE x.product_id = p.id AND x.name_ar = 'تطريز يمين'
  );

-- ===== (5) «تطريز من الخلف» — OPTIONAL typed text + optional photo =====
INSERT INTO option_groups (
  product_id, name_ar, input_type, sort, required,
  requires_customer_text, requires_customer_image, active,
  customer_text_prompt_ar, customer_text_placeholder_ar
)
SELECT p.id, 'تطريز من الخلف', 'single_select'::option_input, 6, FALSE,
       FALSE, FALSE, TRUE,
       'تطريز الخلف', 'اكتب النص/الاسم المطلوب تطريزه على الخلف'
FROM products p
WHERE p.type = 'sash'
  AND p.parent_id IS NULL          -- top-level sashes ONLY; children inherit via the catalog API
  AND NOT EXISTS (
    SELECT 1 FROM option_groups x WHERE x.product_id = p.id AND x.name_ar = 'تطريز من الخلف'
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- One auto-select option per sash typed-field group (label = group name). The option's
-- requires_customer_text/image mirror the group so every consumer is consistent. Guarded so
-- groups that already had an option (e.g. «وشاح»'s pre-existing «اللون»/«لون التطريز») are skipped.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO options (
  group_id, label_ar, price_delta, sort, requires_customer_text, requires_customer_image, active
)
SELECT og.id, og.name_ar, 0, 0,
       og.requires_customer_text, og.requires_customer_image, TRUE
FROM option_groups og
JOIN products p ON p.id = og.product_id
WHERE p.type = 'sash'
  AND og.name_ar IN ('اللون', 'لون التطريز', 'تطريز يسار', 'تطريز يمين', 'تطريز من الخلف')
  AND NOT EXISTS (SELECT 1 FROM options o WHERE o.group_id = og.id);
