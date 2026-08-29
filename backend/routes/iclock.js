'use strict';
// ─── The device-facing endpoint (ZKTeco ADMS / Push SDK) ─────────────────────────────────
//
// The K40 dials OUT to us. That is the whole reason this exists instead of a bridge process
// on a PC at the shop: no port forward on the shop router, no static IP, no always-on
// machine. The paths below are fixed in firmware — we do not get to choose them, which is
// why this router mounts at the ROOT of the app and not under /api.
//
// ⚠️ MOUNTED BEFORE express.json() AND ON THE '/iclock' PATH (server.js). Both matter, for
// opposite reasons. Before, because these bodies are tab-separated text/plain and mounting
// after would work today only because express.json ignores a non-JSON content-type — it would
// break silently the day a firmware sends application/json. On the PATH, because this router
// installs express.text({type:'*/*'}), and a root mount runs that for every request in the
// app: it swallows every JSON body and req.body arrives as a STRING on every POST the shop
// makes. That shipped once and is what iclockRoute.test.js's last test now guards.
//
// ⚠️ AN UNKNOWN SERIAL GETS 200 WITH AN EMPTY BODY, NEVER 403. Some firmware retries a 4xx
// forever with no backoff, so one mistyped serial becomes a self-inflicted flood against our
// own API. We drop it server-side and log it instead. This looks like a missing guard and is
// the opposite of one.
//
// ⚠️ THERE IS NO AUTHENTICATION IN THIS PROTOCOL. There is no token to check — ADMS has no
// such concept. What bounds it: the serial allowlist, the rate limiter below, and the fact
// that a forged punch can at worst create a stamp an admin can see and void. It cannot read
// anything, and it cannot move money: lateness is displayed, never posted to
// staff_salary_transactions (see the two-ledgers rule in HANDOFF.md).
const express = require('express');
const rateLimit = require('express-rate-limit');
const { query, tx } = require('../lib/db');
const { parseAttlog, handshakeBody } = require('../lib/iclockProtocol');
const { ingestPunches } = require('../lib/attendanceDevice');

const router = express.Router();

// Tab-separated plain text, and some firmware sends no Content-Type at all — so this cannot
// key off the header. Scoped to this router; never mount it globally.
router.use(express.text({ type: '*/*', limit: '2mb' }));

// A device on a 10s realtime poll is ~360 requests/hour on getrequest alone, and a buffer
// dump after an outage arrives as a burst. Generous on purpose: throttling the device loses
// punches, and losing punches is the one failure this whole feature exists to prevent.
router.use(
  rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
    // A 429 body would be parsed by the device as command output. Keep it empty.
    handler: (req, res) => res.status(429).type('text/plain').send(''),
  })
);

function cleanIp(req) {
  const raw = String(req.ip || req.socket?.remoteAddress || '').split(',')[0].trim();
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

/** The registered, active device for this request — or null, which means "drop it quietly". */
async function device(req) {
  const sn = String(req.query.SN || req.query.sn || '').trim();
  if (!sn) return null;
  const { rows } = await query(
    `SELECT serial_number FROM attendance_devices WHERE serial_number = $1 AND active`,
    [sn]
  );
  if (!rows.length) {
    console.warn(`[iclock] punch from unregistered serial ${JSON.stringify(sn)} @ ${cleanIp(req)}`);
    return null;
  }
  await query(`UPDATE attendance_devices SET last_seen_at = NOW(), last_ip = $2 WHERE serial_number = $1`,
    [sn, cleanIp(req)]);
  return rows[0].serial_number;
}

const text = (res, body) => res.status(200).type('text/plain').send(body);

// ─── Handshake ───────────────────────────────────────────────────────────────────────────
// The device asks for its operating config on boot and will not upload anything until it
// gets one.
router.get('/cdata', async (req, res) => {
  const sn = await device(req);
  if (!sn) return text(res, '');
  return text(res, handshakeBody(sn));
});

// ─── The punches ─────────────────────────────────────────────────────────────────────────
router.post('/cdata', async (req, res) => {
  const sn = await device(req);
  if (!sn) return text(res, 'OK');

  const table = String(req.query.table || '').toUpperCase();
  if (table && table !== 'ATTLOG') {
    // OPERLOG (door/menu events) and USERINFO echoes are not attendance. Acknowledge them
    // or the device retries the same batch forever, but store nothing.
    return text(res, 'OK');
  }

  const { punches, rejects } = parseAttlog(req.body || '');
  const counts = await tx((client) => ingestPunches(client, sn, punches, rejects));
  console.log(
    `[iclock] ${sn} stored=${counts.stored} dupe=${counts.duplicate} rejected=${counts.rejected} ` +
    `derived=${JSON.stringify(counts.derived)}`
  );
  // The device reads the number back as "how many did you take".
  return text(res, `OK: ${counts.stored}`);
});

// ─── Our channel TO the device ───────────────────────────────────────────────────────────
// One command per poll, by design: the device acknowledges them one at a time, and handing
// out two means the second's result can never be matched to it.
router.get('/getrequest', async (req, res) => {
  const sn = await device(req);
  if (!sn) return text(res, 'OK');
  const { rows } = await query(
    `UPDATE device_commands SET state = 'sent', sent_at = NOW()
      WHERE id = (
        SELECT id FROM device_commands
         WHERE device_sn = $1 AND state = 'queued'
         ORDER BY id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
      RETURNING id, body`,
    [sn]
  );
  if (!rows.length) return text(res, 'OK');
  return text(res, `C:${rows[0].id}:${rows[0].body}`);
});

// ─── The device reporting how a command went ─────────────────────────────────────────────
router.post('/devicecmd', async (req, res) => {
  const sn = await device(req);
  if (!sn) return text(res, 'OK');
  // Body looks like: ID=12&Return=0&CMD=DATA
  const fields = String(req.body || '')
    .split(/[&\n\r]+/)
    .reduce((acc, pair) => {
      const [k, v] = pair.split('=');
      if (k) acc[k.trim().toUpperCase()] = (v || '').trim();
      return acc;
    }, {});
  const id = Number(fields.ID);
  if (!Number.isInteger(id)) return text(res, 'OK');
  // Return=0 is success in this protocol; anything else is the device's own error code.
  const ok = fields.RETURN === '0';
  await query(
    `UPDATE device_commands
        SET state = $2, result_code = $3, done_at = NOW()
      WHERE id = $1 AND device_sn = $4`,
    [id, ok ? 'done' : 'failed', fields.RETURN ?? null, sn]
  );
  return text(res, 'OK');
});

module.exports = router;
