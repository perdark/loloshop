const bcrypt = require('bcrypt');
const { query, tx } = require('../lib/db');
const { createOtp } = require('../lib/otp');

async function getReferral(req, res) {
  const { code } = req.params;
  const { rows } = await query(
    `SELECT u.name AS wholesaler_name, w.deadline
     FROM wholesalers w JOIN users u ON u.id = w.user_id
     WHERE w.referral_code = $1`,
    [code]
  );
  if (!rows.length) {
    return res.status(404).json({ error: 'الرابط غير صالح', code: 'ERR_REFERRAL_INVALID' });
  }
  res.json({ wholesaler_name: rows[0].wholesaler_name, deadline: rows[0].deadline, valid: true });
}

async function joinReferral(req, res) {
  const { code } = req.params;
  const { name, phone, email, password, university_name, department, gender } = req.body;
  if (!name || !phone || !password) {
    return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  }
  if (gender && !['male', 'female'].includes(gender)) {
    return res.status(400).json({ error: 'الجنس غير صالح', code: 'ERR_VALIDATION' });
  }
  const { rows: wRows } = await query(
    `SELECT id FROM wholesalers WHERE referral_code = $1`,
    [code]
  );
  if (!wRows.length) {
    return res.status(404).json({ error: 'الرابط غير صالح', code: 'ERR_REFERRAL_INVALID' });
  }
  const wholesalerId = wRows[0].id;
  const exists = await query(`SELECT id FROM users WHERE phone = $1`, [phone]);
  if (exists.rows.length) {
    return res.status(409).json({ error: 'الرقم مستخدم', code: 'ERR_PHONE_TAKEN' });
  }
  const hash = await bcrypt.hash(password, 10);
  const result = await tx(async (client) => {
    const u = await client.query(
      `INSERT INTO users (name, phone, email, password_hash, role) VALUES ($1, $2, $3, $4, 'retail') RETURNING id`,
      [name, phone, email || null, hash]
    );
    const s = await client.query(
      `INSERT INTO students (user_id, wholesaler_id, full_name_third, university_name, department, gender, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending_approval') RETURNING id`,
      [u.rows[0].id, wholesalerId, name, university_name || null, department || null, gender || null]
    );
    await client.query(
      `INSERT INTO notifications (user_id, type, title_ar, body_ar, link)
       SELECT w.user_id, 'student_joined', 'طالب جديد ينتظر الموافقة', $1, '/wholesaler'
       FROM wholesalers w WHERE w.id = $2`,
      [`${name} انضم عبر رابطك`, wholesalerId]
    );
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'student_joined', 'student', $2, $3)`,
      [u.rows[0].id, s.rows[0].id, JSON.stringify({ wholesaler_id: wholesalerId, code })]
    );
    return { user_id: u.rows[0].id, student_id: s.rows[0].id };
  });
  await createOtp(phone);
  res.status(201).json({
    data: { ...result, status: 'pending_approval', message_ar: 'طلبك بانتظار موافقة الممثل' },
  });
}

module.exports = { getReferral, joinReferral };
