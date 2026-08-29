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
 * Called by the app on every launch (frontend/lib/push.ts), not only the first time: FCM and
 * APNs both rotate tokens on their own schedule — after a restore, an app update, or for no
 * visible reason — and a stale token fails silently forever.
 *
 * ⚠️ IT ACCEPTS AN UNAUTHENTICATED CALLER SINCE MIGRATION 095, and that is the whole point.
 * `user_id` is nullable now: a phone that granted notification permission before it ever had
 * an account registers with a NULL owner instead of having its token thrown away by the
 * client. iOS grants that permission exactly once per install — discarding the token it buys,
 * because nobody had logged in yet, was the most expensive silence in the system (165 tokens
 * against 2,249 accounts on 2026-08-29, and none at all for anyone who never registered).
 *
 * ⚠️ THE UPSERT IS ON `token`, NOT ON (user_id, token). Phones here are shared and re-sold,
 * and the provider hands the SAME token to whoever signs in next. Conflicting on the token
 * MOVES the device to its new owner; a per-user unique key would leave the previous account
 * still subscribed and deliver a student's «تمت الموافقة» to the person who bought their
 * phone. This is the single line that prevents that — and it is also what promotes an
 * anonymous row to a personal one the moment that handset signs in, with no duplicate row and
 * no second permission prompt.
 *
 * ⚠️ `marketing_opt_in` IS ONLY EVER RAISED HERE, NEVER LOWERED. The app sends `true` when the
 * consent card won the grant; a plain re-registration on a later launch omits it, and an
 * omitted flag must not silently revoke a consent the person gave. Withdrawal has its own
 * endpoint (`deviceMarketing` below) — the in-app opt-out Apple 4.5.4 requires.
 *
 * ⚠️ A SIGNED-IN CONSENT WRITES THE ACCOUNT'S PREFERENCE, NOT THE DEVICE'S. An account's
 * consent has to follow the person onto their next phone, so for a known user it belongs in
 * `users.notification_prefs` (089) — the column the broadcast gate already reads. This is an
 * explicit tap on consent language, which is exactly the opt-in 4.5.4 asks for; it is NOT the
 * default flip the HANDOFF landmine warns about, and it enrols nobody who never saw the card.
 */
async function registerDevice(req, res) {
  const token = String(req.body?.token || '').trim();
  const platform = String(req.body?.platform || '').trim();
  if (!token || token.length > MAX_TOKEN_LEN || !PLATFORMS.includes(platform)) {
    return res.status(400).json({ error: 'بيانات الجهاز غير صحيحة', code: 'ERR_VALIDATION' });
  }
  const optedIn = req.body?.marketing_opt_in === true;
  const userId = req.user ? req.user.id : null;

  await query(
    `INSERT INTO device_tokens (user_id, token, platform, marketing_opt_in)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (token) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           platform = EXCLUDED.platform,
           marketing_opt_in = device_tokens.marketing_opt_in OR EXCLUDED.marketing_opt_in,
           last_seen_at = now()`,
    [userId, token, platform, optedIn]
  );

  if (userId && optedIn) {
    await query(
      `UPDATE users SET notification_prefs = notification_prefs || '{"marketing": true}'::jsonb
        WHERE id = $1`,
      [userId]
    );
  }
  res.json({ data: { registered: true, anonymous: !userId } });
}

/**
 * The in-app opt-out for a handset with no account — the other half of what keeps an anonymous
 * promotional push inside Apple 4.5.4.
 *
 * ⚠️ SCOPED BY THE TOKEN THE CALLER ALREADY HOLDS, which is the only identity an anonymous
 * device has. That is weaker than a session, and the trade is deliberate: the worst a leaked
 * token buys is turning someone's offers OFF — never on, never reading anything, never
 * attaching a phone to an account. A signed-in caller is additionally pinned to their own row,
 * so one account can never reach into another's device.
 *
 * A signed-in user's own consent lives on their account (`PATCH /prefs`); this only ever moves
 * the device flag.
 */
async function deviceMarketing(req, res) {
  const token = String(req.body?.token || '').trim();
  if (!token || token.length > MAX_TOKEN_LEN || typeof req.body?.marketing !== 'boolean') {
    return res.status(400).json({ error: 'بيانات الجهاز غير صحيحة', code: 'ERR_VALIDATION' });
  }
  const { rows } = await query(
    `UPDATE device_tokens SET marketing_opt_in = $2
      WHERE token = $1 AND ($3::uuid IS NULL OR user_id = $3)
      RETURNING marketing_opt_in`,
    [token, req.body.marketing, req.user ? req.user.id : null]
  );
  if (!rows.length) {
    return res.status(404).json({ error: 'الجهاز غير مسجّل', code: 'ERR_NOT_FOUND' });
  }
  res.json({ data: { marketing: rows[0].marketing_opt_in } });
}

/**
 * What this handset currently believes, for the signed-out settings screen. Returns the
 * device's own flag — never an account's — and 404s an unknown token so the UI can simply hide
 * the switch rather than show a control that saves nowhere.
 */
async function getDeviceMarketing(req, res) {
  const token = String(req.query?.token || '').trim();
  if (!token || token.length > MAX_TOKEN_LEN) {
    return res.status(400).json({ error: 'بيانات الجهاز غير صحيحة', code: 'ERR_VALIDATION' });
  }
  const { rows } = await query(
    `SELECT marketing_opt_in FROM device_tokens WHERE token = $1`,
    [token]
  );
  if (!rows.length) {
    return res.status(404).json({ error: 'الجهاز غير مسجّل', code: 'ERR_NOT_FOUND' });
  }
  res.json({ data: { marketing: rows[0].marketing_opt_in } });
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
  // ⚠️ An anonymous caller may only remove an anonymous row, and that needs its own IS NULL
  // branch: `user_id = $2` with a NULL $2 is never true in SQL, so without it a signed-out
  // logout would delete nothing and the handset would keep receiving.
  const { rowCount } = await query(
    `DELETE FROM device_tokens
      WHERE token = $1
        AND (($2::uuid IS NULL AND user_id IS NULL) OR user_id = $2)`,
    [token, req.user ? req.user.id : null]
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

module.exports = {
  list,
  markRead,
  markAllRead,
  registerDevice,
  unregisterDevice,
  deviceMarketing,
  getDeviceMarketing,
  getPrefs,
  updatePrefs,
};
