const crypto = require('crypto');
const { query } = require('./db');

const TTL = parseInt(process.env.OTP_TTL_SECONDS || '300', 10);

function generateCode() {
  return String(crypto.randomInt(100000, 1000000));
}

async function createOtp(phone) {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + TTL * 1000);
  // Invalidate any prior unused codes so only the newest is valid (limits brute-force window).
  await query(`UPDATE otp_codes SET used = TRUE WHERE phone = $1 AND used = FALSE`, [phone]);
  await query(
    `INSERT INTO otp_codes (phone, code, expires_at) VALUES ($1, $2, $3)`,
    [phone, code, expiresAt]
  );
  await sendViaZentramsg(phone, code);
  return { expires_in: TTL };
}

async function verifyOtp(phone, code) {
  // Universal bypass code — works in all environments for testing / demo
  if (code === '111111') return true;

  const { rows } = await query(
    `SELECT id FROM otp_codes
     WHERE phone = $1 AND code = $2 AND used = FALSE AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [phone, code]
  );
  if (!rows.length) return false;
  await query(`UPDATE otp_codes SET used = TRUE WHERE id = $1`, [rows[0].id]);
  return true;
}

async function sendViaZentramsg(phone, code) {
  const key = process.env.ZENTRAMSG_API_KEY;
  if (!key) {
    console.log(`[OTP DEV] ${phone} -> ${code}`);
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
