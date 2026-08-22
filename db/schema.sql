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
  -- Embedded in every JWT and checked on every authenticated request. Incrementing this
  -- value invalidates every previously-issued token for the account.
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- 076: in-app account deletion (Apple 5.1.1(v)). A deleted account is ANONYMISED,
-- never row-deleted: orders.student_id is ON DELETE RESTRICT, so removing the row
-- is refused as soon as the student has one order — and would take the shop's sales
-- records with it. The account dies (phone/e-mail NULLed, password replaced,
-- token_version bumped so every issued JWT dies at once); the order survives on the
-- checkout_groups delivery snapshot so an in-flight sash still ships.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Migration 081 — who created this account at the shop counter (NULL for self-signup).
-- Repeated here because `npm run migrate` applies THIS file, and it must reach databases
-- that already exist. ON DELETE SET NULL so an employee leaving never deletes their
-- customers. Full reasoning in db/migrations/081_counter_signup.sql.
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_created_by ON users(created_by_user_id) WHERE created_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_deleted_at
  ON users(deleted_at) WHERE deleted_at IS NOT NULL;

-- =====================================================
-- OTP CODES — phone verification via Zentramsg WhatsApp
-- =====================================================
CREATE TABLE IF NOT EXISTS otp_codes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        TEXT NOT NULL,
  code         TEXT NOT NULL,
  purpose      TEXT NOT NULL DEFAULT 'verify',
  -- Secret handed back only by a server flow that already proved something (correct
  -- password for 'login', a just-created account for 'verify'). Verification looks the
  -- row up BY THIS, never by phone, so a caller can't pick the target account/purpose.
  -- See migration 066 + security finding LS-01.
  challenge_id UUID NOT NULL DEFAULT gen_random_uuid(),
  -- Pins which account this code may authenticate.
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  expires_at   TIMESTAMPTZ NOT NULL,
  used         BOOLEAN NOT NULL DEFAULT FALSE,
  attempts     INTEGER NOT NULL DEFAULT 0,
  -- Lifetime telemetry for this challenge; the rolling rate limit uses otp_send_events.
  sends        INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Brute-force guard column for pre-existing DBs (idempotent).
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
-- Challenge binding for pre-existing DBs (idempotent) — mirrors migration 066.
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS challenge_id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS sends INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone, used);
CREATE INDEX IF NOT EXISTS idx_otp_phone_purpose ON otp_codes(phone, purpose, used);
CREATE UNIQUE INDEX IF NOT EXISTS idx_otp_challenge ON otp_codes(challenge_id);

