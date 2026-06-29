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
    'printing', 'embroidery', 'pressing', 'preparing', 'ready', 'delivered', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Production-pipeline stages (Migration 010). Idempotent upgrade for existing DBs;
-- no-op on a fresh DB where CREATE TYPE above already lists them. Adding a value is
-- transaction-safe here because schema.sql never USES these values as data.
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'embroidery';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'pressing';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'preparing';

-- Migration 012: digitizing stage (تحويل التصميم لتطريز) sits between design_complete and embroidery.
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'converting';

-- Staff job-types (Migration 010). Meaningful only when users.role = 'staff'.
-- Migration 012 adds 'digitizer' (محوّل التطريز) — owns the 'converting' stage.
-- Migration 028 adds 'tailor' (مفصل) — a read-only view role (student name + sash +
-- American-shawl info only), no production stage of its own.
DO $$ BEGIN
  CREATE TYPE staff_type AS ENUM ('designer', 'embroiderer', 'presser', 'preparer', 'manager', 'digitizer', 'tailor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TYPE staff_type ADD VALUE IF NOT EXISTS 'digitizer';
ALTER TYPE staff_type ADD VALUE IF NOT EXISTS 'tailor';

-- Migration 013: student study schedule (صباحي/مسائي), now mandatory at signup.
DO $$ BEGIN
  CREATE TYPE study_type AS ENUM ('morning', 'evening');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Migration 013: staff payroll ledger entry kinds.
DO $$ BEGIN
  CREATE TYPE salary_txn_type AS ENUM ('salary_set', 'bonus', 'deduction');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Individual design approval verdict (Migration 010).
DO $$ BEGIN
  CREATE TYPE design_approval_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =====================================================
-- USERS — all roles share this table
-- =====================================================
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  phone         TEXT UNIQUE,  -- nullable: phoneless staff log in via the private staff portal (see migration 042)
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
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Brute-force guard column for pre-existing DBs (idempotent).
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
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
-- TRUSTED DEVICES — skip the login OTP on a known device (migration 048)
-- After a login/signup OTP we mint a random device token, store its sha-256 hash,
-- and hand the raw token to the client. A matching non-expired row lets the next
-- login skip the WhatsApp OTP (password still required). Cuts OTP volume → protects
-- the WhatsApp sender number from spam bans. Password reset deletes the user's rows.
-- =====================================================
CREATE TABLE IF NOT EXISTS trusted_devices (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_trusted_devices_token ON trusted_devices(token_hash);

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
-- Migration 032: per-wholesaler «التسعيرة» (pricing) — admin-private base price, rep/student
-- base price, and editable add-on surcharges. Replaces commission as the rep's earning model.
ALTER TABLE wholesalers ADD COLUMN IF NOT EXISTS admin_price      BIGINT NOT NULL DEFAULT 0 CHECK (admin_price >= 0);
ALTER TABLE wholesalers ADD COLUMN IF NOT EXISTS wholesaler_price BIGINT NOT NULL DEFAULT 0 CHECK (wholesaler_price >= 0);
ALTER TABLE wholesalers ADD COLUMN IF NOT EXISTS pricing_addons   JSONB  NOT NULL DEFAULT
  '{"royal_sash":10000,"royal_cap_when_normal_sash":3000,"extra_cap_embroidery":3000,"robe_sleeve_each":5000,"american_shawl":25000}'::jsonb;
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
  wholesaler_only    BOOLEAN NOT NULL DEFAULT FALSE,
  parent_id          UUID REFERENCES products(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Migration 035: optional «السعر قبل الخصم» (compare-at / old price) for storefront discounts.
ALTER TABLE products ADD COLUMN IF NOT EXISTS compare_at_price BIGINT
  CHECK (compare_at_price IS NULL OR compare_at_price >= 0);

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
  embroidery_color      TEXT,
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
  actor_id   UUID REFERENCES users(id) ON DELETE SET NULL,
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

-- Admin can lock a (child) product's option group to a single fixed option.
-- Keyed by the child product_id so inherited (parent) groups can be locked per-child.
CREATE TABLE IF NOT EXISTS product_locked_options (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  group_id   UUID NOT NULL REFERENCES option_groups(id) ON DELETE CASCADE,
  option_id  UUID NOT NULL REFERENCES options(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, group_id)
);
CREATE INDEX IF NOT EXISTS idx_product_locked_options_product ON product_locked_options(product_id);

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

-- packages must exist BEFORE orders.package_id FK (C1 fix: moved up from below order_items)
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

-- Migration 019: VIP package tier (retail premium graduation bundle).
-- VIP is a TIER of `packages`, not a new entity — reuses configurePackage()/listPackages/CRUD.
ALTER TABLE packages ADD COLUMN IF NOT EXISTS is_vip         BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS description    TEXT;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS features       JSONB NOT NULL DEFAULT '[]'::jsonb;   -- ordered Arabic perks
ALTER TABLE packages ADD COLUMN IF NOT EXISTS included_items JSONB NOT NULL DEFAULT '[]'::jsonb;   -- "what's inside" checklist
ALTER TABLE packages ADD COLUMN IF NOT EXISTS badge_label    TEXT;                                  -- e.g. VIP / الأفخم
ALTER TABLE packages ADD COLUMN IF NOT EXISTS accent         TEXT;                                  -- hex for badge/halo ONLY
ALTER TABLE packages ADD COLUMN IF NOT EXISTS story_image_url TEXT;                                  -- editorial "story" photo on the VIP page (migration 020)
-- Migration 034: ordered list of photos that auto-rotate on the storefront package card.
ALTER TABLE packages ADD COLUMN IF NOT EXISTS gallery JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS idx_packages_vip ON packages(role, is_vip, active, sort) WHERE active = TRUE;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS package_id UUID REFERENCES packages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_package ON orders(package_id);

-- Migration 011: checkout_group_id links all orders from a single cart checkout.
-- Single-item checkouts leave this NULL. orders stay separate; we only link them.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS checkout_group_id UUID;
CREATE INDEX IF NOT EXISTS idx_orders_checkout_group ON orders(checkout_group_id);

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

-- Migration 005: product parent-child hierarchy
ALTER TABLE products ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES products(id) ON DELETE SET NULL;

-- Migration 008: wholesaler-only product visibility
ALTER TABLE products ADD COLUMN IF NOT EXISTS wholesaler_only BOOLEAN NOT NULL DEFAULT FALSE;

-- Migration 023: retail-only product visibility flag
ALTER TABLE products ADD COLUMN IF NOT EXISTS retail_only BOOLEAN NOT NULL DEFAULT FALSE;

-- Migration 026: per-product image fit ('cover' crop-to-fill, 'contain' zoom-out-whole)
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_fit TEXT NOT NULL DEFAULT 'cover'
  CHECK (image_fit IN ('cover', 'contain'));

-- Migration 009: per-wholesaler sash side lock.
-- Wholesaler-joined students design only one side; the other (locked) side
-- shows the admin/wholesaler's saved default Fabric JSON, read-only.
ALTER TABLE wholesalers ADD COLUMN IF NOT EXISTS editable_sash_side TEXT;
ALTER TABLE wholesalers ADD COLUMN IF NOT EXISTS locked_side_design JSONB;
DO $$ BEGIN
  ALTER TABLE wholesalers
    ADD CONSTRAINT chk_wholesalers_editable_side
    CHECK (editable_sash_side IS NULL OR editable_sash_side IN ('left', 'right'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =====================================================
-- Migration 010 — multi-role staff + production pipeline + retail cart
-- =====================================================

-- Staff job-type (designer | embroiderer | presser | preparer | manager | digitizer | tailor); NULL for non-staff.
ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_type staff_type;
CREATE INDEX IF NOT EXISTS idx_users_staff_type ON users(staff_type) WHERE staff_type IS NOT NULL;

-- Migration 029: multi-role staff. staff_types[] is the authoritative set of roles a
-- staff member holds; staff_type above is kept in sync as the PRIMARY role (staff_types[1])
-- for backward-compatible single-role reads. Backfill one-element arrays for existing staff.
ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_types staff_type[];
UPDATE users
   SET staff_types = ARRAY[staff_type]::staff_type[]
 WHERE role = 'staff'
   AND staff_type IS NOT NULL
   AND (staff_types IS NULL OR cardinality(staff_types) = 0);

-- Staff order-scope (Migration 011): which order SOURCE a staff member handles —
-- 'retail' (independent students), 'wholesaler' (rep-linked students), or 'both'.
-- An order's source = its student's wholesaler_id (NULL = retail). Manager/admin = all.
DO $$ BEGIN
  CREATE TYPE staff_order_scope AS ENUM ('retail', 'wholesaler', 'both');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE users ADD COLUMN IF NOT EXISTS order_scope staff_order_scope NOT NULL DEFAULT 'both';

-- Individual design approval gate (set by the designer / manager / admin).
-- Migration 037: embroidery/thread color typed text (parallels sash_color).
ALTER TABLE designs ADD COLUMN IF NOT EXISTS embroidery_color TEXT;

ALTER TABLE designs ADD COLUMN IF NOT EXISTS approval_status design_approval_status NOT NULL DEFAULT 'pending';
ALTER TABLE designs ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE designs ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE designs ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_designs_approval ON designs(approval_status);

-- Retail shopping cart — one active cart per user; items snapshot the configured selections + price.
CREATE TABLE IF NOT EXISTS carts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cart_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id        UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  design_id      UUID REFERENCES designs(id) ON DELETE SET NULL,  -- set for a designed sash line
  selections     JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{group_id, option_id, qty, customer_image_url}]
  price_snapshot BIGINT NOT NULL CHECK (price_snapshot >= 0),
  qty            INTEGER NOT NULL DEFAULT 1 CHECK (qty >= 1),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cart_items_cart ON cart_items(cart_id);
-- Idempotent upgrade for DBs created before the designed-sash cart line existed.
ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS design_id UUID REFERENCES designs(id) ON DELETE SET NULL;
-- Robe tailoring measurements (فصال الروب) carried per cart line → copied to orders.measurements at checkout.
ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS measurements JSONB;

DROP TRIGGER IF EXISTS trg_carts_updated ON carts;
CREATE TRIGGER trg_carts_updated BEFORE UPDATE ON carts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================
-- Migration 013 — batch: signup fields, embroidery text, robe measurements,
-- production routing flags, staff presence, final design, salary + activity
-- =====================================================

-- Signup: university_name + department already exist; add study schedule + Instagram.
ALTER TABLE students ADD COLUMN IF NOT EXISTS study_type study_type;
ALTER TABLE students ADD COLUMN IF NOT EXISTS instagram_username TEXT;

-- Embroidery options (cap "تطريز القبعة" side/top, robe "تطريز الأكمام"):
-- require a free-text instruction (what to embroider) in addition to an image.
ALTER TABLE option_groups ADD COLUMN IF NOT EXISTS requires_customer_text BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE options       ADD COLUMN IF NOT EXISTS requires_customer_text BOOLEAN NOT NULL DEFAULT FALSE;
-- Student's typed embroidery instruction, snapshotted onto the order line.
ALTER TABLE order_items   ADD COLUMN IF NOT EXISTS customer_text TEXT;

-- Robe tailoring measurements (فصال الروب) in cm — not priced.
-- {shoulder_cm, robe_length_cm, sleeve_length_cm}
ALTER TABLE orders ADD COLUMN IF NOT EXISTS measurements JSONB;

-- Production routing flags, computed at order creation (configureOrder).
--   has_embroidery: order passes through converting + embroidery stages.
--   needs_pressing: order also passes through the pressing stage (sash only).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS has_embroidery BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS needs_pressing BOOLEAN NOT NULL DEFAULT FALSE;
-- Migration 047: embroiderer per-zone checklist progress, keyed by zone key e.g. {"sash_right": true}.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS embroidery_zones JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Migration 036: parallel «الفصال» (tailor) track for retail orders — independent of status.
DO $$ BEGIN
  CREATE TYPE tailor_track_status AS ENUM ('pending', 'done');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tailor_status tailor_track_status NOT NULL DEFAULT 'pending';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tailor_done_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tailor_done_by UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_tailor_pending ON orders(tailor_status) WHERE tailor_status = 'pending';

-- Migration 044: wholesaler order-approval gate (orthogonal, mirrors tailor_status pattern).
-- NULL = retail / not applicable (always visible to staff).
-- 'pending' = waiting for rep approval. 'approved' = enters staff queue. 'rejected' = sent back.
DO $$ BEGIN
  CREATE TYPE wholesaler_approval_status AS ENUM ('pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS wholesaler_approval     wholesaler_approval_status;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS wholesaler_approved_at  TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS wholesaler_approved_by  UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS wholesaler_reject_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_wholesaler_approval ON orders(wholesaler_approval);

-- Staff presence: who is actively working on an order (admin monitor + soft lock).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS working_staff_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS working_since TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_orders_working_staff ON orders(working_staff_id) WHERE working_staff_id IS NOT NULL;

-- Final design image uploaded by admin/designer when a design is finished
-- (works for all product types incl. cap/robe where design_id IS NULL).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS final_design_url TEXT;

-- Backfill routing flags for pre-existing orders (best effort):
-- designed sashes get the full embroidery+pressing route; everything else stays flat.
UPDATE orders SET has_embroidery = TRUE, needs_pressing = TRUE
  WHERE design_id IS NOT NULL AND has_embroidery = FALSE AND needs_pressing = FALSE;

-- =====================================================
-- STAFF PAYROLL — base salary + ledger of bonuses/deductions (IQD)
-- =====================================================
CREATE TABLE IF NOT EXISTS staff_salaries (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  base_salary BIGINT NOT NULL DEFAULT 0 CHECK (base_salary >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS staff_salary_transactions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       salary_txn_type NOT NULL,
  amount     BIGINT NOT NULL CHECK (amount >= 0),
  reason_ar  TEXT,
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_id   UUID,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  delete_reason_ar TEXT
);
ALTER TABLE staff_salary_transactions ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE staff_salary_transactions ADD COLUMN IF NOT EXISTS source_id UUID;
ALTER TABLE staff_salary_transactions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE staff_salary_transactions ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE staff_salary_transactions ADD COLUMN IF NOT EXISTS delete_reason_ar TEXT;
CREATE INDEX IF NOT EXISTS idx_salary_txn_user ON staff_salary_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_salary_txn_active_user ON staff_salary_transactions(user_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- =====================================================
-- STAFF ACTIVITY LOG — auto-recorded production actions (advance/revert/claim)
-- =====================================================
CREATE TABLE IF NOT EXISTS staff_activity_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action     TEXT NOT NULL,
  order_id   UUID REFERENCES orders(id) ON DELETE SET NULL,
  from_stage TEXT,
  to_stage   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_activity_user ON staff_activity_log(user_id, created_at DESC);

-- =====================================================
-- STAFF GOALS — incentive targets (e.g. "complete 15 orders before tomorrow").
-- Progress = completed production actions (advance/approve_design) within the window.
-- The bonus_amount is auto-awarded as a salary 'bonus' transaction once the target is hit.
-- =====================================================
CREATE TABLE IF NOT EXISTS staff_goals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_ar     TEXT,
  target_count INTEGER NOT NULL CHECK (target_count > 0),
  bonus_amount BIGINT NOT NULL DEFAULT 0 CHECK (bonus_amount >= 0),
  deadline     TIMESTAMPTZ NOT NULL,
  awarded      BOOLEAN NOT NULL DEFAULT FALSE,
  awarded_at   TIMESTAMPTZ,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_goals_user ON staff_goals(user_id, created_at DESC);

-- =====================================================
-- STAFF ATTENDANCE — بصمة الموظفين
-- Admin controls the required shift window, grace minutes, per-minute late
-- penalty marker, and shop verification requirements (network/GPS/both/none).
-- Attendance is intentionally separate from payroll; late markers do not create
-- salary transactions.
-- Times are stored UTC as timestamps on records and displayed in Asia/Baghdad.
-- =====================================================
CREATE TABLE IF NOT EXISTS staff_attendance_settings (
  id                         BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  start_time                 TIME NOT NULL DEFAULT '09:00',
  end_time                   TIME NOT NULL DEFAULT '18:00',
  grace_minutes              INTEGER NOT NULL DEFAULT 15 CHECK (grace_minutes >= 0),
  deduction_per_minute       BIGINT NOT NULL DEFAULT 0 CHECK (deduction_per_minute >= 0),
  verification_mode          TEXT NOT NULL DEFAULT 'none'
    CHECK (verification_mode IN ('none', 'network', 'location', 'both', 'network_or_location')),
  allowed_ip_ranges          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  shop_latitude              DOUBLE PRECISION,
  shop_longitude             DOUBLE PRECISION,
  shop_radius_meters         INTEGER NOT NULL DEFAULT 120 CHECK (shop_radius_meters > 0),
  timezone                   TEXT NOT NULL DEFAULT 'Asia/Baghdad',
  updated_by                 UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO staff_attendance_settings (id)
VALUES (TRUE)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS staff_attendance_user_settings (
  user_id                    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  start_time                 TIME NOT NULL,
  end_time                   TIME NOT NULL,
  grace_minutes              INTEGER NOT NULL DEFAULT 15 CHECK (grace_minutes >= 0),
  deduction_per_minute       BIGINT NOT NULL DEFAULT 0 CHECK (deduction_per_minute >= 0),
  attendance_required        BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by                 UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_user_settings_updated
  ON staff_attendance_user_settings(updated_at DESC);

CREATE TABLE IF NOT EXISTS staff_attendance_records (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date                  DATE NOT NULL,
  check_in_at                TIMESTAMPTZ,
  check_out_at               TIMESTAMPTZ,
  expected_start_time        TIME NOT NULL,
  expected_end_time          TIME NOT NULL,
  grace_minutes              INTEGER NOT NULL DEFAULT 15,
  late_minutes               INTEGER NOT NULL DEFAULT 0 CHECK (late_minutes >= 0),
  deduction_amount           BIGINT NOT NULL DEFAULT 0 CHECK (deduction_amount >= 0),
  deduction_transaction_id   UUID REFERENCES staff_salary_transactions(id) ON DELETE SET NULL,
  verification_mode          TEXT NOT NULL DEFAULT 'none',
  network_ok                 BOOLEAN NOT NULL DEFAULT FALSE,
  location_ok                BOOLEAN NOT NULL DEFAULT FALSE,
  verified                   BOOLEAN NOT NULL DEFAULT FALSE,
  check_in_ip                TEXT,
  check_out_ip               TEXT,
  latitude                   DOUBLE PRECISION,
  longitude                  DOUBLE PRECISION,
  location_accuracy_meters   DOUBLE PRECISION,
  distance_meters            DOUBLE PRECISION,
  status                     TEXT NOT NULL DEFAULT 'present'
    CHECK (status IN ('present', 'late', 'missing_checkout', 'overridden')),
  admin_note_ar              TEXT,
  overridden_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  overridden_at              TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, work_date)
);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_date ON staff_attendance_records(work_date DESC);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_user ON staff_attendance_records(user_id, work_date DESC);

-- =====================================================
-- Migration 021 — Full-set packages (طقم التخرج الكامل) + checkout intake groups
-- Full-set is a TIER of `packages` (like VIP): one retail price for روب + قبعة + وشاح,
-- ordered through the structured form wizard (the Instagram-form path).
-- =====================================================
ALTER TABLE packages ADD COLUMN IF NOT EXISTS is_full_set BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_packages_full_set ON packages(role, is_full_set, active, sort) WHERE active = TRUE;

-- Intake data per checkout BUNDLE (shared by the 3 linked orders): delivery address,
-- two phones, event date (حفلة), deposit (واصل). orders.checkout_group_id (plain UUID,
-- migration 011) points here only for full-set orders; legacy cart bundles have no row,
-- so there is no FK — always LEFT JOIN.
CREATE TABLE IF NOT EXISTS checkout_groups (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name      TEXT NOT NULL,            -- الاسم الكامل كما يُطرز/يُسلّم
  instagram_username TEXT,                     -- يوزر الانستا (بدون @)
  phone_primary      TEXT NOT NULL,            -- رقم أول (عراقي 07xxxxxxxxx)
  phone_secondary    TEXT,                     -- رقم ثاني
  governorate        TEXT,                     -- المحافظة
  area_details       TEXT,                     -- القضاء/الناحية + أقرب نقطة دالة
  event_date         DATE,                     -- تاريخ الحفلة — يحدد أولوية الإنتاج
  deposit            BIGINT NOT NULL DEFAULT 0 CHECK (deposit >= 0),  -- العربون المستلم
  notes              TEXT,                     -- ملاحظات عامة (مثل: عرض الوشاح ١٤-١٥ سم)
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_checkout_groups_updated ON checkout_groups;
CREATE TRIGGER trg_checkout_groups_updated BEFORE UPDATE ON checkout_groups FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_checkout_groups_event ON checkout_groups(event_date);

-- Migration 022 — package composition: admin picks the exact products a package bundles
-- (full-set طقم: one robe + one cap + one sash chosen from the catalog).
CREATE TABLE IF NOT EXISTS package_products (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  UNIQUE (package_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_package_products_pkg ON package_products(package_id);

-- Migration 024: admin-editable customer text prompt per group / option
-- When requires_customer_text is TRUE, this prompt is shown to the student
-- instead of the hardcoded "اكتب تفاصيل التطريز" label.
ALTER TABLE option_groups ADD COLUMN IF NOT EXISTS customer_text_prompt_ar TEXT;
ALTER TABLE options       ADD COLUMN IF NOT EXISTS customer_text_prompt_ar TEXT;

-- Migration 025: admin-editable placeholder (example) inside the customer text box.
ALTER TABLE option_groups ADD COLUMN IF NOT EXISTS customer_text_placeholder_ar TEXT;
ALTER TABLE options       ADD COLUMN IF NOT EXISTS customer_text_placeholder_ar TEXT;

-- Migration 027: wholesaler carries جامعة/قسم; students inherit them on join.
ALTER TABLE wholesalers ADD COLUMN IF NOT EXISTS university_name TEXT;
ALTER TABLE wholesalers ADD COLUMN IF NOT EXISTS department      TEXT;

-- Migration 039: per-wholesaler «لون التطريز» (embroidery/thread color).
-- Null/empty = not set → full-set orders carry NO لون التطريز spec line.
ALTER TABLE wholesalers ADD COLUMN IF NOT EXISTS embroidery_color TEXT;

-- Migration 033: delivery confirmation details captured at «تأكيد التسليم».
-- 'delivery' = توصيل بعنوان ورقم · 'pickup' = استلام من المحل.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_method TEXT
  CHECK (delivery_method IS NULL OR delivery_method IN ('delivery', 'pickup'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS recipient_name   TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_phone   TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_notes   TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_by     UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_delivered ON orders(delivered_at DESC) WHERE status = 'delivered';

-- Migration 038: generic key/value settings store for admin-controlled site config.
-- One well-known key: 'discount_popup' — see migration 038_site_settings.sql for shape.
CREATE TABLE IF NOT EXISTS site_settings (
  key        TEXT         PRIMARY KEY,
  value      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Migration 049: maintenance-mode flag — { active, message_ar }. active=true → home page "/" shows the message.
INSERT INTO site_settings (key, value)
VALUES (
  'maintenance_mode',
  jsonb_build_object('active', false, 'message_ar', 'الموقع قيد الصيانة')
)
ON CONFLICT (key) DO NOTHING;

-- Migration 043: admin calligraphy batch tool — one row per name-plate, grouped by job_id.
DO $$ BEGIN
  CREATE TYPE calligraphy_source AS ENUM ('typed','wholesaler','txt');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE calligraphy_status AS ENUM ('pending','done','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Migration 045: per-plate embroidery zone (front / back / cap).
DO $$ BEGIN
  CREATE TYPE calligraphy_variant AS ENUM ('front','back','cap');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS calligraphy_plates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL,
  wholesaler_id UUID REFERENCES wholesalers(id) ON DELETE SET NULL,
  student_id    UUID REFERENCES students(id)    ON DELETE SET NULL,
  order_item_id UUID REFERENCES order_items(id) ON DELETE SET NULL,
  source        calligraphy_source NOT NULL,
  render_text   TEXT NOT NULL,
  element_text  TEXT,
  variant       calligraphy_variant NOT NULL DEFAULT 'front',
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

COMMIT;
