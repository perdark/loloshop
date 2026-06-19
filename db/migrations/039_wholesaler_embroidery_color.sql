-- Migration 039: per-wholesaler «لون التطريز» (embroidery/thread color).
-- Null/empty = not set → the full-set order carries NO لون التطريز spec line.
-- Admin sets it on create/edit wholesaler; the rep can self-edit via PATCH /api/wholesaler/embroidery-color.
ALTER TABLE wholesalers ADD COLUMN IF NOT EXISTS embroidery_color TEXT;
