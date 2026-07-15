-- Migration 062 — أيادي التصميم (Design Team).
--
-- This is deliberately NOT a staff_type. Design helpers work only on the first
-- retail-design review stage and must not inherit staff attendance, payroll,
-- checkout, money, or the broad production console. They receive their own
-- identity role, private portal, roster, and tiny collaboration task state.

BEGIN;

-- A separate login identity keeps helpers outside every existing
-- requireRole('staff') / requireRole('admin','staff') route by default.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'design_helper';

DO $$ BEGIN
  CREATE TYPE design_team_member_role AS ENUM ('lead', 'helper');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE design_team_task_status AS ENUM ('open', 'ready');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One intentionally-small team for the retail design desk. A boolean singleton
-- gives create-helper transactions one row to lock before enforcing the two
-- active-helper limit (without a racy COUNT + INSERT sequence).
CREATE TABLE IF NOT EXISTS design_teams (
  id           BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  name_ar      TEXT NOT NULL DEFAULT 'أيادي التصميم',
  helper_limit SMALLINT NOT NULL DEFAULT 2 CHECK (helper_limit = 2),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO design_teams (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;
-- Keep a manually-tested/partially-created singleton on the intended neutral name too.
UPDATE design_teams SET name_ar = 'أيادي التصميم' WHERE id = TRUE;

CREATE TABLE IF NOT EXISTS design_team_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     BOOLEAN NOT NULL DEFAULT TRUE REFERENCES design_teams(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  member_role design_team_member_role NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_design_team_members_team_active
  ON design_team_members(team_id, active, member_role);
-- Only one active lead at a time. Replacing Muhammad as lead deactivates the old
-- lead in the same transaction, preserving a clean audit trail.
CREATE UNIQUE INDEX IF NOT EXISTS uq_design_team_active_lead
  ON design_team_members(team_id)
  WHERE active = TRUE AND member_role = 'lead';

-- A helper only claims/marks a design ready for the lead. This state NEVER moves
-- an order through production; the lead/admin decision route owns that transition.
CREATE TABLE IF NOT EXISTS design_team_tasks (
  design_id     UUID PRIMARY KEY REFERENCES designs(id) ON DELETE CASCADE,
  team_id       BOOLEAN NOT NULL DEFAULT TRUE REFERENCES design_teams(id) ON DELETE CASCADE,
  status        design_team_task_status NOT NULL DEFAULT 'open',
  note          TEXT,
  assigned_to   UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at   TIMESTAMPTZ,
  ready_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  ready_at      TIMESTAMPTZ,
  resolved_at   TIMESTAMPTZ,
  updated_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_design_team_tasks_status
  ON design_team_tasks(team_id, status, updated_at DESC);

DROP TRIGGER IF EXISTS trg_design_teams_updated ON design_teams;
CREATE TRIGGER trg_design_teams_updated
  BEFORE UPDATE ON design_teams FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_design_team_members_updated ON design_team_members;
CREATE TRIGGER trg_design_team_members_updated
  BEFORE UPDATE ON design_team_members FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_design_team_tasks_updated ON design_team_tasks;
CREATE TRIGGER trg_design_team_tasks_updated
  BEFORE UPDATE ON design_team_tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
