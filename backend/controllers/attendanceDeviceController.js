'use strict';
/**
 * جهاز البصمة (ZKTeco K40 Pro) — the ADMIN half. Migration 094.
 *
 * Three jobs, and they are three because the device knows nothing about our users:
 *   · register a serial     — an UNREGISTERED serial is dropped silently by routes/iclock.js,
 *                             so this screen is a prerequisite for any punch to ever land;
 *   · map device PIN → موظف — `staff_device_pins`, the only bridge between the two worlds;
 *   · resolve «أرقام جهاز بلا اسم» — a finger touched the device before anybody linked it.
 *
 * ⚠️ THE POINT OF THE WHOLE DESIGN LIVES IN `assignUnmapped`. `punch_raw` is append-only
 *    truth: a punch from a PIN nobody has claimed is STORED with `user_id = NULL` rather than
 *    rejected. Linking that PIN therefore has to REPLAY the pin's stored punches through
 *    `applyPunch`, oldest first — that replay is what makes the worker's history appear the
 *    moment they are linked, and it is the entire reason raw punches are kept before they are
 *    understood. Delete the replay and the screen still "works" while silently losing every
 *    punch that arrived before the admin got round to the mapping.
 *
 * ⚠️ Unlinking does NOT clear `punch_raw.user_id` on past punches. Those rows are the record
 *    of who really touched the device; a mapping ending is a fact about the FUTURE. The
 *    already-derived `staff_attendance_records` keep pointing at the same worker, which is
 *    what payroll needs.
 */
const { query, tx } = require('../lib/db');
const { DEFAULT_TZ } = require('../lib/shopTime');
const { applyPunch, allocatePin } = require('../lib/attendanceDevice');
// The ADMS name-push body — one definition, shared with routes/iclock.js.
const { userInfoBody } = require('../lib/iclockProtocol');
const { ensureStaff } = require('./attendanceController');

// The serial is printed on a sticker and typed in by hand next to a noisy device. Keep the
// alphabet narrow so a typo fails here rather than becoming a device that never talks to us.
const SERIAL_RE = /^[A-Za-z0-9._-]{1,64}$/;
const PIN_RE = /^\d{1,5}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_PIN = 1;
const MAX_PIN = 65534;

/**
 * A device PIN arrives as TEXT (`punch_raw.device_pin`) because it is stored exactly as the
 * wire gave it, while `staff_device_pins.pin` is an INTEGER. Compare on the NUMBER: some
 * firmware pads the pin ('007'), and a text comparison would quietly treat that as a
 * different, unclaimable worker. The regex bounds the cast so a 32-digit line — which the
 * parser accepts — can never overflow `int`.
 */
const PIN_IS = (col, param) => `${col} ~ '^[0-9]{1,9}$' AND ${col}::int = ${param}`;

const bad = (res, error, code = 'ERR_VALIDATION', status = 400) =>
  res.status(status).json({ error, code });

/**
 * Queue a command on every ACTIVE device. The device pulls it with GET /iclock/getrequest
 * (Task 5); nothing here talks to the device directly — it dials out to us, never the reverse.
 * Returns how many devices it was queued for, so the screen can say «ما في جهاز مسجّل».
 */
async function queueOnActiveDevices(client, body, pin = null) {
  const { rows } = await client.query(
    `INSERT INTO device_commands (device_sn, body, pin)
     SELECT serial_number, $1, $2 FROM attendance_devices WHERE active = TRUE
     RETURNING id`,
    [body, pin]
  );
  return rows.length;
}

// ───────────────────────────── الأجهزة ─────────────────────────────

async function listDevices(req, res) {
  const { rows } = await query(
    `SELECT d.serial_number, d.label_ar, d.active, d.last_seen_at, d.last_ip,
            d.firmware_note, d.created_at,
            (SELECT COUNT(*)::int FROM punch_raw p
              WHERE p.device_sn = d.serial_number
                AND (p.punched_at AT TIME ZONE $1)::date = (NOW() AT TIME ZONE $1)::date
            ) AS today_punches,
            (SELECT COUNT(*)::int FROM device_commands q
              WHERE q.device_sn = d.serial_number AND q.state = 'queued'
            ) AS queued_commands
       FROM attendance_devices d
      ORDER BY d.created_at ASC`,
    [DEFAULT_TZ]
  );
  res.json({ data: rows });
}

async function registerDevice(req, res) {
  const serial = String(req.body?.serial_number || '').trim();
  const label = String(req.body?.label_ar || '').trim() || 'جهاز البصمة';
  if (!SERIAL_RE.test(serial)) {
    return bad(res, 'رقم الجهاز التسلسلي غير صالح');
  }
  const { rows } = await query(
    `INSERT INTO attendance_devices (serial_number, label_ar)
     VALUES ($1, $2)
     ON CONFLICT (serial_number) DO NOTHING
     RETURNING serial_number, label_ar, active, last_seen_at, last_ip, firmware_note, created_at`,
    [serial, label]
  );
  if (!rows.length) {
    return bad(res, 'هذا الجهاز مسجّل من قبل', 'ERR_DUPLICATE', 409);
  }
  res.status(201).json({ data: { ...rows[0], today_punches: 0, queued_commands: 0 } });
}

