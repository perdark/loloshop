// Regression suite for the second security batch: LS-04 (anonymous wholesale pricing) and
// LS-10 (server-side password policy), including the controller-level integration — the
// riskiest part of LS-10 is that rejection is now a THROW that has to survive Express 5
// async propagation and land on the `err.expose && err.status` gate in server.js.
// (LS-15's health-endpoint shape is verified by hand against a dead DB, not here.)
//
// ⚠ Same shared-database rules as authOtpChallenge.test.js: never delete by a predicate
// that could match a real row, never use a fixed password. See that file's header.

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const { query } = require('../lib/db');
delete process.env.ZENTRAMSG_API_KEY;
delete process.env.ZENTRAMSG_DEVICE_UUID;
delete process.env.DEV_MASTER_OTP;

const { assertPasswordOk, tierForRole, CUSTOMER_MIN, PRIVILEGED_MIN } = require('../lib/password');
const catalog = require('../controllers/catalogController');

// ── LS-10: password policy ──────────────────────────────────────────────────
test('policy rejects passwords below the minimum', () => {
  assert.throws(() => assertPasswordOk('Qw3rt!'.slice(0, CUSTOMER_MIN - 1), 'customer'), /أحرف/);
  assert.throws(() => assertPasswordOk('Qw3rt!'.slice(0, PRIVILEGED_MIN - 1), 'privileged'), /أحرف/);
  // A realistic password of exactly the minimum length is accepted at both tiers. (The
  // owner set one bar for everyone on 2026-07-19, so the two constants are equal today.)
  assert.ok(assertPasswordOk('Qx7#mLp2', 'customer'));
  assert.ok(assertPasswordOk('Qx7#mLp2', 'privileged'));
});

test('length alone is not enough — repeated and sequential runs are refused', () => {
  // These clear the 8-character bar but are trivially guessable.
  assert.throws(() => assertPasswordOk('aaaaaaaa', 'customer'), /ضعيفة/);
  assert.throws(() => assertPasswordOk('11111111', 'customer'), /ضعيفة/);
  // NB '12345678' is separately on the banned list, so it fails as "common" — use a run
  // that isn't, to prove the sequence rule itself is doing the work.
  assert.throws(() => assertPasswordOk('23456789', 'customer'), /ضعيفة/);
  assert.throws(() => assertPasswordOk('abcdefgh', 'customer'), /ضعيفة/);
  assert.throws(() => assertPasswordOk('87654321', 'customer'), /ضعيفة/);
  // A password that merely CONTAINS a run is fine — only a whole-string run is refused.
  assert.ok(assertPasswordOk('abc12xyz', 'customer'));
});

test('policy rejects the seeded/default credentials', () => {
  // Exact-match by design: this list exists to stop a shipped default (admin123/staff123)
  // being re-entered verbatim, not to score passwords. 'admin123xxxx' is a different
  // password and is deliberately NOT caught here — length + the banned list is the whole
  // contract. All of these are long enough to clear CUSTOMER_MIN on their own, so it is
  // the ban that must reject them, not the length rule.
  for (const bad of ['admin123', 'staff123', 'password', 'Password', 'lolo2026', 'PASSWORD123']) {
    assert.throws(() => assertPasswordOk(bad, 'customer'), /شائعة/,
      `"${bad}" must be refused as a known-default password`);
  }
});

test('policy rejects missing/non-string and over-long values', () => {
  assert.throws(() => assertPasswordOk(undefined, 'customer'));
  assert.throws(() => assertPasswordOk('', 'customer'));
  assert.throws(() => assertPasswordOk(12345678, 'customer'));
  // bcrypt truncates past 72 BYTES — a longer value is false confidence, so refuse it.
  assert.throws(() => assertPasswordOk('a'.repeat(73), 'customer'), /72/);
});

test('policy counts code points, not UTF-16 units', () => {
  // 8 Arabic letters is 8 characters to the user; must be accepted at the customer tier.
  assert.ok(assertPasswordOk('كلمةمرور', 'customer'));
  // 4 emoji = 8 UTF-16 units but only 4 real characters — must NOT pass as 8.
  assert.throws(() => assertPasswordOk('😀😀😀😀', 'customer'));
});

test('tierForRole puts every privileged role on the higher bar', () => {
  for (const r of ['admin', 'staff', 'wholesaler', 'worker', 'design_helper']) {
    assert.strictEqual(tierForRole(r), 'privileged', `${r} must be privileged`);
  }
  assert.strictEqual(tierForRole('retail'), 'customer');
});

// ── LS-04: anonymous / retail callers cannot select wholesale pricing ────────
test('anonymous ?role=wholesaler does NOT yield wholesale pricing', async () => {
  assert.strictEqual(await catalog.priceRoleForUser(null, 'wholesaler'), 'retail',
    'an anonymous caller must never read the rep price book');
  assert.strictEqual(await catalog.priceRoleForUser(undefined, 'wholesaler'), 'retail');
});

