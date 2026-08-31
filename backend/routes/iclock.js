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
const { parseAttlog, handshakeBody, userInfoBody } = require('../lib/iclockProtocol');
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

/**
 * SELF-HEALING NAME PUSH — why «الأسماء ما وصلت للجهاز» is not an admin's problem.
 *
 * `linkPin` queues a name onto every ACTIVE device the instant a mapping is saved. All seven
 * of this shop's PINs were mapped BEFORE the K40's serial was registered, so that
 * INSERT … SELECT matched zero devices and queued nothing — silently, because queueing onto
 * no device is not an error. Result: seven correct mappings, an empty `device_commands`, and a
 * device showing a bare number beside every finger. The documented recovery was «re-save a PIN
 * by hand», which also replays that pin's raw punches for no reason, and which nobody was ever
 * going to do — the admin WATCHES this screen, he does not operate it.
 *
 * So the device repairs it itself. Every poll it asks us for work; if nothing is waiting and
 * some name is not on it yet, that name becomes the work. Nothing to press, and it recovers
 * from every cause of the same symptom — a factory reset, a swapped unit, a mapping made while
 * the device was unplugged.
 *
 * ⚠️ 'pending' ONLY, never 'failed'. A device that rejects a name (bad codepage, full user
 * table) would otherwise be handed it again every poll forever, and the failure would never
 * surface — it would look like a queue that never drains. A failed name stays failed and
 * visible, which is exactly what an admin who only watches needs to see.
 *
 * ⚠️ One per poll, matching the queue's own one-command-per-poll rule: hand over five names at
 * once and four of their acknowledgements can never be matched back to a command.
 */
async function queueMissingName(sn) {
  const { rows } = await query(
    `SELECT sdp.pin, COALESCE(sdp.pushed_name, u.name) AS pushed_name
       FROM staff_device_pins sdp
       JOIN users u ON u.id = sdp.user_id
      WHERE sdp.push_state = 'pending'
        AND NOT EXISTS (
          SELECT 1 FROM device_commands dc
           WHERE dc.pin = sdp.pin
             AND dc.device_sn = $1
             AND dc.state IN ('queued', 'sent')
        )
      ORDER BY sdp.pin ASC
      LIMIT 1`,
    [sn]
  );
  if (!rows.length) return null;
  // Inserted already marked 'sent', because it is handed over in this very response.
  const { rows: made } = await query(
    `INSERT INTO device_commands (device_sn, body, pin, state, sent_at)
     VALUES ($1, $2, $3, 'sent', NOW())
     RETURNING id, body, pin`,
    [sn, userInfoBody(rows[0].pin, rows[0].pushed_name), rows[0].pin]
  );
  return made[0] || null;
}

/**
 * Move a PIN's `push_state` along as its USERINFO command travels.
 *
 * ⚠️ Guarded by `pin IS NOT NULL`, because most commands have none: `DATA DELETE USERINFO`
 * carries a pin but the mapping row is already gone, and any future non-user command has no
 * pin at all. A missing row is not an error here — the ack path must never fail a device
 * request over bookkeeping, or the device retries the whole batch forever.
 *
 * ⚠️ Never moves a pin BACKWARD out of 'confirmed'. A device that re-acks an old command (they
 * do, after a power cycle replays its queue) would otherwise knock a healthy name back to
 * 'sent' and the screen would report a problem that does not exist.
 */
async function advancePinPushState(pin, state) {
  if (pin == null) return;
  try {
    await query(
      `UPDATE staff_device_pins
          SET push_state = $2,
              enrolled_at = CASE WHEN $2 = 'confirmed' THEN NOW() ELSE enrolled_at END
        WHERE pin = $1
          AND NOT (push_state = 'confirmed' AND $2 = 'sent')`,
      [pin, state]
    );
  } catch {
    /* bookkeeping only — a failure here must not fail the device's request */
  }
}

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
      RETURNING id, body, pin`,
    [sn]
  );
  // Nothing queued? Then this poll is the moment to put a not-yet-delivered name on the wire.
  const cmd = rows[0] || (await queueMissingName(sn));
  if (!cmd) return text(res, 'OK');
  // Carry the command's fate back to the PIN it belongs to (migration 098). Without this
  // `staff_device_pins.push_state` stayed 'pending' forever — written once at mapping time and
  // never touched again — so the admin screen's «بانتظار الإرسال» badge could neither confirm
  // a name had reached the device nor report that it had failed.
  await advancePinPushState(cmd.pin, 'sent');
  return text(res, `C:${cmd.id}:${cmd.body}`);
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
  const { rows } = await query(
    `UPDATE device_commands
        SET state = $2, result_code = $3, done_at = NOW()
      WHERE id = $1 AND device_sn = $4
      RETURNING pin`,
    [id, ok ? 'done' : 'failed', fields.RETURN ?? null, sn]
  );
  if (rows.length) {
    await advancePinPushState(rows[0].pin, ok ? 'confirmed' : 'failed');
  }
  return text(res, 'OK');
});

module.exports = router;
