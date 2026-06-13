-- Migration 024: admin-editable customer text prompt per group / option
-- When requires_customer_text is TRUE, this prompt is shown to the student
-- instead of the hardcoded "اكتب تفاصيل التطريز" label.
ALTER TABLE option_groups ADD COLUMN IF NOT EXISTS customer_text_prompt_ar TEXT;
ALTER TABLE options       ADD COLUMN IF NOT EXISTS customer_text_prompt_ar TEXT;