async function updateDevice(req, res) {
  const sn = String(req.params.sn || '');
  const patch = {};
  if (req.body?.label_ar != null) {
    const label = String(req.body.label_ar).trim();
    if (!label) return bad(res, 'اسم الجهاز ما يصير فارغ');
    patch.label_ar = label;
  }
  if (req.body?.active != null) patch.active = req.body.active === true;
  if (req.body?.firmware_note != null) {
    patch.firmware_note = String(req.body.firmware_note).trim() || null;
  }
  if (!Object.keys(patch).length) return bad(res, 'ما في شي للتعديل');

  const cols = Object.keys(patch);
  const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const { rows } = await query(
    `UPDATE attendance_devices SET ${sets} WHERE serial_number = $1
     RETURNING serial_number, label_ar, active, last_seen_at, last_ip, firmware_note, created_at`,
    [sn, ...cols.map((c) => patch[c])]
  );
  if (!rows.length) return bad(res, 'الجهاز غير موجود', 'ERR_NOT_FOUND', 404);
  res.json({ data: rows[0] });
}

// ───────────────────────── ربط الأرقام بالموظفين ─────────────────────────

const PIN_SELECT = `
  SELECT u.id AS user_id, u.name AS staff_name,
         p.pin, p.pushed_name, p.push_state, p.enrolled_at, p.created_at,
         (SELECT COUNT(*)::int FROM punch_raw r WHERE r.user_id = u.id) AS punch_count
    FROM users u
    LEFT JOIN staff_device_pins p ON p.user_id = u.id
   WHERE u.role = 'staff'`;

async function listPins(req, res) {
  const { rows } = await query(`${PIN_SELECT} ORDER BY (p.pin IS NULL), p.pin ASC, u.name ASC`);
  res.json({ data: rows });
}

async function loadPinRow(db, userId) {
  const { rows } = await db.query(`${PIN_SELECT} AND u.id = $1`, [userId]);
  return rows[0] || null;
}

/**
 * The one place a PIN becomes a worker. Both entry points below funnel through it:
 * «اربط بموظف» on an unmapped number, and setting a pin by hand from the roster.
 *
 * Returns the outcome tally of the replay so the caller can tell the admin what appeared.
 */
async function linkPin(client, { userId, pin, pushedName }) {
  const taken = await client.query(
    `SELECT user_id FROM staff_device_pins WHERE pin = $1 AND user_id <> $2`,
    [pin, userId]
  );
  if (taken.rows.length) return { conflict: true };

  await client.query(
    `INSERT INTO staff_device_pins (user_id, pin, pushed_name, push_state)
     VALUES ($1, $2, $3, 'pending')
     ON CONFLICT (user_id) DO UPDATE
       SET pin = EXCLUDED.pin,
           pushed_name = EXCLUDED.pushed_name,
           push_state = 'pending'`,
    [userId, pin, pushedName]
  );

  // ⚠️ THE REPLAY. Oldest first — `applyPunch` moves a check-in BACKWARD when it sees an
  // earlier punch, so out-of-order replay would write the day's record more times than it
  // has to and lean on that correction path for no reason. `id` breaks ties inside a second.
  const stored = await client.query(
    `SELECT * FROM punch_raw
      WHERE user_id IS NULL AND ${PIN_IS('device_pin', '$1')}
      ORDER BY device_ts ASC, id ASC`,
    [pin]
  );
  const derived = { created: 0, extended: 0, moved_in: 0, ignored: 0, unmapped: 0 };
  for (const punch of stored.rows) {
    const outcome = await applyPunch(client, punch);
    if (outcome in derived) derived[outcome] += 1;
  }

  const queued = await queueOnActiveDevices(client, userInfoBody(pin, pushedName), pin);
  return { conflict: false, replayed: stored.rows.length, derived, queued };
}

/**
 * PUT /admin/attendance/pins/:userId — set a pin, or allocate the lowest free one when the
 * body carries none. Allocation is deliberately server-side: an admin standing at the device
 * should not have to remember which numbers are already inside it.
 */
async function setPin(req, res) {
  const { userId } = req.params;
  if (!UUID_RE.test(String(userId))) return bad(res, 'الموظف غير موجود', 'ERR_NOT_FOUND', 404);
  const { err, user } = await ensureStaff(userId);
  if (err) return res.status(err.status).json(err.body);

  const rawPin = req.body?.pin;
  let pin = null;
  if (rawPin != null && String(rawPin).trim() !== '') {
    const text = String(rawPin).trim();
    if (!PIN_RE.test(text)) return bad(res, 'رقم الجهاز غير صالح');
    pin = Number(text);
    if (pin < MIN_PIN || pin > MAX_PIN) return bad(res, 'رقم الجهاز غير صالح');
  }
  const pushedName = String(req.body?.pushed_name || '').trim() || user.name;

  const result = await tx(async (client) => {
    const chosen = pin == null ? await allocatePin(client) : pin;
    const linked = await linkPin(client, { userId, pin: chosen, pushedName });
    if (linked.conflict) return { conflict: true };
    return { ...linked, row: await loadPinRow(client, userId) };
  });
  if (result.conflict) {
    return bad(res, 'هذا الرقم مربوط بموظف ثاني', 'ERR_DUPLICATE', 409);
  }
  res.json({
    data: result.row,
    meta: { replayed: result.replayed, derived: result.derived, queued: result.queued },
  });
}

