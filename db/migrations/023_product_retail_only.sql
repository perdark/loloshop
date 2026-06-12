-- Migration 023: retail-only product visibility flag
ALTER TABLE products ADD COLUMN IF NOT EXISTS retail_only BOOLEAN NOT NULL DEFAULT FALSE;
