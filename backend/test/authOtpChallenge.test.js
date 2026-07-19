// LS-01 regression suite — OTP must never be a login on its own.
//
// Before the challenge binding, anyone could POST /auth/resend-otp {phone, purpose:'login'}
// for a victim's number and then POST /auth/login-verify {phone, code} to mint that
// account's JWT with NO password — for EVERY role, admin included. These tests encode that
// the attack is dead and that the legitimate password->OTP sequence still works.
//
// Runs against the real (Neon) database and cleans up after itself.

const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

// ORDER IS LOAD-BEARING. lib/db runs `dotenv.config()`, which repopulates anything we
// cleared beforehand — so require it FIRST, strip the credentials SECOND, and only then
// pull in lib/otp. Getting this backwards makes the suite really WhatsApp every invented
// number it generates, and blasting numbers that don't exist is the single fastest way to
// get the Zentramsg sender device banned (see lib/otp.js). sendViaZentramsg reads these at
// call time, so clearing them here stops the network call while the OTP row is still written.
const { query } = require('../lib/db');
delete process.env.ZENTRAMSG_API_KEY;
delete process.env.ZENTRAMSG_DEVICE_UUID;
// Read at module load inside lib/otp, so it must be cleared before that require: a master
// code would satisfy every challenge and mask a genuine failure. Force real codes.
delete process.env.DEV_MASTER_OTP;

const otp = require('../lib/otp');
const auth = require('../controllers/authController');

// ⚠ THIS SUITE WRITES TO THE SHARED NEON DATABASE (dev and prod are the same database).
// Two rules follow from that and must not be relaxed:
//   1. NEVER delete by a predicate that could match a real row. Scope every cleanup to the
//      ids this run created or to the 'ls01-' name prefix. In particular `user_id IS NULL`
//      is NOT "my rows" — the currently-deployed backend writes NULL there, so it matches
//      every OTP real customers are mid-login with.
//   2. NEVER use a fixed password. It is generated per run and never logged, so a row
//      stranded by a crash is still an account nobody can log into.
const ROLES = ['admin', 'staff', 'wholesaler', 'retail', 'worker', 'design_helper'];
const PASSWORD = `ls01-${crypto.randomBytes(24).toString('hex')}`;
const TAG = `ls01-${crypto.randomBytes(4).toString('hex')}`;
const created = [];

function mockRes() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const mockReq = (body) => ({ body, get: () => 'ls01-test-agent' });

// Unique, shape-valid Iraqi mobile (07 + 9 digits) per user.
function freshPhone() {
  return '077' + String(crypto.randomInt(0, 1e8)).padStart(8, '0');
}

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

// Read the code straight out of the row the flow just wrote.
async function latestCode(phone, purpose) {
  const { rows } = await query(
    `SELECT code, challenge_id FROM otp_codes
     WHERE phone = $1 AND purpose = $2 AND used = FALSE
     ORDER BY created_at DESC LIMIT 1`,
    [phone, purpose]
  );
  return rows[0];
}

// Clear anything a previously crashed run stranded. Matching on the 'ls01-' name prefix
// cannot hit a real account (customer names are Arabic), and otp_codes.user_id cascades.
test.before(async () => {
  await query(`DELETE FROM users WHERE name LIKE 'ls01-%'`);
});

test.after(async () => {
  if (!created.length) return;
  await query(`DELETE FROM otp_codes WHERE user_id = ANY($1::uuid[])`, [created]);
  await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [created]);
});

test('the legacy phone-addressed verifyOtp export is gone', () => {
  assert.strictEqual(otp.verifyOtp, undefined,
    'lib/otp must not export verifyOtp(phone, code, purpose) — it re-opens LS-01');
});

test('resend-otp refuses a caller-chosen phone + purpose', async () => {
  const user = await makeUser('admin');
  const res = mockRes();
  await auth.resendOtp(mockReq({ phone: user.phone, purpose: 'login' }), res);
  assert.strictEqual(res.statusCode, 400);
  const leaked = await latestCode(user.phone, 'login');
  assert.strictEqual(leaked, undefined, 'no login OTP may be created from an unauthenticated request');
});

