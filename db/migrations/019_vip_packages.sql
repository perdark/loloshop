-- Migration 019 — VIP package tier (retail premium graduation bundle)
-- VIP is a TIER of the existing `packages` table (not a new entity): reuses listPackages,
-- configurePackage(), package_rules, the admin CRUD, and the shop-feed mapper.
-- Idempotent: safe to re-run and mirrored into db/schema.sql.

ALTER TABLE packages ADD COLUMN IF NOT EXISTS is_vip         BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS description    TEXT;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS features       JSONB NOT NULL DEFAULT '[]'::jsonb;   -- ordered Arabic perks
ALTER TABLE packages ADD COLUMN IF NOT EXISTS included_items JSONB NOT NULL DEFAULT '[]'::jsonb;   -- "what's inside" checklist
ALTER TABLE packages ADD COLUMN IF NOT EXISTS badge_label    TEXT;                                  -- e.g. VIP / الأفخم
ALTER TABLE packages ADD COLUMN IF NOT EXISTS accent         TEXT;                                  -- hex for badge/halo ONLY

-- Covers the public retail-VIP list (WHERE active AND role='retail' AND is_vip).
CREATE INDEX IF NOT EXISTS idx_packages_vip ON packages(role, is_vip, active, sort) WHERE active = TRUE;
