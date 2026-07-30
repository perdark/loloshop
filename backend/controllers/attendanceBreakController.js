/**
 * الخروج المؤقت — temporary leave during a shift.
 *
 * Flow: the worker requests → the admin approves → the worker taps «طلعت» when
 * actually leaving (that is when the clock starts) → «رجعت» when back. A worker
 * whose admin never answered can still leave via `without_approval`, which
 * records reality and costs money; the admin can approve it afterwards and the
 * deduction is cancelled.
 *
 * All quota and money arithmetic lives in lib/attendanceBreak.js. This file only
 * enforces who may do what, and when.
 */

const { query, tx } = require('../lib/db');
const breaks = require('../lib/attendanceBreak');
const attendance = require('./attendanceController');

const DEFAULT_TZ = breaks.DEFAULT_TZ;

const SELECT_BREAK = `SELECT b.*, u.name AS staff_name
  FROM staff_attendance_breaks b
  JOIN users u ON u.id = b.user_id`;

function httpError(status, message, code, extra = {}) {
  const e = new Error(message);
  e.status = status;
  e.expose = true;
  e.code = code;
  Object.assign(e, extra);
  return e;
}

/**
 * Notifications are a side effect, never part of the atomic unit — they run AFTER
 * the transaction commits and can never fail the break itself. (They also cannot
 * be retried inside a tx: any error aborts the whole Postgres transaction, so a
 * deleted recipient account would take the worker's break down with it. The admin
 * screen lists pending requests regardless, so this is an accelerator, not the
 * only channel.)
 */
async function notifyAdmins({ title, body, link }) {
  try {
    await query(
      `INSERT INTO notifications (user_id, type, title_ar, body_ar, link)
       SELECT id, 'attendance_break', $1, $2, $3 FROM users WHERE role = 'admin'`,
      [title, body, link]
    );
  } catch (err) {
    console.error('attendance_break admin notify failed:', err.message);
  }
}

async function notifyWorker(userId, { title, body, link = '/staff' }) {
  try {
    await query(
      `INSERT INTO notifications (user_id, type, title_ar, body_ar, link)
       VALUES ($1, 'attendance_break', $2, $3, $4)`,
      [userId, title, body, link]
    );
  } catch (err) {
    console.error('attendance_break worker notify failed:', err.message);
  }
}

function durationAr(minutes) {
  const total = Math.max(0, Number(minutes) || 0);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours && mins) return `${hours} ساعة و${mins} دقيقة`;
  if (hours) return `${hours} ساعة`;
  return `${mins} دقيقة`;
}

/** Everything a staff response needs: the open break plus this month's balance. */
async function staffPayload(userId, settings, extra = {}) {
  const timeZone = settings.timezone || DEFAULT_TZ;
  const monthKey = breaks.monthKeyFor(new Date(), timeZone);
  const [open, balance] = await Promise.all([
    breaks.openBreakFor({ query }, userId),
    breaks.loadBalance({ query }, userId, monthKey, breaks.effectiveAllowance(settings)),
  ]);
  return { break: breaks.serializeBreak(open), break_balance: balance, ...extra };
}

/** Load the worker's effective settings and refuse the exempt / non-staff cases. */
async function staffContext(userId) {
  const { err } = await attendance.ensureStaff(userId);
  if (err) throw httpError(err.status, err.body.error, err.body.code);
  const settings = await attendance.loadEffectiveSettings(userId);
  if (settings.attendance_required === false) {
    throw httpError(
      400,
      'هذا الموظف معفى من شرط البصمة',
      'ERR_ATTENDANCE_NOT_REQUIRED'
    );
  }
  return settings;
}

// ─── staff ───────────────────────────────────────────────────────────────────

/**
 * POST /staff/attendance/breaks
 * Body: { reason_ar?, requested_minutes? }
 * Ask to step out. Requires an open بصمة دخول — a break is time carved out of a
 * shift, so there has to be a shift.
 */
