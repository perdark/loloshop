-- Migration 021 — Full-set packages (طقم التخرج الكامل: روب + قبعة + وشاح) + intake groups
-- Full-set is a TIER of the existing `packages` table (like VIP): one retail price for the
-- 3-piece set, ordered through the structured form wizard (the Instagram-form path), not
-- the Fabric designer path.
-- checkout_groups stores what the Instagram order form captures per BUNDLE — delivery
-- address, two phones, event date, deposit (واصل) — shared by the 3 linked orders.
-- Idempotent: safe to re-run and mirrored into db/schema.sql.

ALTER TABLE packages ADD COLUMN IF NOT EXISTS is_full_set BOOLEAN NOT NULL DEFAULT FALSE;
-- Covers the public retail full-set list (WHERE active AND role='retail' AND is_full_set).
CREATE INDEX IF NOT EXISTS idx_packages_full_set ON packages(role, is_full_set, active, sort) WHERE active = TRUE;

-- Intake data for a checkout bundle. orders.checkout_group_id (plain UUID since migration
-- 011) points here WHEN the bundle came from the full-set form; legacy cart checkouts have
-- no row, so no FK is added — always LEFT JOIN.
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
