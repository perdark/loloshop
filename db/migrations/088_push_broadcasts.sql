-- Migration 088 — an audit trail for notifications a HUMAN sent.
--
-- Every push before this one was emitted by code at a moment the code chose, so «why did this
-- arrive?» was always answerable from the event that caused it. An admin-composed broadcast has
-- no such event: the only record that it happened, who sent it, and how far it reached is this
-- table. A push cannot be unsent, which makes the record the only thing that survives a
-- mistake.
--
-- ⚠️ THIS IS NOT THE QUEUE. The `notifications` rows are the queue (migration 077) and
-- lib/pushOutbox.js drains them; this row is written first, in the same transaction, so a
-- half-failed insert of 1,100 notification rows still leaves evidence of the press.
--
-- `people` / `devices` are snapshots taken at send time and deliberately not recomputed: the
-- question this table answers is «what did the sender reach THEN», and both numbers move
-- afterwards as devices register and accounts are deleted.

CREATE TABLE IF NOT EXISTS push_broadcasts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  admin_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  -- 'all' | 'role' | 'university' | 'wholesaler' | 'user'
  audience_kind  TEXT NOT NULL,
  -- The role name, university text, wholesaler id or user id. Free text on purpose: it records
  -- what was TYPED, including a university spelling that matched nobody.
  audience_value TEXT,
  title_ar       TEXT NOT NULL,
  body_ar        TEXT,
  link           TEXT,
  people         INTEGER NOT NULL DEFAULT 0,
  devices        INTEGER NOT NULL DEFAULT 0
);
-- Whether this was a PROMOTIONAL send. Recorded because Apple 4.5.4 treats the two kinds
-- differently: a marketing push may only reach accounts that opted in (migration 089), and this
-- column is the evidence of which rule each send was made under.
ALTER TABLE push_broadcasts ADD COLUMN IF NOT EXISTS marketing BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_push_broadcasts_sent ON push_broadcasts(sent_at DESC);
