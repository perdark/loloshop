// GET /api/admin/otp-gateway — surfaces lib/otp's gatewayStatus() to admins so a sender-device
// ban/failover is visible from the dashboard instead of only from `pm2 logs` on the box.
//
// This deliberately runs through a REAL HTTP server mounting the REAL routes/admin.js, not a
// direct controller call: the entire point of this endpoint is that it sits behind the SAME
// admin gate (authRequired + requireRole('admin')) as every other /api/admin/* route, and that
// can only be proven by exercising the actual middleware chain, not a hand-built req/user.
//
// This test asserts the WRAPPER only (status codes, `data` present, the well-known keys) — it
// does not pin gatewayStatus()'s exact shape, because a frontend agent is coding against that
// shape in parallel and lib/otp.js owns it, not this route.
//
// Runs against the real dev DB. Self-cleaning.

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const express = require('express');

const { query } = require('../lib/db');
const { signToken } = require('../middleware/auth');
const adminRouter = require('../routes/admin');

const TAG = `otpgw-${crypto.randomBytes(4).toString('hex')}`;
const PASSWORD = `Otpgw-${crypto.randomBytes(12).toString('hex')}!9`;
const created = [];

function freshPhone() {
  return '075' + String(crypto.randomInt(0, 1e8)).padStart(8, '0');
}

async function makeUser(role) {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const { rows } = await query(
    `INSERT INTO users (name, phone, password_hash, role, token_version)
     VALUES ($1, $2, $3, $4, 0) RETURNING id, role, token_version`,
    [`${TAG}-${role}`, freshPhone(), hash, role]
  );
  created.push(rows[0].id);
  return rows[0];
}

async function withAdminApp(fn) {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  // Mirrors server.js's error shape closely enough for this test — no route under test here
  // should ever reach it, but a stray throw must not surface as an opaque Express HTML page.
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    res.status(err.status || 500).json({ error: 'خطأ', code: err.code || 'ERR_SERVER' });
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test.after(async () => {
  if (!created.length) return;
  await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [created]);
});

test('GET /api/admin/otp-gateway with no token is refused', async () => {
  const status = await withAdminApp(async (base) => {
    const res = await fetch(`${base}/api/admin/otp-gateway`);
    return res.status;
  });
  assert.strictEqual(status, 401);
});

test('GET /api/admin/otp-gateway as admin returns the gateway status shape', async () => {
  const admin = await makeUser('admin');
  const token = signToken(admin);

  const body = await withAdminApp(async (base) => {
    const res = await fetch(`${base}/api/admin/otp-gateway`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(res.status, 200);
    return res.json();
  });

  assert.ok(body.data, 'response must be wrapped in { data }');
  assert.ok('configured' in body.data);
  assert.ok('active' in body.data);
  assert.ok(Array.isArray(body.data.devices));
});
