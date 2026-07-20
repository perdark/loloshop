#!/usr/bin/env node
// Reset any account's password from the server console.
//
// WHY THIS EXISTS: email-based recovery was removed (2026-07-19) and phone-OTP reset is
// deliberately limited to retail + wholesaler, because one intercepted WhatsApp message
// must not hand over a privileged account. That leaves the ADMIN account with no in-app
// recovery — this script is it. Requires shell access to the server, which is a stronger
// proof of ownership than any email inbox.
//
//   npm run set-password -- 07783571996 'the-new-password'
//   npm run set-password -- 07783571996            # generates a strong one and prints it
//
// The password is validated against the same policy the API enforces (lib/password.js).

require('dotenv').config();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { query, pool } = require('../lib/db');
const { assertPasswordOk, tierForRole } = require('../lib/password');
const { revokeUserDevices } = require('../lib/trustedDevice');

async function main() {
  const [phone, supplied] = process.argv.slice(2);
  if (!phone) {
    console.error("Usage: npm run set-password -- <phone> [new-password]");
    process.exit(1);
  }

  const { rows } = await query(
    `SELECT id, name, role FROM users WHERE phone = $1`,
    [phone]
  );
  if (!rows.length) {
    console.error(`No account with phone ${phone}.`);
    process.exit(1);
  }
  const user = rows[0];

  // base64url so the generated value has no shell-hostile characters to paste.
  const password = supplied || crypto.randomBytes(12).toString('base64url');
  try {
    assertPasswordOk(password, tierForRole(user.role));
  } catch (e) {
    console.error(`Rejected: ${e.message}`);
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);
  await query(
    `UPDATE users
     SET password_hash = $1, token_version = token_version + 1
     WHERE id = $2`,
    [hash, user.id]
  );
  // Match the in-app reset flows: a password change drops every trusted device, so a
  // stolen 90-day device token can't outlive the reset.
  await revokeUserDevices(user.id);

  console.log(`Password updated for ${user.name} (${user.role}, ${phone}).`);
  if (!supplied) console.log(`New password (shown once): ${password}`);
  console.log('All trusted devices for this account were revoked.');
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error('Failed:', e.message);
    await pool.end();
    process.exit(1);
  });
