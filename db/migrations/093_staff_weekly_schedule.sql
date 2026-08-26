-- Migration 093: دوام الأسبوع + الإجازات.
--
-- THE BUG THIS CLOSES. `staff_attendance_settings` held ONE start_time/end_time pair and
-- there was no weekday logic anywhere in backend/ — a grep for getDay / day_of_week /
-- friday / جمعة returned nothing. `checkIn` computed lateness against 09:00 every day
-- (attendanceController.js). The shop opens 3 م الجمعة, so EVERY Friday check-in was
-- recorded as roughly six hours late.
--
-- ⚠️ Nothing was ever DEDUCTED for it. `staff_attendance_records.deduction_transaction_id`
-- is only ever cleared, never set; the sole writer of an attendance salary transaction is
-- lib/attendanceBreak.js, for breaks. So the damage was a RECORD — status='late', a wrong
-- late_minutes, and a deduction_amount that both the staff page and the admin reports
-- display and a human then pays from. Wrong data a person acts on, not money already taken.
-- `npm run friday-deduction-report` lists every affected row; it writes nothing.
--
-- ⚠️ `weekday` uses POSTGRES `EXTRACT(DOW)` NUMBERING — 0 = الأحد … 6 = السبت, so الجمعة is
-- 5. Chosen so a query can join on it with no translation table. JS `getUTCDay()` agrees.
CREATE TABLE IF NOT EXISTS staff_schedule_days (
  weekday    SMALLINT PRIMARY KEY CHECK (weekday BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time   TIME NOT NULL,
  is_off     BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ⚠️ ON CONFLICT DO NOTHING is load-bearing, not tidiness. scripts/deploy.sh runs
-- `npm run migrate`, which applies db/schema.sql — where this same seed is repeated — on
-- EVERY deploy. Without the guard, every deploy would silently undo the owner's edits.
-- Same pattern, same reason, as migrations 077 and 080.
INSERT INTO staff_schedule_days (weekday, start_time, end_time, is_off) VALUES
  (0, '09:00', '22:00', FALSE),   -- الأحد
  (1, '09:00', '22:00', FALSE),   -- الاثنين
  (2, '09:00', '22:00', FALSE),   -- الثلاثاء
  (3, '09:00', '22:00', FALSE),   -- الأربعاء
  (4, '09:00', '22:00', FALSE),   -- الخميس
  (5, '15:00', '00:00', FALSE),   -- الجمعة — crosses midnight, see lib/staffSchedule.js
  (6, '09:00', '22:00', FALSE)    -- السبت
ON CONFLICT (weekday) DO NOTHING;

-- Applies to EVERYONE. Owner decision 2026-08-27: there is no per-staff holiday; a single
-- member of staff being off is an `attendance_required = FALSE` override or an admin note.
CREATE TABLE IF NOT EXISTS staff_holidays (
  work_date  DATE PRIMARY KEY,
  label_ar   TEXT NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_holidays_date ON staff_holidays(work_date DESC);
