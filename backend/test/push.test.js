// Unit tests for lib/push.js — the two decisions in it that are expensive to get wrong, and
// impossible to notice when you do.
//
// 1. THE ES256 SIGNATURE ENCODING. Node signs ECDSA as DER by default; JOSE requires the raw
//    r‖s pair. Get it wrong and every APNs request answers 403 InvalidProviderToken while the
//    key, the kid and the team id all look correct — there is nothing to read that says why.
//    The test verifies the produced JWT against the public key using the same encoding.
//
// 2. WHICH PROVIDER ERRORS DELETE A DEVICE. `dead: true` is the ONLY thing that removes a row
//    from device_tokens, so misclassifying a 429 or a 5xx as fatal would silently unsubscribe
//    every phone in the shop during a provider outage — and nobody would find out until the
//    next notification nobody received.
//
// No database and no network: both are pure functions over a status code and a body.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const push = require('../lib/push');
const { fcmTokenIsDead, apnsTokenIsDead, normalizePem, apnsBearer } = push._internals;

test('normalizePem turns the literal \\n of a one-line .env value into real newlines', () => {
  const pem = normalizePem('-----BEGIN KEY-----\\nabc\\n-----END KEY-----');
  assert.ok(pem.includes('\n'), 'escaped newlines must be unescaped');
  assert.strictEqual(pem.split('\n').length, 3);
  // Already-real newlines pass through untouched.
  assert.strictEqual(normalizePem('a\nb'), 'a\nb');
});

test('a device is only deleted when FCM says the token is gone', () => {
  assert.strictEqual(fcmTokenIsDead(404, {}), true, '404 UNREGISTERED — app uninstalled');
  assert.strictEqual(fcmTokenIsDead(403, {}), true, 'SENDER_ID_MISMATCH — wrong project');
  assert.strictEqual(
    fcmTokenIsDead(400, { error: { details: [{ errorCode: 'INVALID_ARGUMENT' }] } }),
    true
  );
  // ⚠️ The whole point of the function: transient failures must NOT drop a real phone.
  for (const status of [429, 500, 502, 503]) {
    assert.strictEqual(fcmTokenIsDead(status, {}), false, `${status} is transient`);
  }
  assert.strictEqual(fcmTokenIsDead(400, { error: { status: 'QUOTA_EXCEEDED' } }), false);
});

test('a device is only deleted when APNs says the token is gone', () => {
  assert.strictEqual(apnsTokenIsDead(410, 'Unregistered'), true);
  assert.strictEqual(apnsTokenIsDead(400, 'BadDeviceToken'), true);
  assert.strictEqual(apnsTokenIsDead(400, 'DeviceTokenNotForTopic'), true);
  // Our fault, not the device's — the token is fine and must survive.
  assert.strictEqual(apnsTokenIsDead(400, 'PayloadTooLarge'), false);
  assert.strictEqual(apnsTokenIsDead(403, 'InvalidProviderToken'), false);
  assert.strictEqual(apnsTokenIsDead(429, 'TooManyRequests'), false);
  assert.strictEqual(apnsTokenIsDead(500, 'InternalServerError'), false);
});

test('configured() is false with no credentials, so nothing is ever marked failed', () => {
  const saved = { ...process.env };
  for (const k of ['FCM_SERVICE_ACCOUNT_JSON', 'FCM_SERVICE_ACCOUNT_FILE', 'APNS_KEY_P8',
                   'APNS_KEY_FILE', 'APNS_KEY_ID', 'APNS_TEAM_ID', 'IOS_TEAM_ID']) {
    delete process.env[k];
  }
  push.resetForTests();
  assert.deepStrictEqual(push.configured(), { android: false, ios: false });
  assert.strictEqual(push.isConfigured(), false);
  Object.assign(process.env, saved);
  push.resetForTests();
});

test('the APNs provider JWT is a valid ES256 JOSE token (raw r‖s, NOT DER)', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const saved = { ...process.env };
  process.env.APNS_KEY_P8 = privateKey.export({ type: 'pkcs8', format: 'pem' });
  process.env.APNS_KEY_ID = 'ABCD123456';
  process.env.APNS_TEAM_ID = 'TEAM123456';
  push.resetForTests();

  const jwt = apnsBearer();
  assert.ok(jwt, 'a JWT must be produced once key + kid + team are set');
  const [header, claims, signature] = jwt.split('.');
  assert.strictEqual(jwt.split('.').length, 3);

  const decodedHeader = JSON.parse(Buffer.from(header, 'base64url').toString());
  assert.strictEqual(decodedHeader.alg, 'ES256');
  assert.strictEqual(decodedHeader.kid, 'ABCD123456');
  const decodedClaims = JSON.parse(Buffer.from(claims, 'base64url').toString());
  assert.strictEqual(decodedClaims.iss, 'TEAM123456');
  assert.ok(Number.isInteger(decodedClaims.iat));

  const sig = Buffer.from(signature, 'base64url');
  // A P-256 JOSE signature is exactly 64 bytes: r‖s, 32 each. DER would be ~70 and variable —
  // this length check alone catches the mistake this test exists for.
  assert.strictEqual(sig.length, 64, 'ES256 signature must be raw r‖s, not DER');
  assert.strictEqual(
    crypto.verify('sha256', Buffer.from(`${header}.${claims}`), {
      key: publicKey,
      dsaEncoding: 'ieee-p1363',
    }, sig),
    true,
    'Apple must be able to verify this signature'
  );

  // Cached for reuse — Apple rejects more than one provider-token refresh per 20 minutes.
  assert.strictEqual(apnsBearer(), jwt);

  for (const k of ['APNS_KEY_P8', 'APNS_KEY_ID', 'APNS_TEAM_ID']) delete process.env[k];
  Object.assign(process.env, saved);
  push.resetForTests();
});
