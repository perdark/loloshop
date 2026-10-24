-- 117 — «فرّغ الرف» for named people, not only manager/admin (owner 2026-10-25:
-- «افتح التفريغ مال الرف ل محمد عادل»).
--
-- The shelf-wide wipe stays manager/admin by default. `site_settings.shelf_clear_users`
-- holds the extra user ids allowed to press it; `routes/production.js` reads it on each
-- request (shelfAccess.allowShelfClear), and GET /production/shelf reports `can_clear` so
-- the button shows for exactly the people the server admits.
--
-- ON CONFLICT DO NOTHING: this file is repeated in db/schema.sql, which deploy.sh applies on
-- EVERY deploy — an UPSERT would put محمد عادل back after an admin removed him.
-- Keyed on the name because the id differs between prod and any restore; an unmatched name
-- seeds an empty list, which is the old behaviour exactly.
INSERT INTO site_settings (key, value)
SELECT 'shelf_clear_users',
       jsonb_build_object('user_ids', COALESCE(jsonb_agg(u.id), '[]'::jsonb))
  FROM users u
 WHERE u.name = 'محمد عادل' AND u.role = 'staff' AND u.deleted_at IS NULL
ON CONFLICT (key) DO NOTHING;
