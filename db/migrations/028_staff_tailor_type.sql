-- Migration 028 — add 'tailor' (مفصل) staff job-type.
-- مفصل is a READ-ONLY view role: sees only student name + sash info + American-shawl
-- info (no production stage of its own). The view restriction lives in the app layer;
-- here we only register the new staff_type value.
--
-- Apply on its own: a new enum value is added here and only USED as data later (in 029
-- backfill / at runtime), never in this same transaction — so it is transaction-safe.
ALTER TYPE staff_type ADD VALUE IF NOT EXISTS 'tailor';
