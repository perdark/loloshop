-- db/migrations/046_calligraphy_element.sql
-- Cap "same-sheet element": an optional decorative motif word (فراشة/شجرة) drawn by the
-- AI right beside the name on the SAME sheet line, so it costs no extra image. NULL = name only.
ALTER TABLE calligraphy_plates
  ADD COLUMN IF NOT EXISTS element_text TEXT;
