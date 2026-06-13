-- Migration 025: admin-editable placeholder (example) for the customer text box.
-- customer_text_prompt_ar  = the bold question/title shown to the student.
-- customer_text_placeholder_ar = the faint example INSIDE the input box.
-- Lets admin write product-specific guidance (e.g. a sash color) instead of the
-- hardcoded name example "مثال: اسمي علي محمد…".
ALTER TABLE option_groups ADD COLUMN IF NOT EXISTS customer_text_placeholder_ar TEXT;
ALTER TABLE options       ADD COLUMN IF NOT EXISTS customer_text_placeholder_ar TEXT;
