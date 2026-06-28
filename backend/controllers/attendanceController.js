const net = require('net');
const { query, tx } = require('../lib/db');

const DEFAULT_TZ = 'Asia/Baghdad';
const VALID_MODES = new Set(['none', 'network', 'location', 'both', 'network_or_location']);

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
    `SELECT start_time, end_time, grace_minutes, deduction_per_minute, updated_at
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
    has_override: !!row.has_override,
    updated_at: row.updated_at || null,
  };
}

function serializeRecord(row) {
  if (!row) return null;
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
    overridden_by: row.overridden_by,
    overridden_at: row.overridden_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
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
        allowed_ip_ranges, shop_latitude, shop_longitude, shop_radius_meters, updated_by, updated_at)
     VALUES (TRUE, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
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
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()
     RETURNING *`,
    [start, end, grace, perMinute, mode, ranges, lat, lng, radius, req.user.id]
  );
  res.json({ data: serializeSettings(rows[0]) });
}

async function listUserSettings(req, res) {
  const { rows } = await query(
    `SELECT u.id AS user_id, u.name AS staff_name,
            s.start_time, s.end_time, s.grace_minutes, s.deduction_per_minute,
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
  if (!Number.isInteger(grace) || grace < 0 || !Number.isInteger(perMinute) || perMinute < 0) {
    return res.status(400).json({ error: 'إعدادات الخصم غير صالحة', code: 'ERR_VALIDATION' });
  }

  const { rows } = await query(
    `INSERT INTO staff_attendance_user_settings
       (user_id, start_time, end_time, grace_minutes, deduction_per_minute, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET start_time = EXCLUDED.start_time,
           end_time = EXCLUDED.end_time,
           grace_minutes = EXCLUDED.grace_minutes,
           deduction_per_minute = EXCLUDED.deduction_per_minute,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()
     RETURNING user_id, start_time, end_time, grace_minutes, deduction_per_minute, updated_at, TRUE AS has_override`,
    [userId, start, end, grace, perMinute, req.user.id]
  );
  const staff = await query(`SELECT name AS staff_name FROM users WHERE id = $1`, [userId]);
  res.json({ data: serializeUserSetting({ ...rows[0], staff_name: staff.rows[0]?.staff_name }) });
}

async function deleteUserSettings(req, res) {
  const { userId } = req.params;
  const { err } = await ensureStaff(userId);
  if (err) return res.status(err.status).json(err.body);
  await query(`DELETE FROM staff_attendance_user_settings WHERE user_id = $1`, [userId]);
  res.json({ data: { user_id: userId, has_override: false } });
}

async function getToday(req, res) {
  const settings = await loadEffectiveSettings(req.user.id);
  const today = localParts(new Date(), settings.timezone || DEFAULT_TZ).date;
  const { rows } = await query(
    `SELECT * FROM staff_attendance_records WHERE user_id = $1 AND work_date = $2`,
    [req.user.id, today]
  );
  res.json({ data: { settings: serializeSettings(settings), record: serializeRecord(rows[0]) } });
}

async function checkIn(req, res) {
  const { err } = await ensureStaff(req.user.id);
  if (err) return res.status(err.status).json(err.body);

  const now = new Date();
  const result = await tx(async (client) => {
    const settings = await loadEffectiveSettings(req.user.id, client);
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

    let record = inserted.rows[0];
    if (deduction > 0) {
      const txn = await client.query(
        `INSERT INTO staff_salary_transactions
           (user_id, type, amount, reason_ar, source_type, source_id, created_by)
         VALUES ($1, 'deduction', $2, $3, 'attendance', $4, $5)
         RETURNING id`,
        [req.user.id, deduction, `خصم تأخير: ${lateMinutes} دقيقة`, record.id, req.user.id]
      );
      const upd = await client.query(
        `UPDATE staff_attendance_records
            SET deduction_transaction_id = $1, updated_at = NOW()
          WHERE id = $2
          RETURNING *`,
        [txn.rows[0].id, record.id]
      );
      record = upd.rows[0];
    }
    return { settings, record };
  });

  res.status(201).json({ data: { settings: serializeSettings(result.settings), record: serializeRecord(result.record) } });
}

async function checkOut(req, res) {
  const { err } = await ensureStaff(req.user.id);
  if (err) return res.status(err.status).json(err.body);

  const settings = await loadEffectiveSettings(req.user.id);
  const evidence = verificationEvidence(req, settings, req.body?.location);
  if (!evidence.verified) {
    return res.status(403).json({
      error: 'لا يمكن تسجيل بصمة الخروج خارج نطاق المحل',
      code: 'ERR_ATTENDANCE_LOCATION',
      data: evidence,
    });
  }
  const today = localParts(new Date(), settings.timezone || DEFAULT_TZ).date;
  const { rows } = await query(
    `UPDATE staff_attendance_records
        SET check_out_at = COALESCE(check_out_at, NOW()),
            check_out_ip = $3,
            updated_at = NOW()
      WHERE user_id = $1 AND work_date = $2 AND check_in_at IS NOT NULL
      RETURNING *`,
    [req.user.id, today, evidence.ip]
  );
  if (!rows.length) {
    return res.status(404).json({ error: 'لا توجد بصمة دخول لهذا اليوم', code: 'ERR_NOT_FOUND' });
  }
  res.json({ data: { settings: serializeSettings(settings), record: serializeRecord(rows[0]) } });
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
    `SELECT r.*, u.name AS staff_name
       FROM staff_attendance_records r
       JOIN users u ON u.id = r.user_id
      WHERE r.work_date = $1 ${userClause}
      ORDER BY r.check_in_at ASC NULLS LAST, u.name ASC`,
    params
  );
  res.json({ data: rows.map(serializeRecord) });
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
    const row = current.rows[0];
    if (row.deduction_transaction_id) {
      await client.query(
        `UPDATE staff_salary_transactions
            SET deleted_at = NOW(), deleted_by = $2, delete_reason_ar = $3
          WHERE id = $1 AND source_type = 'attendance' AND deleted_at IS NULL`,
        [row.deduction_transaction_id, req.user.id, note || 'تصحيح بصمة الموظف']
      );
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
  overrideRecord,
};
