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
const ctx = { userId: null, server: null, base: '' };

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

  // Handing the same command out twice means its result can never be matched to it.
  const second = await request('GET', `/iclock/getrequest?SN=${SN}`);
  assert.equal(second.body, 'OK');

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
