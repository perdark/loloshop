'use strict';
// Who may press «فرّغ الرف» (shelf-wide wipe). Default: manager + admin, as before.
// Owner 2026-10-25 opened it to محمد عادل by name — the allowlist lives in
// site_settings.shelf_clear_users = { user_ids: [...] } (migration 117), so adding or removing
// a person is a data change, never a deploy. Read per request: it is one PK lookup on a
// button nobody presses twice a day.
const { query } = require('./db');
const { staffTypesOf } = require('../middleware/auth');

async function allowedIds() {
  const { rows } = await query(`SELECT value FROM site_settings WHERE key = 'shelf_clear_users'`);
  const ids = rows[0] && rows[0].value && rows[0].value.user_ids;
  return Array.isArray(ids) ? ids.map(String) : [];
}

async function mayClearShelf(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role !== 'staff') return false;
  if (staffTypesOf(user).includes('manager')) return true;
  return (await allowedIds()).includes(String(user.id));
}

async function allowShelfClear(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ error: 'غير مصرح', code: 'ERR_AUTH' });
    if (await mayClearShelf(req.user)) return next();
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  } catch (err) {
    return next(err);
  }
}

module.exports = { mayClearShelf, allowShelfClear };
