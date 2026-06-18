-- Migration 029 — multi-role staff: one employee can hold several production roles
-- (e.g. تصميم + تطريز + مفصل). `staff_types[]` is the authoritative set; the existing
-- `users.staff_type` column is kept in sync as the PRIMARY role (= staff_types[1]) so
-- every legacy single-role read (auth, queues, monitor) keeps working unchanged.
--
-- Run AFTER 028 (needs the 'tailor' value to exist for runtime writes; this file itself
-- never references 'tailor' as data, so it is transaction-safe regardless).
ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_types staff_type[];

-- Backfill: existing single-role staff → a one-element array.
UPDATE users
   SET staff_types = ARRAY[staff_type]::staff_type[]
 WHERE role = 'staff'
   AND staff_type IS NOT NULL
   AND (staff_types IS NULL OR cardinality(staff_types) = 0);
