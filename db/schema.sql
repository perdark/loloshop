-- LoloShop — PostgreSQL Schema
-- Currency: IQD | Timezone: stored UTC, displayed UTC+3
-- All prices and costs in Iraqi Dinar (BIGINT, no decimals — batch totals can exceed INT4).
-- Idempotent: safe to re-run `npm run migrate` against an existing DB.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================
-- ENUMS (guarded so re-running migrate does not error)
-- =====================================================
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'staff', 'wholesaler', 'retail');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE gender AS ENUM ('male', 'female');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE price_role AS ENUM ('wholesaler', 'retail');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE option_input AS ENUM ('single_select', 'toggle', 'counter');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE student_status AS ENUM ('pending_approval', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE product_type AS ENUM ('sash', 'robe', 'cap', 'shawl');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM (
    'pending_approval', 'designing', 'design_complete', 'staff_review',
    'printing', 'ready', 'delivered', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =====================================================
-- USERS — all roles share this table
-- =====================================================
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL UNIQUE,
  email         TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role          user_role NOT NULL,
  phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- =====================================================
-- OTP CODES — phone verification via Zentramsg WhatsApp
-- =====================================================
CREATE TABLE IF NOT EXISTS otp_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      TEXT NOT NULL,
  code       TEXT NOT NULL,
  purpose    TEXT NOT NULL DEFAULT 'verify',
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone, used);
CREATE INDEX IF NOT EXISTS idx_otp_phone_purpose ON otp_codes(phone, purpose, used);

-- Migrate existing rows if column was added to a live DB:
-- ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'verify';

-- =====================================================
-- PASSWORD RESET TOKENS — email-based
-- =====================================================
CREATE TABLE IF NOT EXISTS password_resets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- WHOLESALERS — extends users for role=wholesaler
-- =====================================================
CREATE TABLE IF NOT EXISTS wholesalers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  referral_code     TEXT NOT NULL UNIQUE,
  deadline          TIMESTAMPTZ,
  commission_rate   NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (commission_rate >= 0 AND commission_rate <= 100),
  approved_by_admin BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE wholesalers ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,2) NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_wholesalers_code ON wholesalers(referral_code);

-- =====================================================
-- STUDENTS — retail users; wholesaler_id NULL for independent retail
-- =====================================================
CREATE TABLE IF NOT EXISTS students (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  wholesaler_id     UUID REFERENCES wholesalers(id) ON DELETE SET NULL,
  university_name   TEXT,
  department        TEXT,
  full_name_third   TEXT NOT NULL,
  gender            gender,
  status            student_status NOT NULL DEFAULT 'pending_approval',
  edit_exception    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_students_wholesaler ON students(wholesaler_id);
CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);

