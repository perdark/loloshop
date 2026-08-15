-- 082: reactions on the AI assistant's own answers.
--
-- WHY. Every answer already lives in ai_chat_messages, and a tap-reaction is a fact about THAT
-- row, not a new entity — one nullable column is the whole feature. Closed vocabulary via a
-- CHECK constraint so a bad value cannot reach this table even if the application-layer check
-- in backend/controllers/supportChatController.js (`REACTIONS`) is ever bypassed or drifts.
--
-- OWNERSHIP, NOT A NEW TRUST BOUNDARY. Reacting never rewrites `answer` or `question`, so the
-- only question POST /api/assistant/react has to answer is "did you receive this message" —
-- the SAME identity check /support already makes: an authenticated user_id, or a
-- SERVER-SIGNED anon session_key (backend/lib/anonSession.js). See the route + controller for
-- the ownership predicate; nothing here enforces it, because a CHECK constraint can only see
-- one row at a time and cannot compare against the caller.
--
-- NULLABLE, no default. Every existing row predates this column, and NULL is the correct
-- reading for "nobody reacted" — never a synthetic zero-th reaction.

ALTER TABLE ai_chat_messages ADD COLUMN IF NOT EXISTS reaction TEXT
  CHECK (reaction IS NULL OR reaction IN ('like', 'love', 'happy', 'sad', 'good', 'excellent'));
