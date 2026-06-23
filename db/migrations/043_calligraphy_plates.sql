-- db/migrations/043_calligraphy_plates.sql
-- Admin calligraphy batch tool: one row per name-plate, grouped by job_id.
DO $$ BEGIN
  CREATE TYPE calligraphy_source AS ENUM ('typed','wholesaler','txt');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE calligraphy_status AS ENUM ('pending','done','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS calligraphy_plates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL,
  wholesaler_id UUID REFERENCES wholesalers(id) ON DELETE SET NULL,
  student_id    UUID REFERENCES students(id)    ON DELETE SET NULL,
  order_item_id UUID REFERENCES order_items(id) ON DELETE SET NULL,
  source        calligraphy_source NOT NULL,
  render_text   TEXT NOT NULL,
  status        calligraphy_status NOT NULL DEFAULT 'pending',
  model         TEXT,
  cost_usd      NUMERIC(10,5) NOT NULL DEFAULT 0,
  sheet_path    TEXT,
  plate_path    TEXT,
  error         TEXT,
  linked_at     TIMESTAMPTZ,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calligraphy_job     ON calligraphy_plates(job_id);
CREATE INDEX IF NOT EXISTS idx_calligraphy_student ON calligraphy_plates(student_id);
CREATE INDEX IF NOT EXISTS idx_calligraphy_status  ON calligraphy_plates(status);
CREATE INDEX IF NOT EXISTS idx_calligraphy_orderitem ON calligraphy_plates(order_item_id);
