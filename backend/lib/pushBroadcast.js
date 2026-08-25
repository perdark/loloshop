// backend/lib/pushBroadcast.js — «إرسال إشعار» : a notification a HUMAN wrote.
//
// Every push the shop has ever sent was emitted by code, at a moment the code chose (an order
// approved, a deadline near, a salary paid). This is the first one an admin types, and that
// makes it the first one with no upstream event to bound it: the audience is whatever the
// sender picks, and there is no way to unsend it.
//
// ── IT REUSES THE OUTBOX, IT DOES NOT SEND ─────────────────────────────────────────────────
// A broadcast writes one `notifications` row per recipient and stops. lib/pushOutbox.js drains
// them exactly as it drains the thirteen existing call sites, so the claim query, the flood
// guard, the freshness window and dead-token handling all apply unchanged — and every blast
// ALSO lands in the in-app bell, so a push that arrives while the phone is off is still
// readable later. A second send path would have to re-earn all of that.
//
// ── THE THREE GUARDS, AND WHY EACH ONE EXISTS ──────────────────────────────────────────────
//
// 1. `link` MUST be a relative in-app path from an allowlist. A broadcast that can carry an
//    arbitrary URL is a phishing primitive pointed at 1,100+ accounts: it arrives from the
//    shop, with the shop's name on it, and one compromised admin session — or one XSS on the
//    admin page — turns it into a credential-harvest campaign. An absolute URL is refused
//    outright rather than sanitised, because "sanitising" a URL is where this class of bug
//    always comes back.
//
// 2. A send to EVERYONE requires the sender to type the recipient count back. Not ceremony:
//    the difference between «طلاب جامعة ديالى» and «الكل» is one dropdown, the two look alike
//    on a phone, and the mistake is unrecoverable. Typing a number that only appears after the
//    audience is resolved forces one look at what is actually about to happen.
//
// 3. Every send is logged to `push_broadcasts` BEFORE the rows are written. If the insert of
//    1,100 notification rows fails halfway, the record of who pressed what still exists.
//
// ── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────────────────────
// No scheduling, no templates, no segments-by-behaviour. Those are marketing-tool features and
// each one widens the blast radius of a mistake; the owner asked to be able to send a message.

const { query, tx } = require('./db');

/**
 * In-app destinations a broadcast may point at.
 *
 * A CLOSED LIST, matched exactly or by a `:id` suffix — never a prefix test. `/orders` and
 * `/orders-evil` share a prefix; `startsWith` would accept the second. Adding an entry here is
 * a deliberate act, which is the point.
 */
const LINK_ALLOWLIST = [
  '/',
  '/cart',
  '/orders',
  '/products',
  '/design',
  '/profile',
  '/wholesaler',
  '/wholesaler/students',
  '/staff',
  '/get-app',
];

/** `/orders/<uuid>` and friends: an allowlisted base plus one id segment. */
const ID_SUFFIX = /^[0-9a-f-]{8,36}$/i;

/**
 * @returns {{ok: true, link: string|null}|{ok: false, error: string, code: string}}
 */
function checkLink(raw) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, link: null };
  const link = String(raw).trim();

  // Anything that could leave the app. `//evil.com` is protocol-relative and is a URL despite
  // starting with a slash, so the leading-slash test alone is not enough.
  if (!link.startsWith('/') || link.startsWith('//')) {
    return { ok: false, error: 'الرابط لازم يكون داخل التطبيق', code: 'ERR_LINK_EXTERNAL' };
  }
  if (link.includes('\\') || link.includes('@') || /[\r\n]/.test(link)) {
    return { ok: false, error: 'رابط غير صالح', code: 'ERR_LINK_INVALID' };
  }

  const path = link.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  if (LINK_ALLOWLIST.includes(path)) return { ok: true, link };

  const cut = path.lastIndexOf('/');
  const base = cut > 0 ? path.slice(0, cut) : null;
  const tail = cut > 0 ? path.slice(cut + 1) : null;
  if (base && LINK_ALLOWLIST.includes(base) && ID_SUFFIX.test(tail)) {
    return { ok: true, link };
  }

  return { ok: false, error: 'هذا الرابط مو من روابط التطبيق المسموحة', code: 'ERR_LINK_NOT_ALLOWED' };
}

const ROLES = new Set(['retail', 'wholesaler', 'staff', 'admin']);

/**
 * Turn an audience descriptor into the SQL that names its recipients.
 *
 * ⚠️ Deleted accounts are excluded everywhere. Migration 076 anonymises rather than row-deletes
 * (orders.student_id is ON DELETE RESTRICT), so a deleted user is still a `users` row and would
 * otherwise be counted — and pushed to, if a stale device token outlived the deletion.
 *
 * @returns {{ok: true, sql: string, params: Array, label: string}|{ok: false, error, code}}
 */
