-- Migration 015 — staff incentive goals.
-- Admin sets a target (count + deadline + bonus); staff track progress;
-- bonus is auto-awarded as a salary 'bonus' transaction when the target is met. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS staff_goals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_ar     TEXT,
  target_count INTEGER NOT NULL CHECK (target_count > 0),
  bonus_amount BIGINT NOT NULL DEFAULT 0 CHECK (bonus_amount >= 0),
  deadline     TIMESTAMPTZ NOT NULL,
  awarded      BOOLEAN NOT NULL DEFAULT FALSE,
  awarded_at   TIMESTAMPTZ,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_goals_user ON staff_goals(user_id, created_at DESC);

COMMIT;
