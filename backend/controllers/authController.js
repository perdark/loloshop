const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { query } = require('../lib/db');
const { signToken } = require('../middleware/auth');
const { createOtp, verifyOtp, isValidIqMobile, isDemoLoginPhone } = require('../lib/otp');
const { issueDeviceToken, isTrustedDevice, revokeUserDevices } = require('../lib/trustedDevice');
const { sendPasswordReset } = require('../lib/email');

const SALT_ROUNDS = 10;

// Free-text registration fields are stored and shown to staff/admin later; cap
// length so a 5MB JSON body can't stuff multi-MB junk into a column.
const MAX_FIELD_LEN = 120;
function tooLong(...values) {
  return values.some((v) => v != null && String(v).length > MAX_FIELD_LEN);
}

async function register(req, res) {
  const { name, phone, email, password, role = 'retail', university_name, department, gender, study_type, instagram_username } = req.body;
  if (!name || !phone || !password) {
    return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  }
  if (tooLong(name, email, university_name, department, instagram_username) || String(phone).length > 32) {
    return res.status(400).json({ error: 'قيمة طويلة جداً في أحد الحقول', code: 'ERR_VALIDATION' });
  }
  if (!isValidIqMobile(phone)) {
    return res.status(400).json({ error: 'رقم هاتف غير صحيح', code: 'ERR_INVALID_PHONE' });
  }
  if (!['retail'].includes(role)) {
    return res.status(403).json({ error: 'دور غير مسموح', code: 'ERR_FORBIDDEN' });
  }
  if (gender && !['male', 'female'].includes(gender)) {
    return res.status(400).json({ error: 'الجنس غير صالح', code: 'ERR_VALIDATION' });
  }
  if (!university_name || !String(university_name).trim()) {
    return res.status(400).json({ error: 'اسم الجامعة مطلوب', code: 'ERR_VALIDATION' });
  }
  if (!department || !String(department).trim()) {
    return res.status(400).json({ error: 'القسم/التخصص مطلوب', code: 'ERR_VALIDATION' });
  }
  if (!study_type || !['morning', 'evening'].includes(study_type)) {
    return res.status(400).json({ error: 'الدراسة (صباحي/مسائي) مطلوبة', code: 'ERR_VALIDATION' });
  }
  if (!instagram_username || !String(instagram_username).trim()) {
    return res.status(400).json({ error: 'حساب إنستقرام مطلوب', code: 'ERR_VALIDATION' });
  }
  const cleanInstagram = String(instagram_username).trim().replace(/^@/, '');
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
    `INSERT INTO students (user_id, full_name_third, university_name, department, gender, study_type, instagram_username, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'approved')`,
    [u.rows[0].id, name, String(university_name).trim(), String(department).trim(), gender || null, study_type, cleanInstagram]
  );
  await createOtp(phone, 'verify');
  res.status(201).json({ data: { user_id: u.rows[0].id, otp_required: true } });
}

