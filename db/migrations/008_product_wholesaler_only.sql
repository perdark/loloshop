-- Migration 008: products that are visible ONLY to wholesaler-joined students
-- (students whose students.wholesaler_id IS NOT NULL) plus admin/staff/wholesaler
-- roles. Plain retail students and anonymous/public viewers never see them.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS wholesaler_only BOOLEAN NOT NULL DEFAULT FALSE;
