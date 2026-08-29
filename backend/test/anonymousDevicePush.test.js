// Anonymous device push — migration 095 (2026-08-29).
//
// The change under test: a phone can be a push recipient with no account behind it. Everything
// covered here is a decision that fails SILENTLY — the failure mode is always "the message went
// to the wrong number of phones, and nothing said so".
//
//   · The two consent columns are separate and both default closed. Getting this wrong is not a
//     bug report, it is an App Review rejection: promotional push to someone who never opted in.
//   · The two audience halves are DISJOINT. `user_id IS NULL` is the only thing keeping a
//     handset that signed in from being counted — and pushed — twice.
//   · Registering promotes an anonymous row to an owned one instead of making a second row.
//   · Consent can only ever be RAISED by a registration, never lowered, or every app launch
//     would quietly undo the student's opt-out.
//   · The device queue drains by DEVICE, not by person, and skips a row whose handset has since
//     signed in (its owner is reached through the user queue instead).

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const { query } = require('../lib/db');
const broadcast = require('../lib/pushBroadcast');
const controller = require('../controllers/notificationController');

// ── helpers ────────────────────────────────────────────────────────────────────────────────

const made = { devices: [], users: [], deviceNotifications: [] };

function tokenOf(tag) {
  return `test-anon-${tag}-${crypto.randomUUID()}`;
}

/** A minimal express-shaped res that records what the controller answered. */
function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
}

async function makeUser(role = 'retail') {
  const { rows } = await query(
    `INSERT INTO users (name, phone, password_hash, role)
     VALUES ($1, $2, 'x', $3) RETURNING id`,
    [`اختبار ${crypto.randomUUID().slice(0, 6)}`, `0770${Date.now() % 10000000}`.slice(0, 11), role]
  );
  made.users.push(rows[0].id);
  return rows[0].id;
}

