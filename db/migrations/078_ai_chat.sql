-- 078: AI chat log — the support chatbot + admin analytics assistant.
--
-- This table is the cost ledger AND the rate limiter. Every model call writes exactly one
-- row here (success or failure), and the caps in backend/lib/aiChat.js are enforced by
-- COUNT/SUM over it. There is no in-memory counter: a PM2 restart must not reset a user's
-- daily allowance, and the flood guard has to hold across both API workers.
--
-- Deliberately NOT a per-conversation table. The support bot is stateless beyond the last
-- few turns (which the client re-sends), so there is nothing to key a conversation on and
-- no orphan rows to clean up when a student's account is deleted.

CREATE TABLE IF NOT EXISTS ai_chat_messages (
  id                BIGSERIAL PRIMARY KEY,
  -- NULL for a signed-out visitor: their allowance is keyed on session_key instead.
  -- ON DELETE SET NULL keeps the cost history intact when an account is deleted (076),
  -- while dropping the link to the person — the row is accounting, not personal data.
  user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  session_key       TEXT,
  surface           TEXT NOT NULL CHECK (surface IN ('support', 'admin_analytics')),
  question          TEXT NOT NULL,
  answer            TEXT,
  -- admin_analytics only: which typed metric the router picked, or NULL when it
  -- matched nothing. Lets us see which questions the fixed metric set cannot answer.
  intent            TEXT,
  model             TEXT,
  prompt_tokens     INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  -- OpenRouter reports real spend per call in usage.cost; we store it rather than
  -- recomputing from a hardcoded price table that goes stale the day a model reprices.
  cost_usd          NUMERIC(12, 8) NOT NULL DEFAULT 0,
  error             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The three reads the caps make, one index each.
CREATE INDEX IF NOT EXISTS idx_ai_chat_user_created    ON ai_chat_messages(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_chat_session_created ON ai_chat_messages(session_key, created_at DESC)
  WHERE session_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_chat_created         ON ai_chat_messages(created_at DESC);