-- =====================================================
-- PRODUCTS — sashes + robes (admin-managed catalog)
-- =====================================================
CREATE TABLE IF NOT EXISTS products (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type               product_type NOT NULL,
  name_ar            TEXT NOT NULL,
  description        TEXT,
  base_price         BIGINT NOT NULL CHECK (base_price >= 0),
  customizable       BOOLEAN NOT NULL DEFAULT FALSE,
  gender_restriction gender,
  image_url          TEXT,
  featured           BOOLEAN NOT NULL DEFAULT FALSE,
  sort               INTEGER NOT NULL DEFAULT 0,
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  parent_id          UUID REFERENCES products(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_images (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id);

CREATE TABLE IF NOT EXISTS product_variants (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  color      TEXT,
  material   TEXT,
  size       TEXT,
  price      BIGINT NOT NULL CHECK (price >= 0),
  image_url  TEXT,
  active     BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);

-- =====================================================
-- DESIGNS — student-created sash designs (Fabric.js JSON)
-- Canvas JSON must reference uploaded images by /uploads URL, never inline base64.
-- =====================================================
CREATE TABLE IF NOT EXISTS designs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id            UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  variant_id            UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  sash_color            TEXT,
  left_canvas           JSONB,
  right_canvas          JSONB,
  canvas_schema_version SMALLINT NOT NULL DEFAULT 1,
  fabric_version        TEXT,
  logo_url              TEXT,
  extra_image_url       TEXT,
  fonts_used            TEXT[],
  notes                 TEXT,
  completed             BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_designs_student ON designs(student_id);
CREATE INDEX IF NOT EXISTS idx_designs_completed ON designs(completed);

-- =====================================================
-- ORDERS — one active order per student per product (enforced below)
-- =====================================================
CREATE TABLE IF NOT EXISTS orders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id   UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  product_id   UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id   UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  design_id    UUID REFERENCES designs(id) ON DELETE SET NULL,
  price        BIGINT NOT NULL CHECK (price >= 0),
  cost         BIGINT NOT NULL DEFAULT 0 CHECK (cost >= 0),
  profit       BIGINT GENERATED ALWAYS AS (price - cost) STORED,
  currency     CHAR(3) NOT NULL DEFAULT 'IQD',
  status       order_status NOT NULL DEFAULT 'pending_approval',
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_orders_student ON orders(student_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
-- Serve the admin dashboard (filter by status, sort by date) and per-student lists.
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_student_created ON orders(student_id, created_at DESC);
-- One non-cancelled order per (student, product) when no design is attached.
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_student_product_nodesign
  ON orders(student_id, product_id)
  WHERE design_id IS NULL AND status <> 'cancelled';

-- =====================================================
-- AUDIT LOG
-- =====================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   UUID REFERENCES users(id),
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  UUID NOT NULL,
  details    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

-- =====================================================
-- NOTIFICATIONS — in-app only (MVP)
-- =====================================================
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title_ar   TEXT NOT NULL,
  body_ar    TEXT,
  link       TEXT,
  read       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);

-- =====================================================
-- TEMPLATES — pre-made designs per university (P3, scaffold now)
-- =====================================================
CREATE TABLE IF NOT EXISTS design_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  university_name TEXT,
  department      TEXT,
  preview_url     TEXT,
  left_canvas     JSONB,
  right_canvas    JSONB,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- AUTO-UPDATE updated_at trigger
-- =====================================================
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated   BEFORE UPDATE ON users   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_designs_updated ON designs;
CREATE TRIGGER trg_designs_updated BEFORE UPDATE ON designs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_orders_updated ON orders;
CREATE TRIGGER trg_orders_updated  BEFORE UPDATE ON orders  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================
-- V2 — admin-managed options + role pricing + batches + packages
-- =====================================================
CREATE TABLE IF NOT EXISTS option_groups (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id         UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name_ar            TEXT NOT NULL,
  input_type         option_input NOT NULL DEFAULT 'single_select',
  sort               INTEGER NOT NULL DEFAULT 0,
  required           BOOLEAN NOT NULL DEFAULT FALSE,
  has_image          BOOLEAN NOT NULL DEFAULT FALSE,
  hint_ar            TEXT,
  image_url          TEXT,
  max_select         INTEGER NOT NULL DEFAULT 1,
  gender_restriction gender,
  requires_customer_image BOOLEAN NOT NULL DEFAULT FALSE,
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_option_groups_product ON option_groups(product_id);

CREATE TABLE IF NOT EXISTS options (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID NOT NULL REFERENCES option_groups(id) ON DELETE CASCADE,
  label_ar    TEXT NOT NULL,
  price_delta BIGINT NOT NULL DEFAULT 0 CHECK (price_delta >= 0),
  image_url   TEXT,
  sort        INTEGER NOT NULL DEFAULT 0,
  requires_customer_image BOOLEAN NOT NULL DEFAULT FALSE,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_options_group ON options(group_id);

CREATE TABLE IF NOT EXISTS option_price_roles (
  option_id   UUID NOT NULL REFERENCES options(id) ON DELETE CASCADE,
  role        price_role NOT NULL,
  price_delta BIGINT NOT NULL CHECK (price_delta >= 0),
  PRIMARY KEY (option_id, role)
);

CREATE TABLE IF NOT EXISTS product_price_roles (
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  role       price_role NOT NULL,
  base_price BIGINT NOT NULL CHECK (base_price >= 0),
  PRIMARY KEY (product_id, role)
);

CREATE TABLE IF NOT EXISTS batches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ar       TEXT NOT NULL,
  wholesaler_id UUID REFERENCES wholesalers(id) ON DELETE SET NULL,
  deadline      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_batches_wholesaler ON batches(wholesaler_id);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES batches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_batch ON orders(batch_id);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS package_id UUID REFERENCES packages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_package ON orders(package_id);

CREATE TABLE IF NOT EXISTS order_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  group_id       UUID REFERENCES option_groups(id) ON DELETE SET NULL,
  option_id      UUID REFERENCES options(id) ON DELETE SET NULL,
  label_snapshot TEXT NOT NULL,
  price_snapshot BIGINT NOT NULL DEFAULT 0,
  qty            INTEGER NOT NULL DEFAULT 1,
  customer_image_url TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS packages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ar    TEXT NOT NULL,
  role       price_role NOT NULL DEFAULT 'wholesaler',
  price      BIGINT NOT NULL CHECK (price >= 0),
  image_url  TEXT,
  sort       INTEGER NOT NULL DEFAULT 0,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS package_rules (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id          UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  sash_type_option_id UUID NOT NULL REFERENCES options(id) ON DELETE CASCADE,
  UNIQUE (sash_type_option_id)
);

-- Migration 005: product parent-child hierarchy
ALTER TABLE products ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES products(id) ON DELETE SET NULL;

COMMIT;
