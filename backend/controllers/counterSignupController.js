// Signup at the shop counter — a staff member creates a student's account in person.
//
// WHY THIS EXISTS. Measured 2026-08-15: 65.6% of August's student signups have no rep (189 of
// 288), up from 27.5% in June, and the owner reports most of those people are standing at the
// counter. Every one of them currently spends a WhatsApp OTP — on an unofficial gateway device
// that Meta bans periodically. So the busiest route to an account is also the most fragile,
// and it breaks exactly when a ban lands.
//
// WHY NOT THE GPS VERSION. The original proposal was "skip the OTP when the phone is near the
// shop". The server never observes location — the client states it. `{"lat":33.7,"lng":44.6}`
// is two numbers in a JSON body with nothing to check them against, so that rule would read as
// "skip the OTP for anyone who can type", and mock-location apps defeat even the honest path.
// The trustworthy thing in that scene is not the coordinate, it is the EMPLOYEE: authenticated,
// attributable, and looking at the student.
//
// WHY THIS IS NOT A NEW BYPASS. It is the existing one, applied to a second population with
// the same argument. `authController.login` already logs rep-linked students in with password
// only and no OTP (see its comment: a rep onboards 100+ students at once, blasting that many
// OTPs is what bans the sender, and the rep already approved them, so the phone-ownership
// proof is redundant). A staff member vouching face to face is at least as strong as a rep
// approving remotely.
//
// ⚠️ `phone_verified` STAYS FALSE, deliberately. The employee verified the PERSON, not that
// the person controls that phone number. Setting it TRUE here would record a proof that never
// happened, and `phone_verified` is what an OTP-backed login legitimately earns. Rep-linked
// students sit at FALSE for the same reason; this matches them exactly.
//
// Related: `orderEditController` already creates a student inside the staff custom-order flow,
// but hashes a random UUID as the password, so that student can never log in afterwards. This
// endpoint is the account-first half — staff create a USABLE account here, then attach an
// order through the existing «طالب موجود» search.

const bcrypt = require('bcrypt');
const { query, tx } = require('../lib/db');
const { isValidIqMobile, normalizeIqPhone } = require('../lib/otp');
const { assertPasswordOk } = require('../lib/password');

const SALT_ROUNDS = 10;
const MAX_FIELD_LEN = 120;

function badField(res, field, error, code = 'ERR_VALIDATION') {
  return res.status(400).json({ error, code, field });
}
const tooLong = (v) => v != null && String(v).length > MAX_FIELD_LEN;
const trimmed = (v) => (v == null ? null : String(v).trim() || null);