async function login(req, res) {
  const { phone, password, device_token } = req.body;
  if (!phone || !password) {
    return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  }
  if (!isValidIqMobile(phone)) {
    return res.status(400).json({ error: 'رقم هاتف غير صحيح', code: 'ERR_INVALID_PHONE' });
  }
  const { rows } = await query(
    `SELECT u.id, u.name, u.phone, u.email, u.role, u.password_hash, u.phone_verified,
            EXISTS (
              SELECT 1 FROM students s
              WHERE s.user_id = u.id AND s.wholesaler_id IS NOT NULL
            ) AS is_wholesaler_student
     FROM users u WHERE u.phone = $1`,
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
  // Wholesaler-linked students log in with password ONLY — no WhatsApp OTP. A rep
  // onboards 100+ students who all sign in around the same time; blasting that many
  // OTPs is exactly what spam-bans the gateway sender number. They already joined via
  // the rep's referral link and were approved by the rep, so the phone-ownership check
  // an OTP provides is redundant here. (Self-registered retail still OTPs — see register.)
  // Checked before the trusted-device branch so it covers first-ever logins too.
  if (user.role === 'retail' && user.is_wholesaler_student) {
    const token = signToken(user);
    return res.json({
      token,
      user: { id: user.id, name: user.name, role: user.role, phone_verified: user.phone_verified },
    });
  }
  // App-store reviewer demo account → skip the WhatsApp OTP. A Google Play / App Store
  // reviewer can't receive an OTP on an Iraqi number they don't own, which would block
  // review and fail the submission. ONLY the specific phone(s) in DEMO_LOGIN_PHONES bypass,
  // and only for role==='retail' — the password is still verified above, so this is an OTP
  // skip for one known number, not a passwordless backdoor. Unset env → no bypass.
  if (user.role === 'retail' && isDemoLoginPhone(user.phone)) {
    const token = signToken(user);
    return res.json({
      token,
      user: { id: user.id, name: user.name, role: user.role, phone_verified: user.phone_verified },
    });
  }
  // Trusted device → skip the WhatsApp OTP entirely (the password is already verified).
  // This is the change that cuts OTP volume to ~zero for returning users and protects the
  // gateway sender number from spam bans.
  if (device_token && (await isTrustedDevice(user.id, device_token))) {
    const token = signToken(user);
    return res.json({
      token,
      user: { id: user.id, name: user.name, role: user.role, phone_verified: user.phone_verified },
    });
  }
  await createOtp(phone, 'login');
  res.json({ otp_required: true, phone });
}

async function loginVerifyOtp(req, res) {
  const { phone, code } = req.body;
  if (!phone || !code) {
    return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  }
  const ok = await verifyOtp(phone, code, 'login');
  if (!ok) return res.status(400).json({ error: 'الرمز خاطئ أو منتهي', code: 'ERR_INVALID_OTP' });
  // Completing login OTP proves phone ownership — mark verified and return token.
  const { rows } = await query(
    `UPDATE users SET phone_verified = TRUE WHERE phone = $1
     RETURNING id, name, phone, email, role, phone_verified`,
    [phone]
  );
  if (!rows.length) return res.status(404).json({ error: 'المستخدم غير موجود', code: 'ERR_NOT_FOUND' });
  const token = signToken(rows[0]);
  // Completing the login OTP trusts this device for 90 days → future logins skip the OTP.
  const device_token = await issueDeviceToken(rows[0].id, req.get('user-agent'));
  res.json({
    token,
    device_token,
    user: { id: rows[0].id, name: rows[0].name, role: rows[0].role, phone_verified: rows[0].phone_verified },
  });
}

// ── Private staff portal (name + password, no OTP) ──────────────────────────
// For staff who have no phone and so can't receive a WhatsApp OTP. The portal is
// guarded by a secret key (STAFF_PORTAL_KEY) that lives in the URL the admin shares;
// a wrong/missing key returns 404 so students/retail never learn the portal exists.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function portalKeyOk(provided) {
  const key = process.env.STAFF_PORTAL_KEY;
  // Fail closed: no key configured → portal is off.
  return !!key && typeof provided === 'string' && provided === key;
}

// GET /auth/staff-portal/members?key=… → [{ id, name }] for staff only. Key-gated.
async function staffPortalMembers(req, res) {
  if (!portalKeyOk(req.query.key)) {
    return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  }
  const { rows } = await query(
    `SELECT id, name FROM users WHERE role = 'staff' ORDER BY name ASC`
  );
  res.json({ data: rows });
}

