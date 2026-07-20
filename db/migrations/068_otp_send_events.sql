-- 068: accurate rolling OTP send limits
--
-- Resends keep the same otp_codes row and created_at. Recording each attempt separately
-- prevents late resends from falling out of the one-hour budget too early.

CREATE TABLE IF NOT EXISTS otp_send_events (
  id         BIGSERIAL PRIMARY KEY,
  phone      TEXT NOT NULL,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otp_send_events_phone_time
  ON otp_send_events(phone, sent_at DESC);
