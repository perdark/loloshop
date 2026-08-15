// WhatsApp sender failover — primary device + standby backup.
//
// The Zentramsg sender is a real WhatsApp device driven by automation, which Meta bans
// periodically. A second device is insurance against that ban. This suite encodes the four
// properties that make the failover safe rather than merely present:
//
//   1. ONE DEVICE SENDS EVERYTHING while it works. Not round-robin — a student who gets a
//      resend must not see a second unknown sender, which is indistinguishable from
//      phishing at the moment we ask them to trust a code. (Owner ruling, 2026-08-15.)
//   2. IT NEVER DRIFTS BACK. Once the backup takes over it keeps sending; recovering on a
//      timer would show the student two numbers anyway, just more slowly.
//   3. A DEVICE IS ONLY BLAMED WHEN ANOTHER ONE SUCCEEDS. That success is the only evidence
//      distinguishing "this device is banned" from "this recipient's number is bad" —
//      Zentramsg's error body cannot tell us that on its own.
//   4. SINGLE-DEVICE CONFIG IS UNCHANGED. Nothing differs until a backup is configured, so
//      deploying this ahead of the owner adding the env var is a no-op.
//
// Property 3 is the one that keeps a single bad phone number from taking the whole gateway
// down, so it is tested negatively: both devices fail => nothing is cooled down.
//
// No database and no network: `fetch` is stubbed and the sender seam is called directly.

const test = require('node:test');
const assert = require('node:assert');

// ORDER IS LOAD-BEARING, same as the other OTP suites: lib/db runs dotenv.config(), so
// require it FIRST and only then pull in lib/otp — otherwise the real .env credentials are
// not yet loaded/controllable and a mistake here WhatsApps real numbers.
require('../lib/db');
const otp = require('../lib/otp');

const PRIMARY = 'device-primary-uuid';
const BACKUP = 'device-backup-uuid';
const PHONE = '07712345678';
const INTL = '9647712345678';

const realFetch = global.fetch;
const realError = console.error;

// Zentramsg confirms acceptance in the JSON BODY, not the HTTP status: a banned device still
// answers 200 with success:false. Both shapes are modelled exactly.
const ACCEPTED = { ok: true, status: 200, text: async () => JSON.stringify({ success: true, msg: 'MESSAGE_CREATED' }) };
const REJECTED = { ok: true, status: 200, text: async () => JSON.stringify({ success: false, msg: 'DEVICE_NOT_FOUND' }) };

// Records which device each POST targeted, so "who sent it" is asserted rather than assumed.
function stubGateway(responder) {
  const calls = [];
  global.fetch = async (_url, opts) => {
    const device = opts.body.get('device_uuid');
    calls.push({ device, ids: opts.body.get('ids') });
    return responder(device, calls.length);
  };
  return calls;
}

function setDevices(...uuids) {
  process.env.ZENTRAMSG_API_KEY = 'test-token';
  delete process.env.ZENTRAMSG_DEVICE_UUID;
  delete process.env.ZENTRAMSG_DEVICE_UUID_2;
  delete process.env.ZENTRAMSG_DEVICE_UUID_3;
  delete process.env.ZENTRAMSG_DEVICE_UUID_4;
  if (uuids[0]) process.env.ZENTRAMSG_DEVICE_UUID = uuids[0];
  if (uuids[1]) process.env.ZENTRAMSG_DEVICE_UUID_2 = uuids[1];
  otp.__resetGatewayState();
}

test.beforeEach(() => { console.error = () => {}; });
test.afterEach(() => { global.fetch = realFetch; console.error = realError; });

test('single device configured — one POST, and it is the original device', async () => {
  setDevices(PRIMARY);
  const calls = stubGateway(() => ACCEPTED);

  const res = await otp.__sendViaZentramsg(PHONE, '123456');

  assert.strictEqual(res.success, true);
  assert.strictEqual(calls.length, 1, 'must not attempt more than the one configured device');
  assert.strictEqual(calls[0].device, PRIMARY);
  assert.strictEqual(calls[0].ids, INTL, 'local 07… must be sent as 964… international digits');
});

