-- Migration 064 — Point أيادي التصميم at real retail orders, not the dead `designs` table.
--
-- The retail Fabric designer was removed on 2026-06-20; the `designs` table is empty
-- and nothing writes it anymore. Retail sashes/caps/robes now arrive as typed-spec
-- orders (design_id IS NULL, has_embroidery = TRUE) sitting at status='design_complete'.
-- محمد هيثم's design desk works THOSE orders: a helper claims/uploads the final art,
-- محمد هيثم (lead) approves → the order advances to 'converting'.
--
-- design_team_tasks was keyed on design_id → designs(id). Re-key it on order_id →
-- orders(id). The table has always been empty (0 designs → 0 tasks), so this drops
-- and recreates it with no data loss.

BEGIN;

DROP TABLE IF EXISTS design_team_tasks CASCADE;

-- A helper claims/uploads/marks a design ready for the lead. This state NEVER moves
-- an order through production on its own; the lead/admin approve route owns that.
CREATE TABLE IF NOT EXISTS design_team_tasks (
  order_id      UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
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

DROP TRIGGER IF EXISTS trg_design_team_tasks_updated ON design_team_tasks;
CREATE TRIGGER trg_design_team_tasks_updated
  BEFORE UPDATE ON design_team_tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
