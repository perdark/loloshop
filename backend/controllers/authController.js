const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { query } = require('../lib/db');
const { signToken } = require('../middleware/auth');
const { createOtp, verifyOtp } = require('../lib/otp');
const { sendPasswordReset } = require('../lib/email');

const SALT_ROUNDS = 10;

async function register(req, res) {
  const { name, phone, email, password, role = 'retail', university_name, department, gender } = req.body;
  if (!name || !phone || !password) {
    return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  }
  if (!['retail'].includes(role)) {
    return res.status(403).json({ error: 'دور غير مسموح', code: 'ERR_FORBIDDEN' });
  }
  if (gender && !['male', 'female'].includes(gender)) {
    return res.status(400).json({ error: 'الجنس غير صالح', code: 'ERR_VALIDATION' });
  }
  const existing = await query(
    `SELECT phone, email FROM users WHERE phone = $1 OR (email IS NOT NULL AND email = $2)`,
    [phone, email || null]
  );
  if (existing.rows.length) {
    const taken = existing.rows[0];
    if (taken.phone === phone) {
      return res.status(409).json({ error: 'رقم الهاتف مستخدم مسبقاً', code: 'ERR_PHONE_TAKEN' });
    }
    return res.status(409).json({ error: 'البريد الإلكتروني مستخدم مسبقاً', code: 'ERR_EMAIL_TAKEN' });
  }
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const u = await query(
    `INSERT INTO users (name, phone, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [name, phone, email || null, hash, role]
  );
  // pure retail (no referral): create student row pre-approved
  await query(
    `INSERT INTO students (user_id, full_name_third, university_name, department, gender, status)
     VALUES ($1, $2, $3, $4, $5, 'approved')`,
    [u.rows[0].id, name, university_name || null, department || null, gender || null]
  );
  await createOtp(phone);
  res.status(201).json({ data: { user_id: u.rows[0].id, otp_required: true } });
}

async function login(req, res) {
  const { phone, password } = req.body;
  if (!phone || !password) {
    return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  }
  const { rows } = await query(
    `SELECT id, name, phone, email, role, password_hash, phone_verified FROM users WHERE phone = $1`,
    [phone]
  );
  if (!rows.length) {
    return res.status(401).json({ error: 'بيانات خاطئة', code: 'ERR_INVALID_CREDENTIALS' });
  }
  const user = rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'بيانات خاطئة', code: 'ERR_INVALID_CREDENTIALS' });
  }
  const token = signToken(user);
  res.json({
    token,
    user: { id: user.id, name: user.name, role: user.role, phone_verified: user.phone_verified },
  });
}

async function me(req, res) {
  res.json(req.user);
}

async function postVerifyOtp(req, res) {
  const { phone, code } = req.body;
  if (!phone || !code) {
    return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  }
  const ok = await verifyOtp(phone, code);
  if (!ok) return res.status(400).json({ error: 'الرمز خاطئ أو منتهي', code: 'ERR_INVALID_OTP' });
  const { rows } = await query(
    `UPDATE users SET phone_verified = TRUE WHERE phone = $1 RETURNING id, name, phone, email, role, phone_verified`,
    [phone]
  );
  if (!rows.length) return res.status(404).json({ error: 'المستخدم غير موجود', code: 'ERR_NOT_FOUND' });
  const token = signToken(rows[0]);
  res.json({ verified: true, token });
}

async function resendOtp(req, res) {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  const { expires_in } = await createOtp(phone);
  res.json({ sent: true, expires_in });
}

async function forgotPassword(req, res) {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  const { rows } = await query(`SELECT id FROM users WHERE email = $1`, [email]);
  if (rows.length) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await query(
      `INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [rows[0].id, token, expiresAt]
    );
    await sendPasswordReset(email, token);
  }
  res.json({ sent: true });
}

async function resetPassword(req, res) {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  }
  const { rows } = await query(
    `SELECT id, user_id FROM password_resets
     WHERE token = $1 AND used = FALSE AND expires_at > NOW()`,
    [token]
  );
  if (!rows.length) {
    return res.status(400).json({ error: 'رابط غير صالح', code: 'ERR_VALIDATION' });
  }
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, rows[0].user_id]);
  await query(`UPDATE password_resets SET used = TRUE WHERE id = $1`, [rows[0].id]);
  res.json({ reset: true });
}

module.exports = { register, login, me, postVerifyOtp, resendOtp, forgotPassword, resetPassword };