test('primary works — the backup is never contacted', async () => {
  setDevices(PRIMARY, BACKUP);
  const calls = stubGateway(() => ACCEPTED);

  await otp.__sendViaZentramsg(PHONE, '111111');
  await otp.__sendViaZentramsg(PHONE, '222222');
  await otp.__sendViaZentramsg(PHONE, '333333');

  assert.strictEqual(calls.length, 3);
  assert.ok(calls.every((c) => c.device === PRIMARY),
    'all three codes must come from ONE number — a resend from a second sender reads as phishing');
});

test('primary banned — backup delivers, and the primary is cooled down', async () => {
  setDevices(PRIMARY, BACKUP);
  const calls = stubGateway((device) => (device === PRIMARY ? REJECTED : ACCEPTED));

  const res = await otp.__sendViaZentramsg(PHONE, '123456');

  assert.strictEqual(res.success, true, 'the student must still receive a code');
  assert.deepStrictEqual(calls.map((c) => c.device), [PRIMARY, BACKUP]);

  const status = otp.gatewayStatus();
  const primary = status.devices.find((d) => d.device.startsWith(PRIMARY.slice(0, 6)));
  assert.strictEqual(primary.healthy, false, 'a proven-bad device must be cooled down');
  assert.ok(primary.cooled_until, 'cooldown must carry an expiry an operator can read');
});

test('after failover it STAYS on the backup — no drifting back to the primary', async () => {
  setDevices(PRIMARY, BACKUP);
  const calls = stubGateway((device) => (device === PRIMARY ? REJECTED : ACCEPTED));

  await otp.__sendViaZentramsg(PHONE, '111111'); // fails over: PRIMARY then BACKUP
  await otp.__sendViaZentramsg(PHONE, '222222');
  await otp.__sendViaZentramsg(PHONE, '333333');

  // Four POSTs in total: send 1 costs two (primary refuses, backup delivers), sends 2 and 3
  // cost one each because the backup is now the sender.
  assert.deepStrictEqual(calls.map((c) => c.device),
    [PRIMARY, BACKUP, BACKUP, BACKUP],
    'the primary is tried once — on the send that discovered the ban — and never again');
  assert.strictEqual(calls.filter((c) => c.device === PRIMARY).length, 1,
    'a known-bad device must not be retried on every subsequent send');
  assert.ok(calls.slice(1).every((c) => c.device === BACKUP),
    'every later code must come from the same number the student already saw');
  assert.ok(otp.gatewayStatus().active.startsWith(BACKUP.slice(0, 6)));
});

test('BOTH devices fail — nothing is cooled down, because the number is the likelier fault', async () => {
  setDevices(PRIMARY, BACKUP);
  const calls = stubGateway(() => REJECTED);

  const res = await otp.__sendViaZentramsg(PHONE, '123456');

  assert.strictEqual(res.success, false);
  assert.strictEqual(res.msg, 'DEVICE_NOT_FOUND', 'the original failure shape must survive');
  assert.strictEqual(calls.length, 2, 'every configured device should be tried once');

  // THE POINT: with no successful send to compare against there is no evidence any device is
  // broken. Blaming them all here would let one bad recipient disable the whole gateway.
  const status = otp.gatewayStatus();
  assert.ok(status.devices.every((d) => d.healthy),
    'an unexplained failure must not disable senders — that is how one bad number kills OTP');
});

test('a recovered-nothing case: invalid recipient never reaches any device', async () => {
  setDevices(PRIMARY, BACKUP);
  const calls = stubGateway(() => ACCEPTED);

  const res = await otp.__sendViaZentramsg('0771234', '123456'); // too short to be a real mobile

  assert.strictEqual(res.success, false);
  assert.strictEqual(calls.length, 0,
    'blasting invalid numbers is the #1 cause of a sender ban — nothing may be POSTed');
});

test('no credentials configured — fails closed without contacting anything', async () => {
  setDevices(); // no devices at all
  delete process.env.ZENTRAMSG_API_KEY;
  const calls = stubGateway(() => ACCEPTED);

  const res = await otp.__sendViaZentramsg(PHONE, '123456');

  assert.strictEqual(res.success, false);
  assert.strictEqual(calls.length, 0);
});

test('duplicate uuids in env collapse to one device', async () => {
  setDevices(PRIMARY, PRIMARY); // owner pastes the same uuid into both vars
  const calls = stubGateway(() => REJECTED);

  await otp.__sendViaZentramsg(PHONE, '123456');

  assert.strictEqual(calls.length, 1, 'the same device must not be tried twice as its own backup');
});
