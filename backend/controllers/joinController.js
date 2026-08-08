const bcrypt = require('bcrypt');
const { query, tx } = require('../lib/db');
const { isValidIqMobile } = require('../lib/otp');
const memoCache = require('../lib/memoCache');
const { assertPasswordOk } = require('../lib/password');

/**
 * Public rep directory behind «ادخل مع ممثلك» on /login.
 *
 * WHY THIS EXISTS: `referral_code` is an admin-typed Latin slug (`damascus-medicine`). A student
 * who lost the WhatsApp link cannot be asked to type that from memory on an Arabic keyboard, and
 * on iOS there is no way to carry the code through an app install (no deferred deep linking), so
 * "just re-send the link" is not always available either. Two dropdowns, zero typing.
 *
 * ⚠️ THIS IS PUBLIC AND UNAUTHENTICATED — it deliberately discloses the university/department
 * list. That was accepted 2026-08-07 (docs/superpowers/specs/2026-08-07-app-entry-deeplinks-gps.md)
 * because joining still gives the student NOTHING until the wholesaler approves them one by one.
 * Keep it that way: never add pricing, deadlines, counts, or the rep's phone to this payload.
 */
async function getRepresentatives(req, res) {
  // 5 min: the list changes when the admin creates a rep, which is rare, and a whole cohort
  // hits /login within the same few minutes during a referral wave.
  const data = await memoCache.wrap('join:representatives', 5 * 60_000, async () => {
    const { rows } = await query(
      `SELECT w.referral_code, w.university_name, w.department, u.name AS wholesaler_name
         FROM wholesalers w
         JOIN users u ON u.id = w.user_id
        WHERE w.approved_by_admin = TRUE
          AND w.university_name IS NOT NULL AND btrim(w.university_name) <> ''
        ORDER BY w.university_name, w.department NULLS LAST, u.name`
    );
    return rows;
  });
  res.json({ representatives: data });
}

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
  const overLong = [studentName, university_name, department, instagram_username]
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
    `SELECT phone FROM users WHERE phone = $1`,
    [phone]
  );
  if (exists.rows.length) {
    return res.status(409).json({
      error: 'رقم الهاتف مستخدم مسبقاً — سجّل الدخول أو استعد كلمة المرور',
      code: 'ERR_PHONE_TAKEN',
      field: 'phone',
    });
  }
  try {
    assertPasswordOk(password, 'customer');
  } catch (e) {
    // Name the field so the join form can show it under the password box.
    return res.status(400).json({ error: e.message, code: e.code || 'ERR_WEAK_PASSWORD', field: 'password' });
  }
  const hash = await bcrypt.hash(password, 10);
  const result = await tx(async (client) => {
    const u = await client.query(
      `INSERT INTO users (name, phone, password_hash, role) VALUES ($1, $2, $3, 'retail') RETURNING id`,
      [studentName, phone, hash]
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

module.exports = { getRepresentatives, getReferral, joinReferral };
