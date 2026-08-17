// OTP degraded mode — the WhatsApp-gateway-outage bypass (OTP_DEGRADED_UNTIL).
//
// The Zentramsg sender is an unofficial gateway device that Meta bans periodically. While
// it is banned no OTP is delivered, so every OTP-gated flow dead-ends. The flag trades the
// second factor for availability, and this suite encodes the four properties that keep it
// from becoming a hole:
//
//   1. It EXPIRES and is CAPPED — unset / past / typo'd-far-future all read as OFF.
//   2. bcrypt STILL RUNS. Degraded mode skips the OTP, never the password.
//   3. Privileged roles (admin/staff/worker/design_helper) never bypass.
//   4. Password RESET is DECOUPLED from this flag (owner decision 2026-08-16): the retail
//      login bypass stays ON while reset stays USABLE. Reset is still safe because it never
//      SKIPS the OTP — the code is generated, sent, and verified, so it remains the sole
//      credential. A separate kill-switch (`FORGOT_PW_OTP_BLOCK=1`) refuses reset only when
//      the gateway genuinely cannot deliver.
//
// Property 2 is the one that turns this from "a day of reduced 2FA" into "anyone can take
// any account", so it is tested per-role and negatively.
//
// Runs against the real database and cleans up after itself.

const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

// ORDER IS LOAD-BEARING — same reasoning as authOtpChallenge.test.js: lib/db runs
// dotenv.config(), so require it FIRST, strip the gateway credentials SECOND, and only
// then pull in lib/otp. Backwards, and this suite really WhatsApps every invented number
// it generates — which is the exact behaviour that gets the sender device banned.
const { query } = require('../lib/db');
delete process.env.ZENTRAMSG_API_KEY;
delete process.env.ZENTRAMSG_DEVICE_UUID;
delete process.env.DEV_MASTER_OTP;

const otp = require('../lib/otp');
const auth = require('../controllers/authController');

// Scoped exactly like the LS-01 suite: never delete by a predicate that could match a real
// customer row, and never use a fixed password.
const PASSWORD = `degr-${crypto.randomBytes(24).toString('hex')}`;
const TAG = `degr-${crypto.randomBytes(4).toString('hex')}`;
const created = [];

const PRIVILEGED = ['admin', 'staff', 'worker', 'design_helper'];
const DEGRADABLE = ['retail', 'wholesaler'];

function mockRes() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const mockReq = (body) => ({ body, get: () => 'degraded-test-agent' });

function freshPhone() {
  return '078' + String(crypto.randomInt(0, 1e8)).padStart(8, '0');
}

// Window helpers — expressed relative to now so the suite never rots on a fixed date.
const hoursFromNow = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();

async function makeUser(role) {
  const phone = freshPhone();
  const hash = await bcrypt.hash(PASSWORD, 10);
  const { rows } = await query(
    `INSERT INTO users (name, phone, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id`,
    [`${TAG}-${role}`, phone, hash, role]
  );
  created.push(rows[0].id);
  return { id: rows[0].id, phone, role };
}

async function countOtpRows(phone) {
  const { rows } = await query(`SELECT count(*)::int AS n FROM otp_codes WHERE phone = $1`, [phone]);
  return rows[0].n;
}

test.before(async () => {
  await query(`DELETE FROM users WHERE name LIKE 'degr-%'`);
});

test.afterEach(() => {
  delete process.env.OTP_DEGRADED_UNTIL;
  delete process.env.FORGOT_PW_OTP_BLOCK;
});

test.after(async () => {
  delete process.env.OTP_DEGRADED_UNTIL;
  delete process.env.FORGOT_PW_OTP_BLOCK;
  if (!created.length) return;
  await query(`DELETE FROM otp_codes WHERE user_id = ANY($1::uuid[])`, [created]);
  await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [created]);
});

// ── 1. The flag itself is fail-safe ──────────────────────────────────────────────

test('unset OTP_DEGRADED_UNTIL means OTP is ON', () => {
  delete process.env.OTP_DEGRADED_UNTIL;
  assert.strictEqual(otp.isOtpDegraded(), false);
});

test('an expired window means OTP is ON', () => {
  process.env.OTP_DEGRADED_UNTIL = hoursFromNow(-1);
  assert.strictEqual(otp.isOtpDegraded(), false, 'a past deadline must not keep the bypass alive');
});

