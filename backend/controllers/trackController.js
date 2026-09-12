// ───────────────────────────────────────────────────────────────────────────
// First-party storefront analytics — the ONLY data feeding the TV board's
// «الزيارات الآن» (live audience) metric. Public, unauthenticated, write-only.
//
// The public shop pings POST /api/track/visit on load, on every navigation, and on a light
// heartbeat, with a localStorage session id (a random uuid). We store AT MOST one row per
// session per 5 min (so an open tab heart-beating every few minutes never floods the table),
// and the board counts DISTINCT session_id in the last 30 minutes. No IP, no PII, no cookies —
// privacy-light by design.
//
// ⚠️ THE 5-MINUTE DEDUP IS WHAT MAKES A ROW A UNIT OF TIME. /admin/analytics reads each row as
// ~5 minutes spent on `path`; loosen the window and every "minutes per visit" figure on that
// page silently inflates. It is a rate limit AND the page's clock.
//
// ⚠️ `platform` (migration 110) is CLIENT-CLAIMED and unauthenticated — a visitor can send
// anything. It is fine for a usage split and must never gate anything: the app-only gate makes
// its own decision from window.Capacitor, in the browser, before first paint. Unrecognised
// values are stored as NULL rather than rejected, because a wrong label is worse than a gap.
// ───────────────────────────────────────────────────────────────────────────
const { query } = require('../lib/db');

const PLATFORMS = new Set(['android', 'ios', 'web']);

async function visit(req, res) {
  try {
    const sid = String((req.body && req.body.session_id) || '').trim();
    // accept a sane session id only (client sends a uuid/short token)
    if (!sid || sid.length < 6 || sid.length > 80) {
      return res.status(204).end(); // silently ignore junk — never break the shop
    }
    const path = String((req.body && req.body.path) || '').slice(0, 160) || null;
    // NULL for anything we do not recognise. NULL already means «قبل ما نبدي نسجّل المنصة» for
    // every row older than migration 110, and both gaps read the same way: «غير معروف».
    const raw = String((req.body && req.body.platform) || '');
    const platform = PLATFORMS.has(raw) ? raw : null;
    // Insert only when this session has no row in the last 5 min → caps row growth
    // and keeps "distinct sessions in 30 min" accurate for an active viewer.
    // ⚠️ THIS DEDUP IS NOT ATOMIC and cannot be made so cheaply: under READ COMMITTED two pings
    // in the same millisecond both see no row and both insert (measured 2026-09-12). The client
    // carries a matching 60s same-path guard for exactly this reason — see VisitBeacon's header.
    // If duplicates ever show up in the data again, fix the CLIENT first; a lock or a unique
    // index here would put a failure path in front of a beacon that must never fail.
    await query(
      `INSERT INTO site_visits (session_id, path, platform)
       SELECT $1, $2, $3
       WHERE NOT EXISTS (
         SELECT 1 FROM site_visits
         WHERE session_id = $1 AND created_at > now() - INTERVAL '5 minutes'
       )`,
      [sid, path, platform]
    );
    res.status(204).end();
  } catch (err) {
    // Tracking must never surface an error to the shop visitor.
    console.error('visit track failed:', err.message);
    res.status(204).end();
  }
}

module.exports = { visit };
