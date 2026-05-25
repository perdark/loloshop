-- LoloShop — PostgreSQL Schema
-- Currency: IQD | Timezone: stored UTC, displayed UTC+3
-- All prices and costs in Iraqi Dinar (integer, no decimals)

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================
-- USERS — all roles share this table
-- =====================================================
CREATE TYPE user_role AS ENUM ('admin', 'staff', 'wholesaler', 'retail');

-- v2 shared enums
CREATE TYPE gender AS ENUM ('male', 'female');
CREATE TYPE price_role AS ENUM ('wholesaler', 'retail');
CREATE TYPE option_input AS ENUM ('single_select', 'toggle', 'counter');

CREATE TABLE users (
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

CREATE INDEX idx_users_role ON users(role);

-- =====================================================
-- OTP CODES — phone verification via Zentramsg WhatsApp
-- =====================================================
CREATE TABLE otp_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      TEXT NOT NULL,
  code       TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_otp_phone ON otp_codes(phone, used);

-- =====================================================
-- PASSWORD RESET TOKENS — email-based
-- =====================================================
CREATE TABLE password_resets (
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
CREATE TABLE wholesalers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  referral_code     TEXT NOT NULL UNIQUE,        -- e.g. 'baghdad-cs-2026'
  deadline          TIMESTAMPTZ,                  -- date by which students must complete designs
  approved_by_admin BOOLEAN NOT NULL DEFAULT TRUE, -- admin creates so default TRUE
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wholesalers_code ON wholesalers(referral_code);

-- =====================================================
-- STUDENTS — extends users for role=retail joining via wholesaler
-- (retail-only students without wholesaler also use this table; wholesaler_id NULL)
-- =====================================================
CREATE TYPE student_status AS ENUM ('pending_approval', 'approved', 'rejected');

CREATE TABLE students (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  wholesaler_id     UUID REFERENCES wholesalers(id) ON DELETE SET NULL,
  university_name   TEXT,                          -- free text per open.md answer #9
  department        TEXT,
  full_name_third   TEXT NOT NULL,                 -- name + father + grandfather (3rd name) for accountability
  gender            gender,                          -- v2: required to enforce shawl (female-only)
  status            student_status NOT NULL DEFAULT 'pending_approval',
  edit_exception    BOOLEAN NOT NULL DEFAULT FALSE, -- admin flag: allow design edit after confirm
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_students_wholesaler ON students(wholesaler_id);
CREATE INDEX idx_students_status ON students(status);

-- =====================================================
-- PRODUCTS — sashes + robes (admin-managed catalog)
-- =====================================================
CREATE TYPE product_type AS ENUM ('sash', 'robe', 'cap', 'shawl');

CREATE TABLE products (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type               product_type NOT NULL,
  name_ar            TEXT NOT NULL,
  description        TEXT,
  base_price         INTEGER NOT NULL CHECK (base_price >= 0), -- IQD
  customizable       BOOLEAN NOT NULL DEFAULT FALSE,           -- sash=true, robe=false
  gender_restriction gender,                                    -- v2: shawl = female-only
  image_url          TEXT,                                      -- main card photo
  featured           BOOLEAN NOT NULL DEFAULT FALSE,
  sort               INTEGER NOT NULL DEFAULT 0,
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE product_images (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_product_images_product ON product_images(product_id);

-- product variants: color/material/size — affect price
CREATE TABLE product_variants (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  color      TEXT,                                   -- white, gray, green, black, navy, burgundy...
  material   TEXT,                                   -- velvet, satin, etc.
  size       TEXT,                                   -- one-size, S, M, L, XL, XXL
  price      INTEGER NOT NULL CHECK (price >= 0),    -- IQD, overrides base_price
  image_url  TEXT,
  active     BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_variants_product ON product_variants(product_id);

-- =====================================================
-- DESIGNS — student-created sash designs (Fabric.js JSON)
-- =====================================================
CREATE TABLE designs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  variant_id      UUID REFERENCES product_variants(id),
  sash_color      TEXT,
  left_canvas     JSONB,        -- Fabric.js serialized state for left panel
  right_canvas    JSONB,        -- Fabric.js serialized state for right panel
  logo_url        TEXT,         -- university logo uploaded
  extra_image_url TEXT,         -- custom uploaded image
  fonts_used      TEXT[],       -- ['amiri', 'cairo', ...] for staff to load
  notes           TEXT,         -- student notes to staff
  completed       BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_designs_student ON designs(student_id);
CREATE INDEX idx_designs_completed ON designs(completed);

-- =====================================================
-- ORDERS — one per student per product
-- =====================================================
CREATE TYPE order_status AS ENUM (
  'pending_approval',  -- wholesaler hasn't approved student yet
  'designing',         -- student working on design
  'design_complete',   -- student confirmed
  'staff_review',      -- staff checking before print
  'printing',          -- in production
  'ready',             -- done, awaiting pickup
  'delivered',         -- picked up
  'cancelled'
);

CREATE TABLE orders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id   UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  product_id   UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id   UUID REFERENCES product_variants(id),
  design_id    UUID REFERENCES designs(id),
  price        INTEGER NOT NULL CHECK (price >= 0),   -- IQD, snapshot at order time
  cost         INTEGER CHECK (cost >= 0),             -- admin enters manually
  profit       INTEGER GENERATED ALWAYS AS (price - COALESCE(cost, 0)) STORED,
  status       order_status NOT NULL DEFAULT 'pending_approval',
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ
);

CREATE INDEX idx_orders_student ON orders(student_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created ON orders(created_at DESC);

-- =====================================================
-- AUDIT LOG — track approvals, deadline extensions, status changes
-- =====================================================
CREATE TABLE audit_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   UUID REFERENCES users(id),              -- who did it
  action     TEXT NOT NULL,                          -- 'approve_student', 'extend_deadline', 'status_change', etc.
  entity     TEXT NOT NULL,                          -- 'student', 'wholesaler', 'order'
  entity_id  UUID NOT NULL,
  details    JSONB,                                  -- before/after state
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);
CREATE INDEX idx_audit_actor ON audit_log(actor_id);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);

-- =====================================================
-- NOTIFICATIONS — in-app only (MVP)
-- =====================================================
CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,         -- 'student_joined', 'approved', 'rejected', 'deadline_warning', 'status_change'
  title_ar   TEXT NOT NULL,
  body_ar    TEXT,
  link       TEXT,                  -- in-app deep link
  read       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, read);

-- =====================================================
-- TEMPLATES — pre-made designs per university (P3, scaffold now)
-- =====================================================
CREATE TABLE design_templates (
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

CREATE TRIGGER trg_users_updated      BEFORE UPDATE ON users      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_designs_updated    BEFORE UPDATE ON designs    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_orders_updated     BEFORE UPDATE ON orders     FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================
-- V2 — admin-managed options + role pricing + batches + packages
-- (mirrors db/migrations/001_v2_product_pricing.sql for fresh installs)
-- =====================================================
CREATE TABLE option_groups (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id         UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name_ar            TEXT NOT NULL,
  input_type         option_input NOT NULL DEFAULT 'single_select',
  sort               INTEGER NOT NULL DEFAULT 0,
  required           BOOLEAN NOT NULL DEFAULT FALSE,   -- admin-editable
  has_image          BOOLEAN NOT NULL DEFAULT FALSE,   -- admin-editable (can remove image)
  hint_ar            TEXT,
  image_url          TEXT,                              -- explanatory image (admin upload)
  max_select         INTEGER NOT NULL DEFAULT 1,        -- e.g. sleeves = 2
  gender_restriction gender,
  requires_customer_image BOOLEAN NOT NULL DEFAULT FALSE, -- customer must upload a photo for this field
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_option_groups_product ON option_groups(product_id);

CREATE TABLE options (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID NOT NULL REFERENCES option_groups(id) ON DELETE CASCADE,
  label_ar    TEXT NOT NULL,
  price_delta INTEGER NOT NULL DEFAULT 0 CHECK (price_delta >= 0),
  image_url   TEXT,
  sort        INTEGER NOT NULL DEFAULT 0,
  requires_customer_image BOOLEAN NOT NULL DEFAULT FALSE, -- this specific value needs a customer photo (e.g. مثلث)
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_options_group ON options(group_id);

CREATE TABLE option_price_roles (
  option_id   UUID NOT NULL REFERENCES options(id) ON DELETE CASCADE,
  role        price_role NOT NULL,
  price_delta INTEGER NOT NULL CHECK (price_delta >= 0),
  PRIMARY KEY (option_id, role)
);

CREATE TABLE product_price_roles (
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  role       price_role NOT NULL,
  base_price INTEGER NOT NULL CHECK (base_price >= 0),
  PRIMARY KEY (product_id, role)
);

CREATE TABLE batches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ar       TEXT NOT NULL,                          -- e.g. 'طب عام 2026'
  wholesaler_id UUID REFERENCES wholesalers(id) ON DELETE SET NULL,
  deadline      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_batches_wholesaler ON batches(wholesaler_id);

ALTER TABLE orders ADD COLUMN batch_id UUID REFERENCES batches(id) ON DELETE SET NULL;
CREATE INDEX idx_orders_batch ON orders(batch_id);

CREATE TABLE order_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  group_id       UUID REFERENCES option_groups(id) ON DELETE SET NULL,
  option_id      UUID REFERENCES options(id) ON DELETE SET NULL,
  label_snapshot TEXT NOT NULL,
  price_snapshot INTEGER NOT NULL DEFAULT 0,
  qty            INTEGER NOT NULL DEFAULT 1,
  customer_image_url TEXT,                       -- photo the customer uploaded for this option
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_order_items_order ON order_items(order_id);

CREATE TABLE packages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ar    TEXT NOT NULL,                             -- 'ملكي' | 'عادي'
  role       price_role NOT NULL DEFAULT 'wholesaler',
  price      INTEGER NOT NULL CHECK (price >= 0),
  image_url  TEXT,
  sort       INTEGER NOT NULL DEFAULT 0,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE package_rules (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id          UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  sash_type_option_id UUID NOT NULL REFERENCES options(id) ON DELETE CASCADE,
  UNIQUE (sash_type_option_id)
);

COMMIT;
