// ───────────────────────────────────────────────────────────────────────────
// First-party storefront analytics — the ONLY data feeding the TV board's
// «الزيارات الآن» (live audience) metric. Public, unauthenticated, write-only.
//
// The public shop pings POST /api/track/visit on load with a localStorage
// session id (a random uuid). We store AT MOST one row per session per 5 min
// (so an open tab heart-beating every few minutes never floods the table), and
// the board counts DISTINCT session_id in the last 30 minutes. No IP, no PII,
// no cookies — privacy-light by design.
// ───────────────────────────────────────────────────────────────────────────
const { query } = require('../lib/db');

async function visit(req, res) {
  try {
    const sid = String((req.body && req.body.session_id) || '').trim();
    // accept a sane session id only (client sends a uuid/short token)
    if (!sid || sid.length < 6 || sid.length > 80) {
      return res.status(204).end(); // silently ignore junk — never break the shop
    }
    const path = String((req.body && req.body.path) || '').slice(0, 160) || null;
    // Insert only when this session has no row in the last 5 min → caps row growth
    // and keeps "distinct sessions in 30 min" accurate for an active viewer.
    await query(
      `INSERT INTO site_visits (session_id, path)
       SELECT $1, $2
       WHERE NOT EXISTS (
         SELECT 1 FROM site_visits
         WHERE session_id = $1 AND created_at > now() - INTERVAL '5 minutes'
       )`,
      [sid, path]
    );
    res.status(204).end();
  } catch (err) {
    // Tracking must never surface an error to the shop visitor.
    console.error('visit track failed:', err.message);
    res.status(204).end();
  }
}

module.exports = { visit };