test('a retail account cannot escalate its price role via ?role=', async () => {
  const { rows } = await query(
    `INSERT INTO users (name, phone, password_hash, role)
     VALUES ($1, $2, 'x', 'retail') RETURNING id`,
    [`ls04-${crypto.randomBytes(4).toString('hex')}`, '077' + String(crypto.randomInt(0, 1e8)).padStart(8, '0')]
  );
  const userId = rows[0].id;
  try {
    // No students row → not rep-linked → retail, regardless of what it asks for.
    const role = await catalog.priceRoleForUser({ id: userId, role: 'retail' }, 'wholesaler');
    assert.strictEqual(role, 'retail',
      'a retail account asking for wholesaler pricing must stay on retail');
  } finally {
    await query(`DELETE FROM users WHERE id = $1`, [userId]);
  }
});

test('only admin and production managers may preview wholesale pricing', async () => {
  assert.strictEqual(
    await catalog.priceRoleForUser({ id: 'x', role: 'admin' }, 'wholesaler'), 'wholesaler');
  assert.strictEqual(
    await catalog.priceRoleForUser({ id: 'x', role: 'staff', staff_types: ['manager'] }, 'wholesaler'),
    'wholesaler');
  // Production staff are denied money on every other surface — no rep price book here
  // either, even though they hold role='staff'.
  for (const t of ['presser', 'tailor', 'embroiderer', 'preparer', 'designer']) {
    assert.strictEqual(
      await catalog.priceRoleForUser({ id: 'x', role: 'staff', staff_types: [t] }, 'wholesaler'),
      'retail', `${t} must not read the wholesale price book`);
  }
});

test('?role=retail stays allowed for everyone (VIP list depends on it)', async () => {
  assert.strictEqual(await catalog.priceRoleForUser(null, 'retail'), 'retail');
  assert.strictEqual(await catalog.priceRoleForUser({ id: 'x', role: 'retail' }, 'retail'), 'retail');
});

// ── LS-10 integration: a rejected password must be a 400, not a 500 ──────────
// assertPasswordOk THROWS. Every call site therefore depends on that throw reaching the
// error handler with expose+status intact. Testing the pure function alone would miss a
// broken handler, a swallowed error, or a half-written record.
const auth = require('../controllers/authController');

function mockRes() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const mockReq = (body) => ({ body, get: () => 'ls-batchA-test' });

test('register rejects a weak password as 400 with the offending field named', async () => {
  const res = mockRes();
  await auth.register(mockReq({
    name: 'اختبار', phone: '07' + String(crypto.randomInt(0, 1e9)).padStart(9, '0'),
    password: 'short', university_name: 'ج', department: 'ق',
    study_type: 'morning', instagram_username: 'x',
  }), res);
  assert.strictEqual(res.statusCode, 400, 'must be a validation error, never a 500');
  assert.strictEqual(res.body.code, 'ERR_WEAK_PASSWORD');
  assert.strictEqual(res.body.field, 'password', 'the form needs to know WHICH input failed');
  assert.match(res.body.error, /[؀-ۿ]/, 'message must be Arabic');
});

test('register names the field for every kind of bad input', async () => {
  const base = {
    name: 'اختبار', phone: '07700000001', password: 'Qx7#mLp2',
    university_name: 'ج', department: 'ق', study_type: 'morning', instagram_username: 'x',
  };
  const cases = [
    [{ ...base, name: '' }, 'name'],
    [{ ...base, phone: '' }, 'phone'],
    [{ ...base, phone: '0712' }, 'phone'],
    [{ ...base, university_name: '' }, 'university_name'],
    [{ ...base, department: '' }, 'department'],
    [{ ...base, study_type: '' }, 'study_type'],
    [{ ...base, instagram_username: '' }, 'instagram_username'],
  ];
  for (const [body, expected] of cases) {
    const res = mockRes();
    await auth.register(mockReq(body), res);
    assert.strictEqual(res.statusCode, 400, `${expected}: expected 400`);
    assert.strictEqual(res.body.field, expected,
      `expected field "${expected}", got "${res.body.field}" (${res.body.error})`);
  }
});

// ── Old accounts must keep working ──────────────────────────────────────────
test('an existing SHORT password still logs in (policy applies only when setting)', async () => {
  // The whole point: raising the bar must not lock out accounts created under the old rule.
  const bcrypt = require('bcrypt');
  const phone = '077' + String(crypto.randomInt(0, 1e8)).padStart(8, '0');
  const legacy = 'abc123'; // 6 chars — would be refused by today's policy
  const { rows } = await query(
    `INSERT INTO users (name, phone, password_hash, role, phone_verified)
     VALUES ($1, $2, $3, 'wholesaler', TRUE) RETURNING id`,
    [`ls01-legacy-${crypto.randomBytes(3).toString('hex')}`, phone, await bcrypt.hash(legacy, 10)]
  );
  try {
    const res = mockRes();
    await auth.login(mockReq({ phone, password: legacy }), res);
    assert.notStrictEqual(res.statusCode, 400,
      'a legacy short password must not be rejected at login');
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.body.otp_required || res.body.token,
      'login must proceed normally for a pre-policy password');
  } finally {
    await query(`DELETE FROM otp_codes WHERE user_id = $1`, [rows[0].id]);
    await query(`DELETE FROM users WHERE id = $1`, [rows[0].id]);
  }
});
