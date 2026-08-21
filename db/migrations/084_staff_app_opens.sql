-- 084 — «هل فتح الموظف التطبيق اليوم؟»
--
-- The owner asks a question the database could not answer: is this employee actually using
-- the app, and how often. Three tables looked like they might already hold it and none does:
--
--   · staff_attendance_records  — بصمة. Says "they stamped in at 09:14", which is a claim a
--     person makes ONCE, deliberately, and then walks away from. It cannot distinguish a
--     preparer who stamped and then worked all day from one who stamped and went home.
--   · staff_activity_log        — production actions (advance/revert/claim). Only fires when
--     someone MOVES a piece, so a designer reading briefs all morning is invisible in it, and
--     a station with no work queued makes its whole staff look idle.
--   · site_visits               — anonymous storefront sessions. No user_id at all, by design
--     (privacy-light: no IP, no cookies). It can never name a person.
--
-- So this is a fourth, separate signal: presence of the PERSON in the APP, independent of both
-- attendance and of whether there was work to do.
--
-- ⚠️ IT MUST STAY INDEPENDENT OF PAYROLL. Opening the app is not attendance and not opening it
-- is not a deduction. Nothing in this feature writes staff_salary_transactions, and the report
-- prints the two columns side by side precisely so the owner can see where they DISAGREE —
-- a stamped بصمة with zero opens all day is the row worth looking at, and folding one signal
-- into the other would erase exactly that row. The money rule stays where it already lives
-- (backend/lib/attendanceBreak.js and the attendance controller), with one owner.
--
-- SHAPE: one row per user per work-date, updated in place. Twelve staff × 365 days ≈ 4k rows
-- a year, so unlike site_visits this needs no retention policy and no dedup window to bound
-- growth — the primary key IS the bound.
--
-- `opens` counts SESSIONS, not pings. The endpoint increments it only when last_seen_at is
-- older than 30 minutes; otherwise it just moves last_seen_at forward. A preparer working
-- through a queue for three hours is one open; leaving for lunch and coming back is two.
--
-- `work_date` is computed in JS by attendanceController.localParts(now, 'Asia/Baghdad') — the
-- SAME helper attendance itself uses — and passed in as a bind parameter. It is NOT
-- CURRENT_DATE: the server clock is UTC, so a 23:30 Baghdad ping would file its open under
-- tomorrow while the same evening's بصمة row sits under today, and every join in the daily
-- report would silently miss.

CREATE TABLE IF NOT EXISTS staff_app_opens (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date     DATE NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opens         INTEGER NOT NULL DEFAULT 1 CHECK (opens >= 0),
  -- 'android' | 'ios' | 'web' — which shell they came from, so the report can say whether
  -- the iPad staff are actually on the iPad. Last one wins; nobody needs the history.
  platform      TEXT,
  PRIMARY KEY (user_id, work_date)
);

-- The daily report scans one date across all staff; the per-user history view scans one user
-- backwards. The primary key serves the second, this index serves the first.
CREATE INDEX IF NOT EXISTS idx_staff_app_opens_date ON staff_app_opens(work_date DESC);