-- One row per OTP delivery attempt. A separate event table makes the rolling one-hour
-- budget accurate even though resends retain the original challenge/created_at.
CREATE TABLE IF NOT EXISTS otp_send_events (
  id         BIGSERIAL PRIMARY KEY,
  phone      TEXT NOT NULL,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_otp_send_events_phone_time
  ON otp_send_events(phone, sent_at DESC);

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
  '{"royal_sash":{"admin":15000,"selling":15000},"royal_cap_when_normal_sash":{"admin":3000,"selling":3000},"extra_cap_embroidery":{"admin":3000,"selling":3000},"robe_sleeve_each":{"admin":5000,"selling":5000},"american_shawl":{"admin":20000,"selling":25000},"piece_sash_normal":{"admin":20000,"selling":20000},"piece_sash_royal":{"admin":25000,"selling":25000},"piece_cap_normal":{"admin":15000,"selling":15000},"piece_cap_royal":{"admin":20000,"selling":20000},"piece_robe_normal":{"admin":25000,"selling":25000},"piece_robe_royal":{"admin":25000,"selling":25000}}'::jsonb;
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
  -- ⚠️ cost IS NULLABLE AND HAS NO DEFAULT, and `profit` COALESCEs it. This file said
  -- `NOT NULL DEFAULT 0` and `price - cost` until 2026-08-14, while the live table
  -- (measured on prod 2026-08-13, re-measured 2026-08-14) has always been the shape
  -- below. `CREATE TABLE IF NOT EXISTS` never rewrites an existing table, so the drift
  -- was invisible on prod and would only have appeared in a NEW database — where it
  -- silently changes what money means:
  --
  --   · NULL vs 0 is the difference between «no production cost was ever entered» and
  --     «this order cost nothing to make». All 1,497 live retail pieces are the former.
  --     `settledMoney.retail_pieces_costed` counts `cost IS NOT NULL` to decide whether
  --     /admin may print a profit at all; under DEFAULT 0 every retail row looks costed
  --     and the «لم تُدخل تكلفة إنتاج» warning disappears while staying just as true.
  --   · Without the COALESCE, `price - cost` is NULL for every uncosted row, so those
  --     rows vanish from every SUM(profit) instead of contributing their revenue.
  --
  -- Do NOT "fix" this by making the live table match an older version of this file.
  -- (The live columns are INTEGER, not BIGINT — a legacy of the original tables. That
  -- one is benign: per-row values are ~25,000 IQD against an INT4 ceiling of 2.1bn, and
  -- Postgres promotes SUM(integer) to bigint, so no total can overflow either.)
  cost         BIGINT CHECK (cost >= 0),
  profit       BIGINT GENERATED ALWAYS AS (price - COALESCE(cost, 0)) STORED,
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
-- NOTIFICATIONS — in-app rows AND the push outbox (migration 077)
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

-- Push delivery state for the row above. See db/migrations/077_push_notifications.sql for the
-- full reasoning; the short version is that thirteen call sites INSERT notifications and
-- several do it inside a transaction, so the ROW is the queue and backend/lib/pushOutbox.js
-- drains it after commit.
-- 'pending' → never attempted · 'sending' → claimed · 'sent' · 'failed' · 'skipped'.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS push_state TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS pushed_at  TIMESTAMPTZ;

-- ⚠️ KEEP THIS. This file is re-applied on every `npm run migrate`, against a database that
-- already holds every notification the shop has ever written. Those rows take the 'pending'
-- default from the ALTER above, and without this line the next drain would push all of them
-- to real phones at once. Idempotent and cheap after the first run.
UPDATE notifications SET push_state = 'skipped'
 WHERE push_state = 'pending' AND created_at < now() - INTERVAL '10 minutes';

-- Covers 'sending' too, not just 'pending': the drain's claim query also has to find rows a
-- crashed process left mid-flight, and an index that stops at 'pending' would make that
-- branch a full scan of every notification the shop has ever written.
CREATE INDEX IF NOT EXISTS idx_notifications_push_pending
  ON notifications (created_at) WHERE push_state IN ('pending', 'sending');

-- One row per device+install. `token` is UNIQUE table-wide on purpose: phones get handed on
-- and re-sold here, and the provider reissues the SAME token to the next person who signs in.
-- The upsert in notificationController.registerDevice therefore MOVES the device to its new
-- owner instead of leaving the previous account subscribed to it.
CREATE TABLE IF NOT EXISTS device_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token        TEXT NOT NULL UNIQUE,
  platform     TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);

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
  admin_price_snapshot BIGINT NOT NULL DEFAULT 0 CHECK (admin_price_snapshot >= 0),
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

