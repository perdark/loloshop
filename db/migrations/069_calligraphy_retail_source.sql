-- db/migrations/069_calligraphy_retail_source.sql
-- New plate source: 'retail'.
--
-- Retail (تجزئة) students were structurally invisible to the calligraphy tool: poolFor()
-- matches four EXACT rep-form labels ('تطريز الوشاح من الأمام' …), while retail orders carry
-- their own labels ('تطريز يمين: تطريز يمين', 'القبعة من الجانب: بكتابة' …). Designers worked
-- around it by copying each name into «لصق أسماء» — which produces source='typed' plates with
-- order_item_id = NULL, i.e. orphans that can never auto-link or be «تحويل للتطريز».
--
-- Retail plates are reviewed one student at a time BEFORE generation (owner rule: ممثل =
-- generate in bulk then review; تجزئة = review then generate), because retail customer_text is
-- free-form instruction ("تطريز من اليمين الدكتورة بان مع حرف ح") that a designer must clean
-- into the actual text to render. That cleaned text lives ONLY on the plate — the order's
-- customer_text is never rewritten.
DO $$ BEGIN
  ALTER TYPE calligraphy_source ADD VALUE IF NOT EXISTS 'retail';
EXCEPTION WHEN undefined_object THEN NULL; END $$;
