const { query } = require('../lib/db');

async function list(req, res) {
  const { unread } = req.query;
  const params = [req.user.id];
  let where = `user_id = $1`;
  if (unread === 'true') where += ` AND read = FALSE`;
  const { rows } = await query(
    `SELECT id, type, title_ar, body_ar, link, read, created_at
     FROM notifications WHERE ${where}
     ORDER BY created_at DESC LIMIT 50`,
    params
  );
  res.json({ data: rows });
}

async function markRead(req, res) {
  const { id } = req.params;
  const { rows } = await query(
    `UPDATE notifications SET read = TRUE WHERE id = $1 AND user_id = $2 RETURNING id, read`,
    [id, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  res.json({ data: rows[0] });
}

module.exports = { list, markRead };
