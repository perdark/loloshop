-- Migration 038 — Generic site_settings table + 'discount_popup' seed row.
--
-- site_settings(key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMPTZ)
-- One well-known key: 'discount_popup'
--   { "active": boolean, "title_ar": string, "message_ar": string, "deadline": string|null }
--   deadline = ISO timestamp string (countdown target) or null.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + INSERT … ON CONFLICT DO NOTHING.

CREATE TABLE IF NOT EXISTS site_settings (
  key        TEXT         PRIMARY KEY,
  value      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

INSERT INTO site_settings (key, value)
VALUES (
  'discount_popup',
  jsonb_build_object(
    'active',      false,
    'title_ar',    'استغل الخصومات',
    'message_ar',  'أسعار مخفّضة على المنتجات المختارة — لا تفوّت الفرصة! اطلب الآن قبل انتهاء الموعد.',
    'deadline',    '2026-07-01T00:00:00.000Z'
  )
)
ON CONFLICT (key) DO NOTHING;
