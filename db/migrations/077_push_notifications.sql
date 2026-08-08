-- 077: real push notifications — device tokens + a send-once outbox on `notifications`.
--
-- WHAT SHIPPED BEFORE THIS: rows in `notifications`, rendered in-app only. A rep whose
-- student joined at 11pm learned about it the next time they opened the app. Nothing
-- ever reached a phone that was closed, which is the only state a phone is in when a
-- notification matters.
--
-- WHY AN OUTBOX AND NOT A SEND CALL AT EACH INSERT SITE. There are thirteen
-- `INSERT INTO notifications` sites and several of them run inside `tx()` — orderController,
-- joinController, designController, productionController. Sending from inside the
-- transaction pushes a notification for work that may still roll back, and sending after it
-- means threading a "and now push this" return value through every one of those callers.
-- Making the ROW the queue fixes both for free: only committed rows are ever visible to the
-- drain (backend/lib/pushOutbox.js), a failed send stays claimable, and no call site changes.
--
-- ⚠️ THE BACKFILL BELOW IS NOT OPTIONAL. `push_state` defaults to 'pending', so without it
-- every notification row this shop has ever written becomes a send candidate the moment the
-- drain starts — thousands of push messages for orders that closed months ago. The drain has
-- its own 15-minute freshness window as a second guard; both exist because either one alone
-- is a single line away from a very loud accident.

BEGIN;

-- One row per (device, app install). `token` is UNIQUE across the whole table, not per user,
-- and that is the point: phones are shared and re-sold in this market. When a second person
-- signs in on the same handset FCM/APNs hands us the SAME token, and the ON CONFLICT upsert in
-- notificationController.registerDevice moves it to the new owner. Scoping uniqueness per user
-- instead would leave two live rows and deliver the new user's notifications to the old
-- account's stream as well.
CREATE TABLE IF NOT EXISTS device_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- FCM registration token (Android) or APNs device token, hex (iOS).
  token        TEXT NOT NULL UNIQUE,
  platform     TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Refreshed on every app open. A token the provider has not rejected but that has not been
  -- seen for months is a device that was wiped without telling us; it is what a future prune
  -- would sort on.
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);

-- 'pending' → never attempted · 'sending' → claimed by a drain · 'sent' → the provider
-- accepted it for at least one device · 'failed' → the provider refused it · 'skipped' →
-- deliberately not pushed (backfilled history, or a user with no registered device).
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS push_state TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS pushed_at  TIMESTAMPTZ;

-- ⚠️ See the header. Retires every pre-existing row so switching the sender on cannot
-- replay the shop's whole notification history onto real phones. Ten minutes rather than
-- zero so a row written while this migration runs is still delivered.
UPDATE notifications SET push_state = 'skipped'
 WHERE push_state = 'pending' AND created_at < now() - INTERVAL '10 minutes';

-- Partial index: 'pending' is a handful of rows at any instant (everything else has moved on),
-- so the drain's claim query reads a tiny index instead of scanning the whole table.
-- Covers 'sending' too, not just 'pending': the drain's claim query also has to find rows a
-- crashed process left mid-flight, and an index that stops at 'pending' would make that
-- branch a full scan of every notification the shop has ever written.
CREATE INDEX IF NOT EXISTS idx_notifications_push_pending
  ON notifications (created_at) WHERE push_state IN ('pending', 'sending');

COMMIT;
