BEGIN;

CREATE TABLE IF NOT EXISTS staff_attendance_user_settings (
  user_id                    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  start_time                 TIME NOT NULL,
  end_time                   TIME NOT NULL,
  grace_minutes              INTEGER NOT NULL DEFAULT 15 CHECK (grace_minutes >= 0),
  deduction_per_minute       BIGINT NOT NULL DEFAULT 0 CHECK (deduction_per_minute >= 0),
  updated_by                 UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_user_settings_updated
  ON staff_attendance_user_settings(updated_at DESC);

COMMIT;
