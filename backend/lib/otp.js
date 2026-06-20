const crypto = require('crypto');
const { query } = require('./db');

// Normalise a typed phone to the canonical local Iraqi form `07XXXXXXXXX`.
// Users sometimes omit the leading 0 (e.g. type `7713644460` instead of
// `07713644460`) — without this, lookups/OTP target the wrong number and nothing
// is sent. Also tolerates Arabic-Indic digits, separators, and a `+964`/`00964`/
// `964` country prefix, all of which collapse back to the local `0…` form so a
// user matches their stored account regardless of how they typed it.
function normalizeIqPhone(input) {
  if (input == null) return input;
  let d = String(input)
    .replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c))
    .replace(/[۰-۹]/g, (c) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c))
    .replace(/\D/g, '');
  if (!d) return String(input).trim();
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('964')) d = d.slice(3); // strip Iraq country code → local
  if (!d.startsWith('0')) d = '0' + d;      // default the leading 0 if omitted
  return d;
}

// Express middleware: normalise `req.body.phone` on the way in so every downstream
// handler (register/login/OTP/reset) sees the canonical form.
function normalizePhoneBody(req, _res, next) {
  if (req.body && req.body.phone != null) {
    req.body.phone = normalizeIqPhone(req.body.phone);
  }
  next();
}

const TTL = parseInt(process.env.OTP_TTL_SECONDS || '300', 10);
// Per-phone request cap (IP-independent). Stops an attacker from resetting the
// 5-guess brute-force budget by spamming new codes, and defeats IP-rotation that
// gets around the per-IP express-rate-limit. Counts ALL codes for the phone in the
// trailing hour regardless of purpose.
const MAX_OTP_REQUESTS_PER_HOUR = parseInt(process.env.OTP_MAX_PER_HOUR || '5', 10);

function generateCode() {
  return String(crypto.randomInt(100000, 1000000));
}

