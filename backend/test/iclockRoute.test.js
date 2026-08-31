'use strict';
// The device-facing endpoint, driven over real HTTP the way the K40 will drive it.
//
// This is the only test that proves the whole chain — wire format → parse → ingest → derive →
// staff_attendance_records — actually connects. The pieces each have their own unit tests;
// what those cannot catch is a router that never reaches them, which is exactly the failure
// a fixed-in-firmware path invites.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const { query } = require('../lib/db');

const TAG = `ZZTEST-iclock-${crypto.randomUUID().slice(0, 8)}`;
const SN = `ZZTESTSN${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
const PIN = 60000 + Math.floor(Math.random() * 5000);
const ctx = { userId: null, server: null, base: '', otherPins: [] };

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${ctx.base}${path}`,
      { method, headers: { 'Content-Type': 'text/plain' } },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

test.before(async () => {
  const app = express();
  app.set('trust proxy', 'loopback');
  // Mounted EXACTLY as server.js does — a test that mounts it differently proves nothing
  // about the app.
  app.use('/iclock', require('../routes/iclock'));
  app.use(express.json());
  app.post('/api/canary', (req, res) => res.json({ kind: typeof req.body }));
  ctx.server = http.createServer(app);
  await new Promise((r) => ctx.server.listen(0, '127.0.0.1', r));
  ctx.base = `http://127.0.0.1:${ctx.server.address().port}`;

  const u = await query(
    `INSERT INTO users (name, phone, password_hash, role)
     VALUES ($1, $2, 'x', 'staff') RETURNING id`,
    [`${TAG} عامل`, `0779${Math.floor(1000000 + Math.random() * 8999999)}`]
  );
  ctx.userId = u.rows[0].id;
  await query(`INSERT INTO staff_device_pins (user_id, pin) VALUES ($1, $2)`, [ctx.userId, PIN]);
  await query(
    `INSERT INTO attendance_devices (serial_number, label_ar) VALUES ($1, $2)`,
    [SN, `${TAG} جهاز`]
  );
});

test.after(async () => {
  // Put every OTHER pin's push_state back exactly as it was. The self-healing push is
  // shop-wide by design, so simply polling this test's device moves real rows — leaving them
  // changed would hand the next reader a dev DB that disagrees with production for no reason.
  for (const row of ctx.otherPins) {
    await query(`UPDATE staff_device_pins SET push_state = $2 WHERE pin = $1`, [
      row.pin,
      row.push_state,
    ]);
  }
  await query(`DELETE FROM punch_raw WHERE device_sn = $1`, [SN]);
  await query(`DELETE FROM punch_reject WHERE device_sn = $1`, [SN]);
  await query(`DELETE FROM device_commands WHERE device_sn = $1`, [SN]);
  await query(`DELETE FROM attendance_devices WHERE serial_number = $1`, [SN]);
  if (ctx.userId) {
    await query(`DELETE FROM staff_attendance_records WHERE user_id = $1`, [ctx.userId]);
    await query(`DELETE FROM staff_device_pins WHERE user_id = $1`, [ctx.userId]);
    await query(`DELETE FROM users WHERE id = $1`, [ctx.userId]);
  }
  await new Promise((r) => ctx.server.close(r));
});

test('the handshake names the device back to itself', async () => {
  const res = await request('GET', `/iclock/cdata?SN=${SN}&options=all`);
  assert.equal(res.status, 200);
  assert.match(res.body, new RegExp(`GET OPTION FROM: ${SN}`));
  // Without Realtime the device batches on an interval and a punch can sit for an hour.
  assert.match(res.body, /Realtime=1/);
});

