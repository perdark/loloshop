BEGIN;

ALTER TABLE staff_salary_transactions ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE staff_salary_transactions ADD COLUMN IF NOT EXISTS source_id UUID;
ALTER TABLE staff_salary_transactions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE staff_salary_transactions ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE staff_salary_transactions ADD COLUMN IF NOT EXISTS delete_reason_ar TEXT;
CREATE INDEX IF NOT EXISTS idx_salary_txn_active_user ON staff_salary_transactions(user_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS staff_attendance_settings (
  id                         BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  start_time                 TIME NOT NULL DEFAULT '09:00',
  end_time                   TIME NOT NULL DEFAULT '18:00',
  grace_minutes              INTEGER NOT NULL DEFAULT 15 CHECK (grace_minutes >= 0),
  deduction_per_minute       BIGINT NOT NULL DEFAULT 0 CHECK (deduction_per_minute >= 0),
  verification_mode          TEXT NOT NULL DEFAULT 'none'
    CHECK (verification_mode IN ('none', 'network', 'location', 'both', 'network_or_location')),
  allowed_ip_ranges          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  shop_latitude              DOUBLE PRECISION,
  shop_longitude             DOUBLE PRECISION,
  shop_radius_meters         INTEGER NOT NULL DEFAULT 120 CHECK (shop_radius_meters > 0),
  timezone                   TEXT NOT NULL DEFAULT 'Asia/Baghdad',
  updated_by                 UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO staff_attendance_settings (id)
VALUES (TRUE)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS staff_attendance_records (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date                  DATE NOT NULL,
  check_in_at                TIMESTAMPTZ,
  check_out_at               TIMESTAMPTZ,
  expected_start_time        TIME NOT NULL,
  expected_end_time          TIME NOT NULL,
  grace_minutes              INTEGER NOT NULL DEFAULT 15,
  late_minutes               INTEGER NOT NULL DEFAULT 0 CHECK (late_minutes >= 0),
  deduction_amount           BIGINT NOT NULL DEFAULT 0 CHECK (deduction_amount >= 0),
  deduction_transaction_id   UUID REFERENCES staff_salary_transactions(id) ON DELETE SET NULL,
  verification_mode          TEXT NOT NULL DEFAULT 'none',
  network_ok                 BOOLEAN NOT NULL DEFAULT FALSE,
  location_ok                BOOLEAN NOT NULL DEFAULT FALSE,
  verified                   BOOLEAN NOT NULL DEFAULT FALSE,
  check_in_ip                TEXT,
  check_out_ip               TEXT,
  latitude                   DOUBLE PRECISION,
  longitude                  DOUBLE PRECISION,
  location_accuracy_meters   DOUBLE PRECISION,
  distance_meters            DOUBLE PRECISION,
  status                     TEXT NOT NULL DEFAULT 'present'
    CHECK (status IN ('present', 'late', 'missing_checkout', 'overridden')),
  admin_note_ar              TEXT,
  overridden_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  overridden_at              TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, work_date)
);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_date ON staff_attendance_records(work_date DESC);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_user ON staff_attendance_records(user_id, work_date DESC);

COMMIT;