for (const role of ROLES) {
  test(`[${role}] OTP possession alone cannot mint a token`, async () => {
    const user = await makeUser(role);

    // An OTP exists for the account (however the attacker caused it to be sent).
    await otp.createOtp(user.phone, 'login', { userId: user.id });
    const row = await latestCode(user.phone, 'login');
    assert.ok(row && row.code, 'precondition: an OTP row exists');

    // Attack 1 — the old login-verify shape: phone + correct code, no password.
    const a1 = mockRes();
    await auth.loginVerifyOtp(mockReq({ phone: user.phone, code: row.code }), a1);
    assert.strictEqual(a1.statusCode, 400, `${role}: phone+code must not be accepted`);
    assert.ok(!a1.body?.token, `${role}: no token may be issued without a challenge`);

    // Attack 2 — the registration-verify handler with phone + code.
    const a2 = mockRes();
    await auth.postVerifyOtp(mockReq({ phone: user.phone, code: row.code }), a2);
    assert.strictEqual(a2.statusCode, 400, `${role}: verify-otp must not accept phone+code`);
    assert.ok(!a2.body?.token, `${role}: no token from the registration path`);

    // Attack 3 — a guessed/lifted challenge id that was never issued.
    const a3 = mockRes();
    await auth.loginVerifyOtp(mockReq({ challenge_id: crypto.randomUUID(), code: row.code }), a3);
    assert.strictEqual(a3.statusCode, 400, `${role}: an unissued challenge must be rejected`);
    assert.ok(!a3.body?.token);
  });
}

test('a login challenge is only issued after the password checks out', async () => {
  const user = await makeUser('admin');

  // Wrong password → 401 and no challenge to work with.
  const bad = mockRes();
  await auth.login(mockReq({ phone: user.phone, password: 'wrong-password' }), bad);
  assert.strictEqual(bad.statusCode, 401);
  assert.ok(!bad.body?.challenge_id);
  assert.strictEqual(await latestCode(user.phone, 'login'), undefined);

  // Correct password → challenge issued, but still no token yet (2FA intact).
  const good = mockRes();
  await auth.login(mockReq({ phone: user.phone, password: PASSWORD }), good);
  assert.strictEqual(good.body.otp_required, true);
  assert.ok(good.body.challenge_id, 'password success must return a challenge');
  assert.ok(!good.body.token, 'password alone must not log an admin in');

  // Challenge + correct code → token. The legitimate sequence still works.
  const row = await latestCode(user.phone, 'login');
  const done = mockRes();
  await auth.loginVerifyOtp(mockReq({ challenge_id: good.body.challenge_id, code: row.code }), done);
  assert.ok(done.body.token, 'password + OTP must still log in');
  assert.strictEqual(done.body.user.role, 'admin');

  // Single use: replaying the same challenge+code is refused.
  const replay = mockRes();
  await auth.loginVerifyOtp(mockReq({ challenge_id: good.body.challenge_id, code: row.code }), replay);
  assert.strictEqual(replay.statusCode, 400, 'a consumed challenge must not be replayable');
});

test('the registration verify path can never return a privileged session', async () => {
  const admin = await makeUser('admin');
  // Even holding a valid 'verify' challenge bound to the admin AND its correct code,
  // the registration handler must refuse — registration only ever makes retail accounts.
  const { challenge_id } = await otp.createOtp(admin.phone, 'verify', { userId: admin.id });
  const row = await latestCode(admin.phone, 'verify');
  const res = mockRes();
  await auth.postVerifyOtp(mockReq({ challenge_id, code: row.code }), res);
  assert.strictEqual(res.statusCode, 403, 'privileged role must be rejected by verify-otp');
  assert.ok(!res.body?.token);
});

test('a challenge is scoped to its purpose (no cross-purpose replay)', async () => {
  const user = await makeUser('retail');
  const { challenge_id } = await otp.createOtp(user.phone, 'reset', { userId: user.id });
  const row = await latestCode(user.phone, 'reset');
  // A reset code must not satisfy a login verification.
  const res = mockRes();
  await auth.loginVerifyOtp(mockReq({ challenge_id, code: row.code }), res);
  assert.strictEqual(res.statusCode, 400);
  assert.ok(!res.body?.token);
});

test('forgot-password-phone returns a challenge id for unknown numbers too', async () => {
  // Otherwise the response is an account-enumeration oracle.
  const unknown = mockRes();
  await auth.forgotPasswordPhone(mockReq({ phone: freshPhone() }), unknown);
  assert.strictEqual(unknown.statusCode, 200);
  assert.ok(unknown.body.challenge_id, 'unknown phone must still get a (decoy) challenge id');

  const user = await makeUser('retail');
  const known = mockRes();
  await auth.forgotPasswordPhone(mockReq({ phone: user.phone }), known);
  assert.ok(known.body.challenge_id);
  assert.deepStrictEqual(
    Object.keys(unknown.body).sort(),
    Object.keys(known.body).sort(),
    'known and unknown numbers must produce indistinguishable response shapes'
  );
});

