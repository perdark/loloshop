-- Direct workshop production + dual wholesaler/admin pricing.
BEGIN;

-- The old run/assignment/payment workflow is intentionally retired with its history.
DROP TABLE IF EXISTS workshop_payments CASCADE;
DROP TABLE IF EXISTS workshop_ledger CASCADE;
DROP TABLE IF EXISTS workshop_assignments CASCADE;
DROP TABLE IF EXISTS workshop_runs CASCADE;

CREATE TABLE IF NOT EXISTS workshop_production_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id   UUID NOT NULL REFERENCES workshop_workers(id) ON DELETE CASCADE,
  product     TEXT NOT NULL,
  operation   TEXT NOT NULL,
  qty         INTEGER NOT NULL CHECK (qty > 0),
  rate        BIGINT NOT NULL CHECK (rate >= 0),
  amount      BIGINT NOT NULL CHECK (amount >= 0),
  work_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  note        TEXT,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_workshop_production_worker
  ON workshop_production_entries(worker_id, work_date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS workshop_adjustments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id   UUID NOT NULL REFERENCES workshop_workers(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('bonus', 'deduction')),
  amount      BIGINT NOT NULL CHECK (amount > 0),
  reason      TEXT NOT NULL,
  entry_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_workshop_adjustments_worker
  ON workshop_adjustments(worker_id, entry_date DESC, created_at DESC);

-- Convert legacy numeric add-ons to explicit admin/selling pairs. Existing add-ons
-- initially carry zero wholesaler profit, except the agreed American-shawl split.
UPDATE wholesalers w
SET pricing_addons = (
  SELECT jsonb_object_agg(
    e.key,
    jsonb_build_object(
      'admin', CASE
        WHEN jsonb_typeof(e.value) = 'object' THEN COALESCE((e.value->>'admin')::bigint, 0)
        WHEN e.key = 'american_shawl' THEN 20000
        ELSE COALESCE((e.value #>> '{}')::bigint, 0) END,
      'selling', CASE
        WHEN jsonb_typeof(e.value) = 'object' THEN COALESCE((e.value->>'selling')::bigint, 0)
        WHEN e.key = 'american_shawl' THEN 25000
        ELSE COALESCE((e.value #>> '{}')::bigint, 0) END
    )
  )
  FROM jsonb_each(COALESCE(w.pricing_addons, '{}'::jsonb)) e
)
WHERE EXISTS (SELECT 1 FROM jsonb_each(COALESCE(w.pricing_addons, '{}'::jsonb)));

ALTER TABLE wholesalers ALTER COLUMN pricing_addons SET DEFAULT
  '{"royal_sash":{"admin":15000,"selling":15000},"royal_cap_when_normal_sash":{"admin":3000,"selling":3000},"extra_cap_embroidery":{"admin":3000,"selling":3000},"robe_sleeve_each":{"admin":5000,"selling":5000},"american_shawl":{"admin":20000,"selling":25000},"piece_sash_normal":{"admin":20000,"selling":20000},"piece_sash_royal":{"admin":25000,"selling":25000},"piece_cap_normal":{"admin":15000,"selling":15000},"piece_cap_royal":{"admin":20000,"selling":20000},"piece_robe_normal":{"admin":25000,"selling":25000},"piece_robe_royal":{"admin":25000,"selling":25000}}'::jsonb;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS admin_price_snapshot BIGINT NOT NULL DEFAULT 0
  CHECK (admin_price_snapshot >= 0);

COMMIT;
