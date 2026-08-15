-- 079: attribution for the AI chat ledger.
--
-- WHY. Owner decision 2026-08-12 removed the per-person daily quota from the assistant: it was
-- keyed on a client-chosen identity, so it bounded honest students and nobody else, and the
-- assistant is now the shop's main marketing surface where «وصلت للحد اليومي» is the worst
-- sentence it could say. Abuse is bounded instead by a server-signed identity, a burst
-- throttle, free repetition through the response cache, and the daily USD ceiling.
--
-- That trade only works if abuse is VISIBLE after the fact. Until now the ledger recorded what
-- was asked and what it cost but nothing about where it came from, so "one address flooded us
-- last night" was not a question the database could answer.
--
-- HASHED, NOT STORED. A raw IP is personal data and the ledger is kept for accounting, so what
-- lands here is a salted SHA-256 (backend/lib/clientIp.js). That is enough to say "these 4,000
-- rows are one address" — which is the whole question — and not enough to say which address,
-- and it cannot be reversed if the table ever leaks. The salt is APP_SECRET/JWT_SECRET, so
-- rotating that key deliberately breaks correlation with older rows.
--
-- NULLABLE on purpose: every existing row predates the column, and a request behind a proxy
-- that strips the header has no address to hash. A NULL means "unknown", never "same client".

ALTER TABLE ai_chat_messages ADD COLUMN IF NOT EXISTS ip_hash TEXT;

-- Supports the only question this column exists to answer: what did one address do recently.
CREATE INDEX IF NOT EXISTS idx_ai_chat_ip_created
  ON ai_chat_messages(ip_hash, created_at DESC) WHERE ip_hash IS NOT NULL;
