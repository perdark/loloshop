-- Migration 115 — staff engagement notices (2026-10-14, owner request).
--
-- Three things, all additive, all idempotent (this block is repeated in db/schema.sql, which
-- scripts/deploy.sh applies on EVERY deploy — nothing here may UPDATE existing rows):
--
-- 1. staff_app_opens.active_minutes / last_active_at — real foreground time in the app.
--    084 only knew first/last seen, so «شكد قضى بالتطبيق» was unmeasurable. The client pings
--    /api/app/active once a minute while the app is VISIBLE; one ping = at most one minute.
-- 2. break_deduction_announcements — once-only ledger keyed on the BREAK. A recompute that
--    replaces the salary transaction (soft-delete + insert) must not re-announce, so the key
--    is the break, never the transaction.
-- 3. staff_ai_messages — every message «لولو» sent a worker, kept for the admin. Owner ruling:
--    the AI messages staff WITHOUT review, so the admin's only control is reading this.

ALTER TABLE staff_app_opens ADD COLUMN IF NOT EXISTS active_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE staff_app_opens ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS break_deduction_announcements (
  break_id     UUID PRIMARY KEY REFERENCES staff_attendance_breaks(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount       BIGINT NOT NULL,
  announced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staff_ai_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date  DATE NOT NULL,
  body_ar    TEXT NOT NULL,
  facts      TEXT NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('ai', 'template')),
  guard_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, work_date)
);
CREATE INDEX IF NOT EXISTS idx_staff_ai_messages_date ON staff_ai_messages(work_date DESC);
