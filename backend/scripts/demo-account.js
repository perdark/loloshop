#!/usr/bin/env node
// Create or reset the App Review demo account (Apple / Google reviewers).
//
//   npm run demo-account                              # default phone + password
//   npm run demo-account -- 07700000000 'Lolo#Review2026'
//
// WHY THIS EXISTS: the app now ships self-service account deletion (Apple guideline
// 5.1.1(v), migration 076) and Apple asks reviewers to walk that exact flow. If the
// reviewer runs it on the demo account, the account is GONE — its phone is NULLed —
// and the next submission fails review with "we could not sign in", which looks far
// worse than the bug it replaced. This script puts it back in one command.
//
// Deletion NULLs `phone` rather than deleting the row, so the number is free to be
// claimed again; this creates a fresh account rather than resurrecting the old one
// (the erased profile stays erased — restoring it would defeat the deletion).
//
// REMEMBER: the OTP bypass needs BOTH env vars set in prod, or the reviewer hits the
// WhatsApp OTP wall on a number they don't own:
//   DEMO_LOGIN_PHONES=07700000000
//   DEMO_LOGIN_EXPIRES_AT=YYYY-MM-DD   (unset => the allow-list is silently inert)

require('dotenv').config();
const bcrypt = require('bcrypt');
const { query, pool } = require('../lib/db');
const { assertPasswordOk } = require('../lib/password');

const DEFAULT_PHONE = '07700000000';
const DEFAULT_PASSWORD = 'Lolo#Review2026';

async function main() {
  const phone = process.argv[2] || DEFAULT_PHONE;
  const password = process.argv[3] || DEFAULT_PASSWORD;

  try {
    assertPasswordOk(password, 'customer');
  } catch (e) {
    console.error(`Rejected: ${e.message}`);
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);
  const existing = await query(
    `SELECT id, role, deleted_at FROM users WHERE phone = $1`,
    [phone]
  );

  let userId;
  if (existing.rows.length) {
    const user = existing.rows[0];
    if (user.role !== 'retail') {
      // Never repoint a staff/admin account at a published demo password.
      console.error(
        `Refusing: ${phone} belongs to a '${user.role}' account, not a retail student.`
      );
      process.exit(1);
    }
    userId = user.id;
    await query(
      `UPDATE users
          SET password_hash = $2, phone_verified = TRUE, deleted_at = NULL,
              token_version = token_version + 1, updated_at = NOW()
        WHERE id = $1`,
      [userId, hash]
    );
    console.log(`Reset the existing demo account (${phone}).`);
  } else {
    const ins = await query(
      `INSERT INTO users (name, phone, password_hash, role, phone_verified)
       VALUES ($1, $2, $3, 'retail', TRUE) RETURNING id`,
      ['حساب المراجعة', phone, hash]
    );
    userId = ins.rows[0].id;
    console.log(`Created a new demo account (${phone}).`);
  }

  // A retail login is only useful to a reviewer if it also has a student profile —
  // that is what the storefront, cart and order screens read.
  await query(
    `INSERT INTO students (user_id, full_name_third, university_name, department,
                           gender, study_type, instagram_username, status)
     VALUES ($1, 'حساب المراجعة', 'جامعة بغداد', 'علوم الحاسوب', 'female', 'morning',
             'lolo_shop96', 'approved')
     ON CONFLICT (user_id) DO UPDATE
       SET full_name_third = EXCLUDED.full_name_third,
           university_name = EXCLUDED.university_name,
           department      = EXCLUDED.department,
           study_type      = EXCLUDED.study_type,
           status          = 'approved'`,
    [userId]
  );

  const expiry = process.env.DEMO_LOGIN_EXPIRES_AT;
  const allowList = process.env.DEMO_LOGIN_PHONES || '';
  console.log(`\nDemo login: ${phone} / ${password}`);
  console.log(`OTP bypass — DEMO_LOGIN_PHONES: ${allowList.includes(phone) ? 'OK' : 'MISSING ⚠️'}`);
  console.log(
    `OTP bypass — DEMO_LOGIN_EXPIRES_AT: ${expiry || 'MISSING ⚠️ (allow-list is inert without it)'}`
  );
  if (expiry && new Date(expiry) < new Date()) {
    console.log('⚠️  That expiry date is in the PAST — push it forward and `pm2 restart`.');
  }
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error('Failed:', e.message);
    await pool.end();
    process.exit(1);
  });