// Create a student account in person. Requires an authenticated staff/admin session — that
// session IS the authorisation, which is the whole point.
async function counterSignup(req, res) {
  const b = req.body || {};
  const name = trimmed(b.name);
  const phone = trimmed(b.phone); // already canonicalised by normalizePhoneBody on the router
  const password = b.password;
  const university_name = trimmed(b.university_name);
  const department = trimmed(b.department);
  const gender = trimmed(b.gender);
  const study_type = trimmed(b.study_type);
  const instagram_username = trimmed(b.instagram_username);

  if (!name) return badField(res, 'name', 'الاسم مطلوب');
  if (tooLong(name)) return badField(res, 'name', `الاسم طويل جداً (${MAX_FIELD_LEN} حرف كحد أقصى)`);
  if (!phone) return badField(res, 'phone', 'رقم الهاتف مطلوب');
  if (!isValidIqMobile(phone)) {
    return badField(res, 'phone', 'رقم هاتف غير صحيح — يجب أن يبدأ بـ 07 ويتكوّن من 11 رقماً', 'ERR_INVALID_PHONE');
  }
  // SECURITY — phone double-entry. Nothing else here checks that the number typed is the
  // number the student in front of the counter actually owns: `normalizePhoneBody` only
  // canonicalises whatever was typed, it doesn't verify it. OTP registration can't produce
  // this failure — a mistyped number simply never receives the code, so the mistake is
  // visible immediately. Counter signup skips the OTP entirely, so a typo here silently
  // succeeds onto a STRANGER's phone number, and `forgot-password-phone` later sends the
  // reset OTP — the sole reset credential for this account — to whoever actually owns that
  // number: an account-takeover path with no other guard in this flow. Require the staff
  // member to type the phone a second time and compare, canonicalising phone_confirm the
  // SAME way normalizePhoneBody canonicalised phone (so '7712345678' matches '07712345678').
  const phoneConfirmRaw = trimmed(b.phone_confirm);
  if (!phoneConfirmRaw) {
    return badField(res, 'phone_confirm', 'يرجى إدخال رقم الهاتف مرة أخرى للتأكيد', 'ERR_PHONE_MISMATCH');
  }
  if (normalizeIqPhone(phoneConfirmRaw) !== phone) {
    return badField(res, 'phone_confirm', 'رقم الهاتف غير متطابق — يرجى التأكد من الرقم مع الطالب', 'ERR_PHONE_MISMATCH');
  }
  if (!password) return badField(res, 'password', 'كلمة المرور مطلوبة');
  // Same policy as self-signup. The account is the student's to keep — a staff member
  // creating it must not be able to give it a weaker password than the student could.
  try {
    assertPasswordOk(password, 'customer');
  } catch (e) {
    return badField(res, 'password', e.message, e.code || 'ERR_WEAK_PASSWORD');
  }
  if (!university_name) return badField(res, 'university_name', 'اسم الجامعة مطلوب');
  if (!department) return badField(res, 'department', 'القسم/التخصص مطلوب');
  if (tooLong(university_name)) return badField(res, 'university_name', 'اسم الجامعة طويل جداً');
  if (tooLong(department)) return badField(res, 'department', 'القسم/التخصص طويل جداً');
  if (tooLong(instagram_username)) return badField(res, 'instagram_username', 'حساب إنستقرام طويل جداً');
  if (gender && !['male', 'female'].includes(gender)) {
    return badField(res, 'gender', 'الجنس غير صالح');
  }
  if (study_type && !['morning', 'evening'].includes(study_type)) {
    return badField(res, 'study_type', 'الدراسة غير صالحة');
  }

  // Checked before the transaction so a duplicate costs no write, and answered with a message
  // the person at the counter can ACT on — they have the student in front of them and can ask
  // whether they already have an account, which a bare «الرقم مستخدم» does not prompt.
  const existing = await query(
    `SELECT u.name, s.id AS student_id FROM users u
     LEFT JOIN students s ON s.user_id = u.id
     WHERE u.phone = $1`,
    [phone]
  );
  if (existing.rows.length) {
    return res.status(409).json({
      error: `هذا الرقم مسجّل مسبقاً باسم «${existing.rows[0].name}» — سجّل دخوله بدل إنشاء حساب جديد`,
      code: 'ERR_PHONE_TAKEN',
      field: 'phone',
      student_id: existing.rows[0].student_id || null,
    });
  }

  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const created = await tx(async (client) => {
    const u = await client.query(
      // phone_verified is left at its FALSE default on purpose — see the header note.
      `INSERT INTO users (name, phone, password_hash, role, created_by_user_id)
       VALUES ($1, $2, $3, 'retail', $4) RETURNING id`,
      [name, phone, hash, req.user.id]
    );
    const s = await client.query(
      // status 'approved': there is no rep to wait for, exactly like self-registered retail.
      `INSERT INTO students
         (user_id, wholesaler_id, full_name_third, university_name, department,
          gender, study_type, instagram_username, status)
       VALUES ($1, NULL, $2, $3, $4, $5::gender, $6::study_type, $7, 'approved')
       RETURNING id`,
      [u.rows[0].id, name, university_name, department,
        gender || null, study_type || null, instagram_username]
    );
    // The attributable half of "who vouched". The column on `users` answers it for the row;
    // this answers it for the timeline, and survives the row being edited later.
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'counter_signup', 'student', $2, $3::jsonb)`,
      [req.user.id, s.rows[0].id, JSON.stringify({ phone, university_name, department })]
    );
    return { user_id: u.rows[0].id, student_id: s.rows[0].id };
  });

  return res.status(201).json({
    data: {
      user_id: created.user_id,
      student_id: created.student_id,
      name,
      phone,
      // Tells the counter screen it can hand the student straight to an order instead of
      // sending them away to verify something.
      otp_required: false,
    },
  });
}

module.exports = { counterSignup };
