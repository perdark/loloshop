-- 075: الخروج المؤقت — temporary leave during the shift, with a monthly allowance.
--
-- Money rule (implemented in backend/lib/attendanceBreak.js):
--   the monthly balance always decrements by the FULL real minutes of a break
--   free     = approved ? min(minutes, remaining_before_this_break) : 0
--   deducted = minutes - free
--   amount   = deducted * deduction_per_minute  (frozen on the row at return time)

BEGIN;

-- Monthly allowance, two-layer exactly like start_time/grace_minutes:
-- a global default plus an optional per-staff override (NULL = inherit global).
ALTER TABLE staff_attendance_settings
  ADD COLUMN IF NOT EXISTS break_monthly_minutes INTEGER NOT NULL DEFAULT 600
    CHECK (break_monthly_minutes >= 0);

ALTER TABLE staff_attendance_user_settings
  ADD COLUMN IF NOT EXISTS break_monthly_minutes INTEGER
    CHECK (break_monthly_minutes IS NULL OR break_monthly_minutes >= 0);

CREATE TABLE IF NOT EXISTS staff_attendance_breaks (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- a break only exists inside a day the worker actually stamped into
  attendance_id             UUID NOT NULL REFERENCES staff_attendance_records(id) ON DELETE CASCADE,
  work_date                 DATE NOT NULL,
  -- quota bucket: 'YYYY-MM' in the shop timezone, stamped from left_at (or request time)
  month_key                 TEXT NOT NULL CHECK (month_key ~ '^[0-9]{4}-[0-9]{2}$'),

  reason_ar                 TEXT,
  -- declared intent only; the quota is charged on real elapsed time
  requested_minutes         INTEGER CHECK (requested_minutes IS NULL OR requested_minutes > 0),
  requested_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at                   TIMESTAMPTZ,
  returned_at               TIMESTAMPTZ,
  minutes                   INTEGER NOT NULL DEFAULT 0 CHECK (minutes >= 0),

  state                     TEXT NOT NULL DEFAULT 'requested'
    CHECK (state IN ('requested', 'out', 'returned', 'cancelled')),
  approval                  TEXT NOT NULL DEFAULT 'pending'
    CHECK (approval IN ('pending', 'approved', 'rejected')),
  left_without_approval     BOOLEAN NOT NULL DEFAULT FALSE,
  decided_by                UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at                TIMESTAMPTZ,
  decision_note_ar          TEXT,

  free_minutes              INTEGER NOT NULL DEFAULT 0 CHECK (free_minutes >= 0),
  deducted_minutes          INTEGER NOT NULL DEFAULT 0 CHECK (deducted_minutes >= 0),
  -- frozen per row: changing the rate later never rewrites past charges
  deduction_per_minute      BIGINT NOT NULL DEFAULT 0 CHECK (deduction_per_minute >= 0),
  deduction_amount          BIGINT NOT NULL DEFAULT 0 CHECK (deduction_amount >= 0),
  deduction_transaction_id  UUID REFERENCES staff_salary_transactions(id) ON DELETE SET NULL,

  -- TRUE when بصمة خروج closed a break the worker forgot to end
  auto_closed               BOOLEAN NOT NULL DEFAULT FALSE,
  admin_note_ar             TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One live break per worker, enforced by the DB and not just by a JS check.
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_break_open
  ON staff_attendance_breaks(user_id)
  WHERE state IN ('requested', 'out');

CREATE INDEX IF NOT EXISTS idx_attendance_break_month
  ON staff_attendance_breaks(user_id, month_key);
CREATE INDEX IF NOT EXISTS idx_attendance_break_date
  ON staff_attendance_breaks(work_date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_break_record
  ON staff_attendance_breaks(attendance_id);
CREATE INDEX IF NOT EXISTS idx_attendance_break_pending
  ON staff_attendance_breaks(requested_at DESC)
  WHERE approval = 'pending' AND state <> 'cancelled';

COMMIT;
