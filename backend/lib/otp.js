const crypto = require('crypto');
const { query, tx } = require('./db');
const { secretMatches } = require('./secretCompare');
const cloud = require('./whatsappCloud');

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

// ── Gateway-outage degraded mode ────────────────────────────────────────────────
// The WhatsApp sender is an unofficial gateway *device* (ZENTRAMSG_DEVICE_UUID below),
// i.e. a real WhatsApp account driven by automation — which Meta bans periodically.
// While it is banned NOTHING is delivered: `sendWhatsApp` returns success:false and every
// OTP flow dead-ends with no way for the user to finish. This flag trades the OTP second
// factor for availability during such an outage, and it is deliberately hard to leave on:
//
//   * It EXPIRES. Unset, unparseable, or past OTP_DEGRADED_UNTIL → OTP is ON. Fail-safe,
//     so forgetting to unset it is not how this becomes permanent — the clock is.
//   * It is CAPPED at MAX_DEGRADED_WINDOW_MS. A fat-fingered year (2027) is not a
//     multi-year bypass; it reads as OFF, because it is further away than the cap.
//   * It only ever covers flows where bcrypt ALREADY passed. Password RESET is never
//     degraded — there the OTP is the sole credential (`forgotPasswordPhone`), so
//     skipping it would hand any account to anyone who knows its phone number. That
//     flow is redirected to human support instead.
//
// ── The one indefinite setting: OTP_DEGRADED_UNTIL=always ───────────────────────
// Owner decision 2026-08-17. The gateway device now drops its WhatsApp session often
// enough ("Device is not connected. Please scan QR code first") that a 48h clock means
// re-setting the flag every other day, and every lapse strands students mid-signup with
// no way to finish. `always` holds the bypass open until a human edits this env var back.
//
// It is a LITERAL WORD on purpose, and the date cap above is untouched. The cap exists to
// catch a *mistake* — a typo'd year that silently becomes a multi-year bypass. Nobody
// types `always` by accident, so the sentinel cannot be reached by fat-fingering a date,
// and every fuzzy truthy value ('yes', 'true', '1', …) still reads as OFF. What is given
// up is the automatic clock: with `always` set, OTP stays off for retail + wholesaler
// logins until someone turns it back on. That is the trade the owner asked for; password
// reset is still never degraded, so it costs the second factor, not the account.
//
// This answers "is the gateway presumed down", NOT "may this user skip" — callers must
// also check the role against OTP_DEGRADED_ROLES in authController.
const MAX_DEGRADED_WINDOW_MS = 48 * 60 * 60 * 1000;
function isOtpDegraded() {
  const raw = (process.env.OTP_DEGRADED_UNTIL || '').trim();
  if (raw.toLowerCase() === 'always') return true;
  const until = Date.parse(raw);
  const remaining = until - Date.now();
  return Number.isFinite(until) && remaining > 0 && remaining <= MAX_DEGRADED_WINDOW_MS;
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
  await sendOtpMessage(phone, code);
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
  await sendOtpMessage(phone, code);
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

// ── Sender devices: one primary, the rest standing by ───────────────────────────
// Zentramsg sends from a real WhatsApp *device* (an account driven by automation), which
// Meta bans periodically. A second device is insurance against that ban.
//
// ⚠️ IT IS DELIBERATELY NOT LOAD-BALANCED, and that is the whole design. Alternating
// between devices would halve each one's volume — and volume is what attracts the ban —
// so round-robin looks strictly better. It is not. Students routinely receive 2–3 codes
// (the first send plus resends), so alternating means code 1 arrives from number A and
// code 2 from number B. Two different unknown senders asking for the same login is
// indistinguishable from a phishing attempt, at the exact moment we need the student to
// trust a number they have never seen. Owner ruling, 2026-08-15.
//
// So: ONE number sends everything until it stops working; then the next takes over and
// KEEPS it. We never drift back to a recovered device on a timer, because drifting back
// shows the student two numbers anyway — just more slowly.
const DEVICE_ENV_KEYS = [
  'ZENTRAMSG_DEVICE_UUID',    // the original — stays the primary, so adding a backup changes nothing
  'ZENTRAMSG_DEVICE_UUID_2',
  'ZENTRAMSG_DEVICE_UUID_3',
  'ZENTRAMSG_DEVICE_UUID_4',
];

// Read per call, not at module load: the OTP suites delete these vars after requiring
// lib/db but before exercising a send, and a module-load snapshot would ignore that.
function configuredDevices() {
  const seen = new Set();
  const out = [];
  for (const key of DEVICE_ENV_KEYS) {
    const uuid = (process.env[key] || '').trim();
    if (uuid && !seen.has(uuid)) { seen.add(uuid); out.push(uuid); }
  }
  return out;
}

// Health is per device uuid and lives for the life of the process. `cooledUntil` is only
// ever set when ANOTHER device succeeded with the same message — see sendViaZentramsg.
const deviceHealth = new Map();
// Env-tunable per the spec rule (see routes/auth.js's envInt): every new limit must be
// changeable with `pm2 restart loloshop-api --update-env` alone, no deploy, so the owner can
// shorten/lengthen the cooldown live during a gateway ban without a developer. Guarded against
// NaN/≤0 so a typo'd env value can't zero out the cooldown — that would let a proven-banned
// device be retried on literally the next send instead of staying parked for the window.
function envIntMs(key, fallback) {
  const n = parseInt(process.env[key] || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
const DEVICE_COOLDOWN_MS = envIntMs('OTP_DEVICE_COOLDOWN_MS', 12 * 60 * 60 * 1000);
let activeDevice = null;

function healthOf(uuid) {
  if (!deviceHealth.has(uuid)) deviceHealth.set(uuid, { cooledUntil: 0, sent: 0, failed: 0 });
  return deviceHealth.get(uuid);
}
function isCooled(uuid) { return healthOf(uuid).cooledUntil > Date.now(); }

// Order to try: the device already doing the sending stays first (stickiness is the point),
// then any device not currently cooled down, then the cooled ones as a last resort — a
// cooled device is still better than not sending at all.
function sendOrder(devices) {
  const head = activeDevice && devices.includes(activeDevice) && !isCooled(activeDevice)
    ? [activeDevice] : [];
  const rest = devices.filter((d) => !head.includes(d));
  return [...head, ...rest.filter((d) => !isCooled(d)), ...rest.filter((d) => isCooled(d))];
}

// Masked for logs/status: a device uuid is a credential, and this string reaches the admin.
function maskDevice(uuid) { return `${String(uuid).slice(0, 6)}…`; }

// One POST to one device. Returns the same shape the single-device version always returned.
async function postToDevice(device, token, ids, code) {
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
      console.error(`WhatsApp API rejected [device ${maskDevice(device)}]:`, res.status, body?.msg ?? text, body?.errors ?? '');
      return { success: false, status: res.status, msg: body?.msg, errors: body?.errors, details: text };
    }
    return { success: true, msg: body.msg, sentTo: ids };
  } catch (e) {
    console.error(`WhatsApp API error [device ${maskDevice(device)}]:`, e.message);
    return { success: false, error: e.message, details: e.stack };
  }
}

async function sendViaZentramsg(phone, code) {
  // Final hard guard (belt & suspenders behind createOtp): never POST to WhatsApp for a
  // non-Iraqi-mobile recipient. Sending to invalid numbers is what gets the sender banned.
  const ids = toIntlDigits(phone);
  if (!isValidIqMobile(phone) || !/^964\d{10}$/.test(ids)) {
    console.error(`[OTP] refusing to send to invalid recipient: ${phone} (${ids})`);
    return { success: false, error: 'رقم هاتف غير صالح للإرسال' };
  }

  const token = process.env.ZENTRAMSG_API_KEY;   // x-api-token — one account, so one token
  const devices = configuredDevices();
  if (!token || !devices.length) {
    // Never print live codes to logs in production. If the WhatsApp creds are
    // missing in prod, OTP can't be delivered — surface it loudly rather than
    // leaking codes to the logs.
    if (process.env.NODE_ENV === 'production') {
      console.error('ZENTRAMSG_API_KEY / ZENTRAMSG_DEVICE_UUID missing — OTP cannot be sent in production.');
    }
    return { success: false, error: 'إعدادات API الواتساب غير موجودة. يرجى التحقق من متغيرات البيئة.' };
  }

  const order = sendOrder(devices);
  let firstFailure = null;
  const failedThisSend = [];

  for (const device of order) {
    const result = await postToDevice(device, token, ids, code);
    if (result.success) {
      healthOf(device).sent += 1;
      // A success PROVES the earlier failures in this loop were the device's fault and not
      // the recipient's number — that is the only evidence we ever act on, because we
      // cannot tell a banned device from a bad number by reading Zentramsg's error alone.
      for (const bad of failedThisSend) {
        const h = healthOf(bad);
        h.failed += 1;
        h.cooledUntil = Date.now() + DEVICE_COOLDOWN_MS;
        console.error(`[OTP] device ${maskDevice(bad)} failed but ${maskDevice(device)} succeeded — cooling it down for 12h`);
      }
      // Promote the winner and STAY on it. No timer moves us back; only its own failure will.
      if (activeDevice !== device) {
        console.error(`[OTP] sender is now device ${maskDevice(device)}`);
        activeDevice = device;
      }
      return result;
    }
    failedThisSend.push(device);
    if (!firstFailure) firstFailure = result;
  }

  // Every device refused. Cool down NOTHING: with no successful send to compare against,
  // the likeliest explanation is this recipient, not all of our senders at once. Marking
  // them all unhealthy here would take the whole gateway down over one bad number.
  console.error(`[OTP] all ${order.length} sender device(s) failed for this message`);
  return firstFailure;
}

// ── The dispatcher: official Cloud API first, Zentramsg as the fallback ─────────────────────
// Every application send goes through here. The ordering is the whole migration: while
// WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_OTP_TEMPLATE are set, Meta's first-party
// API carries the traffic and the device fleet below is dead weight we keep only as insurance.
// With those vars unset this function is a pass-through to the old behaviour, so deploying it
// changes nothing until the credentials exist — that is deliberate, so the code can ship and sit
// dormant while Meta business verification is still pending.
//
// ⚠️ Do NOT "improve" this by trying Zentramsg when the Cloud API says the RECIPIENT is
// unreachable (131026 — the number has no WhatsApp). Both senders deliver over the same WhatsApp
// network, so the fallback cannot succeed where the official API just failed for that reason; all
// it would do is spend a Zentramsg send, and sending to numbers that cannot receive WhatsApp is
// precisely the behaviour that gets a Zentramsg device banned. Bailing out here is what protects
// the fallback for the failures it CAN actually help with.
async function sendOtpMessage(phone, code) {
  // Same hard guard the Zentramsg sender applies, repeated here because the cloud path does not
  // pass through it. Never POST an OTP for a number that is not a real Iraqi mobile.
  if (!isValidIqMobile(phone)) {
    console.error(`[OTP] refusing to send to invalid recipient: ${phone}`);
    return { success: false, error: 'رقم هاتف غير صالح للإرسال' };
  }

  if (cloud.isConfigured()) {
    const result = await cloud.send(toIntlDigits(phone), code);
    if (result.success) return result;
    if (result.recipientPermanent) {
      // Terminal for this recipient on BOTH senders — see the warning above.
      console.error(`[OTP] recipient cannot receive WhatsApp (code ${result.code}) — not falling back`);
      return result;
    }
    console.error('[OTP] Cloud API send failed — falling back to the Zentramsg device fleet');
  }

  return sendViaZentramsg(phone, code);
}

// Read-only view for operators: which number is sending, and has one been cooled down.
// Device ids are masked — this is surfaced to an admin, not kept to ourselves.
function gatewayStatus() {
  const devices = configuredDevices();
  return {
    // `primary` tells an admin which sender is actually carrying traffic. Once it reads 'cloud',
    // a cooled-down device below is informational, not an incident.
    primary: cloud.isConfigured() ? 'cloud' : 'zentramsg',
    cloud: cloud.status(),
    configured: devices.length,
    active: activeDevice ? maskDevice(activeDevice) : (devices[0] ? maskDevice(devices[0]) : null),
    devices: devices.map((uuid) => {
      const h = healthOf(uuid);
      return {
        device: maskDevice(uuid),
        healthy: !isCooled(uuid),
        cooled_until: h.cooledUntil > Date.now() ? new Date(h.cooledUntil).toISOString() : null,
        sent: h.sent,
        failed: h.failed,
      };
    }),
  };
}

// Test seam only — lets a suite start from a known state instead of inheriting the
// previous test's failover. Never called by application code.
function __resetGatewayState() {
  deviceHealth.clear();
  activeDevice = null;
}

// NB: the old phone-addressed `verifyOtp(phone, code, purpose)` is deliberately GONE.
// Re-adding it re-opens LS-01 — any caller that can name a phone could mint that
// account's session. Verification must stay addressed by challenge.
// ⚠️ `__sendViaZentramsg` and `__sendOtpMessage` are TEST SEAMS, not entry points. Application
// code must always go through createOtp/refreshOtp: the per-phone hourly cap and the user/phone
// binding live THERE, not in the sender. Calling either directly sends a WhatsApp message with no
// budget check at all, which is the behaviour that gets the sender device banned.
// `__sendViaZentramsg` stays pinned to the Zentramsg-only sender so the failover suite keeps
// testing the device fleet in isolation; `__sendOtpMessage` is the real dispatcher (cloud first).
module.exports = { createOtp, verifyOtpByChallenge, refreshOtp, toIntlDigits, normalizeIqPhone, normalizePhoneBody, isValidIqMobile, isDemoLoginPhone, isOtpDegraded, gatewayStatus, __resetGatewayState, __sendViaZentramsg: sendViaZentramsg, __sendOtpMessage: sendOtpMessage };
