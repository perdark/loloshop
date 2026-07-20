const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { query } = require('../lib/db');
const { signToken } = require('../middleware/auth');
const { createOtp, verifyOtpByChallenge, refreshOtp, isValidIqMobile, isDemoLoginPhone } = require('../lib/otp');
const { issueDeviceToken, isTrustedDevice, revokeUserDevices } = require('../lib/trustedDevice');
const { secretMatches } = require('../lib/secretCompare');
const { assertPasswordOk, tierForRole } = require('../lib/password');

const SALT_ROUNDS = 10;

// Roles allowed to reset a password with a WhatsApp OTP alone. This is an ALLOW-list on
// purpose: that flow hands an account to whoever can read one message, so a role must opt
// IN. The previous deny-list (`NOT IN ('admin','staff')`) silently exposed 'worker' and
// 'design_helper' the moment those roles were added (migrations 060/062) — a workshop lead
// can record production on others' behalf and move the wage ledger. Everyone not listed
// here is reset by an admin from the staff/workshop/design screens, or — for the admin
// account itself — on the server with `npm run set-password`.
const PHONE_RESET_ROLES = ['retail', 'wholesaler'];

// Free-text registration fields are stored and shown to staff/admin later; cap
// length so a 5MB JSON body can't stuff multi-MB junk into a column.
const MAX_FIELD_LEN = 120;
function tooLong(...values) {
  return values.some((v) => v != null && String(v).length > MAX_FIELD_LEN);
}

// Reply with the FIELD that failed, not just "something's wrong". The old handler collapsed
// every problem into «بيانات ناقصة» / «قيمة طويلة جداً في أحد الحقول», so a student had to
// guess which box to fix. `field` lets the form put the message under the right input.
function badField(res, field, error, code = 'ERR_VALIDATION') {
  return res.status(400).json({ error, code, field });
}

async function register(req, res) {
  const { name, phone, password, role = 'retail', university_name, department, gender, study_type, instagram_username } = req.body;
  if (!name || !String(name).trim()) return badField(res, 'name', 'الاسم مطلوب');
  if (!phone || !String(phone).trim()) return badField(res, 'phone', 'رقم الهاتف مطلوب');
  if (!password) return badField(res, 'password', 'كلمة المرور مطلوبة');
  if (tooLong(name)) return badField(res, 'name', `الاسم طويل جداً (${MAX_FIELD_LEN} حرف كحد أقصى)`);
  if (String(phone).length > 32) return badField(res, 'phone', 'رقم الهاتف طويل جداً');
  if (tooLong(university_name)) return badField(res, 'university_name', `اسم الجامعة طويل جداً (${MAX_FIELD_LEN} حرف كحد أقصى)`);
  if (tooLong(department)) return badField(res, 'department', `القسم/التخصص طويل جداً (${MAX_FIELD_LEN} حرف كحد أقصى)`);
  if (tooLong(instagram_username)) return badField(res, 'instagram_username', `حساب إنستقرام طويل جداً (${MAX_FIELD_LEN} حرف كحد أقصى)`);
  if (!isValidIqMobile(phone)) {
    return badField(res, 'phone', 'رقم هاتف غير صحيح — يجب أن يبدأ بـ 07 ويتكوّن من 11 رقماً', 'ERR_INVALID_PHONE');
  }
  // Server-side policy — the signup form's check doesn't apply to a direct API call. (LS-10)
  try {
    assertPasswordOk(password, 'customer');
  } catch (e) {
    return badField(res, 'password', e.message, e.code || 'ERR_WEAK_PASSWORD');
  }
  if (!['retail'].includes(role)) {
    return res.status(403).json({ error: 'دور غير مسموح', code: 'ERR_FORBIDDEN' });
  }
  if (gender && !['male', 'female'].includes(gender)) {
    return badField(res, 'gender', 'الجنس غير صالح');
  }
  if (!university_name || !String(university_name).trim()) {
    return badField(res, 'university_name', 'اسم الجامعة مطلوب');
  }
  if (!department || !String(department).trim()) {
    return badField(res, 'department', 'القسم/التخصص مطلوب');
  }
  if (!study_type || !['morning', 'evening'].includes(study_type)) {
    return badField(res, 'study_type', 'الدراسة (صباحي/مسائي) مطلوبة');
  }
  if (!instagram_username || !String(instagram_username).trim()) {
    return badField(res, 'instagram_username', 'حساب إنستقرام مطلوب');
  }
  const cleanInstagram = String(instagram_username).trim().replace(/^@/, '');
  const existing = await query(`SELECT phone FROM users WHERE phone = $1`, [phone]);
  if (existing.rows.length) {
    return res.status(409).json({
      error: 'رقم الهاتف مستخدم مسبقاً — سجّل الدخول أو استعد كلمة المرور',
      code: 'ERR_PHONE_TAKEN',
      field: 'phone',
    });
  }
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const u = await query(
    `INSERT INTO users (name, phone, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id`,
    [name, phone, hash, role]
  );
  // pure retail (no referral): create student row pre-approved
  await query(
    `INSERT INTO students (user_id, full_name_third, university_name, department, gender, study_type, instagram_username, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'approved')`,
    [u.rows[0].id, name, String(university_name).trim(), String(department).trim(), gender || null, study_type, cleanInstagram]
  );
  // The challenge is bound to the account we just created, so the verify step can only
  // ever finish THIS registration (it cannot be pointed at an existing/privileged user).
  const { challenge_id } = await createOtp(phone, 'verify', { userId: u.rows[0].id });
  res.status(201).json({ data: { user_id: u.rows[0].id, otp_required: true, challenge_id } });
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
            u.token_version,
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
  // The password is now verified, so this challenge is the second factor — it exists only
  // because bcrypt passed above. Without it /auth/login-verify cannot mint anything, which
  // is what stops OTP-possession alone from being a login (LS-01).
  const { challenge_id } = await createOtp(phone, 'login', { userId: user.id });
  res.json({ otp_required: true, phone, challenge_id });
}

