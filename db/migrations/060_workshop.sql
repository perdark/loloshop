-- Migration 060: Workshop (الورشة / Team B) — bulk piecework production + wage ledger.
--
-- Team B = the Syrian workshop workers (حمزة، محمود، بهاء, …) who physically build the
-- garments in bulk: قص → أوفرلوك/خياطة القبعة → خياطة الروب/تسكير الشال. This is a
-- STANDALONE module: it tracks quantities and pays per piece, and does NOT touch the
-- orders table or the Team-A production pipeline (there is intentionally no auto-handoff
-- into التطريز yet — Team B just completes its own chain).
--
-- Identity: workshop workers reuse `users` with a NEW role 'worker' so they get the same
-- JWT / secret-portal (no-OTP) login machinery as staff. ابو عبدو already exists as a
-- `staff` user and is linked into the roster without changing his role or his فصال screen.
--
-- SAFE in one transaction: this migration never INSERTs a 'worker' row, so adding the enum
-- value and creating the tables (which only reference the value as a column type / not at
-- all) does not hit the "can't use a new enum value in the same transaction" restriction.

-- New login role for the Syrian workshop workers (phoneless → secret-URL portal, no OTP).
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'worker';

-- Where a run's pieces come from.
DO $$ BEGIN
  CREATE TYPE workshop_run_source AS ENUM ('wholesale', 'retail', 'manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Append-only wage/quantity ledger entry kinds.
DO $$ BEGIN
  CREATE TYPE workshop_ledger_kind AS ENUM ('completion', 'damage', 'adjustment');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1) Roster — links a person (a 'worker' user, or an existing staff user like ابو عبدو)
--    into the workshop. is_lead (حمزة) may start runs + record the cut quantity.
CREATE TABLE IF NOT EXISTS workshop_workers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  is_lead    BOOLEAN NOT NULL DEFAULT FALSE,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2) Piece rates — per operation × garment type, in IQD. Admin-editable; this is where the
--    real per-piece wages get filled in (they are deliberately NOT hardcoded). Operation
--    codes: cut · overlock · cap_sew · robe_sew · shawl_close · american_shawl.
--    product codes: robe · cap · shawl · sash.
CREATE TABLE IF NOT EXISTS workshop_piece_rates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation  TEXT NOT NULL,
  product    TEXT NOT NULL,
  amount     BIGINT NOT NULL DEFAULT 0 CHECK (amount >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (operation, product)
);

-- 3) Runs — one bulk production run of a single garment type from a source. total_qty is
--    the cut quantity that starts the chain; planned_qty is the expected count (e.g. a
--    wholesale batch's order count) shown only as a reconciliation hint.
CREATE TABLE IF NOT EXISTS workshop_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ar     TEXT NOT NULL,
  source      workshop_run_source NOT NULL DEFAULT 'manual',
  batch_id    UUID REFERENCES batches(id) ON DELETE SET NULL,
  product     TEXT NOT NULL,
  total_qty   INTEGER NOT NULL DEFAULT 0 CHECK (total_qty >= 0),
  planned_qty INTEGER CHECK (planned_qty IS NULL OR planned_qty >= 0),
  status      TEXT NOT NULL DEFAULT 'open',   -- open | closed
  notes       TEXT,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_workshop_runs_status ON workshop_runs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workshop_runs_batch  ON workshop_runs(batch_id);

-- 4) Assignments — allocate a portion of a run's operation to one worker.
CREATE TABLE IF NOT EXISTS workshop_assignments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       UUID NOT NULL REFERENCES workshop_runs(id) ON DELETE CASCADE,
  operation    TEXT NOT NULL,
  worker_id    UUID NOT NULL REFERENCES workshop_workers(id) ON DELETE CASCADE,
  assigned_qty INTEGER NOT NULL DEFAULT 0 CHECK (assigned_qty >= 0),
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, operation, worker_id)
);
CREATE INDEX IF NOT EXISTS idx_workshop_assign_worker ON workshop_assignments(worker_id);
CREATE INDEX IF NOT EXISTS idx_workshop_assign_run    ON workshop_assignments(run_id);

-- 5) Ledger — append-only completion/damage/adjustment events. completed(assignment) =
--    SUM(qty) WHERE kind='completion'. rate is FROZEN per row so editing a rate later never
--    rewrites past earnings. Drives reconciliation AND worker earnings. created_by NULL =
--    self-recorded by the worker; otherwise the admin/lead who recorded on their behalf.
CREATE TABLE IF NOT EXISTS workshop_ledger (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES workshop_assignments(id) ON DELETE CASCADE,
  worker_id     UUID NOT NULL REFERENCES workshop_workers(id) ON DELETE CASCADE,
  kind          workshop_ledger_kind NOT NULL DEFAULT 'completion',
  qty           INTEGER NOT NULL,           -- signed (adjustment may be negative)
  rate          BIGINT NOT NULL DEFAULT 0 CHECK (rate >= 0),
  amount        BIGINT NOT NULL DEFAULT 0,  -- qty*rate for completion; 0 for damage; signed for adjustment
  note          TEXT,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_workshop_ledger_worker     ON workshop_ledger(worker_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workshop_ledger_assignment ON workshop_ledger(assignment_id);

-- 6) Payments — cash paid to a worker. unpaid = SUM(ledger.amount) − SUM(payments.amount).
CREATE TABLE IF NOT EXISTS workshop_payments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id  UUID NOT NULL REFERENCES workshop_workers(id) ON DELETE CASCADE,
  amount     BIGINT NOT NULL CHECK (amount > 0),
  note       TEXT,
  paid_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  paid_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_workshop_payments_worker ON workshop_payments(worker_id, paid_at DESC);
