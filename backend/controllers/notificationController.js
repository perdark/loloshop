const { query } = require('../lib/db');
const prefs = require('../lib/notificationPrefs');

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

async function markAllRead(req, res) {
  const { rowCount } = await query(
    `UPDATE notifications SET read = TRUE WHERE user_id = $1 AND read = FALSE`,
    [req.user.id]
  );
  res.json({ data: { updated: rowCount } });
}


// ── Device registration for push (migration 077) ─────────────────────────────

/** FCM tokens run ~160 chars, APNs 64+ hex. The cap only stops a junk body reaching the DB. */
const MAX_TOKEN_LEN = 4096;
const PLATFORMS = ['android', 'ios'];

/**
 * Called by the app on every launch while signed in (frontend/lib/push.ts), not only the
 * first time: FCM and APNs both rotate tokens on their own schedule — after a restore, an
 * app update, or for no visible reason — and a stale token fails silently forever.
 *
 * ⚠️ THE UPSERT IS ON `token`, NOT ON (user_id, token). Phones here are shared and re-sold,
 * and the provider hands the SAME token to whoever signs in next. Conflicting on the token
 * MOVES the device to its new owner; a per-user unique key would leave the previous account
 * still subscribed and deliver a student's «تمت الموافقة» to the person who bought their
 * phone. This is the single line that prevents that.
 */
async function registerDevice(req, res) {
  const token = String(req.body?.token || '').trim();
  const platform = String(req.body?.platform || '').trim();
  if (!token || token.length > MAX_TOKEN_LEN || !PLATFORMS.includes(platform)) {
    return res.status(400).json({ error: 'بيانات الجهاز غير صحيحة', code: 'ERR_VALIDATION' });
  }
  await query(
    `INSERT INTO device_tokens (user_id, token, platform)
     VALUES ($1, $2, $3)
     ON CONFLICT (token) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           platform = EXCLUDED.platform,
           last_seen_at = now()`,
    [req.user.id, token, platform]
  );
  res.json({ data: { registered: true } });
}

/**
 * Logout, from the device that is leaving. Scoped to the caller's own rows so a leaked token
 * string cannot be used to unsubscribe someone else's phone.
 *
 * The app fires this BEFORE clearing its JWT (frontend/lib/auth.ts) — afterwards the request
 * would be a 401 and the phone would keep receiving the previous user's notifications until
 * somebody signed in again on it.
 */
async function unregisterDevice(req, res) {
  const token = String(req.body?.token || '').trim();
  if (!token || token.length > MAX_TOKEN_LEN) {
    return res.status(400).json({ error: 'بيانات الجهاز غير صحيحة', code: 'ERR_VALIDATION' });
  }
  const { rowCount } = await query(
    `DELETE FROM device_tokens WHERE token = $1 AND user_id = $2`,
    [token, req.user.id]
  );
  res.json({ data: { removed: rowCount } });
}

// ── «شنو تريد يوصلك؟» — notification preferences (migration 089) ─────────────
// ⚠️ These two endpoints are what keeps the app inside Apple's guideline 4.5.4: promotional
// push needs an explicit in-app opt-in AND an in-app opt-out. See lib/notificationPrefs.js.

/** GET /api/notifications/prefs */
async function getPrefs(req, res) {
  const { rows } = await query(`SELECT notification_prefs FROM users WHERE id = $1`, [req.user.id]);
  res.json({ data: prefs.normalize(rows[0] && rows[0].notification_prefs) });
}

/**
 * PATCH /api/notifications/prefs — body: { orders?: bool, marketing?: bool }
 *
 * Merged, not replaced: the client sends only the toggle that moved, so two settings screens
 * open at once cannot silently reset each other's category.
 */
async function updatePrefs(req, res) {
  const checked = prefs.validatePatch(req.body);
  if (!checked.ok) return res.status(400).json({ error: checked.error, code: checked.code });

  const { rows } = await query(
    `UPDATE users SET notification_prefs = notification_prefs || $2::jsonb
      WHERE id = $1 RETURNING notification_prefs`,
    [req.user.id, JSON.stringify(checked.patch)]
  );
  res.json({ data: prefs.normalize(rows[0] && rows[0].notification_prefs) });
}

module.exports = { list, markRead, markAllRead, registerDevice, unregisterDevice, getPrefs, updatePrefs };