async function loginVerifyOtp(req, res) {
  const { challenge_id, code } = req.body;
  if (!challenge_id || !code) {
    return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  }
  // Identity comes from the challenge (issued only after a correct password), never from
  // the request body — the caller cannot name the account it wants a token for.
  const result = await verifyOtpByChallenge(challenge_id, code, 'login');
  if (!result.ok || !result.user_id) {
    return res.status(400).json({ error: 'الرمز خاطئ أو منتهي', code: 'ERR_INVALID_OTP' });
  }
  // Completing login OTP proves phone ownership — mark verified and return token.
  const { rows } = await query(
    `UPDATE users SET phone_verified = TRUE WHERE id = $1
     RETURNING id, name, phone, email, role, phone_verified, token_version`,
    [result.user_id]
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
  // Fail closed: no key configured → portal is off.
  return secretMatches(provided, process.env.STAFF_PORTAL_KEY);
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
    `SELECT id, name, role, password_hash, token_version
     FROM users WHERE id = $1 AND role = 'staff'`,
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
  const { challenge_id, code } = req.body;
  if (!challenge_id || !code) {
    return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  }
  const result = await verifyOtpByChallenge(challenge_id, code, 'verify');
  if (!result.ok || !result.user_id) {
    return res.status(400).json({ error: 'الرمز خاطئ أو منتهي', code: 'ERR_INVALID_OTP' });
  }
  // Hard role gate: this is the REGISTRATION verify handler and registration only ever
  // creates retail accounts, so it must never be able to hand back a privileged session.
  // Belt-and-braces alongside the challenge binding above (LS-01 remediation step 5).
  const { rows } = await query(
    `UPDATE users SET phone_verified = TRUE WHERE id = $1 AND role = 'retail'
     RETURNING id, name, phone, email, role, phone_verified, token_version`,
    [result.user_id]
  );
  if (!rows.length) return res.status(403).json({ error: 'غير مصرح', code: 'ERR_FORBIDDEN' });
  const token = signToken(rows[0]);
  // Verifying at signup trusts this device for 90 days → first real login skips the OTP.
  const device_token = await issueDeviceToken(rows[0].id, req.get('user-agent'));
  res.json({ verified: true, token, device_token });
}

// Resend the code for an EXISTING challenge. The caller no longer supplies a phone or a
// purpose — both live on the challenge it was already issued — so this endpoint can no
// longer be used to start a login/verify flow against an arbitrary number (LS-01). The
// challenge id is unchanged by a resend; the client can keep the one it holds.
async function resendOtp(req, res) {
  const { challenge_id } = req.body;
  if (!challenge_id) return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  const result = await refreshOtp(challenge_id);
  if (!result) {
    return res.status(400).json({ error: 'انتهت الجلسة، يرجى المحاولة من جديد', code: 'ERR_VALIDATION' });
  }
  res.json({ sent: true, expires_in: result.expires_in, challenge_id: result.challenge_id });
}


// Phone-based reset (WhatsApp OTP) — students log in by phone and may not recall
// their email. Mirrors forgotPassword but uses an OTP with purpose 'reset'.
// Privileged accounts cannot reset via phone OTP. An administrator must reset
// them through the authenticated admin flow or the server-side set-password tool.
// We still return { sent: true } to avoid enumeration leaks.
async function forgotPasswordPhone(req, res) {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  if (!isValidIqMobile(phone)) {
    return res.status(400).json({ error: 'رقم هاتف غير صحيح', code: 'ERR_INVALID_PHONE' });
  }
  const { rows } = await query(`SELECT id, role FROM users WHERE phone = $1`, [phone]);
  let challenge_id = null;
  if (rows.length && PHONE_RESET_ROLES.includes(rows[0].role)) {
    ({ challenge_id } = await createOtp(phone, 'reset', { userId: rows[0].id }));
  }
  // Always 200 with a challenge id — a decoy when there's no eligible account — so THIS
  // response alone doesn't say whether the number is registered.
  // NOT a general enumeration defence, and don't build on it as one: a follow-up
  // /auth/resend-otp distinguishes a decoy (400) from a real challenge (200), the send
  // path is measurably slower for a real account, and /auth/register already answers the
  // question outright with 409 ERR_PHONE_TAKEN. Closing enumeration properly means
  // starting at register.
  res.json({ sent: true, challenge_id: challenge_id || crypto.randomUUID() });
}

async function resetPasswordPhone(req, res) {
  const { challenge_id, code, password } = req.body;
  if (!challenge_id || !code || !password) {
    return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  }
  // Screen the password BEFORE consuming the code, so a too-short one doesn't burn the
  // user's OTP and force another WhatsApp round trip. The role-specific tier is applied
  // below once the challenge tells us who this actually is.
  assertPasswordOk(password, 'customer');
  const result = await verifyOtpByChallenge(challenge_id, code, 'reset');
  if (!result.ok || !result.user_id) {
    return res.status(400).json({ error: 'الرمز خاطئ أو منتهي', code: 'ERR_INVALID_OTP' });
  }
  const { rows: who } = await query(`SELECT role FROM users WHERE id = $1`, [result.user_id]);
  if (!who.length) return res.status(403).json({ error: 'غير مصرح', code: 'ERR_FORBIDDEN' });
  assertPasswordOk(password, tierForRole(who[0].role));
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  // Defence-in-depth: even if the OTP somehow reached a privileged account, refuse the reset here.
  const { rows } = await query(
    `UPDATE users
     SET password_hash = $1, token_version = token_version + 1
     WHERE id = $2 AND role = ANY($3)
     RETURNING id`,
    [hash, result.user_id, PHONE_RESET_ROLES]
  );
  if (!rows.length) return res.status(403).json({ error: 'غير مصرح', code: 'ERR_FORBIDDEN' });
  // A password change must invalidate every trusted device (a stolen device token can't
  // outlive the reset). The user re-OTPs once on next login to re-trust the device.
  await revokeUserDevices(rows[0].id);
  res.json({ reset: true });
}


// Email-based recovery is GONE (owner decision 2026-07-19): SMTP was never configured in
// production so the flow was already dead, and it carried a reset-token endpoint plus the
// nodemailer dependency (2 of the audit's high-severity advisories) for nothing. Phone-OTP
// reset covers retail + wholesaler; privileged accounts are reset by an admin, or on the
// server with `npm run set-password`.
module.exports = { register, login, loginVerifyOtp, me, postVerifyOtp, resendOtp, forgotPasswordPhone, resetPasswordPhone, staffPortalMembers, staffPortalLogin };