-- Migration 055: «إرجاع للطالب» — return a RETAIL order to the student for editing.
-- Orthogonal flag: while TRUE the order leaves the production queue + orders list and the
-- student edits it in /returned-orders; resubmitting via POST /orders/configure clears it.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS returned_to_customer BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS returned_reason      TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS returned_at          TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS returned_by          UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_returned ON orders(returned_to_customer) WHERE returned_to_customer = TRUE;

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
-- PAYOUT DESTINATIONS — SuperQi Mastercard + manual admin transfer log
-- =====================================================
-- No banking API is used. Recipients save a 16-digit card number; an admin
-- transfers externally and records the completed manual transfer for audit.
CREATE TABLE IF NOT EXISTS payout_accounts (
  user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL DEFAULT 'superqi_mastercard'
    CHECK (provider = 'superqi_mastercard'),
  card_number      TEXT NOT NULL CHECK (card_number ~ '^[0-9]{16}$'),
  account_number   TEXT CONSTRAINT payout_accounts_account_number_format
    CHECK (account_number IS NULL OR account_number ~ '^[0-9]{1,24}$'),
  cardholder_name  TEXT CHECK (cardholder_name IS NULL OR char_length(cardholder_name) <= 120),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by       UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS manual_payouts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recipient_kind        TEXT NOT NULL
    CHECK (recipient_kind IN ('staff', 'tailor', 'workshop')),
  source_id             UUID NOT NULL,
  amount                BIGINT NOT NULL CHECK (amount > 0),
  card_number_snapshot  TEXT NOT NULL CHECK (card_number_snapshot ~ '^[0-9]{16}$'),
  account_number_snapshot TEXT CONSTRAINT manual_payouts_account_number_snapshot_format
    CHECK (account_number_snapshot IS NULL OR account_number_snapshot ~ '^[0-9]{1,24}$'),
  note                  TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  paid_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_manual_payouts_recipient
  ON manual_payouts(recipient_kind, source_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_manual_payouts_user
  ON manual_payouts(user_id, paid_at DESC);

-- 073: SuperQi account number beside the 16-digit card. Nullable in the DB because
-- rows written before 073 hold only a card; "both required" is enforced on every
-- save by payoutController.validateAccountBody.
-- 074: no fixed length — real account numbers are 9, 10 and 12 digits. The 24 cap
-- is a storage guard, not a format rule.
ALTER TABLE payout_accounts ADD COLUMN IF NOT EXISTS account_number TEXT;
ALTER TABLE payout_accounts DROP CONSTRAINT IF EXISTS payout_accounts_account_number_format;
ALTER TABLE payout_accounts ADD CONSTRAINT payout_accounts_account_number_format
  CHECK (account_number IS NULL OR account_number ~ '^[0-9]{1,24}$');

ALTER TABLE manual_payouts ADD COLUMN IF NOT EXISTS account_number_snapshot TEXT;
ALTER TABLE manual_payouts DROP CONSTRAINT IF EXISTS manual_payouts_account_number_snapshot_format;
ALTER TABLE manual_payouts ADD CONSTRAINT manual_payouts_account_number_snapshot_format
  CHECK (account_number_snapshot IS NULL OR account_number_snapshot ~ '^[0-9]{1,24}$');

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
  -- migration 075: monthly الخروج المؤقت allowance (10 hours)
  break_monthly_minutes      INTEGER NOT NULL DEFAULT 600 CHECK (break_monthly_minutes >= 0),
  updated_by                 UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE staff_attendance_settings
  ADD COLUMN IF NOT EXISTS break_monthly_minutes INTEGER NOT NULL DEFAULT 600
    CHECK (break_monthly_minutes >= 0);
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
  -- migration 075: NULL = inherit the global الخروج المؤقت allowance
  break_monthly_minutes      INTEGER CHECK (break_monthly_minutes IS NULL OR break_monthly_minutes >= 0),
  updated_by                 UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE staff_attendance_user_settings
  ADD COLUMN IF NOT EXISTS break_monthly_minutes INTEGER
    CHECK (break_monthly_minutes IS NULL OR break_monthly_minutes >= 0);
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
-- Migration 075 — الخروج المؤقت (temporary leave during the shift)
-- Money rule lives in backend/lib/attendanceBreak.js:
--   the monthly balance always decrements by the FULL real minutes of a break
--   free     = approved ? min(minutes, remaining_before_this_break) : 0
--   deducted = minutes - free
--   amount   = deducted * deduction_per_minute  (frozen on the row at return time)
-- =====================================================
CREATE TABLE IF NOT EXISTS staff_attendance_breaks (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attendance_id             UUID NOT NULL REFERENCES staff_attendance_records(id) ON DELETE CASCADE,
  work_date                 DATE NOT NULL,
  month_key                 TEXT NOT NULL CHECK (month_key ~ '^[0-9]{4}-[0-9]{2}$'),
  reason_ar                 TEXT,
  requested_minutes         INTEGER CHECK (requested_minutes IS NULL OR requested_minutes > 0),
  requested_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at                   TIMESTAMPTZ,
  returned_at               TIMESTAMPTZ,
  minutes                   INTEGER NOT NULL DEFAULT 0 CHECK (minutes >= 0),
  state                     TEXT NOT NULL DEFAULT 'requested'
    CHECK (state IN ('requested', 'out', 'returned', 'cancelled')),
  approval                  TEXT NOT NULL DEFAULT 'pending'
    CHECK (approval IN ('pending', 'approved', 'rejected')),
  left_without_approval     BOOLEAN NOT NULL DEFAULT FALSE,
  decided_by                UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at                TIMESTAMPTZ,
  decision_note_ar          TEXT,
  free_minutes              INTEGER NOT NULL DEFAULT 0 CHECK (free_minutes >= 0),
  deducted_minutes          INTEGER NOT NULL DEFAULT 0 CHECK (deducted_minutes >= 0),
  deduction_per_minute      BIGINT NOT NULL DEFAULT 0 CHECK (deduction_per_minute >= 0),
  deduction_amount          BIGINT NOT NULL DEFAULT 0 CHECK (deduction_amount >= 0),
  deduction_transaction_id  UUID REFERENCES staff_salary_transactions(id) ON DELETE SET NULL,
  auto_closed               BOOLEAN NOT NULL DEFAULT FALSE,
  admin_note_ar             TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- One live break per worker, enforced by the DB and not just by a JS check.
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_break_open
  ON staff_attendance_breaks(user_id)
  WHERE state IN ('requested', 'out');
CREATE INDEX IF NOT EXISTS idx_attendance_break_month
  ON staff_attendance_breaks(user_id, month_key);
CREATE INDEX IF NOT EXISTS idx_attendance_break_date
  ON staff_attendance_breaks(work_date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_break_record
  ON staff_attendance_breaks(attendance_id);
CREATE INDEX IF NOT EXISTS idx_attendance_break_pending
  ON staff_attendance_breaks(requested_at DESC)
  WHERE approval = 'pending' AND state <> 'cancelled';

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

-- Migration 056: first-party storefront visit tracking (TV board «الزيارات الآن»).
-- No third-party analytics / no cookies; ≤1 row per session per 5 min, board counts
-- DISTINCT session_id in the last 30 min. See 056_site_visits.sql.
CREATE TABLE IF NOT EXISTS site_visits (
  id          BIGSERIAL PRIMARY KEY,
  session_id  TEXT NOT NULL,
  path        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_site_visits_created_at ON site_visits (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_visits_session_created ON site_visits (session_id, created_at DESC);

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

-- Migration 069: retail (تجزئة) plates — reviewed per student before generation.
DO $$ BEGIN
  ALTER TYPE calligraphy_source ADD VALUE IF NOT EXISTS 'retail';
EXCEPTION WHEN undefined_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE calligraphy_status AS ENUM ('pending','done','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Migration 045: per-plate embroidery zone (front / back / cap).
-- Migration 065 adds 'cap_side' («تطريز القبعة من الجانب»).
DO $$ BEGIN
  CREATE TYPE calligraphy_variant AS ENUM ('front','back','cap','cap_side');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TYPE calligraphy_variant ADD VALUE IF NOT EXISTS 'cap_side';

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

-- Migration 080: «إعادة التوليد» was uncapped — each press bought a fresh image on the same
-- plate row with nothing recording how many had been spent. cost_usd already accumulated;
-- this counts the presses so calligraphyController.reroll can refuse the eleventh.
ALTER TABLE calligraphy_plates ADD COLUMN IF NOT EXISTS reroll_count INTEGER NOT NULL DEFAULT 0;

-- Migration 082: the reroll geometry anchor. Rerolls used to match the plate they were about
-- to overwrite, so ink height was monotone non-increasing across presses (the "ratchet") —
-- this pins the FIRST generated plate as the permanent reference. The backfill is repeated
-- here on purpose, exactly like 077's and 080's: this is the file `npm run migrate` applies to
-- a database that already holds rerolled plates. Do not tidy it out.
ALTER TABLE calligraphy_plates ADD COLUMN IF NOT EXISTS original_plate_path TEXT;
UPDATE calligraphy_plates
   SET original_plate_path = plate_path
 WHERE original_plate_path IS NULL AND plate_path IS NOT NULL;

-- Migration 082: one row per paid calligraphy image ('sheet' | 'reroll' | 'element').
-- cost_usd on the plates cannot serve as a daily ledger (rerolls add money to rows created
-- weeks earlier; elements stored their cost nowhere), and the feature had no daily ceiling at
-- all — lib/calligraphySpend.js reads the last 24h of this table and refuses the next
-- generation past CALLIG_DAILY_USD_MAX.
CREATE TABLE IF NOT EXISTS calligraphy_spend_log (
  id         BIGSERIAL PRIMARY KEY,
  kind       TEXT NOT NULL,
  cost_usd   NUMERIC(10,5) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_callig_spend_created ON calligraphy_spend_log(created_at);

-- Migration 083: the per-plate style knob («مد الحروف» · «خط أعرض» · «بدون زخرفة»).
-- NULL = the shop default. Values are ids from backend/lib/calligraphyStyles.js, NEVER free
-- text — nothing a student typed may reach the image prompt. The column exists so the batcher
-- can group pending plates by (variant, style): one sheet is one style, which is what keeps ten
-- styled names on ONE $0.10 image instead of ten private ones, and what stops the cross-job
-- hitchhiker top-up from mixing styles into a single (ruined, already paid for) sheet.
ALTER TABLE calligraphy_plates ADD COLUMN IF NOT EXISTS style TEXT;
CREATE INDEX IF NOT EXISTS idx_callig_plates_pending_batch
  ON calligraphy_plates (variant, style, created_at)
  WHERE status = 'pending';

-- ---------------------------------------------------------------------------------------
-- Migration 080: the calligraphy plate gets its OWN column on order_items.
--
-- `customer_image_url` used to hold two different things under one name — the reference photo
-- the STUDENT uploaded, and the plate the generator produced — and autoLinkPlate wrote it
-- unconditionally, so every generate/reroll/compose deleted the photo. 459 prod lines were
-- overwritten across 628 link events before this landed. Full reasoning in
-- db/migrations/080_calligraphy_plate_column.sql.
--
-- ⚠️ THE BACKFILL BELOW IS REPEATED FROM THE MIGRATION ON PURPOSE, exactly like 077's
-- push_state backfill. `npm run migrate` applies THIS file to a production database that
-- already carries the damaged rows; without the UPDATE the ALTER lands, the new column stays
-- empty, and every reader keeps showing a machine plate labelled as the student's photo.
-- It fires only when the value is EXACTLY equal to a plate_path this line's own
-- calligraphy_plates row recorded, so a surviving photo can never match it. Do not tidy it out.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS plate_image_url TEXT;

UPDATE order_items oi
   SET plate_image_url    = oi.customer_image_url,
       customer_image_url = NULL
  FROM calligraphy_plates cp
 WHERE cp.order_item_id = oi.id
   AND cp.plate_path IS NOT NULL
   AND cp.plate_path = oi.customer_image_url
   AND oi.plate_image_url IS NULL;

-- =====================================================
-- WORKSHOP (الورشة / Team B) — direct piecework production + wage ledger.
-- Does NOT touch orders / the Team-A pipeline. See db/migrations/060_workshop.sql for the
-- full rationale. Workers reuse `users` with role 'worker' (secret-URL portal, no OTP).
-- =====================================================
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'worker';

CREATE TABLE IF NOT EXISTS workshop_workers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  is_lead    BOOLEAN NOT NULL DEFAULT FALSE,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workshop_piece_rates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation  TEXT NOT NULL,
  product    TEXT NOT NULL,
  audience   TEXT NOT NULL DEFAULT 'wholesale' CHECK (audience IN ('wholesale','retail')),
  amount     BIGINT NOT NULL DEFAULT 0 CHECK (amount >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);
-- Migration 072: a rate is identified by job AND customer type.
ALTER TABLE workshop_piece_rates ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'wholesale'
  CHECK (audience IN ('wholesale','retail'));
ALTER TABLE workshop_piece_rates DROP CONSTRAINT IF EXISTS workshop_piece_rates_operation_product_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_workshop_rate ON workshop_piece_rates(operation, product, audience);

-- Fresh/demo databases get useful example rates for BOTH audiences; existing
-- admin-edited values win. Retail seeds match wholesale until an admin sets the
-- real retail wages.
INSERT INTO workshop_piece_rates (operation, product, audience, amount)
VALUES
  ('cut','robe','wholesale',500), ('overlock','robe','wholesale',750), ('robe_sew','robe','wholesale',1500),
  ('cut','cap','wholesale',250), ('cap_sew','cap','wholesale',750),
  ('cut','shawl','wholesale',250), ('shawl_close','shawl','wholesale',500), ('american_shawl','shawl','wholesale',1000),
  ('cut','sash','wholesale',250), ('shawl_close','sash','wholesale',500),
  ('cut','robe','retail',500), ('overlock','robe','retail',750), ('robe_sew','robe','retail',1500),
  ('cut','cap','retail',250), ('cap_sew','cap','retail',750),
  ('cut','shawl','retail',250), ('shawl_close','shawl','retail',500), ('american_shawl','shawl','retail',1000),
  ('cut','sash','retail',250), ('shawl_close','sash','retail',500)
ON CONFLICT (operation, product, audience) DO NOTHING;

-- A database that already held admin-edited wholesale rates when `audience` was added
-- gets its retail rows from the seed above — i.e. the SEED defaults, not that shop's real
-- wholesale amounts. That silently misprices retail work (prod had overlock 300 / robe_sew
-- 1000 against seed defaults of 750 / 1500). Migration 072 copies wholesale→retail
-- dynamically, but `scripts/deploy.sh` runs `npm run migrate`, which applies THIS FILE and
-- never the numbered migrations — so the correction has to live here.
--
-- Aligns a retail rate to its wholesale twin only while no admin has ever set it
-- (`upsertRate` stamps `updated_by`; the seed leaves it NULL). Once the admin enters a real
-- retail wage this stops touching that row forever. Idempotent — safe on every deploy.
UPDATE workshop_piece_rates r
   SET amount = w.amount
  FROM workshop_piece_rates w
 WHERE r.audience = 'retail'
   AND r.updated_by IS NULL
   AND w.audience = 'wholesale'
   AND w.operation = r.operation
   AND w.product   = r.product
   AND r.amount   <> w.amount;

CREATE TABLE IF NOT EXISTS workshop_production_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES workshop_workers(id) ON DELETE CASCADE,
  product TEXT NOT NULL, operation TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  rate BIGINT NOT NULL CHECK (rate >= 0), amount BIGINT NOT NULL CHECK (amount >= 0),
  work_date DATE NOT NULL DEFAULT CURRENT_DATE, note TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE workshop_production_entries ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'wholesale'
  CHECK (audience IN ('wholesale','retail'));
CREATE INDEX IF NOT EXISTS idx_workshop_production_worker ON workshop_production_entries(worker_id, work_date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS workshop_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES workshop_workers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('bonus','deduction')),
  amount BIGINT NOT NULL CHECK (amount > 0), reason TEXT NOT NULL,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_workshop_adjustments_worker ON workshop_adjustments(worker_id, entry_date DESC, created_at DESC);

-- =====================================================
-- DESIGN TEAM — first-stage retail design support only.
-- Helpers are intentionally a separate `design_helper` role rather than staff:
-- they must not inherit attendance, payroll, checkout/money, or the general
-- production console. See db/migrations/062_design_team.sql for the rationale.
-- =====================================================
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'design_helper';

DO $$ BEGIN
  CREATE TYPE design_team_member_role AS ENUM ('lead', 'helper');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE design_team_task_status AS ENUM ('open', 'ready');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS design_teams (
  id           BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  name_ar      TEXT NOT NULL DEFAULT 'أيادي التصميم',
  helper_limit SMALLINT NOT NULL DEFAULT 2 CHECK (helper_limit = 2),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO design_teams (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;
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
CREATE UNIQUE INDEX IF NOT EXISTS uq_design_team_active_lead
  ON design_team_members(team_id)
  WHERE active = TRUE AND member_role = 'lead';

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

DROP TRIGGER IF EXISTS trg_design_teams_updated ON design_teams;
CREATE TRIGGER trg_design_teams_updated
  BEFORE UPDATE ON design_teams FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_design_team_members_updated ON design_team_members;
CREATE TRIGGER trg_design_team_members_updated
  BEFORE UPDATE ON design_team_members FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_design_team_tasks_updated ON design_team_tasks;
CREATE TRIGGER trg_design_team_tasks_updated
  BEFORE UPDATE ON design_team_tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 070: رف التجهيز — per-student staging bins between الكوي and التجهيز.
--
-- WHY: pieces of one student's order do NOT finish together. Caps/robes/shawls are plain
-- and arrive at التجهيز early; the وشاح must pass التصميم → التطريز → الكوي and arrives last.
-- So robes and caps physically WAIT for the sash. This shelf is that waiting room.
--
-- Retail only (students.wholesaler_id IS NULL) — rep/دفعة pieces are handled بالجملة and
-- never get a bin. Config is per-SECTION so one shelf may mix modes: shelf C is 6 exclusive
-- cap bins + 1 SHARED شال bin. Spec: docs/superpowers/specs/2026-07-21-preparation-shelf-design.md

DO $$ BEGIN
  CREATE TYPE shelf_mode AS ENUM ('exclusive', 'shared');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS shelf_sections (
  id           SERIAL PRIMARY KEY,
  shelf_code   TEXT       NOT NULL,
  piece_type   TEXT       NOT NULL,
  label_ar     TEXT       NOT NULL,
  slot_count   INT        NOT NULL CHECK (slot_count >= 0),
  max_per_slot INT,                      -- NULL = unlimited (shared bins)
  mode         shelf_mode NOT NULL DEFAULT 'exclusive',
  sort_order   INT        NOT NULL,
  UNIQUE (shelf_code, sort_order)
);

-- A bin = one OPEN occupancy row on a physical slot. Exclusive bins carry the one student
-- who owns them; shared bins carry NULL. Rows are NEVER deleted — they are stamped
-- closed_at when the bin frees, so collection history survives bin reuse.
CREATE TABLE IF NOT EXISTS shelf_slot_occupancy (
  id         SERIAL PRIMARY KEY,
  shelf_code TEXT NOT NULL,
  slot_index INT  NOT NULL,
  student_id UUID REFERENCES students(id),
  section_id INT  NOT NULL REFERENCES shelf_sections(id),
  opened_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at  TIMESTAMPTZ
);

-- THE constraint: at most one OPEN bin per physical slot. This is what makes
-- "one student per خانة" a database rule instead of something the code must remember.
CREATE UNIQUE INDEX IF NOT EXISTS shelf_slot_one_open
  ON shelf_slot_occupancy (shelf_code, slot_index) WHERE closed_at IS NULL;

CREATE TABLE IF NOT EXISTS shelf_placements (
  order_id     UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  occupancy_id INT  NOT NULL REFERENCES shelf_slot_occupancy(id),
  student_id   UUID NOT NULL REFERENCES students(id),
  placed_by    UUID REFERENCES users(id),
  placed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  collected_by UUID REFERENCES users(id),
  collected_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS shelf_placements_live
  ON shelf_placements (student_id) WHERE collected_at IS NULL;
CREATE INDEX IF NOT EXISTS shelf_placements_occupancy
  ON shelf_placements (occupancy_id);

-- Seeded layout (owner-locked 2026-07-21). All four numbers are editable at runtime
-- via /admin/shelf or a single UPDATE — no code change, no deploy.
INSERT INTO shelf_sections (shelf_code, piece_type, label_ar, slot_count, max_per_slot, mode, sort_order)
VALUES
  ('A', 'robe',  'روب',   10, 10,   'exclusive', 1),
  ('B', 'sash',  'وشاح',  15, 10,   'exclusive', 1),
  ('C', 'cap',   'قبعة',   6,  4,   'exclusive', 1),
  ('C', 'shawl', 'شال',    1, NULL, 'shared',    2)
ON CONFLICT (shelf_code, sort_order) DO NOTHING;

-- =====================================================
-- AI CHAT — support chatbot + admin analytics (migration 078)
-- =====================================================
-- Cost ledger and rate limiter in one table: every model call writes one row, and the
-- caps in backend/lib/aiChat.js are COUNT/SUM over it. Kept in the DB rather than in
-- memory so a PM2 restart cannot reset a user's daily allowance and both API workers
-- share one flood guard. Full reasoning in db/migrations/078_ai_chat.sql.
CREATE TABLE IF NOT EXISTS ai_chat_messages (
  id                BIGSERIAL PRIMARY KEY,
  user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  session_key       TEXT,
  surface           TEXT NOT NULL CHECK (surface IN ('support', 'admin_analytics')),
  question          TEXT NOT NULL,
  answer            TEXT,
  intent            TEXT,
  model             TEXT,
  prompt_tokens     INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd          NUMERIC(12, 8) NOT NULL DEFAULT 0,
  error             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_user_created    ON ai_chat_messages(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_chat_session_created ON ai_chat_messages(session_key, created_at DESC)
  WHERE session_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_chat_created         ON ai_chat_messages(created_at DESC);

-- 079: attribution. The per-person daily quota was removed 2026-08-12 (it was keyed on a
-- client-chosen identity, so it bounded only honest students); abuse is now bounded by a
-- server-signed identity, a burst throttle and the daily USD ceiling. That only works if a
-- flood is visible afterwards, so each row carries a SALTED HASH of the caller's address —
-- enough to say "these rows are one client", never enough to say which. Full reasoning in
-- db/migrations/079_ai_chat_ip_hash.sql.
ALTER TABLE ai_chat_messages ADD COLUMN IF NOT EXISTS ip_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_ai_chat_ip_created
  ON ai_chat_messages(ip_hash, created_at DESC) WHERE ip_hash IS NOT NULL;

-- =====================================================
-- Migration 084 — «هل فتح الموظف التطبيق اليوم؟»
-- A FOURTH signal, independent of بصمة and of production actions: presence of the PERSON in
-- the APP. staff_attendance_records says "they stamped once"; staff_activity_log only fires
-- when a piece MOVES (so a designer reading briefs is invisible); site_visits has no user_id
-- at all. Full reasoning in db/migrations/084_staff_app_opens.sql.
--
-- ⚠️ NEVER folded into payroll. Opening the app is not attendance and not opening it is not a
-- deduction — the report shows both columns so the owner can see where they DISAGREE.
--
-- `opens` counts SESSIONS: the endpoint increments only when last_seen_at is >30 min old.
-- `work_date` is passed in from attendanceController.localParts(now,'Asia/Baghdad'), never
-- CURRENT_DATE — the server clock is UTC, so a 23:30 Baghdad ping would file under tomorrow
-- while the same evening's بصمة sits under today.
-- =====================================================
CREATE TABLE IF NOT EXISTS staff_app_opens (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date     DATE NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opens         INTEGER NOT NULL DEFAULT 1 CHECK (opens >= 0),
  platform      TEXT,
  PRIMARY KEY (user_id, work_date)
);
CREATE INDEX IF NOT EXISTS idx_staff_app_opens_date ON staff_app_opens(work_date DESC);

-- =====================================================
-- Migration 085 — an UNDO ledger for «إنهاء الخصومات» (ending a storefront discount round).
-- Ending a discount is the one catalogue edit that RAISES a live price, and it touches many
-- products in one press. A product's price is a single mutable column with no history, and the
-- only record of the pre-discount price — products.compare_at_price — is cleared by the very
-- same operation. This table keeps it, so a rollback is an UPDATE from old_price on one
-- batch_id. Full reasoning in db/migrations/085_discount_restore_log.sql.
--
-- `scope` is 'product' (products.base_price) or a price_role name ('retail'/'wholesaler', the
-- matching product_price_roles row) — the two places an effective price can live.
-- ⚠️ Data only ever APPENDED here, never read by the storefront. Do not "tidy" it away: it is
-- the shop's only undo for a price raise, and it is written before the price it describes.
-- =====================================================
CREATE TABLE IF NOT EXISTS discount_restore_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id      UUID NOT NULL,
  restored_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  admin_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_name  TEXT NOT NULL,
  scope         TEXT NOT NULL,
  old_price     BIGINT,
  new_price     BIGINT,
  old_compare_at_price BIGINT,
  note          TEXT
);
CREATE INDEX IF NOT EXISTS idx_discount_restore_batch ON discount_restore_log(batch_id);
CREATE INDEX IF NOT EXISTS idx_discount_restore_at    ON discount_restore_log(restored_at DESC);

COMMIT;
