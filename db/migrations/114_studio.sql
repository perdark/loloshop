-- 114: «الاستوديو» — a ChatGPT-like tool for design staff on SmartAPI (lib/studioAi.js).
--
-- Owner: 3–4 design staff each pay for their own ChatGPT subscription; replace with one
-- in-app tool billed once, with per-person usage visible to the admin (GET /api/studio/usage).
--
-- Who may use it: same audience as الخط العربي (lib/calligraphyAccess.js allowToolUser) —
-- admin, staff manager/designer/embroiderer, and an active design_helper.
--
-- `studio_conversations.model` stores the UI choice, NOT the real model id — 'gpt' maps to
-- STUDIO_GPT_MODEL (default gpt-5.5) and 'claude' to STUDIO_CLAUDE_MODEL (default
-- claude-sonnet-5) at call time, same indirection calligraphy/aiChat already use so the real
-- model id can move without a migration.
--
-- `studio_messages.image_urls` holds BOTH a user's attached uploads (/uploads/studio/) and a
-- generated image message's own output — the role+kind columns disambiguate which. `content`
-- defaults to '' rather than NULL so an image-only message never needs a null-check downstream.
--
-- Plain CREATE/ALTER TABLE IF NOT EXISTS, so re-applying this file (schema.sql runs on every
-- deploy) is a no-op — no backfill, nothing to make idempotent beyond IF NOT EXISTS itself.
CREATE TABLE IF NOT EXISTS studio_conversations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id),
  title      TEXT,
  model      TEXT NOT NULL DEFAULT 'gpt',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'studio_conversations_model_chk') THEN
    ALTER TABLE studio_conversations ADD CONSTRAINT studio_conversations_model_chk
      CHECK (model IN ('gpt', 'claude'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS studio_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES studio_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL DEFAULT '',
  image_urls      TEXT[] NOT NULL DEFAULT '{}',
  kind            TEXT NOT NULL DEFAULT 'text',
  cost_usd        NUMERIC(10,6) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'studio_messages_role_chk') THEN
    ALTER TABLE studio_messages ADD CONSTRAINT studio_messages_role_chk
      CHECK (role IN ('user', 'assistant'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'studio_messages_kind_chk') THEN
    ALTER TABLE studio_messages ADD CONSTRAINT studio_messages_kind_chk
      CHECK (kind IN ('text', 'image'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS studio_conversations_user_updated_idx
  ON studio_conversations (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS studio_messages_conversation_created_idx
  ON studio_messages (conversation_id, created_at);
-- Feeds GET /usage (admin-only spend-by-user over the last 30 days).
CREATE INDEX IF NOT EXISTS studio_messages_created_idx
  ON studio_messages (created_at);