test('a window beyond the 48h cap means OTP is ON', () => {
  // The realistic failure: someone types the wrong year and creates a silent multi-year
  // bypass. The cap makes that read as OFF instead.
  process.env.OTP_DEGRADED_UNTIL = hoursFromNow(49);
  assert.strictEqual(otp.isOtpDegraded(), false, '>48h must be rejected, not honoured');
  process.env.OTP_DEGRADED_UNTIL = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
  assert.strictEqual(otp.isOtpDegraded(), false, 'a typo\'d year must not be a permanent bypass');
});

test('an unparseable value means OTP is ON', () => {
  for (const bad of ['yes', 'true', '1', 'tomorrow', '']) {
    process.env.OTP_DEGRADED_UNTIL = bad;
    assert.strictEqual(otp.isOtpDegraded(), false, `"${bad}" must not enable the bypass`);
  }
});

// ── 1b. The one indefinite setting (owner decision 2026-08-17) ───────────────────
// `always` is the deliberate escape hatch from the clock, for a gateway device that
// drops its session every couple of days. It must be reachable ONLY by typing the
// word — never by mistyping a date, which is what the 48h cap above is for.

test('OTP_DEGRADED_UNTIL=always enables the bypass with no expiry', () => {
  process.env.OTP_DEGRADED_UNTIL = 'always';
  assert.strictEqual(otp.isOtpDegraded(), true, 'the literal sentinel must hold the bypass open');
});

test('the always sentinel is case- and whitespace-insensitive', () => {
  for (const v of ['ALWAYS', 'Always', '  always  ', 'always\n']) {
    process.env.OTP_DEGRADED_UNTIL = v;
    assert.strictEqual(otp.isOtpDegraded(), true, `"${JSON.stringify(v)}" must be honoured`);
  }
});

test('the sentinel does not loosen the date cap', () => {
  // The cap catches mistakes; `always` is a decision. Adding the second must not weaken
  // the first — a typo'd far-future date is still OFF, not "close enough to always".
  process.env.OTP_DEGRADED_UNTIL = hoursFromNow(49);
  assert.strictEqual(otp.isOtpDegraded(), false, '>48h must still be rejected');
  for (const nearly of ['alway', 'always-on', 'forever', 'never']) {
    process.env.OTP_DEGRADED_UNTIL = nearly;
    assert.strictEqual(otp.isOtpDegraded(), false, `"${nearly}" must not enable the bypass`);
  }
});

test('a valid near-term window enables the bypass', () => {
  process.env.OTP_DEGRADED_UNTIL = hoursFromNow(12);
  assert.strictEqual(otp.isOtpDegraded(), true);
});

// ── 2. bcrypt still runs — the bypass skips the OTP, never the password ──────────

for (const role of DEGRADABLE) {
  test(`[${role}] degraded mode still rejects a WRONG password`, async () => {
    const user = await makeUser(role);
    process.env.OTP_DEGRADED_UNTIL = hoursFromNow(12);
    const res = mockRes();
    await auth.login(mockReq({ phone: user.phone, password: 'not-the-password' }), res);
    assert.strictEqual(res.statusCode, 401, 'a bad password must fail even while degraded');
    assert.strictEqual(res.body.token, undefined, 'no token may be minted without the password');
  });
}

test('degraded mode does not turn an unknown phone into a login', async () => {
  process.env.OTP_DEGRADED_UNTIL = hoursFromNow(12);
  const res = mockRes();
  await auth.login(mockReq({ phone: freshPhone(), password: PASSWORD }), res);
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(res.body.token, undefined);
});

// ── 3. Who may bypass, and what they get ────────────────────────────────────────

for (const role of DEGRADABLE) {
  test(`[${role}] correct password + degraded mode logs in without an OTP`, async () => {
    const user = await makeUser(role);
    process.env.OTP_DEGRADED_UNTIL = hoursFromNow(12);
    const res = mockRes();
    await auth.login(mockReq({ phone: user.phone, password: PASSWORD }), res);

    assert.ok(res.body.token, 'a token must be issued');
    assert.strictEqual(res.body.otp_required, undefined, 'no OTP step may be demanded');
    assert.strictEqual(res.body.degraded_auth, true, 'the response must mark itself degraded');
    assert.strictEqual(await countOtpRows(user.phone), 0,
      'no OTP row may be written — writing one would try to WhatsApp a banned gateway');

    // A password-only login must not buy 90 days of trusted-device access; that would
    // outlive the outage window and re-enter through the trusted-device branch later.
    assert.strictEqual(res.body.device_token, undefined, 'no device token may be issued');
    // No phone ownership was proven, so the flag that records it must stay false.
    assert.strictEqual(res.body.user.phone_verified, false, 'phone_verified must not be flipped');
    const { rows } = await query(`SELECT phone_verified FROM users WHERE id = $1`, [user.id]);
    assert.strictEqual(rows[0].phone_verified, false, 'and must not be flipped in the DB either');
  });
}

