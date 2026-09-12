-- 110 — «هل هذي زيارة من التطبيق لو من المتصفح؟»
--
-- WHY IT DID NOT EXIST BEFORE: site_visits was built for ONE number — «الزيارات الآن» on the TV
-- board — and a live-audience count does not care what the audience is holding. That stopped
-- being true the day the app-only gate was written: after the gate, a browser visitor is sent to
-- /get-app and an app visitor is not, so «هل البوابة اشتغلت؟» is exactly the app-vs-browser
-- split, and this table is the only one that sees an unsigned-in visitor at all
-- (app_opens.user_id is NOT NULL by design — see lib/appPresence.js).
--
-- NULLABLE ON PURPOSE, AND NULL DOES NOT MEAN 'web'. Every row written before this column
-- existed has no platform and no way to recover one; calling those 'web' would invent a fact
-- about 34k historical rows. Readers must keep counting NULL as «غير معروف».
--
-- ⚠️ Repeated in db/schema.sql, like 077's and 080's backfills — that file is what
-- scripts/deploy.sh applies on every deploy, and its CREATE TABLE IF NOT EXISTS will NOT add a
-- column to the table that already exists on prod. The ALTER there is the copy that runs.
ALTER TABLE site_visits ADD COLUMN IF NOT EXISTS platform TEXT;

-- The board's live count and every analytics read filter on recency first, so the existing
-- created_at index still carries them; this one is for the platform split over a window.
CREATE INDEX IF NOT EXISTS site_visits_platform_idx ON site_visits (created_at DESC, platform);
