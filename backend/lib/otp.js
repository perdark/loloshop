const crypto = require('crypto');
const { query } = require('./db');

const TTL = parseInt(process.env.OTP_TTL_SECONDS || '300', 10);

function generateCode() {
  return String(crypto.randomInt(100000, 1000000));
}

async function createOtp(phone, purpose = 'verify') {
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

// Dev-only master OTP so local testing doesn't require reading the code from
// logs. HARD-GATED to non-production: on the VPS (NODE_ENV=production) this is
// never active and real OTP verification always applies. Override the code via
// DEV_MASTER_OTP; set it to empty to disable even in dev.
const DEV_MASTER_OTP =
  process.env.NODE_ENV === 'production'
    ? null
    : process.env.DEV_MASTER_OTP ?? '111111';

async function verifyOtp(phone, code, purpose = 'verify') {
  if (DEV_MASTER_OTP && code === DEV_MASTER_OTP) {
    console.log(`[OTP DEV] master code accepted for ${phone} (${purpose})`);
    return true;
  }
  const { rows } = await query(
    `SELECT id FROM otp_codes
     WHERE phone = $1 AND code = $2 AND purpose = $3 AND used = FALSE AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [phone, code, purpose]
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
