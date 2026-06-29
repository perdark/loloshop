BEGIN;

ALTER TABLE staff_attendance_user_settings
  ADD COLUMN IF NOT EXISTS attendance_required BOOLEAN NOT NULL DEFAULT TRUE;

COMMIT;
