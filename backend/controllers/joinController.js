const bcrypt = require('bcrypt');
const { query, tx } = require('../lib/db');
const { isValidIqMobile } = require('../lib/otp');
const memoCache = require('../lib/memoCache');

async function getReferral(req, res) {
  const { code } = req.params;
  // Hot path during a referral wave (a whole cohort opens the same link within
  // minutes) — cache HITS only for 60s; a miss keeps hitting the DB so a freshly
  // created rep link works immediately.
  const data = await memoCache.wrap(`join:${code}`, 60_000, async () => {
    const { rows } = await query(
      `SELECT u.name AS wholesaler_name, w.deadline, w.university_name, w.department
       FROM wholesalers w JOIN users u ON u.id = w.user_id
       WHERE w.referral_code = $1`,
      [code]
    );
    return rows.length ? rows[0] : undefined; // undefined → not cached
  });
  if (!data) {
    return res.status(404).json({ error: 'الرابط غير صالح', code: 'ERR_REFERRAL_INVALID' });
  }
  res.json({
    wholesaler_name: data.wholesaler_name,
    deadline: data.deadline,
    university_name: data.university_name,
    department: data.department,
    valid: true,
  });
}

async function joinReferral(req, res) {
  const { code } = req.params;
  const {
    name,
    full_name_third,
    phone,
    email,
    password,
    university_name,
    department,
    gender,
    study_type,
    instagram_username,
  } = req.body;
  const studentName = name || full_name_third;
  if (!studentName || !phone || !password) {
    return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  }
  if (!isValidIqMobile(phone)) {
    return res.status(400).json({ error: 'رقم هاتف غير صحيح', code: 'ERR_INVALID_PHONE' });
  }
  // Cap free-text so a large JSON body can't stuff multi-MB junk into columns.
  const MAX_FIELD_LEN = 120;
  const overLong = [studentName, email, university_name, department, instagram_username]
    .some((v) => v != null && String(v).length > MAX_FIELD_LEN);
  if (overLong || String(phone).length > 32) {
    return res.status(400).json({ error: 'قيمة طويلة جداً في أحد الحقول', code: 'ERR_VALIDATION' });
  }
  if (gender && !['male', 'female'].includes(gender)) {
    return res.status(400).json({ error: 'الجنس غير صالح', code: 'ERR_VALIDATION' });
  }
  // University + department are NOT collected from the student here — they are inherited
  // from the wholesaler whose referral link the student joined (resolved below).
  if (!study_type || !['morning', 'evening'].includes(study_type)) {
    return res.status(400).json({ error: 'الدراسة (صباحي/مسائي) مطلوبة', code: 'ERR_VALIDATION' });
  }
  if (!instagram_username || !String(instagram_username).trim()) {
    return res.status(400).json({ error: 'حساب إنستقرام مطلوب', code: 'ERR_VALIDATION' });
  }
  const cleanInstagram = String(instagram_username).trim().replace(/^@/, '');
  const { rows: wRows } = await query(
    `SELECT id, university_name, department FROM wholesalers WHERE referral_code = $1`,
    [code]
  );
  if (!wRows.length) {
    return res.status(404).json({ error: 'الرابط غير صالح', code: 'ERR_REFERRAL_INVALID' });
  }
  const wholesalerId = wRows[0].id;
  // Student inherits the wholesaler's جامعة/قسم. Fall back to anything the body sent
  // (legacy clients) so older flows still work, but the link's cohort wins.
  const finalUniversity =
    (wRows[0].university_name && String(wRows[0].university_name).trim()) ||
    (university_name ? String(university_name).trim() : null);
  const finalDepartment =
    (wRows[0].department && String(wRows[0].department).trim()) ||
    (department ? String(department).trim() : null);
  const exists = await query(
    `SELECT phone, email FROM users WHERE phone = $1 OR (email IS NOT NULL AND email = $2)`,
    [phone, email || null]
  );
  if (exists.rows.length) {
    const taken = exists.rows[0];
    if (taken.phone === phone) {
      return res.status(409).json({ error: 'رقم الهاتف مستخدم مسبقاً', code: 'ERR_PHONE_TAKEN' });
    }
    return res.status(409).json({ error: 'البريد الإلكتروني مستخدم مسبقاً', code: 'ERR_EMAIL_TAKEN' });
  }
  const hash = await bcrypt.hash(password, 10);
  const result = await tx(async (client) => {
    const u = await client.query(
      `INSERT INTO users (name, phone, email, password_hash, role) VALUES ($1, $2, $3, $4, 'retail') RETURNING id`,
      [studentName, phone, email || null, hash]
    );
    const s = await client.query(
      `INSERT INTO students (user_id, wholesaler_id, full_name_third, university_name, department, gender, study_type, instagram_username, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending_approval') RETURNING id`,
      [u.rows[0].id, wholesalerId, studentName, finalUniversity, finalDepartment, gender || null, study_type, cleanInstagram]
    );
    await client.query(
      `INSERT INTO notifications (user_id, type, title_ar, body_ar, link)
       SELECT w.user_id, 'student_joined', 'طالب جديد ينتظر الموافقة', $1, '/wholesaler'
       FROM wholesalers w WHERE w.id = $2`,
      [`${studentName} انضم عبر رابطك`, wholesalerId]
    );
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'student_joined', 'student', $2, $3)`,
      [u.rows[0].id, s.rows[0].id, JSON.stringify({ wholesaler_id: wholesalerId, code })]
    );
    return { user_id: u.rows[0].id, student_id: s.rows[0].id };
  });
  // No OTP on join. The student account is created as 'pending_approval' and the rep
  // approves it in-app — the join UI never asks for an OTP code (it only shows "قيد
  // المراجعة"), so any code sent here was an orphan WhatsApp message: pure spam that,
  // multiplied across 100+ students joining together, risks banning the gateway sender.
  // Phone format is still validated above (isValidIqMobile); we just don't send.
  res.status(201).json({
    data: { ...result, status: 'pending_approval', message_ar: 'طلبك بانتظار موافقة الممثل' },
  });
}

module.exports = { getReferral, joinReferral };
