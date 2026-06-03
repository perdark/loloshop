-- Migration 013 — batch: signup fields, embroidery text, robe measurements,
-- production routing flags, staff presence, final design, salary + activity.
-- Run AFTER 012 (needs study_type + salary_txn_type). Idempotent.

BEGIN;

-- Signup: add study schedule + Instagram (university_name + department already exist).
ALTER TABLE students ADD COLUMN IF NOT EXISTS study_type study_type;
ALTER TABLE students ADD COLUMN IF NOT EXISTS instagram_username TEXT;

-- Embroidery options require a free-text instruction in addition to an image.
ALTER TABLE option_groups ADD COLUMN IF NOT EXISTS requires_customer_text BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE options       ADD COLUMN IF NOT EXISTS requires_customer_text BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE order_items   ADD COLUMN IF NOT EXISTS customer_text TEXT;

-- Robe tailoring measurements (فصال الروب) in cm — not priced.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS measurements JSONB;
ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS measurements JSONB;

-- Production routing flags, computed at order creation.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS has_embroidery BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS needs_pressing BOOLEAN NOT NULL DEFAULT FALSE;

-- Staff presence (admin monitor + soft lock).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS working_staff_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS working_since TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_orders_working_staff ON orders(working_staff_id) WHERE working_staff_id IS NOT NULL;

-- Final design image (works for all product types incl. design_id IS NULL).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS final_design_url TEXT;

-- Backfill routing flags for pre-existing orders (best effort).
UPDATE orders SET has_embroidery = TRUE, needs_pressing = TRUE
  WHERE design_id IS NOT NULL AND has_embroidery = FALSE AND needs_pressing = FALSE;

-- Staff payroll.
CREATE TABLE IF NOT EXISTS staff_salaries (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  base_salary BIGINT NOT NULL DEFAULT 0 CHECK (base_salary >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS staff_salary_transactions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       salary_txn_type NOT NULL,
  amount     BIGINT NOT NULL CHECK (amount >= 0),
  reason_ar  TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_salary_txn_user ON staff_salary_transactions(user_id, created_at DESC);

-- Staff activity log.
CREATE TABLE IF NOT EXISTS staff_activity_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action     TEXT NOT NULL,
  order_id   UUID REFERENCES orders(id) ON DELETE SET NULL,
  from_stage TEXT,
  to_stage   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_activity_user ON staff_activity_log(user_id, created_at DESC);

COMMIT;
