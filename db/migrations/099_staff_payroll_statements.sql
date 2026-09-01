-- 099 — «حصيلة شهرك وراتبك»: the monthly payroll statement a worker sees.
--
-- WHY A TABLE AND NOT A COMPUTATION
-- `/payroll/me/summary` recomputes the month from live rows every time it is opened. That is
-- right for «شنو صار بشهري» and wrong for «هذا راتبك»: the schedule, the per-minute deduction
-- rate, a holiday and an admin override can all change AFTER a worker was paid, and every one
-- of them would silently move a number the shop has already handed over in cash. So a
-- statement is a SNAPSHOT — the rates, the counts and the day list are frozen onto the row at
-- publish time and never recomputed. Same reasoning that freezes `late_minutes` onto
-- `staff_attendance_records` at check-in (migration 093).
--
-- ⚠️ `published_at IS NULL` MEANS THE WORKER CANNOT SEE IT. The read endpoint filters on it,
-- so a half-entered month is invisible rather than half-true. Do not "simplify" that filter
-- away — an unpublished row exists precisely so the numbers can be checked before anyone reads
-- them as their pay.
--
-- ⚠️ THIS IS A SECOND MONEY LEDGER AND IT IS NOT `staff_salary_transactions`. The salary ledger
-- is a running balance on a fixed monthly base; a statement is one month priced by the DAY
-- (day_rate × worked days). Both are true and they do not agree, which is why `note_ar` exists
-- to say which one was actually paid. Never post a statement's net into the salary ledger as a
-- transaction — that would double it.

CREATE TABLE IF NOT EXISTS staff_payroll_statements (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month_key        TEXT NOT NULL CHECK (month_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),

  -- The prices this statement was computed at, frozen. A later rate change never moves it.
  day_rate         BIGINT  NOT NULL DEFAULT 0 CHECK (day_rate >= 0),
  half_rate        BIGINT  NOT NULL DEFAULT 0 CHECK (half_rate >= 0),
  minute_rate      BIGINT  NOT NULL DEFAULT 0 CHECK (minute_rate >= 0),
  grace_minutes    INTEGER NOT NULL DEFAULT 0 CHECK (grace_minutes >= 0),

  full_shifts      INTEGER NOT NULL DEFAULT 0,
  half_shifts      INTEGER NOT NULL DEFAULT 0,
  leave_days       INTEGER NOT NULL DEFAULT 0,   -- unworked days paid anyway
  unpaid_days      INTEGER NOT NULL DEFAULT 0,   -- unworked days NOT paid
  late_days        INTEGER NOT NULL DEFAULT 0,
  late_minutes     INTEGER NOT NULL DEFAULT 0,   -- the minutes actually charged
  waived_minutes   INTEGER NOT NULL DEFAULT 0,   -- lateness forgiven, shown so it is not a secret

  gross            BIGINT NOT NULL DEFAULT 0,
  late_deduction   BIGINT NOT NULL DEFAULT 0,
  other_deduction  BIGINT NOT NULL DEFAULT 0,
  other_reason_ar  TEXT,
  net              BIGINT NOT NULL DEFAULT 0,

  note_ar          TEXT,                          -- the sentence shown under the number
  days             JSONB  NOT NULL DEFAULT '[]'::jsonb,

  published_at     TIMESTAMPTZ,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One statement per person per month. A re-publish UPDATEs; it never stacks a second row,
-- or «راتبك» would depend on which one the query happened to pick.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_statement_user_month
  ON staff_payroll_statements (user_id, month_key);

CREATE INDEX IF NOT EXISTS idx_payroll_statement_published
  ON staff_payroll_statements (user_id, published_at DESC)
  WHERE published_at IS NOT NULL;