/**
 * DELETE /admin/attendance/pins/:userId — the mapping ends, the history does not.
 * Past `punch_raw.user_id` and every derived `staff_attendance_records` row stay exactly as
 * they are; only future punches from that number become «بلا اسم» again.
 */
async function deletePin(req, res) {
  const { userId } = req.params;
  if (!UUID_RE.test(String(userId))) return bad(res, 'الموظف غير موجود', 'ERR_NOT_FOUND', 404);
  const result = await tx(async (client) => {
    const { rows } = await client.query(
      `DELETE FROM staff_device_pins WHERE user_id = $1 RETURNING pin`,
      [userId]
    );
    if (!rows.length) return { missing: true };
    const queued = await queueOnActiveDevices(
      client,
      `DATA DELETE USERINFO PIN=${rows[0].pin}`,
      rows[0].pin
    );
    return { pin: rows[0].pin, queued };
  });
  if (result.missing) return bad(res, 'ما في رقم مربوط بهذا الموظف', 'ERR_NOT_FOUND', 404);
  res.json({ data: { user_id: userId, pin: null }, meta: { queued: result.queued } });
}

// ───────────────────── أرقام جهاز بلا اسم ─────────────────────

/**
 * Every PIN that has punched but is not attached to anybody. This list existing at all is the
 * design working: a stranger's finger is never dropped, it waits here to be claimed.
 */
async function listUnmapped(req, res) {
  const { rows } = await query(
    `SELECT p.device_pin,
            COUNT(*)::int          AS punch_count,
            MIN(p.punched_at)      AS first_seen_at,
            MAX(p.punched_at)      AS last_seen_at,
            MIN(p.device_ts)       AS first_device_ts,
            MAX(p.device_ts)       AS last_device_ts,
            (ARRAY_AGG(DISTINCT p.device_sn))[1] AS device_sn,
            u.id   AS mapped_user_id,
            u.name AS mapped_staff_name
       FROM punch_raw p
       LEFT JOIN staff_device_pins sdp ON ${PIN_IS('p.device_pin', 'sdp.pin')}
       LEFT JOIN users u ON u.id = sdp.user_id
      WHERE p.user_id IS NULL
      GROUP BY p.device_pin, u.id, u.name
      ORDER BY MAX(p.punched_at) DESC`
  );
  res.json({ data: rows });
}

/**
 * POST /admin/attendance/unmapped/:pin/assign — «اربط بموظف».
 *
 * ⚠️ This is the endpoint the whole raw-punch design exists for: it links the number AND
 * replays every punch that number already made, so a worker who has been touching the device
 * for a week gets that week of attendance the instant somebody names them.
 */
async function assignUnmapped(req, res) {
  const pinText = String(req.params.pin || '').trim();
  if (!PIN_RE.test(pinText)) return bad(res, 'رقم الجهاز غير صالح');
  const pin = Number(pinText);
  if (pin < MIN_PIN || pin > MAX_PIN) return bad(res, 'رقم الجهاز غير صالح');

  const userId = String(req.body?.user_id || '').trim();
  if (!userId) return bad(res, 'اختر الموظف');
  if (!UUID_RE.test(userId)) return bad(res, 'الموظف غير موجود', 'ERR_NOT_FOUND', 404);
  const { err, user } = await ensureStaff(userId);
  if (err) return res.status(err.status).json(err.body);

  const pushedName = String(req.body?.pushed_name || '').trim() || user.name;

  const result = await tx(async (client) => {
    const linked = await linkPin(client, { userId, pin, pushedName });
    if (linked.conflict) return { conflict: true };
    return { ...linked, row: await loadPinRow(client, userId) };
  });
  if (result.conflict) {
    return bad(res, 'هذا الرقم مربوط بموظف ثاني', 'ERR_DUPLICATE', 409);
  }
  res.json({
    data: result.row,
    meta: { replayed: result.replayed, derived: result.derived, queued: result.queued },
  });
}

// ───────────────────────── نبضات مرفوضة ─────────────────────────

/**
 * A row here is a line the device sent that we could not read — a dialect mismatch, and its
 * `raw_line` names it exactly. Quarantining is what stops one bad line freezing the device's
 * whole upload queue, so this list is the only place that failure is visible.
 */
async function listRejects(req, res) {
  const limit = Math.min(200, Math.max(1, Number(req.query?.limit) || 50));
  const { rows } = await query(
    `SELECT id, device_sn, raw_line, reason, at
       FROM punch_reject ORDER BY at DESC, id DESC LIMIT $1`,
    [limit]
  );
  res.json({ data: rows });
}

module.exports = {
  listDevices,
  registerDevice,
  updateDevice,
  listPins,
  setPin,
  deletePin,
  listUnmapped,
  assignUnmapped,
  listRejects,
};