// Phone-OTP reset is account takeover for whoever reads one WhatsApp message, so it is an
// allow-list. 'worker' and 'design_helper' were exposed by the old deny-list.
for (const role of ['admin', 'staff', 'worker', 'design_helper']) {
  test(`[${role}] cannot reset a password by phone OTP`, async () => {
    const user = await makeUser(role);
    const res = mockRes();
    await auth.forgotPasswordPhone(mockReq({ phone: user.phone }), res);
    assert.strictEqual(res.statusCode, 200, 'must not leak that the number exists');
    assert.strictEqual(await latestCode(user.phone, 'reset'), undefined,
      `${role}: no reset OTP may be created for this role`);

    // And if a code somehow existed, the reset itself must still refuse.
    const { challenge_id } = await otp.createOtp(user.phone, 'reset', { userId: user.id });
    const row = await latestCode(user.phone, 'reset');
    const done = mockRes();
    await auth.resetPasswordPhone(
      mockReq({ challenge_id, code: row.code, password: 'attacker-chosen-pw' }), done);
    assert.strictEqual(done.statusCode, 403, `${role}: reset must be refused`);
  });
}

test('retail CAN still reset by phone OTP (the flow is not broken)', async () => {
  const user = await makeUser('retail');
  const sent = mockRes();
  await auth.forgotPasswordPhone(mockReq({ phone: user.phone }), sent);
  const row = await latestCode(user.phone, 'reset');
  assert.ok(row, 'retail must still receive a reset code');
  const done = mockRes();
  await auth.resetPasswordPhone(
    mockReq({ challenge_id: sent.body.challenge_id, code: row.code, password: 'new-good-password' }), done);
  assert.strictEqual(done.body?.reset, true);
});

test('resend refreshes in place — same id, new code, old code dead', async () => {
  const user = await makeUser('retail');
  const { challenge_id } = await otp.createOtp(user.phone, 'login', { userId: user.id });
  const first = await latestCode(user.phone, 'login');

  const res = mockRes();
  await auth.resendOtp(mockReq({ challenge_id }), res);
  assert.strictEqual(res.body.challenge_id, challenge_id,
    'the challenge id must survive a resend, or a lost response strands the client');

  const second = await latestCode(user.phone, 'login');
  assert.notStrictEqual(second.code, first.code, 'a resend must issue a new code');
  assert.strictEqual(second.challenge_id, challenge_id);

  // The superseded code must not work; the fresh one must.
  const stale = mockRes();
  await auth.loginVerifyOtp(mockReq({ challenge_id, code: first.code }), stale);
  assert.strictEqual(stale.statusCode, 400);
  const fresh = mockRes();
  await auth.loginVerifyOtp(mockReq({ challenge_id, code: second.code }), fresh);
  assert.ok(fresh.body?.token, 'the resent code must log in');
});

test('a consumed challenge cannot be revived by resending', async () => {
  const user = await makeUser('retail');
  const { challenge_id } = await otp.createOtp(user.phone, 'login', { userId: user.id });
  const row = await latestCode(user.phone, 'login');
  const login = mockRes();
  await auth.loginVerifyOtp(mockReq({ challenge_id, code: row.code }), login);
  assert.ok(login.body?.token, 'precondition: the challenge was consumed by a real login');

  const res = mockRes();
  await auth.resendOtp(mockReq({ challenge_id }), res);
  assert.strictEqual(res.statusCode, 400, 'a used challenge must not be resurrected');
});

test('an unbound (user_id NULL) code is refused WITHOUT being burned', async () => {
  // This is what the currently-deployed backend writes; in-flight users must be able to
  // retry rather than have their code destroyed by the failed attempt.
  const user = await makeUser('retail');
  const { rows } = await query(
    `INSERT INTO otp_codes (phone, code, expires_at, purpose)
     VALUES ($1, '654321', NOW() + INTERVAL '5 minutes', 'login') RETURNING challenge_id`,
    [user.phone]
  );
  const legacyChallenge = rows[0].challenge_id;
  const res = mockRes();
  await auth.loginVerifyOtp(mockReq({ challenge_id: legacyChallenge, code: '654321' }), res);
  assert.strictEqual(res.statusCode, 400);
  assert.ok(!res.body?.token, 'an unpinned code must never mint a token');

  const { rows: after } = await query(
    `SELECT used, attempts FROM otp_codes WHERE challenge_id = $1`, [legacyChallenge]);
  assert.strictEqual(after[0].used, false, 'the row must NOT be consumed by the refusal');
  assert.strictEqual(after[0].attempts, 0, 'and must not burn a guess attempt');
  await query(`DELETE FROM otp_codes WHERE challenge_id = $1`, [legacyChallenge]);
});
