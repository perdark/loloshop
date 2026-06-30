-- 056_site_visits.sql — first-party storefront visit tracking for the TV board's
-- «الزيارات الآن» (live audience) metric. No third-party analytics, no cookies:
-- the public storefront pings /api/track/visit with a localStorage session id; we
-- store at most one row per session per 5 min, and the board counts DISTINCT
-- session_id in the last 30 minutes. Privacy-light on purpose — no IP, no PII.

CREATE TABLE IF NOT EXISTS site_visits (
  id          BIGSERIAL PRIMARY KEY,
  session_id  TEXT NOT NULL,
  path        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- audience-now query = COUNT(DISTINCT session_id) WHERE created_at > now()-30min
CREATE INDEX IF NOT EXISTS idx_site_visits_created_at
  ON site_visits (created_at DESC);
-- per-session 5-min dedup guard on insert
CREATE INDEX IF NOT EXISTS idx_site_visits_session_created
  ON site_visits (session_id, created_at DESC);
