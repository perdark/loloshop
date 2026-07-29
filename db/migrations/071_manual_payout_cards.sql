-- 071: SuperQi Mastercard payout destinations + admin manual-transfer log.
--
-- The application never contacts a bank or moves money. Staff, tailors, and
-- workshop workers save only the 16-digit card number used to receive wages.
-- Admins copy that number, transfer in the external banking app, then record
-- the completed manual transfer here for an internal audit trail.

CREATE TABLE IF NOT EXISTS payout_accounts (
  user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL DEFAULT 'superqi_mastercard'
    CHECK (provider = 'superqi_mastercard'),
  card_number      TEXT NOT NULL CHECK (card_number ~ '^[0-9]{16}$'),
  cardholder_name  TEXT CHECK (cardholder_name IS NULL OR char_length(cardholder_name) <= 120),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by       UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS manual_payouts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recipient_kind        TEXT NOT NULL
    CHECK (recipient_kind IN ('staff', 'tailor', 'workshop')),
  source_id             UUID NOT NULL,
  amount                BIGINT NOT NULL CHECK (amount > 0),
  card_number_snapshot  TEXT NOT NULL CHECK (card_number_snapshot ~ '^[0-9]{16}$'),
  note                  TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  paid_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_manual_payouts_recipient
  ON manual_payouts(recipient_kind, source_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_manual_payouts_user
  ON manual_payouts(user_id, paid_at DESC);
