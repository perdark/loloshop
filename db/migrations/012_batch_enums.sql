-- Migration 012 — new enum values for the batch update.
-- MUST run before 013 (which uses study_type + salary_txn_type) and before any
-- code uses 'converting'/'digitizer' as data. ALTER TYPE ... ADD VALUE is safe in
-- a transaction on PG12+ as long as the new value is not used as data in the same tx;
-- this file only declares enum values, so it is safe via `npm run migrate:file`.

-- Digitizing stage (تحويل التصميم لتطريز): between design_complete and embroidery.
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'converting';

-- New staff job-type that owns the converting stage (محوّل التطريز).
ALTER TYPE staff_type ADD VALUE IF NOT EXISTS 'digitizer';

-- Student study schedule (صباحي/مسائي).
DO $$ BEGIN
  CREATE TYPE study_type AS ENUM ('morning', 'evening');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Staff payroll ledger entry kinds.
DO $$ BEGIN
  CREATE TYPE salary_txn_type AS ENUM ('salary_set', 'bonus', 'deduction');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
