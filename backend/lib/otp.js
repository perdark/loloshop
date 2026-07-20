const crypto = require('crypto');
const { query, tx } = require('./db');
const { secretMatches } = require('./secretCompare');

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

// A real Iraqi mobile in canonical local form is exactly `07` + 9 digits (11 total),
// e.g. 07713644460. Garbage like `03`, `010`, `0771`, `07788888` fails this. Blasting
// WhatsApp messages to non-existent numbers is the #1 reason an unofficial-gateway sender
// number gets spam-banned by Meta — so NOTHING is sent unless the recipient passes this.
function isValidIqMobile(phone) {
  return typeof phone === 'string' && /^07\d{9}$/.test(phone);
}

// Demo-login allow-list: phones listed in DEMO_LOGIN_PHONES (comma-separated) skip the
// WhatsApp OTP on login. This exists to give an app-store reviewer (Google Play / App Store)
// a working sign-in without a real WhatsApp OTP they can't receive on an Iraqi number they
// don't own. Empty/unset/expired → NO phone bypasses (fail-safe), and the required deadline
// may be at most 30 days away. The login handler additionally requires role==='retail', so
// a mistakenly-listed admin/staff number can never skip OTP.
// The password is still bcrypt-verified, so this is an OTP skip, not a passwordless backdoor.
function isDemoLoginPhone(phone) {
  const raw = process.env.DEMO_LOGIN_PHONES;
  if (!raw || !phone) return false;
  // Reviewer bypasses must expire. An allow-list without a valid near-term deadline is
  // inert, preventing a temporary App Store review exception from becoming permanent.
  const expiresAt = Date.parse(process.env.DEMO_LOGIN_EXPIRES_AT || '');
  const remaining = expiresAt - Date.now();
  if (!Number.isFinite(expiresAt) || remaining <= 0 || remaining > 30 * 24 * 60 * 60 * 1000) {
    return false;
  }
  const list = raw.split(',').map((p) => normalizeIqPhone(p.trim())).filter(Boolean);
  return list.includes(normalizeIqPhone(phone));
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
const OTP_PURPOSES = new Set(['verify', 'login', 'reset']);

function otpRateError() {
  const err = new Error('تم طلب عدد كبير من الرموز. يرجى المحاولة بعد قليل.');
  err.status = 429;
  err.code = 'ERR_OTP_RATE';
  err.expose = true;
  return err;
}

function generateCode() {
  return String(crypto.randomInt(100000, 1000000));
}

// Challenge ids are UUIDs handed to the client. Validate the shape before it reaches a
// ::uuid cast so a malformed value is a clean "wrong code" rather than a 500.
const CHALLENGE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `opts.userId` pins the account this code may authenticate. Always pass it for flows
// that end in a token (login/verify); verification refuses to mint one without it.
async function createOtp(phone, purpose = 'verify', opts = {}) {
  // Backstop validation: never generate/send an OTP for a number that isn't a real Iraqi
  // mobile. Controllers validate too (for nicer errors); this guarantees NO code path can
  // ever blast WhatsApp at a garbage number and get the sender banned.
  if (!isValidIqMobile(phone)) {
    const err = new Error('رقم هاتف غير صحيح');
    err.status = 400;
    err.code = 'ERR_INVALID_PHONE';
    err.expose = true;
    throw err;
  }
  if (!OTP_PURPOSES.has(purpose)) {
    throw new Error(`Unsupported OTP purpose: ${purpose}`);
  }
  if (!opts.userId) throw new Error('createOtp requires opts.userId');

  const code = generateCode();
  const expiresAt = new Date(Date.now() + TTL * 1000);
  const challengeId = await tx(async (client) => {
    // Serialize every create/resend operation for one phone. Without this lock, parallel
    // requests can all observe a remaining send slot and exceed the hourly budget.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [phone]);

    // A programming mistake must not send a code to one phone while binding it to another
    // account. Every authenticating challenge is required to match the user's stored phone.
    const bound = await client.query(
      `SELECT 1 FROM users WHERE id = $1 AND phone = $2`,
      [opts.userId, phone]
    );
    if (!bound.rows.length) throw new Error('OTP user/phone binding mismatch');

    // Count actual send attempts in a trailing window. `otp_codes.created_at` cannot do
    // this because resends reuse an old row; a resend at minute 59 must still count until
    // minute 119.
    const recent = await client.query(
      `SELECT COUNT(*)::int AS n FROM otp_send_events
       WHERE phone = $1 AND sent_at > NOW() - INTERVAL '1 hour'`,
      [phone]
    );
    if (recent.rows[0].n >= MAX_OTP_REQUESTS_PER_HOUR) throw otpRateError();

    // Invalidate + insert atomically so a failed insert never destroys a working code.
    await client.query(
      `UPDATE otp_codes SET used = TRUE WHERE phone = $1 AND purpose = $2 AND used = FALSE`,
      [phone, purpose]
    );
    const inserted = await client.query(
      `INSERT INTO otp_codes (phone, code, expires_at, purpose, user_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING challenge_id`,
      [phone, code, expiresAt, purpose, opts.userId]
    );
    await client.query(`INSERT INTO otp_send_events (phone) VALUES ($1)`, [phone]);
    return inserted.rows[0].challenge_id;
  });
  await sendViaZentramsg(phone, code);
  return { expires_in: TTL, challenge_id: challengeId };
}

const MAX_OTP_ATTEMPTS = 5; // wrong guesses before the code is burned

// Consume an OTP addressed BY CHALLENGE. The caller supplies only a challenge id it was
// given by a prior server flow plus the code — never a phone or a purpose — so it cannot
// choose which account it is authenticating. Returns { ok, phone, user_id } on success and
// { ok: false } for every failure (missing/expired/consumed challenge, wrong purpose,
// wrong code, attempts exhausted) so callers can't distinguish the cases and probe.
async function verifyOtpByChallenge(challengeId, code, purpose) {
  if (!challengeId || !CHALLENGE_RE.test(String(challengeId))) return { ok: false };
  if (!OTP_PURPOSES.has(purpose)) return { ok: false };

  // Keep the row locked through compare + consume. The old SELECT-then-UPDATE sequence let
  // many concurrent guesses all compare before any of their increments became visible,
  // and it raced resends so a superseded code could still consume a freshly-refreshed row.
  return tx(async (client) => {
    const { rows } = await client.query(
      `SELECT id, phone, code, attempts, user_id FROM otp_codes
       WHERE challenge_id = $1 AND purpose = $2 AND used = FALSE AND expires_at > NOW()
       FOR UPDATE`,
      [challengeId, purpose]
    );
    if (!rows.length) return { ok: false };
    const otp = rows[0];

    // Legacy rows written before challenge binding remain untouched and unusable.
    if (!otp.user_id) return { ok: false };
    if (otp.attempts >= MAX_OTP_ATTEMPTS) {
      await client.query(`UPDATE otp_codes SET used = TRUE WHERE id = $1`, [otp.id]);
      return { ok: false };
    }

    if (!secretMatches(String(code), otp.code)) {
      await client.query(
        `UPDATE otp_codes
         SET attempts = attempts + 1,
             used = (attempts + 1 >= $2)
         WHERE id = $1`,
        [otp.id, MAX_OTP_ATTEMPTS]
      );
      return { ok: false };
    }

    await client.query(`UPDATE otp_codes SET used = TRUE WHERE id = $1`, [otp.id]);
    return { ok: true, phone: otp.phone, user_id: otp.user_id };
  });
}

// Re-send the code for an existing challenge, IN PLACE — same row, same challenge id, fresh
// code and expiry. Keeping the id stable is deliberate: rotating it meant a resend whose
// response was lost left the client holding a superseded id while the user read out a code
// belonging to the new one, which could never verify. Returns null when there's nothing
// resendable, so the caller can't tell a bad id from an already-consumed one.
//
// Requires used = FALSE: an already-consumed challenge must never be revived (that would
// let a completed login be replayed). Expired-but-unused is fine — that's the normal case.
// Bounded to the last hour so an old id isn't a permanent send-to-this-number handle.
async function refreshOtp(challengeId) {
  if (!challengeId || !CHALLENGE_RE.test(String(challengeId))) return null;
  const code = generateCode();
  const phone = await tx(async (client) => {
    // Read the phone first without locking, then take the same per-phone advisory lock as
    // createOtp before locking the row. Consistent lock order avoids deadlocks.
    const found = await client.query(
      `SELECT phone FROM otp_codes
       WHERE challenge_id = $1 AND used = FALSE AND created_at > NOW() - INTERVAL '1 hour'`,
      [challengeId]
    );
    if (!found.rows.length) return null;
    const candidatePhone = found.rows[0].phone;
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [candidatePhone]);

    const locked = await client.query(
      `SELECT id, phone FROM otp_codes
       WHERE challenge_id = $1 AND used = FALSE AND created_at > NOW() - INTERVAL '1 hour'
       FOR UPDATE`,
      [challengeId]
    );
    if (!locked.rows.length) return null;

    const recent = await client.query(
      `SELECT COUNT(*)::int AS n FROM otp_send_events
       WHERE phone = $1 AND sent_at > NOW() - INTERVAL '1 hour'`,
      [locked.rows[0].phone]
    );
    if (recent.rows[0].n >= MAX_OTP_REQUESTS_PER_HOUR) throw otpRateError();

    await client.query(
      `UPDATE otp_codes SET code = $1, expires_at = $2, attempts = 0, sends = sends + 1
       WHERE id = $3`,
      [code, new Date(Date.now() + TTL * 1000), locked.rows[0].id]
    );
    await client.query(`INSERT INTO otp_send_events (phone) VALUES ($1)`, [locked.rows[0].phone]);
    return locked.rows[0].phone;
  });
  if (!phone) return null;
  await sendViaZentramsg(phone, code);
  return { expires_in: TTL, challenge_id: challengeId };
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
  // Final hard guard (belt & suspenders behind createOtp): never POST to WhatsApp for a
  // non-Iraqi-mobile recipient. Sending to invalid numbers is what gets the sender banned.
  const ids = toIntlDigits(phone);
  if (!isValidIqMobile(phone) || !/^964\d{10}$/.test(ids)) {
    console.error(`[OTP] refusing to send to invalid recipient: ${phone} (${ids})`);
    return { success: false, error: 'رقم هاتف غير صالح للإرسال' };
  }

  const token = process.env.ZENTRAMSG_API_KEY;       // x-api-token
  const device = process.env.ZENTRAMSG_DEVICE_UUID;  // device_uuid (the WhatsApp sender device)
  if (!token || !device) {
    // Never print live codes to logs in production. If the WhatsApp creds are
    // missing in prod, OTP can't be delivered — surface it loudly rather than
    // leaking codes to the logs.
    if (process.env.NODE_ENV === 'production') {
      console.error('ZENTRAMSG_API_KEY / ZENTRAMSG_DEVICE_UUID missing — OTP cannot be sent in production.');
    }
    return { success: false, error: 'إعدادات API الواتساب غير موجودة. يرجى التحقق من متغيرات البيئة.' };
  }
  try {
    const form = new FormData();
    form.append('device_uuid', device);
    form.append('text_message', `رمز التحقق LoloShop: ${code}`);
    form.append('type_message', 'text');
    form.append('type_contact', 'numbers');
    form.append('ids', ids);
    // Native fetch sets the multipart Content-Type (with boundary) from the FormData.
    const res = await fetch(ZENTRAMSG_URL, {
      method: 'POST',
      headers: { 'x-api-token': token },
      body: form,
    });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* non-JSON response — keep raw text */ }
    // Zentramsg confirms real delivery acceptance in the JSON BODY, not just the HTTP
    // status: a banned/expired sender device still returns HTTP 200 with success:false
    // (the message sits "pending" and is never delivered). Per the WhatsApp guide, count
    // it as sent ONLY when the body says success:true && msg:"MESSAGE_CREATED" — otherwise
    // log loudly so a silent ban is visible instead of looking like a successful send.
    const accepted = res.ok && body && body.success === true && body.msg === 'MESSAGE_CREATED';
    if (!accepted) {
      console.error('WhatsApp API rejected:', res.status, body?.msg ?? text, body?.errors ?? '');
      return { success: false, status: res.status, msg: body?.msg, errors: body?.errors, details: text };
    }
    return { success: true, msg: body.msg, sentTo: ids };
  } catch (e) {
    console.error('WhatsApp API error:', e.message);
    return { success: false, error: e.message, details: e.stack };
  }
}

// NB: the old phone-addressed `verifyOtp(phone, code, purpose)` is deliberately GONE.
// Re-adding it re-opens LS-01 — any caller that can name a phone could mint that
// account's session. Verification must stay addressed by challenge.
module.exports = { createOtp, verifyOtpByChallenge, refreshOtp, toIntlDigits, normalizeIqPhone, normalizePhoneBody, isValidIqMobile, isDemoLoginPhone };