async function createOtp(phone, purpose = 'verify') {
  // Enforced in production only — dev has the master-OTP bypass, so the cap would
  // just add friction to repeated test logins for the same phone.
  if (process.env.NODE_ENV === 'production') {
    const recent = await query(
      `SELECT COUNT(*)::int AS n FROM otp_codes
       WHERE phone = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
      [phone]
    );
    if (recent.rows[0].n >= MAX_OTP_REQUESTS_PER_HOUR) {
      const err = new Error('تم طلب عدد كبير من الرموز. يرجى المحاولة بعد قليل.');
      err.status = 429;
      err.code = 'ERR_OTP_RATE';
      err.expose = true;
      throw err;
    }
  }
  const code = generateCode();
  const expiresAt = new Date(Date.now() + TTL * 1000);
  // Invalidate prior unused codes for this phone+purpose only.
  await query(
    `UPDATE otp_codes SET used = TRUE WHERE phone = $1 AND purpose = $2 AND used = FALSE`,
    [phone, purpose]
  );
  await query(
    `INSERT INTO otp_codes (phone, code, expires_at, purpose) VALUES ($1, $2, $3, $4)`,
    [phone, code, expiresAt, purpose]
  );
  await sendViaZentramsg(phone, code);
  return { expires_in: TTL };
}

// Master OTP bypass so dev/testing doesn't require reading the code from
// logs/WhatsApp — defaults to 111111 in dev. HARD-DISABLED in production: a master
// code logs in as ANY phone (incl. admin/staff) and gates password reset, so it is
// never honored when NODE_ENV==='production', even if DEV_MASTER_OTP is set in env.
const MAX_OTP_ATTEMPTS = 5; // wrong guesses before the code is burned
// In prod the master code is a full-account-takeover backdoor, so it stays OFF
// unless BOTH an explicit opt-in flag and a NON-default code are set in env.
// There is NO baked-in default any more (the old 111111 is gone): a master code is
// honored ONLY when DEV_MASTER_OTP is explicitly set in env. With it unset, dev reads
// the real code from the backend console (or WhatsApp once Zentramsg creds are set).
const DEV_MASTER_OTP = (() => {
  if (process.env.NODE_ENV !== 'production') {
    return process.env.DEV_MASTER_OTP || null;
  }
  if (process.env.ALLOW_PROD_MASTER_OTP === 'true' && process.env.DEV_MASTER_OTP) {
    console.warn('[OTP] PROD master OTP ENABLED via ALLOW_PROD_MASTER_OTP — backdoor active.');
    return process.env.DEV_MASTER_OTP;
  }
  return null;
})();

async function verifyOtp(phone, code, purpose = 'verify') {
  if (DEV_MASTER_OTP && code === DEV_MASTER_OTP) {
    console.log(`[OTP DEV] master code accepted for ${phone} (${purpose})`);
    return true;
  }
  // Find the latest still-valid code for this phone+purpose, regardless of whether
  // the submitted code matches — so we can count wrong guesses against it.
  const { rows } = await query(
    `SELECT id, code, attempts FROM otp_codes
     WHERE phone = $1 AND purpose = $2 AND used = FALSE AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [phone, purpose]
  );
  if (!rows.length) return false;
  const otp = rows[0];

  // Too many wrong guesses on this code → burn it (forces requesting a new one).
  if (otp.attempts >= MAX_OTP_ATTEMPTS) {
    await query(`UPDATE otp_codes SET used = TRUE WHERE id = $1`, [otp.id]);
    return false;
  }
  if (otp.code !== code) {
    // Atomic gate+increment: the `attempts < cap` predicate is evaluated under the
    // row lock, so concurrent wrong guesses can't slip past the cap (no TOCTOU).
    await query(
      `UPDATE otp_codes SET attempts = attempts + 1
       WHERE id = $1 AND attempts < $2`,
      [otp.id, MAX_OTP_ATTEMPTS]
    );
    return false;
  }
  // Single-use: only the request that flips used FALSE→TRUE wins (guards a race
  // where the same correct code is submitted twice concurrently).
  const consumed = await query(
    `UPDATE otp_codes SET used = TRUE WHERE id = $1 AND used = FALSE RETURNING id`,
    [otp.id]
  );
  return consumed.rows.length > 0;
}

// Defensive URL resolver: guards against the common misconfiguration where the
// whole `KEY=value` assignment is pasted as the value again (e.g.
// `ZENTRAMSG_API_URL=ZENTRAMSG_API_URL=https://…`), which produces a non-URL
// string that causes fetch() to throw and silently drops every OTP.
const ZENTRAMSG_DEFAULT_URL = 'https://api.zentramsg.com/v1/messages';
function resolveZentramsgUrl() {
  const raw = process.env.ZENTRAMSG_API_URL;
  if (!raw) return ZENTRAMSG_DEFAULT_URL;
  try {
    const u = new URL(String(raw).trim());
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
  } catch { /* fall through */ }
  console.error(
    `[OTP] ZENTRAMSG_API_URL is not a valid http(s) URL — falling back to ${ZENTRAMSG_DEFAULT_URL}. ` +
    'Check backend/.env (a duplicated "ZENTRAMSG_API_URL=" prefix is the usual cause).'
  );
  return ZENTRAMSG_DEFAULT_URL;
}
const ZENTRAMSG_URL = resolveZentramsgUrl();

// Zentramsg's `ids` field wants international digits with no leading '+' or '00'
// (e.g. an Iraqi local number 0771234567 → 964771234567). Numbers are stored
// in local form, so normalise here.
function toIntlDigits(phone) {
  let d = String(phone).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('964')) return d;          // already international
  if (d.startsWith('0')) return '964' + d.slice(1); // local Iraqi → +964
  return d;
}

async function sendViaZentramsg(phone, code) {
  // Always surface the code on dev so local testing works even when Zentramsg
  // creds are present (no more blind OTP loops in development).
  if (process.env.NODE_ENV !== 'production') console.log(`[OTP DEV] ${phone} -> ${code}`);

  const token = process.env.ZENTRAMSG_API_KEY;       // x-api-token
  const device = process.env.ZENTRAMSG_DEVICE_UUID;  // device_uuid (the WhatsApp sender device)
  if (!token || !device) {
    // Never print live codes to logs in production. If the WhatsApp creds are
    // missing in prod, OTP can't be delivered — surface it loudly rather than
    // leaking codes to the logs.
    if (process.env.NODE_ENV === 'production') {
      console.error('ZENTRAMSG_API_KEY / ZENTRAMSG_DEVICE_UUID missing — OTP cannot be sent in production.');
    }
    return;
  }
  try {
    const form = new FormData();
    form.append('device_uuid', device);
    form.append('text_message', `رمز التحقق LoloShop: ${code}`);
    form.append('type_message', 'text');
    form.append('type_contact', 'numbers');
    form.append('ids', toIntlDigits(phone));
    // Native fetch sets the multipart Content-Type (with boundary) from the FormData.
    const res = await fetch(ZENTRAMSG_URL, {
      method: 'POST',
      headers: { 'x-api-token': token },
      body: form,
    });
    if (!res.ok) console.error('Zentramsg send failed:', res.status, await res.text());
  } catch (e) {
    console.error('Zentramsg error:', e.message);
  }
}

module.exports = { createOtp, verifyOtp, toIntlDigits, normalizeIqPhone, normalizePhoneBody };