function audienceSql(audience) {
  const kind = audience && audience.kind;
  const value = audience && audience.value;

  if (kind === 'all') {
    return { ok: true, sql: `SELECT id FROM users WHERE deleted_at IS NULL`, params: [], label: 'الكل' };
  }

  if (kind === 'role') {
    if (!ROLES.has(value)) return { ok: false, error: 'دور غير معروف', code: 'ERR_VALIDATION' };
    return {
      ok: true,
      sql: `SELECT id FROM users WHERE deleted_at IS NULL AND role = $1`,
      params: [value],
      label: `دور: ${value}`,
    };
  }

  if (kind === 'wholesaler') {
    // The rep's own students. The rep themselves is NOT included: «بلّغ طلابك» and «بلّغ الممثل»
    // are different messages, and folding them together means the rep gets a notice addressed
    // to their students.
    if (!value) return { ok: false, error: 'اختر ممثلاً', code: 'ERR_VALIDATION' };
    return {
      ok: true,
      sql: `SELECT u.id FROM users u
              JOIN students s ON s.user_id = u.id
             WHERE u.deleted_at IS NULL AND s.wholesaler_id = $1`,
      params: [value],
      label: 'طلاب ممثل',
    };
  }

  if (kind === 'university') {
    if (!value) return { ok: false, error: 'اكتب اسم الجامعة', code: 'ERR_VALIDATION' };
    // ⚠️ `university_name` is free text and one university is spelled three ways on prod (see
    // HANDOFF). An exact match would silently miss two thirds of a cohort, so this matches
    // case-insensitively on a contained string and the caller is shown the resolved count
    // BEFORE sending — that count is the only honest check that the spelling caught everyone.
    return {
      ok: true,
      sql: `SELECT u.id FROM users u
              JOIN students s ON s.user_id = u.id
             WHERE u.deleted_at IS NULL AND s.university_name ILIKE '%' || $1 || '%'`,
      params: [String(value).trim()],
      label: `جامعة: ${value}`,
    };
  }

  if (kind === 'user') {
    if (!value) return { ok: false, error: 'اختر شخصاً', code: 'ERR_VALIDATION' };
    return {
      ok: true,
      sql: `SELECT id FROM users WHERE deleted_at IS NULL AND id = $1`,
      params: [value],
      label: 'شخص واحد',
    };
  }

  return { ok: false, error: 'جمهور غير معروف', code: 'ERR_VALIDATION' };
}

/**
 * How many people the audience resolves to, and how many of them could actually receive a push.
 *
 * The two numbers are always shown together and are usually far apart: someone with no device
 * token still gets the in-app bell, so «٣١٢ شخص · ١٩٤ جهاز» is not an error — it is the honest
 * reach of the message, and hiding the gap would make the bell look broken.
 */
async function resolveAudience(audience) {
  const built = audienceSql(audience);
  if (!built.ok) return built;

  const { rows } = await query(
    `WITH aud AS (${built.sql})
     SELECT (SELECT COUNT(*)::int FROM aud) AS people,
            (SELECT COUNT(DISTINCT d.user_id)::int FROM device_tokens d
              WHERE d.user_id IN (SELECT id FROM aud)) AS devices`,
    built.params
  );
  return { ok: true, ...built, people: rows[0].people, devices: rows[0].devices };
}

const TITLE_MAX = 80;
const BODY_MAX = 300;

/**
 * Write the broadcast.
 *
 * One transaction: the audit row first, then the notification rows in a single INSERT…SELECT so
 * 1,100 recipients cost one statement rather than 1,100 round trips to Neon.
 *
 * `push_state` is left at its 'pending' default — that IS the queue (migration 077), and the
 * outbox picks the rows up after commit.
 */
async function send({ audience, titleAr, bodyAr, link, adminId, confirmedCount }) {
  const title = String(titleAr || '').trim();
  const body = String(bodyAr || '').trim();
  if (!title) return { ok: false, error: 'اكتب عنوان الإشعار', code: 'ERR_VALIDATION' };
  if (title.length > TITLE_MAX || body.length > BODY_MAX) {
    return { ok: false, error: 'النص طويل جداً', code: 'ERR_VALIDATION' };
  }

  const checked = checkLink(link);
  if (!checked.ok) return checked;

  const resolved = await resolveAudience(audience);
  if (!resolved.ok) return resolved;
  if (resolved.people === 0) {
    return { ok: false, error: 'ما في أحد بهذا الجمهور', code: 'ERR_EMPTY_AUDIENCE' };
  }

  // Guard 2 — see the header. Only for «الكل»: demanding it on every send would train the
  // sender to type numbers without reading them, which is worse than not asking.
  if (audience.kind === 'all' && Number(confirmedCount) !== resolved.people) {
    return {
      ok: false,
      error: `اكتب عدد المستلمين (${resolved.people}) للتأكيد`,
      code: 'ERR_CONFIRM_COUNT',
    };
  }

  const built = audienceSql(audience);
  const result = await tx(async (client) => {
    const { rows: logRows } = await client.query(
      `INSERT INTO push_broadcasts
         (admin_id, audience_kind, audience_value, title_ar, body_ar, link, people, devices)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        adminId || null,
        audience.kind,
        audience.value === undefined ? null : String(audience.value),
        title,
        body || null,
        checked.link,
        resolved.people,
        resolved.devices,
      ]
    );
    const broadcastId = logRows[0].id;

    // ⚠️ The audience params come FIRST and the copy's placeholders are numbered after them.
    // `built.sql` is written with its own $1, so hard-coding $1..$3 for the copy here would
    // collide with it — and the collision is silent: the audience filter would receive the
    // notification title as its parameter and match nobody, or match the wrong people.
    const n = built.params.length;
    const { rowCount } = await client.query(
      `INSERT INTO notifications (user_id, type, title_ar, body_ar, link)
       SELECT id, 'admin_broadcast', $${n + 1}, $${n + 2}, $${n + 3}
         FROM (${built.sql}) AS aud`,
      [...built.params, title, body || null, checked.link]
    );
    return { broadcastId, rowCount };
  });

  return {
    ok: true,
    broadcast_id: result.broadcastId,
    people: result.rowCount,
    devices: resolved.devices,
    label: resolved.label,
  };
}

module.exports = {
  send,
  resolveAudience,
  checkLink,
  audienceSql,
  LINK_ALLOWLIST,
  TITLE_MAX,
  BODY_MAX,
};