for (const role of PRIVILEGED) {
  test(`[${role}] is NEVER bypassed, even while degraded`, async () => {
    const user = await makeUser(role);
    process.env.OTP_DEGRADED_UNTIL = hoursFromNow(12);
    const res = mockRes();
    await auth.login(mockReq({ phone: user.phone, password: PASSWORD }), res);
    assert.strictEqual(res.body.token, undefined,
      `${role} must not receive a token from a password alone`);
    assert.strictEqual(res.body.otp_required, true, `${role} must still be sent to the OTP step`);
  });
}

test('with the flag OFF, a retail login still demands the OTP', async () => {
  const user = await makeUser('retail');
  delete process.env.OTP_DEGRADED_UNTIL;
  const res = mockRes();
  await auth.login(mockReq({ phone: user.phone, password: PASSWORD }), res);
  assert.strictEqual(res.body.otp_required, true, 'normal mode must be unchanged');
  assert.strictEqual(res.body.token, undefined);
});

// ── 4. Password reset is DECOUPLED from the degrade flag ────────────────────────

test('forgot-password STILL WORKS during degraded mode (decoupled from the flag)', async () => {
  const user = await makeUser('retail');
  process.env.OTP_DEGRADED_UNTIL = hoursFromNow(12);
  const res = mockRes();
  await auth.forgotPasswordPhone(mockReq({ phone: user.phone }), res);

  // Owner decision 2026-08-16: the retail LOGIN bypass stays on, but reset must remain
  // usable. Safe because reset never SKIPS the OTP — it is created, sent, and verified.
  assert.strictEqual(res.statusCode, 200, 'reset must proceed, not fail closed');
  assert.strictEqual(res.body.sent, true);
  assert.ok(res.body.challenge_id, 'an eligible account gets a real challenge');
  assert.strictEqual(await countOtpRows(user.phone), 1, 'a reset OTP row IS created');
});

test('FORGOT_PW_OTP_BLOCK still refuses reset and leaks nothing about the number', async () => {
  process.env.FORGOT_PW_OTP_BLOCK = '1';
  const known = await makeUser('retail');

  const a = mockRes();
  await auth.forgotPasswordPhone(mockReq({ phone: known.phone }), a);
  const b = mockRes();
  await auth.forgotPasswordPhone(mockReq({ phone: freshPhone() }), b);

  // The kill-switch fails closed and is returned BEFORE the user lookup, so a registered
  // and an unregistered number must be byte-identical.
  assert.strictEqual(a.statusCode, 503, 'the kill-switch fails closed');
  assert.strictEqual(a.body.code, 'ERR_OTP_UNAVAILABLE');
  assert.strictEqual(a.body.challenge_id, undefined, 'no challenge may be handed out');
  assert.match(a.body.error, /دعم المتجر/, 'must point the user at shop support');
  assert.doesNotMatch(a.body.error, /واتساب|إنستقرام|@/,
    'must not name WhatsApp, Instagram, or any handle');
  assert.deepStrictEqual(a.body, b.body, 'registered and unregistered must look alike');
  assert.strictEqual(await countOtpRows(known.phone), 0, 'no reset OTP row may be created');
});

// ── 5. Registration completes without a code it can never receive ───────────────

test('register during degraded mode creates an UNVERIFIED account and skips the OTP', async () => {
  process.env.OTP_DEGRADED_UNTIL = hoursFromNow(12);
  const phone = freshPhone();
  const res = mockRes();
  await auth.register(mockReq({
    name: `${TAG}-reg`,
    phone,
    password: PASSWORD,
    university_name: 'جامعة بغداد',
    department: 'هندسة',
    study_type: 'morning',
    instagram_username: 'degraded_test',
  }), res);

  assert.strictEqual(res.statusCode, 201, 'the account must still be created');
  assert.strictEqual(res.body.data.otp_required, false, 'no code step may be demanded');
  assert.strictEqual(res.body.data.challenge_id, null, 'and no challenge id handed out');
  assert.strictEqual(await countOtpRows(phone), 0, 'no OTP row may be written');

  const { rows } = await query(`SELECT id, phone_verified FROM users WHERE phone = $1`, [phone]);
  assert.strictEqual(rows.length, 1);
  created.push(rows[0].id);
  assert.strictEqual(rows[0].phone_verified, false,
    'an account created without a delivered code must be recorded as unverified');
});