async function requestBreak(req, res) {
  const settings = await staffContext(req.user.id);
  const timeZone = settings.timezone || DEFAULT_TZ;

  const reason = req.body?.reason_ar ? String(req.body.reason_ar).trim().slice(0, 400) : null;
  const rawMinutes = req.body?.requested_minutes;
  const requestedMinutes = rawMinutes == null || rawMinutes === '' ? null : Number(rawMinutes);
  if (
    requestedMinutes != null &&
    (!Number.isInteger(requestedMinutes) ||
      requestedMinutes <= 0 ||
      requestedMinutes > breaks.MAX_REQUEST_MINUTES)
  ) {
    return res.status(400).json({ error: 'المدة المطلوبة غير صالحة', code: 'ERR_VALIDATION' });
  }

  const created = await tx(async (client) => {
    const record = await client.query(
      `SELECT id, work_date FROM staff_attendance_records
        WHERE user_id = $1 AND check_in_at IS NOT NULL AND check_out_at IS NULL
        ORDER BY check_in_at DESC
        LIMIT 1`,
      [req.user.id]
    );
    if (!record.rows.length) {
      throw httpError(409, 'سجّل بصمة الدخول أولاً', 'ERR_NO_OPEN_ATTENDANCE');
    }

    const existing = await breaks.openBreakFor(client, req.user.id);
    if (existing) {
      throw httpError(409, 'لديك خروج مؤقت مفتوح', 'ERR_OPEN_BREAK', {
        break_id: existing.id,
      });
    }

    let inserted;
    try {
      inserted = await client.query(
        `INSERT INTO staff_attendance_breaks
           (user_id, attendance_id, work_date, month_key, reason_ar, requested_minutes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          req.user.id,
          record.rows[0].id,
          record.rows[0].work_date,
          breaks.monthKeyFor(new Date(), timeZone),
          reason,
          requestedMinutes,
        ]
      );
    } catch (err) {
      // uq_attendance_break_open — two taps racing each other
      if (err.code === '23505') {
        throw httpError(409, 'لديك خروج مؤقت مفتوح', 'ERR_OPEN_BREAK');
      }
      throw err;
    }

    return inserted.rows[0];
  });

  await notifyAdmins({
    title: 'طلب خروج مؤقت',
    body: `${req.user.name} يطلب الخروج${
      requestedMinutes ? ` لمدة ${durationAr(requestedMinutes)}` : ''
    }${reason ? ` — ${reason}` : ''}`,
    link: '/admin/attendance',
  });

  res.status(201).json({
    data: await staffPayload(req.user.id, settings, {
      break: breaks.serializeBreak(created),
    }),
  });
}

/**
 * POST /staff/attendance/breaks/:id/leave
 * Body: { without_approval?: boolean }
 * Start the clock. Approved → normal. Not approved → only with an explicit
 * without_approval, which flags the break and makes every minute deductible.
 */
async function leaveBreak(req, res) {
  const settings = await staffContext(req.user.id);
  const withoutApproval = req.body?.without_approval === true;

  const started = await tx(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM staff_attendance_breaks
        WHERE id = $1 AND user_id = $2
        FOR UPDATE`,
      [req.params.id, req.user.id]
    );
    if (!rows.length) throw httpError(404, 'الطلب غير موجود', 'ERR_NOT_FOUND');
    const row = rows[0];
    if (row.state === 'out') throw httpError(409, 'أنت خارج المحل بالفعل', 'ERR_ALREADY_OUT');
    if (row.state !== 'requested') {
      throw httpError(409, 'هذا الطلب مغلق', 'ERR_BREAK_CLOSED');
    }
    if (row.approval !== 'approved' && !withoutApproval) {
      throw httpError(
        409,
        row.approval === 'rejected' ? 'المدير رفض الطلب' : 'بانتظار موافقة المدير',
        row.approval === 'rejected' ? 'ERR_BREAK_REJECTED' : 'ERR_BREAK_PENDING'
      );
    }

    const unapproved = row.approval !== 'approved';
    const updated = await client.query(
      `UPDATE staff_attendance_breaks
          SET state = 'out', left_at = NOW(), left_without_approval = $2,
              month_key = $3, updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [row.id, unapproved, breaks.monthKeyFor(new Date(), settings.timezone || DEFAULT_TZ)]
    );

    return updated.rows[0];
  });

  if (started.left_without_approval) {
    await notifyAdmins({
      title: 'خروج بدون موافقة',
      body: `${req.user.name} خرج من المحل بدون موافقة — كل دقيقة تُخصم حتى توافق`,
      link: '/admin/attendance',
    });
  }

  res.json({
    data: await staffPayload(req.user.id, settings, { break: breaks.serializeBreak(started) }),
  });
}

/**
 * POST /staff/attendance/breaks/:id/return
 * «رجعت» — freeze the real elapsed minutes, then re-price the month.
 */
async function returnBreak(req, res) {
  const settings = await staffContext(req.user.id);

  const finished = await tx(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM staff_attendance_breaks
        WHERE id = $1 AND user_id = $2
        FOR UPDATE`,
      [req.params.id, req.user.id]
    );
    if (!rows.length) throw httpError(404, 'الطلب غير موجود', 'ERR_NOT_FOUND');
    if (rows[0].state !== 'out') {
      throw httpError(409, 'لا يوجد خروج مؤقت مفتوح', 'ERR_BREAK_NOT_OPEN');
    }

    const closed = await breaks.finishBreak(client, rows[0], {
      returnedAt: new Date(),
      perMinute: settings.deduction_per_minute,
    });
    await breaks.recomputeMonth(client, {
      userId: req.user.id,
      monthKey: closed.month_key,
      allowanceMinutes: breaks.effectiveAllowance(settings),
    });
    const fresh = await client.query(`SELECT * FROM staff_attendance_breaks WHERE id = $1`, [
      closed.id,
    ]);
    return fresh.rows[0];
  });

  res.json({
    data: await staffPayload(req.user.id, settings, {
      break: null,
      last_break: breaks.serializeBreak(finished),
    }),
  });
}

/**
 * DELETE /staff/attendance/breaks/:id
 * Cancel a request the worker changed their mind about (before leaving only).
 */
async function cancelBreak(req, res) {
  const settings = await staffContext(req.user.id);
  const { rows } = await query(
    `UPDATE staff_attendance_breaks
        SET state = 'cancelled', updated_at = NOW()
      WHERE id = $1 AND user_id = $2 AND state = 'requested'
      RETURNING id`,
    [req.params.id, req.user.id]
  );
  if (!rows.length) {
    return res.status(409).json({ error: 'لا يمكن إلغاء هذا الطلب', code: 'ERR_BREAK_CLOSED' });
  }
  res.json({ data: await staffPayload(req.user.id, settings) });
}

/**
 * GET /staff/attendance/breaks/mine?month=YYYY-MM
 * The worker's own history for a month — where their allowance went.
 */
async function myBreaks(req, res) {
  const settings = await attendance.loadEffectiveSettings(req.user.id);
  const monthKey = monthParam(req.query.month, settings.timezone || DEFAULT_TZ);
  const { rows } = await query(
    `${SELECT_BREAK}
      WHERE b.user_id = $1 AND b.month_key = $2 AND b.state <> 'cancelled'
      ORDER BY b.requested_at DESC`,
    [req.user.id, monthKey]
  );
  res.json({
    data: {
      month_key: monthKey,
      breaks: rows.map((r) => breaks.serializeBreak(r)),
      break_balance: await breaks.loadBalance(
        { query },
        req.user.id,
        monthKey,
        breaks.effectiveAllowance(settings)
      ),
    },
  });
}

function monthParam(value, timeZone) {
  const raw = String(value || '').slice(0, 7);
  return /^\d{4}-\d{2}$/.test(raw) ? raw : breaks.monthKeyFor(new Date(), timeZone);
}

// ─── admin ───────────────────────────────────────────────────────────────────

/**
 * GET /admin/attendance/breaks?from&to&user_id&state&approval&pending_only
 * Defaults to the current month so the screen always has content.
 */
async function listBreaks(req, res) {
  const params = [];
  const where = [`b.state <> 'cancelled'`];

  const from = String(req.query.from || '').slice(0, 10);
  const to = String(req.query.to || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    params.push(from, to);
    where.push(`b.work_date BETWEEN $${params.length - 1} AND $${params.length}`);
  } else {
    params.push(breaks.monthKeyFor(new Date(), DEFAULT_TZ));
    where.push(`b.month_key = $${params.length}`);
  }
  if (req.query.user_id) {
    params.push(String(req.query.user_id));
    where.push(`b.user_id = $${params.length}`);
  }
  if (['requested', 'out', 'returned'].includes(String(req.query.state))) {
    params.push(String(req.query.state));
    where.push(`b.state = $${params.length}`);
  }
  if (['pending', 'approved', 'rejected'].includes(String(req.query.approval))) {
    params.push(String(req.query.approval));
    where.push(`b.approval = $${params.length}`);
  }

  const { rows } = await query(
    `${SELECT_BREAK}
      WHERE ${where.join(' AND ')}
      ORDER BY (b.approval = 'pending' AND b.state <> 'returned') DESC,
               b.state = 'out' DESC,
               b.requested_at DESC`,
    params
  );
  res.json({ data: rows.map((r) => breaks.serializeBreak(r)) });
}

/**
 * GET /admin/attendance/breaks/balances?month=YYYY-MM
 * Allowance vs. used per staff member — the screen that answers "who is over".
 */
async function listBalances(req, res) {
  const monthKey = monthParam(req.query.month, DEFAULT_TZ);
  const { rows } = await query(
    `SELECT u.id AS user_id, u.name AS staff_name,
            COALESCE(s.break_monthly_minutes, g.break_monthly_minutes) AS monthly_minutes,
            COALESCE(SUM(b.minutes) FILTER (WHERE b.state = 'returned'), 0)::int AS used_minutes,
            COALESCE(SUM(b.deducted_minutes) FILTER (WHERE b.state = 'returned'), 0)::int AS deducted_minutes,
            COALESCE(SUM(b.deduction_amount) FILTER (WHERE b.state = 'returned'), 0)::bigint AS deduction_amount,
            COUNT(b.id) FILTER (WHERE b.state = 'returned')::int AS break_count,
            COUNT(b.id) FILTER (WHERE b.state = 'out')::int AS out_count,
            COUNT(b.id) FILTER (WHERE b.approval = 'pending' AND b.state <> 'returned')::int AS pending_count
       FROM users u
       CROSS JOIN staff_attendance_settings g
       LEFT JOIN staff_attendance_user_settings s ON s.user_id = u.id
       LEFT JOIN staff_attendance_breaks b
              ON b.user_id = u.id AND b.month_key = $1 AND b.state <> 'cancelled'
      WHERE u.role = 'staff' AND g.id = TRUE
        AND COALESCE(s.attendance_required, TRUE) = TRUE
      GROUP BY u.id, u.name, s.break_monthly_minutes, g.break_monthly_minutes
      ORDER BY u.name ASC`,
    [monthKey]
  );

  res.json({
    data: {
      month_key: monthKey,
      staff: rows.map((r) => {
        const allowance = Number(r.monthly_minutes) || 0;
        const used = Number(r.used_minutes);
        return {
          user_id: r.user_id,
          staff_name: r.staff_name,
          monthly_minutes: allowance,
          used_minutes: used,
          remaining_minutes: Math.max(0, allowance - used),
          deducted_minutes: Number(r.deducted_minutes),
          deduction_amount: Number(r.deduction_amount),
          break_count: Number(r.break_count),
          out_count: Number(r.out_count),
          pending_count: Number(r.pending_count),
        };
      }),
    },
  });
}

/** Shared by approve/reject: set the decision, re-price the month, notify. */
async function decide(req, res, approval) {
  const note = req.body?.note_ar ? String(req.body.note_ar).trim().slice(0, 400) : null;

  const result = await tx(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM staff_attendance_breaks WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (!rows.length) throw httpError(404, 'الطلب غير موجود', 'ERR_NOT_FOUND');
    const row = rows[0];
    if (row.state === 'cancelled') {
      throw httpError(409, 'هذا الطلب ملغى', 'ERR_BREAK_CLOSED');
    }

    const updated = await client.query(
      `UPDATE staff_attendance_breaks
          SET approval = $2, decided_by = $3, decided_at = NOW(),
              decision_note_ar = $4, updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [row.id, approval, req.user.id, note]
    );

    // A decision on an already-returned break moves money, so the month is re-priced.
    const settings = await attendance.loadEffectiveSettings(row.user_id, client);
    await breaks.recomputeMonth(client, {
      userId: row.user_id,
      monthKey: row.month_key,
      allowanceMinutes: breaks.effectiveAllowance(settings),
      actorId: req.user.id,
    });

    const fresh = await client.query(
      `${SELECT_BREAK} WHERE b.id = $1`,
      [row.id]
    );
    return { row: fresh.rows[0], userId: row.user_id, monthKey: row.month_key, settings };
  });

  const approved = approval === 'approved';
  await notifyWorker(result.userId, {
    title: approved ? 'تمت الموافقة على خروجك' : 'تم رفض طلب الخروج',
    body: approved
      ? note || 'وافق المدير على خروجك المؤقت'
      : note || 'رفض المدير طلب الخروج المؤقت — الخروج الآن يُخصم من راتبك',
  });

  res.json({
    data: {
      break: breaks.serializeBreak(result.row),
      break_balance: await breaks.loadBalance(
        { query },
        result.userId,
        result.monthKey,
        breaks.effectiveAllowance(result.settings)
      ),
    },
  });
}

const approveBreak = (req, res) => decide(req, res, 'approved');
const rejectBreak = (req, res) => decide(req, res, 'rejected');

/**
 * PATCH /admin/attendance/breaks/:id
 * Body: { returned_at?, minutes?, admin_note_ar? }
 * Fix a break the worker forgot to close, or correct its duration. This is the
 * relief valve for the biggest footgun in the feature: a forgotten «رجعت».
 */
async function correctBreak(req, res) {
  const note = req.body?.admin_note_ar ? String(req.body.admin_note_ar).trim().slice(0, 400) : null;
  const hasMinutes = req.body?.minutes != null && req.body.minutes !== '';
  const minutes = hasMinutes ? Number(req.body.minutes) : null;
  if (hasMinutes && (!Number.isInteger(minutes) || minutes < 0 || minutes > 24 * 60)) {
    return res.status(400).json({ error: 'المدة غير صالحة', code: 'ERR_VALIDATION' });
  }
  const rawReturned = req.body?.returned_at ? new Date(req.body.returned_at) : null;
  if (rawReturned && Number.isNaN(rawReturned.getTime())) {
    return res.status(400).json({ error: 'وقت الرجوع غير صالح', code: 'ERR_VALIDATION' });
  }

  const result = await tx(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM staff_attendance_breaks WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (!rows.length) throw httpError(404, 'الطلب غير موجود', 'ERR_NOT_FOUND');
    const row = rows[0];
    if (row.state === 'cancelled') throw httpError(409, 'هذا الطلب ملغى', 'ERR_BREAK_CLOSED');
    if (row.state === 'requested') {
      throw httpError(409, 'لم يخرج الموظف بعد', 'ERR_BREAK_NOT_OPEN');
    }
    if (!rawReturned && !hasMinutes && note == null) {
      throw httpError(400, 'لا يوجد تعديل', 'ERR_VALIDATION');
    }

    const settings = await attendance.loadEffectiveSettings(row.user_id, client);
    const returnedAt = rawReturned || row.returned_at || new Date();
    const finalMinutes = hasMinutes
      ? minutes
      : breaks.elapsedMinutes(row.left_at, returnedAt);
    // A break still out keeps the rate that applies now; a returned one keeps its frozen rate.
    const perMinute =
      row.state === 'out' ? Number(settings.deduction_per_minute) || 0 : row.deduction_per_minute;

    await client.query(
      `UPDATE staff_attendance_breaks
          SET state = 'returned', returned_at = $2, minutes = $3,
              deduction_per_minute = $4, admin_note_ar = COALESCE($5, admin_note_ar),
              updated_at = NOW()
        WHERE id = $1`,
      [row.id, returnedAt.toISOString ? returnedAt.toISOString() : returnedAt, finalMinutes, perMinute, note]
    );

    await breaks.recomputeMonth(client, {
      userId: row.user_id,
      monthKey: row.month_key,
      allowanceMinutes: breaks.effectiveAllowance(settings),
      actorId: req.user.id,
    });

    const fresh = await client.query(`${SELECT_BREAK} WHERE b.id = $1`, [row.id]);
    return { row: fresh.rows[0], userId: row.user_id, monthKey: row.month_key, settings };
  });

  res.json({
    data: {
      break: breaks.serializeBreak(result.row),
      break_balance: await breaks.loadBalance(
        { query },
        result.userId,
        result.monthKey,
        breaks.effectiveAllowance(result.settings)
      ),
    },
  });
}

module.exports = {
  // staff
  requestBreak,
  leaveBreak,
  returnBreak,
  cancelBreak,
  myBreaks,
  // admin
  listBreaks,
  listBalances,
  approveBreak,
  rejectBreak,
  correctBreak,
};