test('an ATTLOG upload becomes an attendance record, filed on the ARRIVAL date', async () => {
  // ⚠️ The device timestamp here is deliberately a date in the past, and the record must NOT
  // land on it: since 2026-08-30 the server clock stamps the punch (see ingestPunches). This
  // line used to assert '2026-08-20' — the device's own reading — and flipping it is the
  // whole behaviour change, not a test fix.
  const ts = '2026-08-20 09:40:00';
  const todayBaghdad = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const res = await request('POST', `/iclock/cdata?SN=${SN}&table=ATTLOG`,
    `${PIN}\t${ts}\t0\t1\t0\t0\n`);
  assert.equal(res.status, 200);
  assert.equal(res.body, 'OK: 1');

  // ⚠️ work_date is read back as TEXT on purpose. node-postgres hands a DATE back as a JS
  // Date at LOCAL midnight, so on this UTC+3 machine `.toISOString()` reports the day
  // before — a test that "fails" for a reason that has nothing to do with attendance.
  const rec = await query(
    `SELECT to_char(work_date, 'YYYY-MM-DD') AS work_date, check_in_at
       FROM staff_attendance_records WHERE user_id = $1`,
    [ctx.userId]
  );
  assert.equal(rec.rows.length, 1);
  assert.equal(rec.rows[0].work_date, todayBaghdad);
});

test('the same batch again stores nothing — the device resends its whole buffer', async () => {
  const res = await request('POST', `/iclock/cdata?SN=${SN}&table=ATTLOG`,
    `${PIN}\t2026-08-20 09:40:00\t0\t1\t0\t0\n`);
  assert.equal(res.body, 'OK: 0');
  const n = await query(`SELECT COUNT(*)::int AS c FROM punch_raw WHERE device_sn = $1`, [SN]);
  assert.equal(n.rows[0].c, 1);
});

test('one malformed line is quarantined and the good ones still land', async () => {
  const body = `${PIN}\t2026-08-21 09:05:00\t0\nGARBAGE LINE\n${PIN}\t2026-08-21 20:00:00\t1\n`;
  const res = await request('POST', `/iclock/cdata?SN=${SN}&table=ATTLOG`, body);
  assert.equal(res.body, 'OK: 2');
  const rej = await query(
    `SELECT raw_line FROM punch_reject WHERE device_sn = $1 ORDER BY id DESC LIMIT 1`, [SN]
  );
  assert.equal(rej.rows[0].raw_line, 'GARBAGE LINE');
});

test('an unregistered serial gets 200 and stores nothing — a 4xx would make it retry forever', async () => {
  const res = await request('POST', `/iclock/cdata?SN=NOPE${SN}&table=ATTLOG`,
    `${PIN}\t2026-08-22 09:00:00\t0\n`);
  assert.equal(res.status, 200);
  const n = await query(`SELECT COUNT(*)::int AS c FROM punch_raw WHERE device_sn = $1`,
    [`NOPE${SN}`]);
  assert.equal(n.rows[0].c, 0);
});

test('a non-ATTLOG table is acknowledged but stores nothing', async () => {
  const before = await query(`SELECT COUNT(*)::int AS c FROM punch_raw WHERE device_sn = $1`, [SN]);
  const res = await request('POST', `/iclock/cdata?SN=${SN}&table=OPERLOG`, 'whatever\n');
  assert.equal(res.body, 'OK');
  const after = await query(`SELECT COUNT(*)::int AS c FROM punch_raw WHERE device_sn = $1`, [SN]);
  assert.equal(after.rows[0].c, before.rows[0].c);
});

test('a queued command is handed out once, then reported done', async () => {
  const q = await query(
    `INSERT INTO device_commands (device_sn, body) VALUES ($1, $2) RETURNING id`,
    [SN, 'DATA UPDATE USERINFO PIN=1\tName=تجربة']
  );
  const id = q.rows[0].id;

  const first = await request('GET', `/iclock/getrequest?SN=${SN}`);
  assert.match(first.body, new RegExp(`^C:${id}:DATA UPDATE USERINFO`));

  // Handing the SAME command out twice means its result can never be matched to it.
  // ⚠️ This used to assert a bare 'OK'. It cannot any more, and that is the point of the
  // self-healing push: an empty queue is now the moment the device is handed a name it does
  // not have yet (the fixture's PIN is 'pending' and has no command). What must still hold —
  // and is the thing this test was always really about — is that `id` is not re-issued.
  const second = await request('GET', `/iclock/getrequest?SN=${SN}`);
  assert.ok(
    !second.body.startsWith(`C:${id}:`),
    `command ${id} was handed out twice: ${second.body}`
  );

  await request('POST', `/iclock/devicecmd?SN=${SN}`, `ID=${id}&Return=0&CMD=DATA`);
  const done = await query(`SELECT state FROM device_commands WHERE id = $1`, [id]);
  assert.equal(done.rows[0].state, 'done');
});

