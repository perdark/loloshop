const crypto = require('crypto');
const { query } = require('./db');

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
const DEV_MASTER_OTP =
  process.env.NODE_ENV === 'production'
    ? null
    : process.env.DEV_MASTER_OTP ?? '111111';

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

async function sendViaZentramsg(phone, code) {
  const key = process.env.ZENTRAMSG_API_KEY;
  if (!key) {
    // Never print live codes to logs in production. If the SMS key is missing in
    // prod, OTP can't be delivered — surface it loudly rather than leaking codes.
    if (process.env.NODE_ENV === 'production') {
      console.error('ZENTRAMSG_API_KEY missing — OTP cannot be sent in production.');
    } else {
      console.log(`[OTP DEV] ${phone} -> ${code}`);
    }
    return;
  }
  try {
    const res = await fetch('https://api.zentramsg.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        to: phone,
        sender: process.env.ZENTRAMSG_SENDER,
        message: `رمز التحقق LoloShop: ${code}`,
      }),
    });
    if (!res.ok) console.error('Zentramsg send failed:', await res.text());
  } catch (e) {
    console.error('Zentramsg error:', e.message);
  }
}

module.exports = { createOtp, verifyOtp };
