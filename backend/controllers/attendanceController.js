const net = require('net');
const { query, tx } = require('../lib/db');
const breaks = require('../lib/attendanceBreak');

const DEFAULT_TZ = 'Asia/Baghdad';
const VALID_MODES = new Set(['none', 'network', 'location', 'both', 'network_or_location']);

/**
 * Returned الخروج المؤقت minutes for a record, so worked_minutes can exclude
 * time the worker spent outside the shop. Expects the record aliased as `r`.
 */
const BREAK_MINUTES_SQL = `(SELECT COALESCE(SUM(b.minutes), 0)::int
       FROM staff_attendance_breaks b
      WHERE b.attendance_id = r.id AND b.state = 'returned') AS break_minutes`;

function cleanIp(ip) {
  const raw = String(ip || '').split(',')[0].trim();
  if (raw.startsWith('::ffff:')) return raw.slice(7);
  if (raw === '::1') return '127.0.0.1';
  return raw;
}

function clientIp(req) {
  return cleanIp(req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '');
}

function ipv4ToInt(ip) {
  if (net.isIP(ip) !== 4) return null;
  return ip.split('.').reduce((acc, part) => ((acc << 8) + Number(part)) >>> 0, 0);
}

function ipMatchesRange(ip, range) {
  const value = cleanIp(ip);
  const rule = String(range || '').trim();
  if (!rule) return false;
  if (!rule.includes('/')) return value === cleanIp(rule);
  const [base, bitsRaw] = rule.split('/');
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const ipInt = ipv4ToInt(value);
  const baseInt = ipv4ToInt(cleanIp(base));
  if (ipInt == null || baseInt == null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

function localParts(date = new Date(), timeZone = DEFAULT_TZ) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .formatToParts(date)
    .reduce((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value;
      return acc;
    }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function timeToMinutes(value) {
  const [h, m] = String(value || '00:00').split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function scheduledMinutes(startTime, endTime) {
  const start = timeToMinutes(startTime);
  let end = timeToMinutes(endTime);
  if (end <= start) end += 24 * 60;
  return Math.max(0, end - start);
}

function diffMinutes(start, end) {
  if (!start || !end) return 0;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.floor(ms / 60000);
}

function distanceMeters(aLat, aLng, bLat, bLng) {
  const toRad = (v) => (v * Math.PI) / 180;
  const r = 6371000;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

async function ensureStaff(userId) {
  const { rows } = await query(`SELECT id, name, role FROM users WHERE id = $1`, [userId]);
  if (!rows.length || rows[0].role !== 'staff') {
    return { err: { status: 404, body: { error: 'الموظف غير موجود', code: 'ERR_NOT_FOUND' } } };
  }
  return { user: rows[0] };
}

async function loadSettings(client = null) {
  const db = client || { query };
  const { rows } = await db.query(`SELECT * FROM staff_attendance_settings WHERE id = TRUE`);
  if (rows.length) return rows[0];
  const inserted = await db.query(
    `INSERT INTO staff_attendance_settings (id) VALUES (TRUE)
     ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
     RETURNING *`
  );
  return inserted.rows[0];
}

async function loadEffectiveSettings(userId, client = null) {
  const db = client || { query };
  const base = await loadSettings(client);
  if (!userId) return { ...base, is_user_override: false };
  const { rows } = await db.query(
    `SELECT start_time, end_time, grace_minutes, deduction_per_minute,
            COALESCE(attendance_required, TRUE) AS attendance_required,
            break_monthly_minutes,
            updated_at
       FROM staff_attendance_user_settings
      WHERE user_id = $1`,
    [userId]
  );
  if (!rows.length) return { ...base, is_user_override: false };
  return {
    ...base,
    start_time: rows[0].start_time,
    end_time: rows[0].end_time,
    grace_minutes: rows[0].grace_minutes,
    deduction_per_minute: rows[0].deduction_per_minute,
    attendance_required: rows[0].attendance_required,
    // a NULL override inherits the shop-wide allowance
    break_monthly_minutes:
      rows[0].break_monthly_minutes == null
        ? base.break_monthly_minutes
        : rows[0].break_monthly_minutes,
    updated_at: rows[0].updated_at,
    is_user_override: true,
  };
}

function serializeSettings(row) {
  return {
    start_time: String(row.start_time).slice(0, 5),
    end_time: String(row.end_time).slice(0, 5),
    grace_minutes: Number(row.grace_minutes),
    deduction_per_minute: Number(row.deduction_per_minute),
    verification_mode: row.verification_mode,
    allowed_ip_ranges: row.allowed_ip_ranges || [],
    shop_latitude: row.shop_latitude == null ? null : Number(row.shop_latitude),
    shop_longitude: row.shop_longitude == null ? null : Number(row.shop_longitude),
    shop_radius_meters: Number(row.shop_radius_meters),
    timezone: row.timezone || DEFAULT_TZ,
    updated_at: row.updated_at,
    is_user_override: !!row.is_user_override,
    attendance_required: row.attendance_required !== false,
    break_monthly_minutes: breaks.effectiveAllowance(row),
  };
}

function serializeUserSetting(row) {
  return {
    user_id: row.user_id,
    staff_name: row.staff_name || null,
    start_time: row.start_time ? String(row.start_time).slice(0, 5) : null,
    end_time: row.end_time ? String(row.end_time).slice(0, 5) : null,
    grace_minutes: row.grace_minutes == null ? null : Number(row.grace_minutes),
    deduction_per_minute: row.deduction_per_minute == null ? null : Number(row.deduction_per_minute),
    attendance_required: row.attendance_required !== false,
    // null = inherits the shop-wide الخروج المؤقت allowance
    break_monthly_minutes:
      row.break_monthly_minutes == null ? null : Number(row.break_monthly_minutes),
    has_override: !!row.has_override,
    updated_at: row.updated_at || null,
  };
}

function serializeRecord(row, now = new Date()) {
  if (!row) return null;
  const present = row.check_in_at ? diffMinutes(row.check_in_at, row.check_out_at || now) : 0;
  // Time spent outside the shop on الخروج المؤقت is not worked time (migration 075).
  const breakMinutes = Number(row.break_minutes || 0);
  const worked = Math.max(0, present - breakMinutes);
  const planned = scheduledMinutes(row.expected_start_time, row.expected_end_time);
  const openTooLong = !!row.check_in_at && !row.check_out_at && present >= 24 * 60;
  const overtime = row.check_out_at ? Math.max(0, worked - planned) : 0;
  const note = openTooLong ? 'الموظف لم يخرج من المعمل' : row.admin_note_ar;
  return {
    id: row.id,
    user_id: row.user_id,
    staff_name: row.staff_name || null,
    work_date: row.work_date,
    check_in_at: row.check_in_at,
    check_out_at: row.check_out_at,
    expected_start_time: String(row.expected_start_time || '').slice(0, 5),
    expected_end_time: String(row.expected_end_time || '').slice(0, 5),
    grace_minutes: Number(row.grace_minutes),
    late_minutes: Number(row.late_minutes),
    deduction_amount: Number(row.deduction_amount),
    deduction_transaction_id: row.deduction_transaction_id,
    verification_mode: row.verification_mode,
    network_ok: !!row.network_ok,
    location_ok: !!row.location_ok,
    verified: !!row.verified,
    check_in_ip: row.check_in_ip,
    check_out_ip: row.check_out_ip,
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    location_accuracy_meters:
      row.location_accuracy_meters == null ? null : Number(row.location_accuracy_meters),
    distance_meters: row.distance_meters == null ? null : Math.round(Number(row.distance_meters)),
    status: row.status,
    admin_note_ar: row.admin_note_ar,
    note_ar: note,
    worked_minutes: worked,
    // check-in → check-out span, before break time is removed
    present_minutes: present,
    break_minutes: breakMinutes,
    scheduled_minutes: planned,
    overtime_minutes: overtime,
    open_too_long: openTooLong,
    overridden_by: row.overridden_by,
    overridden_at: row.overridden_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function dateKey(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

function verificationEvidence(req, settings, location) {
  const ip = clientIp(req);
  const ranges = Array.isArray(settings.allowed_ip_ranges) ? settings.allowed_ip_ranges : [];
  const networkOk = ranges.length > 0 && ranges.some((r) => ipMatchesRange(ip, r));

  const lat = location?.latitude == null ? null : Number(location.latitude);
  const lng = location?.longitude == null ? null : Number(location.longitude);
  const accuracy = location?.accuracy == null ? null : Number(location.accuracy);
  let distance = null;
  let locationOk = false;
  if (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    settings.shop_latitude != null &&
    settings.shop_longitude != null
  ) {
    distance = distanceMeters(lat, lng, Number(settings.shop_latitude), Number(settings.shop_longitude));
    locationOk = distance <= Number(settings.shop_radius_meters || 120);
  }

  const mode = settings.verification_mode || 'none';
  const verified =
    mode === 'none' ||
    (mode === 'network' && networkOk) ||
    (mode === 'location' && locationOk) ||
    (mode === 'both' && networkOk && locationOk) ||
    (mode === 'network_or_location' && (networkOk || locationOk));

  return {
    ip,
    networkOk,
    locationOk,
    verified,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lng) ? lng : null,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
    distance,
  };
}

async function getSettings(req, res) {
  res.json({ data: serializeSettings(await loadSettings()) });
}

async function updateSettings(req, res) {
  const start = String(req.body.start_time || '').trim();
  const end = String(req.body.end_time || '').trim();
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
    return res.status(400).json({ error: 'وقت الدوام غير صالح', code: 'ERR_VALIDATION' });
  }
  const grace = Number(req.body.grace_minutes);
  const perMinute = Number(req.body.deduction_per_minute);
  const radius = Number(req.body.shop_radius_meters || 120);
  const mode = String(req.body.verification_mode || 'none');
  if (!VALID_MODES.has(mode)) {
    return res.status(400).json({ error: 'طريقة التحقق غير صالحة', code: 'ERR_VALIDATION' });
  }
  if (!Number.isInteger(grace) || grace < 0 || !Number.isInteger(perMinute) || perMinute < 0) {
    return res.status(400).json({ error: 'إعدادات الخصم غير صالحة', code: 'ERR_VALIDATION' });
  }
  if (!Number.isInteger(radius) || radius <= 0) {
    return res.status(400).json({ error: 'نطاق الموقع غير صالح', code: 'ERR_VALIDATION' });
  }
  const breakAllowance =
    req.body.break_monthly_minutes == null ? 600 : Number(req.body.break_monthly_minutes);
  if (!Number.isInteger(breakAllowance) || breakAllowance < 0) {
    return res.status(400).json({ error: 'رصيد الخروج المؤقت غير صالح', code: 'ERR_VALIDATION' });
  }
  const ranges = Array.isArray(req.body.allowed_ip_ranges)
    ? req.body.allowed_ip_ranges.map((r) => String(r).trim()).filter(Boolean)
    : [];
  const lat = req.body.shop_latitude === null || req.body.shop_latitude === '' ? null : Number(req.body.shop_latitude);
  const lng = req.body.shop_longitude === null || req.body.shop_longitude === '' ? null : Number(req.body.shop_longitude);
  if ((lat != null && !Number.isFinite(lat)) || (lng != null && !Number.isFinite(lng))) {
    return res.status(400).json({ error: 'إحداثيات الموقع غير صالحة', code: 'ERR_VALIDATION' });
  }

  const { rows } = await query(
    `INSERT INTO staff_attendance_settings
       (id, start_time, end_time, grace_minutes, deduction_per_minute, verification_mode,
        allowed_ip_ranges, shop_latitude, shop_longitude, shop_radius_meters,
        break_monthly_minutes, updated_by, updated_at)
     VALUES (TRUE, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
     ON CONFLICT (id) DO UPDATE
       SET start_time = EXCLUDED.start_time,
           end_time = EXCLUDED.end_time,
           grace_minutes = EXCLUDED.grace_minutes,
           deduction_per_minute = EXCLUDED.deduction_per_minute,
           verification_mode = EXCLUDED.verification_mode,
           allowed_ip_ranges = EXCLUDED.allowed_ip_ranges,
           shop_latitude = EXCLUDED.shop_latitude,
           shop_longitude = EXCLUDED.shop_longitude,
           shop_radius_meters = EXCLUDED.shop_radius_meters,
           break_monthly_minutes = EXCLUDED.break_monthly_minutes,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()
     RETURNING *`,
    [start, end, grace, perMinute, mode, ranges, lat, lng, radius, breakAllowance, req.user.id]
  );
  // Changing the allowance changes how already-taken breaks were charged, so the
  // ledger is re-run now instead of drifting until the next break happens.
  await recomputeCurrentMonthForAll(req.user.id);
  res.json({ data: serializeSettings(rows[0]) });
}

/**
 * Re-run the current month for every staff member who has breaks in it.
 * Small by construction (one shop, a handful of staff).
 */
async function recomputeCurrentMonthForAll(actorId) {
  const monthKey = breaks.monthKeyFor(new Date(), DEFAULT_TZ);
  const { rows } = await query(
    `SELECT DISTINCT user_id FROM staff_attendance_breaks
      WHERE month_key = $1 AND state = 'returned'`,
    [monthKey]
  );
  for (const row of rows) {
    const settings = await loadEffectiveSettings(row.user_id);
    await tx(async (client) =>
      breaks.recomputeMonth(client, {
        userId: row.user_id,
        monthKey,
        allowanceMinutes: breaks.effectiveAllowance(settings),
        actorId,
      })
    );
  }
}

async function listUserSettings(req, res) {
  const { rows } = await query(
    `SELECT u.id AS user_id, u.name AS staff_name,
            s.start_time, s.end_time, s.grace_minutes, s.deduction_per_minute,
            COALESCE(s.attendance_required, TRUE) AS attendance_required,
            s.break_monthly_minutes,
            s.updated_at,
            (s.user_id IS NOT NULL) AS has_override
       FROM users u
       LEFT JOIN staff_attendance_user_settings s ON s.user_id = u.id
      WHERE u.role = 'staff'
      ORDER BY u.name ASC`
  );
  res.json({ data: rows.map(serializeUserSetting) });
}

async function setUserSettings(req, res) {
  const { userId } = req.params;
  const { err } = await ensureStaff(userId);
  if (err) return res.status(err.status).json(err.body);

  const start = String(req.body.start_time || '').trim();
  const end = String(req.body.end_time || '').trim();
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
    return res.status(400).json({ error: 'وقت الدوام غير صالح', code: 'ERR_VALIDATION' });
  }
  const grace = Number(req.body.grace_minutes);
  const perMinute = Number(req.body.deduction_per_minute);
  const attendanceRequired = req.body.attendance_required !== false;
  if (!Number.isInteger(grace) || grace < 0 || !Number.isInteger(perMinute) || perMinute < 0) {
    return res.status(400).json({ error: 'إعدادات الخصم غير صالحة', code: 'ERR_VALIDATION' });
  }
  // null / '' means "inherit the shop-wide الخروج المؤقت allowance"
  const rawAllowance = req.body.break_monthly_minutes;
  const breakAllowance =
    rawAllowance == null || rawAllowance === '' ? null : Number(rawAllowance);
  if (breakAllowance != null && (!Number.isInteger(breakAllowance) || breakAllowance < 0)) {
    return res.status(400).json({ error: 'رصيد الخروج المؤقت غير صالح', code: 'ERR_VALIDATION' });
  }

  const { rows } = await query(
    `INSERT INTO staff_attendance_user_settings
       (user_id, start_time, end_time, grace_minutes, deduction_per_minute, attendance_required,
        break_monthly_minutes, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET start_time = EXCLUDED.start_time,
           end_time = EXCLUDED.end_time,
           grace_minutes = EXCLUDED.grace_minutes,
           deduction_per_minute = EXCLUDED.deduction_per_minute,
           attendance_required = EXCLUDED.attendance_required,
           break_monthly_minutes = EXCLUDED.break_monthly_minutes,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()
     RETURNING user_id, start_time, end_time, grace_minutes, deduction_per_minute,
               attendance_required, break_monthly_minutes, updated_at, TRUE AS has_override`,
    [userId, start, end, grace, perMinute, attendanceRequired, breakAllowance, req.user.id]
  );
  await recomputeCurrentMonthFor(userId, req.user.id);
  const staff = await query(`SELECT name AS staff_name FROM users WHERE id = $1`, [userId]);
  res.json({ data: serializeUserSetting({ ...rows[0], staff_name: staff.rows[0]?.staff_name }) });
}

/** Re-run one worker's current month after their allowance changed. */
async function recomputeCurrentMonthFor(userId, actorId) {
  const settings = await loadEffectiveSettings(userId);
  const monthKey = breaks.monthKeyFor(new Date(), settings.timezone || DEFAULT_TZ);
  await tx(async (client) =>
    breaks.recomputeMonth(client, {
      userId,
      monthKey,
      allowanceMinutes: breaks.effectiveAllowance(settings),
      actorId,
    })
  );
}

async function deleteUserSettings(req, res) {
  const { userId } = req.params;
  const { err } = await ensureStaff(userId);
  if (err) return res.status(err.status).json(err.body);
  await query(`DELETE FROM staff_attendance_user_settings WHERE user_id = $1`, [userId]);
  // dropping the override falls back to the shop allowance, which re-prices the month
  await recomputeCurrentMonthFor(userId, req.user.id);
  res.json({ data: { user_id: userId, has_override: false } });
}

/**
 * The ONE staff attendance payload: schedule + today's record + break state.
 *
 * Shared with attendanceBreakController so that every break action (request /
 * «طلعت» / «رجعت» / cancel) answers with exactly the same shape as
 * GET /attendance/today. That is not tidiness — the frontend maps all of them
 * through a single `mapAttendancePayload`, which reads `settings.start_time`
 * unconditionally and throws `Cannot read properties of undefined` on a partial
 * body. Returning half a payload from any one of these endpoints breaks the
 * screen even though the write itself succeeded.
 *
 * Must be called OUTSIDE a transaction — it uses the pool, not a client.
 */
async function todayPayload(userId, settings, timeZone = settings.timezone || DEFAULT_TZ) {
  const today = localParts(new Date(), timeZone).date;
  const { rows } = await query(
    `SELECT r.*, ${BREAK_MINUTES_SQL}
       FROM (
         (SELECT * FROM staff_attendance_records
           WHERE user_id = $1 AND check_in_at IS NOT NULL AND check_out_at IS NULL
           ORDER BY check_in_at DESC
           LIMIT 1)
         UNION ALL
         (SELECT * FROM staff_attendance_records
           WHERE user_id = $1 AND work_date = $2
             AND NOT EXISTS (
               SELECT 1 FROM staff_attendance_records
                WHERE user_id = $1 AND check_in_at IS NOT NULL AND check_out_at IS NULL
             )
           LIMIT 1)
         LIMIT 1
       ) r`,
    [userId, today]
  );
  return {
    settings: serializeSettings(settings),
    record: serializeRecord(rows[0]),
    ...(await breakState(userId, settings, timeZone)),
  };
}

async function getToday(req, res) {
  const settings = await loadEffectiveSettings(req.user.id);
  res.json({ data: await todayPayload(req.user.id, settings) });
}

/**
 * The worker's open break plus their allowance for the current month — attached
 * to every attendance response so one round-trip refreshes the whole card.
 */
async function breakState(userId, settings, timeZone = DEFAULT_TZ) {
  const monthKey = breaks.monthKeyFor(new Date(), timeZone);
  const [open, balance] = await Promise.all([
    breaks.openBreakFor({ query }, userId),
    breaks.loadBalance({ query }, userId, monthKey, breaks.effectiveAllowance(settings)),
  ]);
  return { break: breaks.serializeBreak(open), break_balance: balance };
}

async function checkIn(req, res) {
  const { err } = await ensureStaff(req.user.id);
  if (err) return res.status(err.status).json(err.body);

  const now = new Date();
  const result = await tx(async (client) => {
    const settings = await loadEffectiveSettings(req.user.id, client);
    if (settings.attendance_required === false) {
      const e = new Error('هذا الموظف معفى من شرط البصمة');
      e.status = 400;
      e.expose = true;
      e.code = 'ERR_ATTENDANCE_NOT_REQUIRED';
      throw e;
    }
    const evidence = verificationEvidence(req, settings, req.body?.location);
    if (!evidence.verified) {
      const e = new Error('لا يمكن تسجيل البصمة خارج نطاق المحل');
      e.status = 403;
      e.expose = true;
      e.code = 'ERR_ATTENDANCE_LOCATION';
      e.evidence = evidence;
      throw e;
    }

    const local = localParts(now, settings.timezone || DEFAULT_TZ);
    const open = await client.query(
      `SELECT id FROM staff_attendance_records
        WHERE user_id = $1 AND check_in_at IS NOT NULL AND check_out_at IS NULL
        ORDER BY check_in_at DESC
        LIMIT 1`,
      [req.user.id]
    );
    if (open.rows.length) {
      const e = new Error('لديك بصمة دخول مفتوحة. سجّل الخروج أولاً');
      e.status = 409;
      e.expose = true;
      e.code = 'ERR_OPEN_ATTENDANCE';
      throw e;
    }
    const startMinutes = timeToMinutes(settings.start_time);
    const lateMinutes = Math.max(0, local.minutes - startMinutes - Number(settings.grace_minutes));
    const deduction = lateMinutes * Number(settings.deduction_per_minute || 0);
    const status = lateMinutes > 0 ? 'late' : 'present';

    const inserted = await client.query(
      `INSERT INTO staff_attendance_records
         (user_id, work_date, check_in_at, expected_start_time, expected_end_time, grace_minutes,
          late_minutes, deduction_amount, verification_mode, network_ok, location_ok, verified,
          check_in_ip, latitude, longitude, location_accuracy_meters, distance_meters, status, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())
       ON CONFLICT (user_id, work_date) DO NOTHING
       RETURNING *`,
      [
        req.user.id,
        local.date,
        now.toISOString(),
        settings.start_time,
        settings.end_time,
        settings.grace_minutes,
        lateMinutes,
        deduction,
        settings.verification_mode,
        evidence.networkOk,
        evidence.locationOk,
        evidence.verified,
        evidence.ip,
        evidence.latitude,
        evidence.longitude,
        evidence.accuracy,
        evidence.distance,
        status,
      ]
    );
    if (!inserted.rows.length) {
      const e = new Error('تم تسجيل بصمة الدخول لهذا اليوم');
      e.status = 409;
      e.expose = true;
      e.code = 'ERR_ALREADY_CHECKED_IN';
      throw e;
    }

    return { settings, record: inserted.rows[0] };
  });

  res.status(201).json({
    data: {
      settings: serializeSettings(result.settings),
      record: serializeRecord(result.record),
      ...(await breakState(req.user.id, result.settings, result.settings.timezone || DEFAULT_TZ)),
    },
  });
}

async function checkOut(req, res) {
  const { err } = await ensureStaff(req.user.id);
  if (err) return res.status(err.status).json(err.body);

  const settings = await loadEffectiveSettings(req.user.id);
  if (settings.attendance_required === false) {
    return res.status(400).json({ error: 'هذا الموظف معفى من شرط البصمة', code: 'ERR_ATTENDANCE_NOT_REQUIRED' });
  }
  const evidence = verificationEvidence(req, settings, req.body?.location);
  if (!evidence.verified) {
    return res.status(403).json({
      error: 'لا يمكن تسجيل بصمة الخروج خارج نطاق المحل',
      code: 'ERR_ATTENDANCE_LOCATION',
      data: evidence,
    });
  }
  const timeZone = settings.timezone || DEFAULT_TZ;
  const result = await tx(async (client) => {
    const closed = await client.query(
      `UPDATE staff_attendance_records
          SET check_out_at = COALESCE(check_out_at, NOW()),
              check_out_ip = $2,
              updated_at = NOW()
        WHERE id = (
          SELECT id FROM staff_attendance_records
           WHERE user_id = $1 AND check_in_at IS NOT NULL AND check_out_at IS NULL
           ORDER BY check_in_at DESC
           LIMIT 1
        )
        RETURNING *`,
      [req.user.id, evidence.ip]
    );
    if (!closed.rows.length) {
      const e = new Error('لا توجد بصمة دخول لهذا اليوم');
      e.status = 404;
      e.expose = true;
      e.code = 'ERR_NOT_FOUND';
      throw e;
    }
    const record = closed.rows[0];

    // A forgotten «رجعت» must never bill the rest of the night: stamping out ends
    // any break still open, at the checkout moment. A request nobody acted on is
    // just dropped — the shift it belonged to is over.
    let autoClosed = null;
    const open = await breaks.openBreakFor(client, req.user.id);
    if (open?.state === 'out') {
      autoClosed = await breaks.finishBreak(client, open, {
        returnedAt: record.check_out_at,
        perMinute: settings.deduction_per_minute,
        autoClosed: true,
      });
      if (autoClosed) {
        await breaks.recomputeMonth(client, {
          userId: req.user.id,
          monthKey: autoClosed.month_key,
          allowanceMinutes: breaks.effectiveAllowance(settings),
        });
      }
    } else if (open?.state === 'requested') {
      await client.query(
        `UPDATE staff_attendance_breaks SET state = 'cancelled', updated_at = NOW() WHERE id = $1`,
        [open.id]
      );
    }

    const totals = await client.query(
      `SELECT COALESCE(SUM(minutes), 0)::int AS break_minutes
         FROM staff_attendance_breaks
        WHERE attendance_id = $1 AND state = 'returned'`,
      [record.id]
    );
    return {
      record: { ...record, break_minutes: totals.rows[0].break_minutes },
      autoClosedBreakId: autoClosed?.id || null,
    };
  });

  res.json({
    data: {
      settings: serializeSettings(settings),
      record: serializeRecord(result.record),
      auto_closed_break_id: result.autoClosedBreakId,
      ...(await breakState(req.user.id, settings, timeZone)),
    },
  });
}

async function listRecords(req, res) {
  const date = req.query.date ? String(req.query.date) : localParts(new Date(), DEFAULT_TZ).date;
  const params = [date];
  let userClause = '';
  if (req.query.user_id) {
    params.push(String(req.query.user_id));
    userClause = `AND r.user_id = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT r.*, u.name AS staff_name, ${BREAK_MINUTES_SQL}
       FROM staff_attendance_records r
       JOIN users u ON u.id = r.user_id
      WHERE r.work_date = $1 ${userClause}
      ORDER BY r.check_in_at ASC NULLS LAST, u.name ASC`,
    params
  );
  res.json({ data: rows.map(serializeRecord) });
}

async function calendar(req, res) {
  const from = String(req.query.from || '').slice(0, 10);
  const to = String(req.query.to || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ error: 'مدى التاريخ غير صالح', code: 'ERR_VALIDATION' });
  }
  if (from > to) {
    return res.status(400).json({ error: 'تاريخ البداية يجب أن يسبق تاريخ النهاية', code: 'ERR_VALIDATION' });
  }

  const params = [from, to];
  let userClause = '';
  if (req.query.user_id) {
    params.push(String(req.query.user_id));
    userClause = `AND r.user_id = $${params.length}`;
  }

  const { rows } = await query(
    `SELECT r.*, u.name AS staff_name, ${BREAK_MINUTES_SQL}
       FROM staff_attendance_records r
       JOIN users u ON u.id = r.user_id
      WHERE r.work_date BETWEEN $1 AND $2 ${userClause}
      ORDER BY r.work_date ASC, r.check_in_at ASC NULLS LAST, u.name ASC`,
    params
  );

  const byDate = new Map();
  for (const row of rows) {
    const record = serializeRecord(row);
    const key = dateKey(row.work_date);
    if (!byDate.has(key)) {
      byDate.set(key, {
        date: key,
        records: [],
        totals: {
          staff_count: 0,
          present_count: 0,
          late_count: 0,
          open_count: 0,
          open_too_long_count: 0,
          worked_minutes: 0,
          overtime_minutes: 0,
          break_minutes: 0,
        },
      });
    }
    const day = byDate.get(key);
    day.records.push(record);
    day.totals.staff_count += 1;
    if (record.check_in_at) day.totals.present_count += 1;
    if (record.late_minutes > 0) day.totals.late_count += 1;
    if (record.check_in_at && !record.check_out_at) day.totals.open_count += 1;
    if (record.open_too_long) day.totals.open_too_long_count += 1;
    day.totals.worked_minutes += record.worked_minutes || 0;
    day.totals.overtime_minutes += record.overtime_minutes || 0;
    day.totals.break_minutes += record.break_minutes || 0;
  }

  res.json({ data: { from, to, days: Array.from(byDate.values()) } });
}

async function overrideRecord(req, res) {
  const { id } = req.params;
  const note = req.body.note_ar ? String(req.body.note_ar).trim() : null;
  const late = req.body.late_minutes == null ? null : Number(req.body.late_minutes);
  const deduction = req.body.deduction_amount == null ? null : Number(req.body.deduction_amount);
  if ((late != null && (!Number.isInteger(late) || late < 0)) || (deduction != null && (!Number.isInteger(deduction) || deduction < 0))) {
    return res.status(400).json({ error: 'قيم التصحيح غير صالحة', code: 'ERR_VALIDATION' });
  }

  const record = await tx(async (client) => {
    const current = await client.query(`SELECT * FROM staff_attendance_records WHERE id = $1`, [id]);
    if (!current.rows.length) {
      const e = new Error('السجل غير موجود');
      e.status = 404;
      e.expose = true;
      e.code = 'ERR_NOT_FOUND';
      throw e;
    }
    const updated = await client.query(
      `UPDATE staff_attendance_records
          SET late_minutes = COALESCE($2, late_minutes),
              deduction_amount = COALESCE($3, 0),
              deduction_transaction_id = NULL,
              status = 'overridden',
              admin_note_ar = $4,
              overridden_by = $5,
              overridden_at = NOW(),
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id, late, deduction, note, req.user.id]
    );
    return updated.rows[0];
  });
  res.json({ data: serializeRecord(record) });
}

module.exports = {
  getSettings,
  updateSettings,
  listUserSettings,
  setUserSettings,
  deleteUserSettings,
  getToday,
  checkIn,
  checkOut,
  listRecords,
  calendar,
  overrideRecord,
  // shared with attendanceBreakController — one source for the effective schedule,
  // the shop timezone and the staff-role guard
  loadEffectiveSettings,
  serializeSettings,
  todayPayload,
  localParts,
  ensureStaff,
  DEFAULT_TZ,
};
