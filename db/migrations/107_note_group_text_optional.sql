-- Migration 107 — «ملاحظة» is OPTIONAL text, not required text.
--
-- ⚠️ NUMBERED 107, NOT 106. This was written as 106 in an earlier session on the same day
-- that `106_assembly_stage.sql` was committed (itself renumbered 105 → 106 by cb76c14 for the
-- same reason). Two sessions kept claiming the next free number in parallel. Renumbered while
-- still unapplied to prod, which is the only moment renaming a migration is safe — an applied
-- one matches no history under a new name.
--
-- Owner, 2026-09-06: «the notes ملاحظة on the sash and cap is req, i want it optional».
--
-- WHAT 103 GOT WRONG. It set `required = FALSE` — correct, and it is what the note test
-- asserted — but ALSO `requires_customer_text = TRUE`. Those two columns answer different
-- questions and only the second one was reachable:
--   · `required`               → «must the student pick something in this group?»
--   · `requires_customer_text` → «having picked, must they type?»
-- The note group has exactly one option and the configurator AUTO-SELECTS it
-- (OptionGroupField's typed-field list, `group.nameAr === 'ملاحظة'`) so that the typed text
-- has a row to hang on. So the group was ALWAYS selected, `required = FALSE` never got a
-- chance to matter, and `priceSelections` (orderController.js ~line 554) refused every
-- checkout with an empty box: «يرجى كتابة التفاصيل المطلوبة لـ ملاحظة»
-- (`ERR_CUSTOMER_TEXT_REQUIRED`). Front end agreed — `validateCustomerTexts` blocked first
-- with «الكتابة مطلوبة: ملاحظة» — so it failed identically on both sides and looked deliberate.
--
-- ⚠️ THE TEXT IS STILL SAVED WHEN IT IS TYPED. `priceSelections` persists `customer_text` for
-- any group, required or not («Persist ANY text the customer typed» — the same rule that keeps
-- the optional sash zones working). Nothing about delivery of the note depends on this flag.
--
-- ⚠️ AND THE NOTE IS STILL NOT EMBROIDERY. `is_embroidery = FALSE` is untouched here and is
-- the whole safety of 103 — read its header before going near that column.
--
-- WHY THE PROMPT CHANGES TOO. The UI appends «(اختياري)» itself once the field is optional
-- (CustomerImageUpload), so the seeded prompt «ملاحظة للمحل (اختياري)» would print it twice.
--
-- IDEMPOTENCE, AND WHY THIS ONE IS SELF-LIMITING. This block is repeated in `db/schema.sql`,
-- which `scripts/deploy.sh` re-applies on EVERY deploy (the 077/080/093/103 pattern). Its
-- guard is the OLD seeded prompt, so it matches exactly once per database and is a no-op
-- forever after — which is what keeps it from reverting a later admin decision. An admin who
-- deliberately ticks «كتابة مطلوبة من الزبون» on the note keeps that tick; the guard cannot
-- match their row any more. Same reasoning as 093's `ON CONFLICT DO NOTHING`.

UPDATE option_groups
   SET requires_customer_text = FALSE,
       customer_text_prompt_ar = 'ملاحظة للمحل'
 WHERE name_ar = 'ملاحظة'
   AND customer_text_prompt_ar = 'ملاحظة للمحل (اختياري)';
