-- Migration 027 — wholesaler carries جامعة/قسم for its cohort.
-- Students who join via a wholesaler's referral link inherit these automatically,
-- so they no longer enter university/department at signup.
ALTER TABLE wholesalers ADD COLUMN IF NOT EXISTS university_name TEXT;
ALTER TABLE wholesalers ADD COLUMN IF NOT EXISTS department      TEXT;
