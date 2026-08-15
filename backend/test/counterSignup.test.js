// Signup at the shop counter — a staff member creates a student's account in person.
//
// The feature exists because ~65% of August's signups have no rep and most of those people are
// standing at the counter, each currently spending a WhatsApp OTP on a gateway device Meta
// bans periodically. This suite encodes the properties that make the OTP skip defensible
// rather than merely convenient:
//
//   1. The STAFF SESSION is the authorisation. There is no location, no header, no client-
//      supplied claim involved — the caller must already be an authenticated staff member.
//   2. WHO VOUCHED IS RECORDED, on the row and in the audit log. A named employee is the
//      entire justification, so an unattributable counter account would be a hole.
//   3. `phone_verified` STAYS FALSE. The employee verified the person, not the phone. Setting
//      it TRUE would record a proof that never happened.
//   4. THE STUDENT CAN THEN LOG IN WITHOUT AN OTP. Without this the feature only MOVES the
//      OTP from signup to first login and saves nothing — so it is tested end to end.
//
// Property 3 is the one that keeps this honest, and property 4 is the one that makes it worth
// building; both are asserted directly rather than inferred.
//
// Runs against the real database and cleans up after itself.

const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

// ORDER IS LOAD-BEARING (same as the other auth suites): lib/db runs dotenv.config(), so
// require it FIRST, strip the gateway credentials SECOND, and only then pull in the
// controllers — backwards, and a stray createOtp would really WhatsApp an invented number.
const { query } = require('../lib/db');
delete process.env.ZENTRAMSG_API_KEY;
delete process.env.ZENTRAMSG_DEVICE_UUID;
delete process.env.ZENTRAMSG_DEVICE_UUID_2;

const counter = require('../controllers/counterSignupController');
const auth = require('../controllers/authController');

const TAG = `cntr-${crypto.randomBytes(4).toString('hex')}`;
const PASSWORD = `Cntr-${crypto.randomBytes(12).toString('hex')}!9`;
const created = [];

function mockRes() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
// req.user is what an authenticated staff session leaves behind — the authorisation itself.
const staffReq = (body, actorId) => ({ body, user: { id: actorId, role: 'staff' }, get: () => 'counter-test' });

function freshPhone() {
  return '079' + String(crypto.randomInt(0, 1e8)).padStart(8, '0');
}

async function makeStaff() {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const { rows } = await query(
    `INSERT INTO users (name, phone, password_hash, role) VALUES ($1, $2, $3, 'staff') RETURNING id`,
    [`${TAG}-staff`, freshPhone(), hash]
  );
  created.push(rows[0].id);
  return rows[0].id;
}

function validBody(overrides = {}) {
  const base = {
    name: `${TAG} طالب`,
    phone: freshPhone(),
    password: PASSWORD,
    university_name: 'جامعة ديالى',
    department: 'هندسة',
    ...overrides,
  };
  // Default phone_confirm to match phone (including a caller-supplied phone override) so every
  // pre-existing test — none of which cares about the confirm field — keeps passing unchanged.
  // Tests that DO care pass phone_confirm explicitly and win over this default.
  if (base.phone_confirm === undefined) base.phone_confirm = base.phone;
  return base;
}

let STAFF_ID;
test.before(async () => { STAFF_ID = await makeStaff(); });

test.after(async () => {
  if (!created.length) return;
  await query(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [created]);
  await query(`DELETE FROM students WHERE user_id = ANY($1::uuid[])`, [created]);
  await query(`DELETE FROM users WHERE created_by_user_id = ANY($1::uuid[])`, [created]);
  await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [created]);
});

// ── 1. It creates a real, attributable, honestly-recorded account ────────────────

test('creates a usable student account and records WHO vouched', async () => {
  const body = validBody();
  const res = mockRes();
  await counter.counterSignup(staffReq(body, STAFF_ID), res);

  assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));
  const userId = res.body.data.user_id;
  created.push(userId);
  assert.ok(res.body.data.student_id);
  assert.strictEqual(res.body.data.otp_required, false);

  const { rows } = await query(
    `SELECT u.role, u.phone_verified, u.created_by_user_id, s.status, s.wholesaler_id, s.university_name
     FROM users u JOIN students s ON s.user_id = u.id WHERE u.id = $1`,
    [userId]
  );
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].role, 'retail');
  assert.strictEqual(rows[0].status, 'approved', 'no rep to wait for — same as self-registered retail');
  assert.strictEqual(rows[0].wholesaler_id, null);
  assert.strictEqual(rows[0].university_name, 'جامعة ديالى');

  // THE ATTRIBUTION: a named employee is the whole justification for skipping the OTP.
  assert.strictEqual(rows[0].created_by_user_id, STAFF_ID, 'the vouching employee must be recorded');

  // THE HONESTY: the employee verified the PERSON, not the phone.
  assert.strictEqual(rows[0].phone_verified, false,
    'phone_verified must stay FALSE — no phone ownership was ever proven');
});