test('a command the device rejected is marked failed, not done', async () => {
  const q = await query(
    `INSERT INTO device_commands (device_sn, body) VALUES ($1, 'DATA DELETE USERINFO PIN=9')
     RETURNING id`, [SN]
  );
  const id = q.rows[0].id;
  await request('GET', `/iclock/getrequest?SN=${SN}`);
  await request('POST', `/iclock/devicecmd?SN=${SN}`, `ID=${id}&Return=-1&CMD=DATA`);
  const row = await query(`SELECT state, result_code FROM device_commands WHERE id = $1`, [id]);
  assert.equal(row.rows[0].state, 'failed');
  assert.equal(row.rows[0].result_code, '-1');
});

test('the device router does not eat the rest of the app\'s JSON bodies', async () => {
  // The regression this exists for: mounted at the root, this router's express.text({type:'*/*'})
  // consumed every request body in the shop, so req.body arrived as a STRING on every POST —
  // login, checkout, orders, all of it. Scoping the mount to '/iclock' is the fix; this is the
  // proof, and it belongs here because no unit test of a controller can see it.
  const res = await new Promise((resolve, reject) => {
    const req = http.request(`${ctx.base}/api/canary`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (r) => { let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => resolve(d)); });
    req.on('error', reject);
    req.write(JSON.stringify({ hello: 'world' }));
    req.end();
  });
  assert.equal(JSON.parse(res).kind, 'object');
});

// ─── The self-healing name push (2026-08-31) ─────────────────────────────────────────────
// Seven PINs were mapped before the device's serial was registered, so `linkPin`'s
// INSERT … SELECT matched zero devices and queued nothing — silently. The mappings were right,
// `device_commands` was empty, and every finger showed a bare number on the device. The
// recovery must not be a button: this admin watches the screen, he does not operate it.
//
// ⚠️ These tests PARK every other pin at 'confirmed' first. Not tidiness — the push is
// deliberately shop-wide and ordered by pin, so on the dev DB (which carries the real shop's
// pins 1..10) a poll hands over برزان's name long before this fixture's 64315, and the test
// would be asserting against whichever rows happen to exist. `ctx.otherPins` restores them.
test('park the shop\'s own pins so the fixture is the only candidate', async () => {
  const { rows } = await query(
    `SELECT pin, push_state FROM staff_device_pins WHERE pin <> $1`, [PIN]
  );
  ctx.otherPins = rows;
  await query(`UPDATE staff_device_pins SET push_state = 'confirmed' WHERE pin <> $1`, [PIN]);
  assert.ok(true);
});

test('a name that never reached the device is queued on the next poll, with no admin action', async () => {
  // Exactly the broken shape: the pin is mapped and 'pending', nothing is queued for it.
  await query(`DELETE FROM device_commands WHERE device_sn = $1`, [SN]);
  await query(`UPDATE staff_device_pins SET push_state = 'pending' WHERE pin = $1`, [PIN]);

  const res = await request('GET', `/iclock/getrequest?SN=${SN}`);
  assert.match(
    res.body,
    new RegExp(`^C:\\d+:DATA UPDATE USERINFO PIN=${PIN}\\t`),
    `expected the missing name to be handed over, got: ${res.body}`
  );

  const st = await query(`SELECT push_state FROM staff_device_pins WHERE pin = $1`, [PIN]);
  assert.equal(st.rows[0].push_state, 'sent', 'the screen must stop saying «بانتظار الإرسال»');
});

test('the same name is not re-queued while one is already in flight', async () => {
  // Without the NOT EXISTS guard every poll would stack another copy of the same name, and a
  // device polling every few seconds would build an unbounded queue of duplicates.
  const count = async () =>
    (await query(
      `SELECT COUNT(*)::int AS c FROM device_commands WHERE device_sn = $1 AND pin = $2`,
      [SN, PIN]
    )).rows[0].c;
  const before = await count();
  await request('GET', `/iclock/getrequest?SN=${SN}`);
  await request('GET', `/iclock/getrequest?SN=${SN}`);
  assert.equal(await count(), before, 'a second copy of the name was queued');
});

