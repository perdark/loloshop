-- Migration 089 — «شنو تريد يوصلك؟»: transactional vs marketing notifications.
--
-- ⚠️ THIS IS A STORE REQUIREMENT, NOT A NICETY. Apple's review guideline 4.5.4 forbids using
-- push for advertising, promotions or direct marketing UNLESS the user explicitly opted in
-- through consent language in the app's UI, AND the app offers a way to opt out. Google Play
-- takes the same line on unsolicited notifications. Until migration 088 every push this system
-- sent was transactional (an order moved, an approval landed, a deadline neared), so the
-- question never arose; `lib/pushBroadcast.js` is the first thing here that can send an offer,
-- which is what creates the obligation.
--
-- ⚠️ `marketing` DEFAULTS TO FALSE AND MUST STAY THAT WAY. Opt-IN is the whole requirement —
-- defaulting it true would silently enrol all 1,100+ existing accounts in marketing push, which
-- is precisely the thing the guideline exists to prevent, and it would be invisible in review
-- right up until a reviewer looked at the default.
--
-- ⚠️ `orders` DEFAULTS TO TRUE and is deliberately NOT the same kind of switch. Order updates
-- are the thing a student installed the app for; a shop that stops telling someone their sash
-- is ready has broken, not respected, their preference. It is still switchable — the guideline
-- wants control, and a student who only wants the in-app bell should have it — but the default
-- is on and turning it off is the student's deliberate act.
--
-- WHY ONE JSONB COLUMN RATHER THAN TWO BOOLEANS: the next category (نتيجة التصميم? الرواتب
-- للموظفين?) should not need a migration and a deploy. The shape is flat and closed —
-- {orders: bool, marketing: bool} — and lib/notificationPrefs.js owns reading it so an unknown
-- or malformed value degrades to the defaults rather than throwing on a student's phone.

ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_prefs JSONB NOT NULL
  DEFAULT '{"orders": true, "marketing": false}'::jsonb;

-- Marketing sends filter on this, over the whole user table, so it is worth an index rather
-- than a sequential scan of 1,100+ rows on every audience preview keystroke.
CREATE INDEX IF NOT EXISTS idx_users_marketing_optin
  ON users ((notification_prefs->>'marketing'))
  WHERE deleted_at IS NULL;