test('writes an audit_log entry naming the employee', async () => {
  const body = validBody();
  const res = mockRes();
  await counter.counterSignup(staffReq(body, STAFF_ID), res);
  created.push(res.body.data.user_id);

  const { rows } = await query(
    `SELECT actor_id, action, entity FROM audit_log WHERE entity_id = $1`,
    [res.body.data.student_id]
  );
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].actor_id, STAFF_ID);
  assert.strictEqual(rows[0].action, 'counter_signup');
});

test('sends NO OTP — nothing is written to otp_codes', async () => {
  const body = validBody();
  const res = mockRes();
  await counter.counterSignup(staffReq(body, STAFF_ID), res);
  created.push(res.body.data.user_id);

  const { rows } = await query(`SELECT count(*)::int AS n FROM otp_codes WHERE phone = $1`, [body.phone]);
  assert.strictEqual(rows[0].n, 0, 'the entire point is that the counter costs no WhatsApp message');
});

// ── 2. The half that makes it worth building ────────────────────────────────────

test('the student can then LOG IN with the password alone — no OTP challenge', async () => {
  const body = validBody();
  const signupRes = mockRes();
  await counter.counterSignup(staffReq(body, STAFF_ID), signupRes);
  created.push(signupRes.body.data.user_id);

  const loginRes = mockRes();
  await auth.login({ body: { phone: body.phone, password: PASSWORD }, get: () => 'counter-test' }, loginRes);

  assert.strictEqual(loginRes.statusCode, 200, JSON.stringify(loginRes.body));
  assert.ok(loginRes.body.token, 'a counter student must get a session straight away');
  // If this ever starts returning a challenge, the feature has silently become "move the OTP
  // from signup to first login", which saves nothing and is the failure worth catching.
  assert.ok(!loginRes.body.challenge_id, 'must NOT fall through to the OTP branch');
  assert.strictEqual(loginRes.body.user.phone_verified, false);
});

// ── 3. Validation — it must not become the weak way in ──────────────────────────

test('a phone already registered is refused, and names the existing owner', async () => {
  const body = validBody();
  const first = mockRes();
  await counter.counterSignup(staffReq(body, STAFF_ID), first);
  created.push(first.body.data.user_id);

  const second = mockRes();
  await counter.counterSignup(staffReq(validBody({ phone: body.phone }), STAFF_ID), second);

  assert.strictEqual(second.statusCode, 409);
  assert.strictEqual(second.body.code, 'ERR_PHONE_TAKEN');
  assert.ok(second.body.error.includes(TAG),
    'the message must name the existing account so the person at the counter can act on it');
});

test('a weak password is refused — staff may not create a weaker account than self-signup', async () => {
  const res = mockRes();
  await counter.counterSignup(staffReq(validBody({ password: '123' }), STAFF_ID), res);
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.field, 'password');
});

test('a non-Iraqi-mobile phone is refused', async () => {
  const res = mockRes();
  await counter.counterSignup(staffReq(validBody({ phone: '0771234' }), STAFF_ID), res);
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.code, 'ERR_INVALID_PHONE');
});

test('university and department are required — a sash cannot be made without them', async () => {
  for (const missing of ['university_name', 'department']) {
    const res = mockRes();
    await counter.counterSignup(staffReq(validBody({ [missing]: '' }), STAFF_ID), res);
    assert.strictEqual(res.statusCode, 400, `${missing} must be required`);
    assert.strictEqual(res.body.field, missing);
  }
});

test('an invalid gender or study_type is refused rather than coerced', async () => {
  for (const [field, value] of [['gender', 'other'], ['study_type', 'weekend']]) {
    const res = mockRes();
    await counter.counterSignup(staffReq(validBody({ [field]: value }), STAFF_ID), res);
    assert.strictEqual(res.statusCode, 400, `${field} must be validated`);
    assert.strictEqual(res.body.field, field);
  }
});

// ── 4. Phone double-entry — the account-takeover guard ──────────────────────────
//
// A typo'd phone here silently creates the account on a stranger's number, and
// `forgot-password-phone` later sends the reset OTP — the SOLE reset credential — to
// whoever owns it. OTP registration cannot produce this (a mistyped number never receives
// a code); counter signup skips the OTP entirely, so this is its only guard.

test('missing phone_confirm is refused', async () => {
  const body = validBody();
  delete body.phone_confirm;
  const res = mockRes();
  await counter.counterSignup(staffReq(body, STAFF_ID), res);
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.code, 'ERR_PHONE_MISMATCH');
  assert.strictEqual(res.body.field, 'phone_confirm');
});

test('a mismatched phone_confirm is refused', async () => {
  const body = validBody({ phone_confirm: freshPhone() });
  const res = mockRes();
  await counter.counterSignup(staffReq(body, STAFF_ID), res);
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.code, 'ERR_PHONE_MISMATCH');
  assert.strictEqual(res.body.field, 'phone_confirm');
});

test('phone_confirm typed without the leading zero still matches (same canonicalisation as phone)', async () => {
  const phone = freshPhone(); // canonical 07XXXXXXXXX
  const body = validBody({ phone, phone_confirm: phone.slice(1) }); // '7XXXXXXXXX'
  const res = mockRes();
  await counter.counterSignup(staffReq(body, STAFF_ID), res);
  assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));
  created.push(res.body.data.user_id);
});
