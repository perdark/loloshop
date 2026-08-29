-- 095_anonymous_device_push.sql — reach the phones that never signed in.
--
-- ── THE MEASUREMENT THAT FORCED THIS ──────────────────────────────────────────────────────
-- On 2026-08-29 prod held 165 device tokens against 2,249 retail accounts, so a broadcast
-- physically reached ~7% of the people who have an account — and 0% of everyone who installed
-- the app, browsed the shop and never registered. `device_tokens.user_id` was NOT NULL, which
-- meant a signed-out phone that had already GRANTED notification permission had its token
-- thrown away by the client: the most expensive thing an app can own (an iOS permission that
-- is granted exactly once per install) spent on nothing.
--
-- Owner decision 2026-08-29: the shop will run a lot of promotion through notifications, so
-- reach is the point. This migration makes a device a first-class push target with or without
-- an account.
--
-- ── THE THREE PIECES ──────────────────────────────────────────────────────────────────────
-- 1. `user_id` becomes NULLABLE. A row with a NULL owner is an anonymous handset. The token
--    stays UNIQUE, so the moment that phone signs in, `registerDevice`'s ON CONFLICT sets the
--    owner and the row becomes an ordinary personal device — no duplicate, no second prompt,
--    and every anonymous push it received before that stops.
--
-- 2. `marketing_opt_in` — the anonymous half of Apple guideline 4.5.4.
--    ⚠️ THIS IS NOT A DUPLICATE OF `users.notification_prefs.marketing` (migration 089) AND
--    THE TWO MUST NOT BE MERGED. They answer the same question for two different subjects: a
--    PERSON who may hold three handsets, and a HANDSET that belongs to nobody. An account's
--    consent has to follow them onto a new phone, so it cannot live on a device row; an
--    anonymous handset has no account to hang consent on, so it cannot live on a user row.
--    `lib/pushBroadcast.js` applies exactly one of the two per recipient — never both, never
--    neither. It defaults FALSE for the same reason 089's did: consent is never inherited from
--    a column default, only from a tap on the consent card.
--
-- 3. `device_notifications` — the queue for a push with no `notifications` row behind it.
--    `notifications` is the in-app bell and is keyed to a user; an anonymous phone has no bell
--    and no user, so its message cannot live there. This table is the same shape on purpose —
--    the same 'pending'/'sending'/'sent'/'failed'/'skipped' states, drained by the same
--    lib/pushOutbox.js pass, under the same 15-minute freshness window and the same dead-token
--    cleanup. A second delivery mechanism would have to re-earn all of that.
--
-- ⚠️ WHAT DOES NOT CHANGE. Every existing push path is user-keyed and stays user-keyed: the
-- thirteen `INSERT INTO notifications` call sites, the outbox's user pass, `/notifications`,
-- the bell. Only an admin broadcast aimed at «كل الأجهزة» ever writes this table.

BEGIN;

-- 1 ─────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE device_tokens ALTER COLUMN user_id DROP NOT NULL;

-- 2 ─────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE device_tokens
  ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE;

-- The anonymous audience is a small slice of the table and is scanned on every broadcast that
-- includes it; partial so it never indexes the (much larger) owned rows.
CREATE INDEX IF NOT EXISTS idx_device_tokens_anon
  ON device_tokens(last_seen_at) WHERE user_id IS NULL;

-- 3 ─────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS device_notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ON DELETE CASCADE, because the outbox DELETEs a device row the provider called dead:
  -- an undeliverable queue entry pointed at a token that no longer exists is pure garbage.
  device_id    UUID NOT NULL REFERENCES device_tokens(id) ON DELETE CASCADE,
  -- The audit row this came from. SET NULL rather than CASCADE: losing the broadcast record
  -- must never silently delete the evidence of what was actually queued.
  broadcast_id UUID REFERENCES push_broadcasts(id) ON DELETE SET NULL,
  type         TEXT NOT NULL,
  title_ar     TEXT NOT NULL,
  body_ar      TEXT,
  link         TEXT,
  push_state   TEXT NOT NULL DEFAULT 'pending'
                 CHECK (push_state IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  pushed_at    TIMESTAMPTZ
);

-- The claim query's index, partial for the same reason 077's is: only unfinished rows are ever
-- looked at, and `retireStale` keeps that set small.
CREATE INDEX IF NOT EXISTS idx_device_notifications_pending
  ON device_notifications(created_at)
  WHERE push_state IN ('pending', 'sending');

COMMIT;