test.after(async () => {
  if (made.devices.length) {
    await query(`DELETE FROM device_tokens WHERE token = ANY($1::text[])`, [made.devices]);
  }
  if (made.users.length) {
    await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [made.users]);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════════════════════

test('an unauthenticated register stores the token with NO owner', async () => {
  const token = tokenOf('plain');
  made.devices.push(token);

  const res = fakeRes();
  await controller.registerDevice(
    { body: { token, platform: 'android' }, user: undefined },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.anonymous, true);
  const { rows } = await query(
    `SELECT user_id, marketing_opt_in FROM device_tokens WHERE token = $1`,
    [token]
  );
  assert.equal(rows.length, 1, 'the row must exist — this is the token that used to be discarded');
  assert.equal(rows[0].user_id, null);
  // ⚠️ Consent is NEVER implied by registration. A phone that granted the OS permission has not
  // agreed to offers; only the consent card can do that.
  assert.equal(rows[0].marketing_opt_in, false);
});

test('signing in PROMOTES the anonymous row instead of making a second one', async () => {
  const token = tokenOf('promote');
  made.devices.push(token);
  const userId = await makeUser();

  await controller.registerDevice({ body: { token, platform: 'ios' }, user: undefined }, fakeRes());
  await controller.registerDevice(
    { body: { token, platform: 'ios' }, user: { id: userId } },
    fakeRes()
  );

  const { rows } = await query(`SELECT user_id FROM device_tokens WHERE token = $1`, [token]);
  assert.equal(rows.length, 1, 'one handset is one row — a duplicate would push twice');
  assert.equal(rows[0].user_id, userId);
});

test('a registration can RAISE consent but never lower it', async () => {
  const token = tokenOf('consent');
  made.devices.push(token);

  await controller.registerDevice(
    { body: { token, platform: 'android', marketing_opt_in: true }, user: undefined },
    fakeRes()
  );
  let { rows } = await query(`SELECT marketing_opt_in FROM device_tokens WHERE token = $1`, [token]);
  assert.equal(rows[0].marketing_opt_in, true);

  // The next launch registers again and says nothing about consent. If that silently cleared
  // the flag, the shop would lose every opt-in the moment the app restarted.
  await controller.registerDevice({ body: { token, platform: 'android' }, user: undefined }, fakeRes());
  ({ rows } = await query(`SELECT marketing_opt_in FROM device_tokens WHERE token = $1`, [token]));
  assert.equal(rows[0].marketing_opt_in, true, 'an omitted flag must not revoke consent');
});

test('the device opt-out is what actually lowers consent, and it is scoped to the token', async () => {
  const token = tokenOf('optout');
  made.devices.push(token);
  await controller.registerDevice(
    { body: { token, platform: 'android', marketing_opt_in: true }, user: undefined },
    fakeRes()
  );

  const res = fakeRes();
  await controller.deviceMarketing({ body: { token, marketing: false }, user: undefined }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.marketing, false);

  const { rows } = await query(`SELECT marketing_opt_in FROM device_tokens WHERE token = $1`, [token]);
  assert.equal(rows[0].marketing_opt_in, false);
});

test('a signed-in caller cannot move another account\'s device', async () => {
  const token = tokenOf('foreign');
  made.devices.push(token);
  const owner = await makeUser();
  const stranger = await makeUser();

  await controller.registerDevice(
    { body: { token, platform: 'ios', marketing_opt_in: true }, user: { id: owner } },
    fakeRes()
  );

  const res = fakeRes();
  await controller.deviceMarketing(
    { body: { token, marketing: false }, user: { id: stranger } },
    res
  );
  assert.equal(res.statusCode, 404, 'someone else\'s handset is not theirs to change');

  const { rows } = await query(`SELECT marketing_opt_in FROM device_tokens WHERE token = $1`, [token]);
  assert.equal(rows[0].marketing_opt_in, true, 'and nothing moved');
});

test('an anonymous unregister only removes an anonymous row', async () => {
  const anon = tokenOf('unreg-anon');
  const owned = tokenOf('unreg-owned');
  made.devices.push(anon, owned);
  const userId = await makeUser();

  await controller.registerDevice({ body: { token: anon, platform: 'android' }, user: undefined }, fakeRes());
  await controller.registerDevice(
    { body: { token: owned, platform: 'android' }, user: { id: userId } },
    fakeRes()
  );

  // ⚠️ The SQL trap this pins: `user_id = $2` with a NULL $2 is never true, so without the
  // explicit IS NULL branch a signed-out logout deletes nothing and the handset keeps buzzing.
  const res = fakeRes();
  await controller.unregisterDevice({ body: { token: anon }, user: undefined }, res);
  assert.equal(res.body.data.removed, 1);

  const owns = fakeRes();
  await controller.unregisterDevice({ body: { token: owned }, user: undefined }, owns);
  assert.equal(owns.body.data.removed, 0, 'an owned device is not an anonymous one');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// THE AUDIENCE
// ═══════════════════════════════════════════════════════════════════════════════════════════

test('anonDeviceSql gates on the DEVICE column, and only for a marketing send', () => {
  const plain = broadcast.anonDeviceSql();
  const promo = broadcast.anonDeviceSql({ marketing: true });

  assert.match(plain, /user_id IS NULL/);
  assert.doesNotMatch(plain, /marketing_opt_in/);
  assert.match(promo, /marketing_opt_in = TRUE/);
  // ⚠️ It must NOT reach for the user column. That one belongs to a person; these rows have
  // none, and `notification_prefs` would be NULL for every one of them — silently emptying the
  // audience this whole feature exists to reach.
  assert.doesNotMatch(promo, /notification_prefs/);
});

test('«كل الأجهزة» counts owned people and unowned handsets separately', async () => {
  const anon = tokenOf('aud-anon');
  made.devices.push(anon);
  await controller.registerDevice(
    { body: { token: anon, platform: 'android', marketing_opt_in: true }, user: undefined },
    fakeRes()
  );

  const all = await broadcast.resolveAudience({ kind: 'all' });
  const devices = await broadcast.resolveAudience({ kind: 'devices' });

  assert.equal(all.ok && devices.ok, true);
  // The user half is identical — «كل الأجهزة» adds handsets, it does not change who the people
  // are. A drift here would mean one of the two audiences silently lost accounts.
  assert.equal(devices.people, all.people);
  assert.equal(all.anonDevices, 0, 'every other audience reports zero unowned handsets');
  assert.ok(devices.anonDevices >= 1, 'and this one sees the anonymous phone');
});

test('a MARKETING «كل الأجهزة» excludes a handset that never consented', async () => {
  const quiet = tokenOf('aud-quiet');
  made.devices.push(quiet);
  await controller.registerDevice(
    { body: { token: quiet, platform: 'ios' }, user: undefined },
    fakeRes()
  );

  const plain = await broadcast.resolveAudience({ kind: 'devices' });
  const promo = await broadcast.resolveAudience({ kind: 'devices' }, { marketing: true });

  assert.ok(
    promo.anonDevices < plain.anonDevices,
    'a phone with no consent must not be in a promotional audience — this is Apple 4.5.4'
  );
});

test('a signed-in handset leaves the anonymous half — the two never overlap', async () => {
  const token = tokenOf('disjoint');
  made.devices.push(token);
  const userId = await makeUser();

  await controller.registerDevice({ body: { token, platform: 'android' }, user: undefined }, fakeRes());
  const before = await broadcast.resolveAudience({ kind: 'devices' });

  await controller.registerDevice(
    { body: { token, platform: 'android' }, user: { id: userId } },
    fakeRes()
  );
  const after = await broadcast.resolveAudience({ kind: 'devices' });

  assert.equal(
    after.anonDevices,
    before.anonDevices - 1,
    'once it has an owner it is counted through the user half, never both'
  );
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// THE CONFIRM GUARD
// ═══════════════════════════════════════════════════════════════════════════════════════════

test('«كل الأجهزة» demands people + handsets typed back, not just people', async () => {
  const anon = tokenOf('confirm');
  made.devices.push(anon);
  await controller.registerDevice(
    { body: { token: anon, platform: 'android' }, user: undefined },
    fakeRes()
  );

  const resolved = await broadcast.resolveAudience({ kind: 'devices' });
  assert.ok(resolved.anonDevices >= 1);

  // The old number — people alone — must be refused, or the sender vouches for a smaller
  // audience than the one that will actually buzz.
  const short = await broadcast.send({
    audience: { kind: 'devices' },
    titleAr: 'اختبار',
    confirmedCount: resolved.people,
  });
  assert.equal(short.ok, false);
  assert.equal(short.code, 'ERR_CONFIRM_COUNT');
  assert.match(short.error, new RegExp(String(resolved.people + resolved.anonDevices)));
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// THE DRAIN
//
// ⚠️ The provider is stubbed, not called. These tests are about the CLAIM and the SKIP rules —
// which rows are picked up, which are passed over, and what state they end in. Whether APNs
// accepts a payload is lib/push.js's problem and test/push.test.js's.
// ═══════════════════════════════════════════════════════════════════════════════════════════

const push = require('../lib/push');
const outbox = require('../lib/pushOutbox');

/** Swap the provider for a recorder, and give the caller its calls back. */
async function withStubbedProvider(run) {
  const realConfigured = push.configured;
  const realSend = push.sendToDevice;
  const calls = [];
  push.configured = () => ({ android: true, ios: true });
  push.sendToDevice = async (device, message) => {
    calls.push({ token: device.token, title: message.title });
    return { ok: true };
  };
  try {
    return await run(calls);
  } finally {
    push.configured = realConfigured;
    push.sendToDevice = realSend;
  }
}

/** Queue one message straight at a device row, the way a «كل الأجهزة» broadcast does. */
async function queueForDevice(token, title) {
  const { rows } = await query(
    `INSERT INTO device_notifications (device_id, type, title_ar)
     SELECT id, 'admin_marketing', $2 FROM device_tokens WHERE token = $1
     RETURNING id`,
    [token, title]
  );
  return rows[0].id;
}

test('the device pass sends one push per QUEUED ROW, by handset', async () => {
  const token = tokenOf('drain');
  made.devices.push(token);
  await controller.registerDevice(
    { body: { token, platform: 'android', marketing_opt_in: true }, user: undefined },
    fakeRes()
  );
  const rowId = await queueForDevice(token, 'عرض جديد');

  await withStubbedProvider(async (calls) => {
    await outbox.drainDevicesOnce();
    assert.ok(
      calls.some((c) => c.token === token && c.title === 'عرض جديد'),
      'the anonymous handset must actually be sent to — this is the whole feature'
    );
  });

  const { rows } = await query(`SELECT push_state FROM device_notifications WHERE id = $1`, [rowId]);
  assert.equal(rows[0].push_state, 'sent');
});

test('a queued row whose handset has since SIGNED IN is skipped, never double-sent', async () => {
  const token = tokenOf('drain-promoted');
  made.devices.push(token);
  await controller.registerDevice({ body: { token, platform: 'ios' }, user: undefined }, fakeRes());
  const rowId = await queueForDevice(token, 'عرض قديم');

  // Between the queue write and the drain, the student signs in on this phone. Their account is
  // now in the USER half of the audience, so sending this row as well would buzz them twice.
  const userId = await makeUser();
  await controller.registerDevice(
    { body: { token, platform: 'ios' }, user: { id: userId } },
    fakeRes()
  );

  await withStubbedProvider(async (calls) => {
    await outbox.drainDevicesOnce();
    assert.equal(
      calls.some((c) => c.token === token),
      false,
      'the join requires user_id IS NULL — an owned handset is the user queue\'s job'
    );
  });

  const { rows } = await query(`SELECT push_state FROM device_notifications WHERE id = $1`, [rowId]);
  // 'skipped', not 'failed': nothing refused it, there was simply nothing left to send to.
  assert.equal(rows[0].push_state, 'skipped');
});
