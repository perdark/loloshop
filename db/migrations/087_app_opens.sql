-- Migration 087 — «شكد ينفتح التطبيق، وعلى أي منصة» for EVERYONE, not just staff.
--
-- 084 answered the same question for staff only, because that is who the owner was asking
-- about at the time. Nothing in the schema answers it for the two audiences the app was
-- actually built for — students and ممثلين:
--
--   · staff_app_opens — staff only, by design (written behind requireRole('staff')).
--   · device_tokens   — counts people who installed AND allowed notifications AND were signed
--     in when they did. A FLOOR on installs, not a count of them, and it says nothing about
--     whether the app is ever opened again afterwards.
--   · site_visits     — anonymous by design: no user_id, and no platform column at all. It
--     cannot tell an app open from a browser tab.
--
-- ⚠️ WHY A SECOND TABLE INSTEAD OF WIDENING 084. staff_app_opens is read by the nightly staff
-- report and the admin console, and its «opening the app is not attendance» rule is load-
-- bearing in payroll-adjacent code. Moving those rows to satisfy a stats page would put a
-- payroll-adjacent table on the critical path of a dashboard. Staff therefore write BOTH — one
-- request, two UPSERTs — and the duplication is the deliberate price of leaving 084 alone.
--
-- ⚠️ NOT RETROACTIVE. There is no source to backfill from: nothing recorded a student opening
-- the app before this table existed. Every chart built on it starts empty on deploy day, and
-- the admin page says so rather than drawing a flat line that looks like zero usage.
--
-- SHAPE and SEMANTICS copy 084 exactly, so the two can be read side by side without a mental
-- conversion: one row per user per shop-local work-date, `opens` counts SESSIONS (incremented
-- only across a >30 min gap, in the UPSERT itself so two tabs cannot race), and `work_date`
-- comes from lib/shopTime.js — never CURRENT_DATE, which is UTC and would file a 23:30 Baghdad
-- open under tomorrow.
--
-- GROWTH: one row per active user per day. Unlike site_visits it is bounded by the primary key
-- rather than by traffic, but the audience is ~1,100 accounts rather than 12 staff — call it
-- ~50k rows a year at current activity, which needs no retention policy yet. Revisit if the
-- shop grows an order of magnitude.

CREATE TABLE IF NOT EXISTS app_opens (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date     DATE NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opens         INTEGER NOT NULL DEFAULT 1 CHECK (opens >= 0),
  -- 'android' | 'ios' | 'web'. Nullable because an older client may not send one, and a NULL
  -- must never overwrite a platform we already learned (see COALESCE in lib/appPresence.js).
  platform      TEXT,
  PRIMARY KEY (user_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_app_opens_date ON app_opens(work_date DESC);
-- The stats page's two heaviest reads are "per day, per platform" over a 30-day window.
CREATE INDEX IF NOT EXISTS idx_app_opens_date_platform ON app_opens(work_date DESC, platform);