test('the device acknowledging the name is what turns the badge green', async () => {
  const cmd = await query(
    `SELECT id FROM device_commands WHERE device_sn = $1 AND pin = $2 ORDER BY id DESC LIMIT 1`,
    [SN, PIN]
  );
  await request('POST', `/iclock/devicecmd?SN=${SN}`, `ID=${cmd.rows[0].id}&Return=0&CMD=DATA`);
  const st = await query(
    `SELECT push_state, enrolled_at FROM staff_device_pins WHERE pin = $1`, [PIN]
  );
  assert.equal(st.rows[0].push_state, 'confirmed');
  assert.ok(st.rows[0].enrolled_at, 'confirming should stamp when the name landed');
});

test('a confirmed name is never handed over again', async () => {
  // The other half of the loop guard: 'confirmed' is a resting state, so a device that has the
  // name is not handed it on every poll for the rest of its life.
  const res = await request('GET', `/iclock/getrequest?SN=${SN}`);
  assert.equal(res.body, 'OK');
});

test('a name lost mid-poll is re-offered once it goes stale — healing must repeat', async () => {
  // The failure this guards is the ordinary one for this device: it is marked 'sent' the
  // instant we hand the command over, so a unit that drops before acknowledging (the whole
  // 08-29 → 08-30 outage) leaves the command at 'sent' forever. Without the staleness window
  // that corpse blocks the pin for the rest of time and the name is never offered again.
  await query(`DELETE FROM device_commands WHERE device_sn = $1`, [SN]);
  await query(`UPDATE staff_device_pins SET push_state = 'pending' WHERE pin = $1`, [PIN]);

  const handed = await request('GET', `/iclock/getrequest?SN=${SN}`);
  assert.match(handed.body, new RegExp(`^C:\\d+:DATA UPDATE USERINFO PIN=${PIN}\\t`));
  // …and the device vanishes without ever POSTing /devicecmd. Nothing acknowledges it.
  const stuck = await request('GET', `/iclock/getrequest?SN=${SN}`);
  assert.equal(stuck.body, 'OK', 'still in flight — must not be re-sent immediately');

  // Age the in-flight command past the window, exactly as wall-clock would.
  await query(
    `UPDATE device_commands SET sent_at = NOW() - INTERVAL '30 minutes'
      WHERE device_sn = $1 AND pin = $2`,
    [SN, PIN]
  );
  const again = await request('GET', `/iclock/getrequest?SN=${SN}`);
  assert.match(
    again.body,
    new RegExp(`^C:\\d+:DATA UPDATE USERINFO PIN=${PIN}\\t`),
    `a name lost in flight was never re-offered, got: ${again.body}`
  );
});

test('a name the device REFUSED is left failed, never retried in a loop', async () => {
  // The guard that keeps a bad name from being handed over on every poll forever — which would
  // look like a queue that never drains and would hide the failure from the only person
  // watching. 'failed' is a resting state a human can see.
  await query(`DELETE FROM device_commands WHERE device_sn = $1`, [SN]);
  await query(`UPDATE staff_device_pins SET push_state = 'pending' WHERE pin = $1`, [PIN]);
  await request('GET', `/iclock/getrequest?SN=${SN}`);
  const cmd = await query(
    `SELECT id FROM device_commands WHERE device_sn = $1 AND pin = $2 ORDER BY id DESC LIMIT 1`,
    [SN, PIN]
  );
  await request('POST', `/iclock/devicecmd?SN=${SN}`, `ID=${cmd.rows[0].id}&Return=-1&CMD=DATA`);
  const failed = await query(`SELECT push_state FROM staff_device_pins WHERE pin = $1`, [PIN]);
  assert.equal(failed.rows[0].push_state, 'failed');

  const res = await request('GET', `/iclock/getrequest?SN=${SN}`);
  assert.equal(res.body, 'OK', 'a failed name must not be re-offered on the next poll');
});
