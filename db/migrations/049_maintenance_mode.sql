-- Migration 049 — Maintenance mode flag (site_settings 'maintenance_mode' row).
--
-- Reuses the generic site_settings table (migration 038).
-- One well-known key: 'maintenance_mode'
--   { "active": boolean, "message_ar": string }
--   active=true → the public home page ("/") shows the maintenance message instead of the shop.
--
-- Idempotent: INSERT … ON CONFLICT DO NOTHING (table already exists from 038).

INSERT INTO site_settings (key, value)
VALUES (
  'maintenance_mode',
  jsonb_build_object(
    'active',     false,
    'message_ar', 'الموقع قيد الصيانة'
  )
)
ON CONFLICT (key) DO NOTHING;
