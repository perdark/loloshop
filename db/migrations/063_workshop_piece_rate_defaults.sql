-- Demo-safe workshop defaults. Existing/admin-edited rates always win.
-- These non-zero examples make the worker/admin forms useful immediately after a
-- fresh demo migration; the admin can replace every amount from /admin/workshop.
BEGIN;

INSERT INTO workshop_piece_rates (operation, product, amount)
VALUES
  ('cut',             'robe',  500),
  ('overlock',        'robe',  750),
  ('robe_sew',        'robe', 1500),
  ('cut',             'cap',   250),
  ('cap_sew',         'cap',   750),
  ('cut',             'shawl', 250),
  ('shawl_close',     'shawl', 500),
  ('american_shawl',  'shawl',1000),
  ('cut',             'sash',  250),
  ('shawl_close',     'sash',  500)
ON CONFLICT (operation, product) DO NOTHING;

COMMIT;
