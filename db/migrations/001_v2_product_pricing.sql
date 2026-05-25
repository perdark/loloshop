-- LoloShop v2 — admin-managed options + role pricing + batches + packages
-- Additive migration, safe on existing data. Run: psql $DATABASE_URL -f db/migrations/001_v2_product_pricing.sql
-- No explicit transaction: psql autocommits each statement (needed for ALTER TYPE ADD VALUE).

-- ---- Enums ----
ALTER TYPE product_type ADD VALUE IF NOT EXISTS 'cap';
ALTER TYPE product_type ADD VALUE IF NOT EXISTS 'shawl';

DO $$ BEGIN CREATE TYPE option_input AS ENUM ('single_select','toggle','counter');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE gender AS ENUM ('male','female');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE price_role AS ENUM ('wholesaler','retail');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- Column adds ----
ALTER TABLE products ADD COLUMN IF NOT EXISTS gender_restriction gender;
ALTER TABLE students ADD COLUMN IF NOT EXISTS gender gender;

-- ---- option_groups: a configurable field on a product (admin-managed) ----
CREATE TABLE IF NOT EXISTS option_groups (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id         UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name_ar            TEXT NOT NULL,
  input_type         option_input NOT NULL DEFAULT 'single_select',
  sort               INTEGER NOT NULL DEFAULT 0,
  required           BOOLEAN NOT NULL DEFAULT FALSE,   -- admin-editable
  has_image          BOOLEAN NOT NULL DEFAULT FALSE,   -- admin-editable (can remove image)
  hint_ar            TEXT,                              -- shown to student
  image_url          TEXT,                              -- explanatory image (admin upload)
  max_select         INTEGER NOT NULL DEFAULT 1,        -- e.g. sleeves = 2
  gender_restriction gender,
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_option_groups_product ON option_groups(product_id);

-- ---- options: a value inside a group ----
CREATE TABLE IF NOT EXISTS options (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID NOT NULL REFERENCES option_groups(id) ON DELETE CASCADE,
  label_ar    TEXT NOT NULL,
  price_delta INTEGER NOT NULL DEFAULT 0 CHECK (price_delta >= 0),  -- admin-editable
  image_url   TEXT,
  sort        INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_options_group ON options(group_id);

-- ---- Role-based price overrides (fall back to base when no row) ----
CREATE TABLE IF NOT EXISTS option_price_roles (
  option_id   UUID NOT NULL REFERENCES options(id) ON DELETE CASCADE,
  role        price_role NOT NULL,
  price_delta INTEGER NOT NULL CHECK (price_delta >= 0),
  PRIMARY KEY (option_id, role)
);

CREATE TABLE IF NOT EXISTS product_price_roles (
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  role       price_role NOT NULL,
  base_price INTEGER NOT NULL CHECK (base_price >= 0),
  PRIMARY KEY (product_id, role)
);

-- ---- Batches (دفعات) ----
CREATE TABLE IF NOT EXISTS batches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ar       TEXT NOT NULL,                          -- e.g. 'طب عام 2026'
  wholesaler_id UUID REFERENCES wholesalers(id) ON DELETE SET NULL,
  deadline      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_batches_wholesaler ON batches(wholesaler_id);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES batches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_batch ON orders(batch_id);

-- ---- order_items: immutable price snapshot per chosen option ----
CREATE TABLE IF NOT EXISTS order_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  group_id       UUID REFERENCES option_groups(id) ON DELETE SET NULL,
  option_id      UUID REFERENCES options(id) ON DELETE SET NULL,
  label_snapshot TEXT NOT NULL,
  price_snapshot INTEGER NOT NULL DEFAULT 0,
  qty            INTEGER NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- ---- Packages (wholesaler bundles: robe + sash + cap), tier driven by sash type ----
CREATE TABLE IF NOT EXISTS packages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ar    TEXT NOT NULL,                             -- 'ملكي' | 'عادي'
  role       price_role NOT NULL DEFAULT 'wholesaler',
  price      INTEGER NOT NULL CHECK (price >= 0),
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- which sash-type option maps to which package tier (cap stays swappable)
CREATE TABLE IF NOT EXISTS package_rules (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id          UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  sash_type_option_id UUID NOT NULL REFERENCES options(id) ON DELETE CASCADE,
  UNIQUE (sash_type_option_id)
);