// POST /auth/staff-portal-login { key, staff_id, password } → JWT, no OTP. Staff only.
async function staffPortalLogin(req, res) {
  const { key, staff_id, password } = req.body;
  if (!portalKeyOk(key)) {
    return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  }
  if (!staff_id || !password) {
    return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  }
  // Guard the UUID cast so a malformed id is a clean 401, not a 500.
  if (!UUID_RE.test(String(staff_id))) {
    return res.status(401).json({ error: 'بيانات خاطئة', code: 'ERR_INVALID_CREDENTIALS' });
  }
  const { rows } = await query(
    `SELECT id, name, role, password_hash FROM users WHERE id = $1 AND role = 'staff'`,
    [staff_id]
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
  res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
}

async function me(req, res) {
  // Retail accounts carry their student profile (signup captures instagram_username,
  // university, …) so forms — e.g. the full-set wizard — can prefill from the login.
  if (req.user.role === 'retail') {
    const { rows } = await query(
      `SELECT university_name, department, gender, study_type, instagram_username, wholesaler_id
       FROM students WHERE user_id = $1`,
      [req.user.id]
    );
    if (rows.length) return res.json({ ...req.user, student: rows[0] });
  }
  res.json(req.user);
}

async function postVerifyOtp(req, res) {
  const { phone, code } = req.body;
  if (!phone || !code) {
    return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  }
  const ok = await verifyOtp(phone, code, 'verify');
  if (!ok) return res.status(400).json({ error: 'الرمز خاطئ أو منتهي', code: 'ERR_INVALID_OTP' });
  const { rows } = await query(
    `UPDATE users SET phone_verified = TRUE WHERE phone = $1 RETURNING id, name, phone, email, role, phone_verified`,
    [phone]
  );
  if (!rows.length) return res.status(404).json({ error: 'المستخدم غير موجود', code: 'ERR_NOT_FOUND' });
  const token = signToken(rows[0]);
  // Verifying at signup trusts this device for 90 days → first real login skips the OTP.
  const device_token = await issueDeviceToken(rows[0].id, req.get('user-agent'));
  res.json({ verified: true, token, device_token });
}

async function resendOtp(req, res) {
  const { phone, purpose = 'verify' } = req.body;
  if (!phone) return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  if (!['verify', 'login', 'reset'].includes(purpose)) {
    return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  }
  if (!isValidIqMobile(phone)) {
    return res.status(400).json({ error: 'رقم هاتف غير صحيح', code: 'ERR_INVALID_PHONE' });
  }
  const { expires_in } = await createOtp(phone, purpose);
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

// Phone-based reset (WhatsApp OTP) — students log in by phone and may not recall
// their email. Mirrors forgotPassword but uses an OTP with purpose 'reset'.
// Privileged accounts (admin/staff) cannot reset via phone OTP — they must use
// the email token path. We still return { sent: true } to avoid enumeration leaks.
async function forgotPasswordPhone(req, res) {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  if (!isValidIqMobile(phone)) {
    return res.status(400).json({ error: 'رقم هاتف غير صحيح', code: 'ERR_INVALID_PHONE' });
  }
  const { rows } = await query(`SELECT id, role FROM users WHERE phone = $1`, [phone]);
  // Don't leak whether the phone is registered — always 200.
  if (rows.length && !['admin', 'staff'].includes(rows[0].role)) {
    await createOtp(phone, 'reset');
  }
  res.json({ sent: true });
}

async function resetPasswordPhone(req, res) {
  const { phone, code, password } = req.body;
  if (!phone || !code || !password) {
    return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  }
  const ok = await verifyOtp(phone, code, 'reset');
  if (!ok) return res.status(400).json({ error: 'الرمز خاطئ أو منتهي', code: 'ERR_INVALID_OTP' });
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  // Defence-in-depth: even if the OTP somehow reached a privileged account, refuse the reset here.
  const { rows } = await query(
    `UPDATE users SET password_hash = $1 WHERE phone = $2 AND role NOT IN ('admin','staff') RETURNING id`,
    [hash, phone]
  );
  if (!rows.length) return res.status(403).json({ error: 'غير مصرح', code: 'ERR_FORBIDDEN' });
  // A password change must invalidate every trusted device (a stolen device token can't
  // outlive the reset). The user re-OTPs once on next login to re-trust the device.
  await revokeUserDevices(rows[0].id);
  res.json({ reset: true });
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
  // Invalidate trusted devices on password change (parallel to the phone-reset path).
  await revokeUserDevices(rows[0].user_id);
  res.json({ reset: true });
}

module.exports = { register, login, loginVerifyOtp, me, postVerifyOtp, resendOtp, forgotPassword, resetPassword, forgotPasswordPhone, resetPasswordPhone, staffPortalMembers, staffPortalLogin };
