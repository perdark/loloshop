/**
 * Payroll controller — staff salary + activity.
 * Tables: staff_salaries, staff_salary_transactions, staff_activity_log
 * All monetary amounts are IQD stored as BIGINT.
 */

const { query, tx } = require('../lib/db');
const schedule = require('../lib/staffSchedule');
const breaks = require('../lib/attendanceBreak');
const attendance = require('./attendanceController');
const { localParts, DEFAULT_TZ } = require('../lib/shopTime');
const { activityFor, monthBounds } = require('../lib/staffActivity');

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Assert the target user exists and has role='staff'.
 * Returns the user row or throws a 404-shaped object { status, body }.
 */
async function resolveStaffUser(userId) {
  const { rows } = await query(
    `SELECT id, name, role FROM users WHERE id = $1`,
    [userId]
  );
  if (!rows.length) {
    return { err: { status: 404, body: { error: 'الموظف غير موجود', code: 'ERR_NOT_FOUND' } } };
  }
  if (rows[0].role !== 'staff') {
    return { err: { status: 404, body: { error: 'المستخدم ليس موظفاً', code: 'ERR_NOT_FOUND' } } };
  }
  return { user: rows[0] };
}

/**
 * Build the salary summary for a given staff user_id.
 * Returns { user_id, base_salary, balance, transactions: [...] }
 */
async function buildSalarySummary(userId) {
  // base salary
  const salaryRow = await query(
    `SELECT base_salary FROM staff_salaries WHERE user_id = $1`,
    [userId]
  );
  const base_salary = salaryRow.rows.length ? Number(salaryRow.rows[0].base_salary) : 0;

  // transactions
  //
  // ⚠️ `source_type <> 'attendance'` MATCHES NOTHING and is not what it looks like. Measured
  // 2026-08-27: no row in the table has ever carried that value. Break deductions are written
  // with source_type **`'attendance_break'`** (lib/attendanceBreak.js:28), a different string,
  // so they ARE listed here and ARE in the balance below — as they should be. The filter is a
  // leftover from a lateness auto-deduction that was never built. It is left in place because
  // removing it changes nothing today and the same predicate appears in payoutController's
  // «المبلغ المقترح»; the two must keep agreeing, so they change together or not at all.
  //
  // Lateness itself never becomes a transaction: `staff_attendance_records.deduction_amount`
  // is displayed and reported, and `deduction_transaction_id` is only ever cleared, never set.
  // /payroll/me/summary shows it as its own section rather than pretending it is salary.
  const txRows = await query(
    `SELECT id, type, amount, reason_ar, source_type, source_id, created_by, created_at
     FROM staff_salary_transactions
     WHERE user_id = $1
       AND deleted_at IS NULL
       AND source_type <> 'attendance'
     ORDER BY created_at DESC`,
    [userId]
  );

  const transactions = txRows.rows.map((r) => ({
    ...r,
    amount: Number(r.amount),
  }));

  // balance = base_salary + SUM(bonus) - SUM(deduction)
  const balance =
    base_salary +
    transactions.reduce((acc, t) => {
      if (t.type === 'bonus') return acc + t.amount;
      if (t.type === 'deduction') return acc - t.amount;
      return acc; // salary_set rows don't affect the running balance
    }, 0);

  return { user_id: userId, base_salary, balance, transactions };
}

/**
 * Build the current goal summary for a staff user (most recent goal).
 * Progress = completed production actions (advance / approve_design) inside the
 * goal window. When the target is hit and not yet awarded, the bonus is granted
 * atomically as a salary 'bonus' transaction. Returns null when no goal exists.
 */
async function buildGoalSummary(userId) {
  const g = await query(
    `SELECT id, user_id, title_ar, target_count, bonus_amount, deadline,
            awarded, awarded_at, created_by, created_at
     FROM staff_goals WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  if (!g.rows.length) return null;
  const goal = g.rows[0];

  const p = await query(
    `SELECT COUNT(*)::int AS c FROM staff_activity_log
     WHERE user_id = $1 AND action IN ('advance', 'approve_design')
       AND created_at >= $2 AND created_at <= $3`,
    [userId, goal.created_at, goal.deadline]
  );
  const progress = p.rows[0].c;
  const target = goal.target_count;
  const achieved = progress >= target;

  // Auto-award the bonus exactly once when the target is reached.
  if (achieved && !goal.awarded) {
    const awarded = await tx(async (client) => {
      const upd = await client.query(
        `UPDATE staff_goals SET awarded = TRUE, awarded_at = NOW()
         WHERE id = $1 AND awarded = FALSE RETURNING id`,
        [goal.id]
      );
      if (!upd.rows.length) return false;
      if (Number(goal.bonus_amount) > 0) {
        await client.query(
          `INSERT INTO staff_salary_transactions (user_id, type, amount, reason_ar, source_type, source_id, created_by)
           VALUES ($1, 'bonus', $2, $3, 'goal', $4, $5)`,
          [
            userId,
            goal.bonus_amount,
            `حافز إنجاز الهدف${goal.title_ar ? ': ' + goal.title_ar : ''}`,
            goal.id,
            goal.created_by,
          ]
        );
      }
      return true;
    });
    if (awarded) {
      goal.awarded = true;
      goal.awarded_at = new Date().toISOString();
    }
  }

  const expired = !achieved && new Date(goal.deadline).getTime() < Date.now();
  return {
    id: goal.id,
    user_id: userId,
    title_ar: goal.title_ar,
    target_count: target,
    bonus_amount: Number(goal.bonus_amount),
    deadline: goal.deadline,
    progress,
    achieved,
    awarded: goal.awarded,
    awarded_at: goal.awarded_at,
    expired,
    created_at: goal.created_at,
  };
}

// ─── Admin endpoints ──────────────────────────────────────────────────────────

/** GET /admin/staff/:id/goal — current goal + progress for a staff member. */
async function getStaffGoal(req, res) {
  const { id } = req.params;
  const { err } = await resolveStaffUser(id);
  if (err) return res.status(err.status).json(err.body);
  res.json({ data: await buildGoalSummary(id) });
}

/**
 * POST /admin/staff/:id/goal
 * Body: { target_count (int>0), bonus_amount (int>=0), deadline (ISO), title_ar? }
 * Creates a new goal (the latest goal is the active one).
 */
async function setStaffGoal(req, res) {
  const { id } = req.params;
  const { err } = await resolveStaffUser(id);
  if (err) return res.status(err.status).json(err.body);

  const target = Number(req.body.target_count);
  if (!Number.isInteger(target) || target <= 0) {
    return res.status(400).json({ error: 'عدد الطلبات يجب أن يكون صحيحاً أكبر من صفر', code: 'ERR_VALIDATION' });
  }
  const bonus = req.body.bonus_amount == null ? 0 : Number(req.body.bonus_amount);
  if (!Number.isInteger(bonus) || bonus < 0) {
    return res.status(400).json({ error: 'الحافز يجب أن يكون عدداً صحيحاً', code: 'ERR_VALIDATION' });
  }
  const deadline = req.body.deadline ? new Date(req.body.deadline) : null;
  if (!deadline || Number.isNaN(deadline.getTime())) {
    return res.status(400).json({ error: 'الموعد النهائي غير صالح', code: 'ERR_VALIDATION' });
  }
  if (deadline.getTime() <= Date.now()) {
    return res.status(400).json({ error: 'الموعد النهائي يجب أن يكون في المستقبل', code: 'ERR_VALIDATION' });
  }
  const titleAr = req.body.title_ar ? String(req.body.title_ar).trim() : null;

  await query(
    `INSERT INTO staff_goals (user_id, title_ar, target_count, bonus_amount, deadline, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, titleAr, target, bonus, deadline.toISOString(), req.user.id]
  );
  res.status(201).json({ data: await buildGoalSummary(id) });
}



/**
 * GET /admin/staff/:id/salary
 * Return salary summary for a staff member.
 */
async function getStaffSalary(req, res) {
  const { id } = req.params;
  const { err } = await resolveStaffUser(id);
  if (err) return res.status(err.status).json(err.body);

  const summary = await buildSalarySummary(id);
  res.json({ data: summary });
}

/**
 * POST /admin/staff/:id/salary
 * Body: { base_salary: number (integer >= 0) }
 * UPSERT staff_salaries + record a salary_set transaction.
 */
async function setStaffSalary(req, res) {
  const { id } = req.params;
  const { err } = await resolveStaffUser(id);
  if (err) return res.status(err.status).json(err.body);

  const raw = req.body.base_salary;
  if (raw === undefined || raw === null) {
    return res.status(400).json({ error: 'الراتب مطلوب', code: 'ERR_VALIDATION' });
  }
  const base_salary = Number(raw);
  if (!Number.isInteger(base_salary) || base_salary < 0) {
    return res.status(400).json({ error: 'الراتب يجب أن يكون عدداً صحيحاً أكبر من أو يساوي صفر', code: 'ERR_VALIDATION' });
  }

  await tx(async (client) => {
    await client.query(
      `INSERT INTO staff_salaries (user_id, base_salary, updated_at, updated_by)
       VALUES ($1, $2, NOW(), $3)
       ON CONFLICT (user_id) DO UPDATE
         SET base_salary  = EXCLUDED.base_salary,
             updated_at   = NOW(),
             updated_by   = EXCLUDED.updated_by`,
      [id, base_salary, req.user.id]
    );
    await client.query(
      `INSERT INTO staff_salary_transactions (user_id, type, amount, reason_ar, created_by)
       VALUES ($1, 'salary_set', $2, NULL, $3)`,
      [id, base_salary, req.user.id]
    );
  });

  const summary = await buildSalarySummary(id);
  res.json({ data: summary });
}

/**
 * POST /admin/staff/:id/salary/bonus
 * Body: { amount: number (integer > 0), reason_ar?: string }
 */
async function addBonus(req, res) {
  const { id } = req.params;
  const { err } = await resolveStaffUser(id);
  if (err) return res.status(err.status).json(err.body);

  const raw = req.body.amount;
  if (raw === undefined || raw === null) {
    return res.status(400).json({ error: 'المبلغ مطلوب', code: 'ERR_VALIDATION' });
  }
  const amount = Number(raw);
  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: 'المبلغ يجب أن يكون عدداً صحيحاً أكبر من صفر', code: 'ERR_VALIDATION' });
  }

  const reason_ar = req.body.reason_ar ? String(req.body.reason_ar).trim() : null;

  await query(
    `INSERT INTO staff_salary_transactions (user_id, type, amount, reason_ar, source_type, created_by)
     VALUES ($1, 'bonus', $2, $3, 'manual', $4)`,
    [id, amount, reason_ar, req.user.id]
  );

  const summary = await buildSalarySummary(id);
  res.json({ data: summary });
}

/**
 * POST /admin/staff/:id/salary/deduction
 * Body: { amount: number (integer > 0), reason_ar?: string }
 */
async function addDeduction(req, res) {
  const { id } = req.params;
  const { err } = await resolveStaffUser(id);
  if (err) return res.status(err.status).json(err.body);

  const raw = req.body.amount;
  if (raw === undefined || raw === null) {
    return res.status(400).json({ error: 'المبلغ مطلوب', code: 'ERR_VALIDATION' });
  }
  const amount = Number(raw);
  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: 'المبلغ يجب أن يكون عدداً صحيحاً أكبر من صفر', code: 'ERR_VALIDATION' });
  }

  const reason_ar = req.body.reason_ar ? String(req.body.reason_ar).trim() : null;

  await query(
    `INSERT INTO staff_salary_transactions (user_id, type, amount, reason_ar, source_type, created_by)
     VALUES ($1, 'deduction', $2, $3, 'manual', $4)`,
    [id, amount, reason_ar, req.user.id]
  );

  const summary = await buildSalarySummary(id);
  res.json({ data: summary });
}

/**
 * DELETE /admin/staff/:id/salary/transactions/:txnId
 * Soft-remove a manual bonus/deduction without erasing audit history.
 */
async function removeTransaction(req, res) {
  const { id, txnId } = req.params;
  const { err } = await resolveStaffUser(id);
  if (err) return res.status(err.status).json(err.body);

  const note = req.body?.reason_ar ? String(req.body.reason_ar).trim() : null;
  const { rows } = await query(
    `UPDATE staff_salary_transactions
        SET deleted_at = NOW(),
            deleted_by = $3,
            delete_reason_ar = $4
      WHERE id = $1
        AND user_id = $2
        AND type IN ('bonus', 'deduction')
        AND source_type = 'manual'
        AND deleted_at IS NULL
      RETURNING id`,
    [txnId, id, req.user.id, note]
  );
  if (!rows.length) {
    return res.status(404).json({
      error: 'لا يمكن حذف هذه المعاملة',
      code: 'ERR_NOT_FOUND',
    });
  }
  res.json({ data: await buildSalarySummary(id) });
}

/**
 * GET /admin/staff/:id/activity?month=YYYY-MM
 * One shared builder (lib/staffActivity) with /payroll/me/activity — stage moves AND
 * embroidery-zone ticks, newest first, scoped to one calendar month (default: current
 * month at the shop). See lib/staffActivity.js for why both sources are needed.
 */
async function getStaffActivity(req, res) {
  const { id } = req.params;
  const { err } = await resolveStaffUser(id);
  if (err) return res.status(err.status).json(err.body);

  let rows;
  try {
    rows = await activityFor(id, { month: req.query.month });
  } catch (e) {
    if (e.code === 'ERR_VALIDATION') {
      return res.status(400).json({ error: e.message, code: e.code });
    }
    throw e;
  }
  res.json({ data: rows, meta: { month: rows[0]?.month ?? monthBounds(req.query.month).key } });
}

// ─── Staff self endpoints ─────────────────────────────────────────────────────

/**
 * GET /payroll/me/salary  (or /staff/me/salary)
 * Staff member reads their own salary summary.
 */
async function getMySalary(req, res) {
  const userId = req.user.id;
  // For staff role, confirm they are indeed staff (should always be true via requireRole guard)
  const summary = await buildSalarySummary(userId);
  res.json({ data: summary });
}

/**
 * GET /payroll/me/activity  (or /staff/me/activity)  ?month=YYYY-MM
 * Staff member reads their own activity log — same builder as getStaffActivity above.
 */
async function getMyActivity(req, res) {
  const userId = req.user.id;

  let rows;
  try {
    rows = await activityFor(userId, { month: req.query.month });
  } catch (e) {
    if (e.code === 'ERR_VALIDATION') {
      return res.status(400).json({ error: e.message, code: e.code });
    }
    throw e;
  }
  res.json({ data: rows, meta: { month: rows[0]?.month ?? monthBounds(req.query.month).key } });
}

/** GET /payroll/me/goal — the logged-in staff member's own goal + progress. */
async function getMyGoal(req, res) {
  res.json({ data: await buildGoalSummary(req.user.id) });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payroll/me/summary?month=YYYY-MM — «راتبي ونشاطي», the whole month.
//
// One call, one screen. Owner request 2026-08-27: «الأيام يلي أنجز بيها والساعات وعدد
// الفتحات وتقصيره والخصومات وليش والحوافز وليش وكلشي».
//
// THE RULE THIS PAGE IS BUILT ON: every number carries its own sentence. A deduction with no
// reason next to it is the thing this page exists to remove, so anything that cannot explain
// itself does not get a tile.
//
// ⚠️ Lateness and salary are DIFFERENT LEDGERS and are shown as such. `deduction_amount` on
// an attendance record is never posted to `staff_salary_transactions` — nothing writes it,
// and `deduction_transaction_id` is only ever cleared. Merging the two into one «رصيدك» would
// invent a debt the shop has not actually charged. الحضور section says «معروض، ما انخصم».
// ─────────────────────────────────────────────────────────────────────────────

/** 'YYYY-MM' → { from, to } as inclusive date strings, plus the days in the month. */
function monthRange(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    from: `${monthKey}-01`,
    to: `${monthKey}-${String(last).padStart(2, '0')}`,
    days: last,
  };
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

async function getMySummary(req, res) {
  const userId = req.user.id;
  const settings = await attendance.loadEffectiveSettings(userId);
  const timeZone = settings.timezone || DEFAULT_TZ;

  // Default to the current month AT THE SHOP, never the server's UTC month — between 21:00
  // and midnight Baghdad on the last of the month those are different months, and the page
  // would open on an empty one. Same rule lib/shopTime.js exists for.
  const requested = String(req.query.month || '');
  const monthKey = MONTH_RE.test(requested)
    ? requested
    : localParts(new Date(), timeZone).date.slice(0, 7);
  const { from, to } = monthRange(monthKey);

  const [week, holidays, records, breakRows, salary, goal, work] = await Promise.all([
    schedule.loadWeek(),
    schedule.loadHolidays(from, to),
    query(
      `SELECT to_char(r.work_date, 'YYYY-MM-DD') AS work_date,
              r.check_in_at, r.check_out_at,
              to_char(r.expected_start_time, 'HH24:MI') AS expected_start_time,
              to_char(r.expected_end_time,   'HH24:MI') AS expected_end_time,
              r.late_minutes, r.deduction_amount, r.status, r.admin_note_ar,
              (SELECT COALESCE(SUM(b.minutes), 0)::int
                 FROM staff_attendance_breaks b
                WHERE b.attendance_id = r.id AND b.state = 'returned') AS break_minutes
         FROM staff_attendance_records r
        WHERE r.user_id = $1 AND r.work_date BETWEEN $2::date AND $3::date
        ORDER BY r.work_date`,
      [userId, from, to]
    ),
    query(
      `SELECT id, to_char(work_date, 'YYYY-MM-DD') AS work_date, reason_ar, minutes,
              free_minutes, deducted_minutes, deduction_amount, approval, state,
              left_without_approval, auto_closed, requested_at
         FROM staff_attendance_breaks
        WHERE user_id = $1 AND month_key = $2 AND state <> 'cancelled'
        ORDER BY requested_at DESC`,
      [userId, monthKey]
    ),
    buildSalarySummary(userId),
    buildGoalSummary(userId),
    query(
      `SELECT to_char(created_at AT TIME ZONE 'UTC' AT TIME ZONE $3, 'YYYY-MM-DD') AS d,
              COUNT(*)::int AS pieces
         FROM staff_activity_log
        WHERE user_id = $1
          AND action IN ('advance', 'approve_design')
          AND created_at >= ($2 || '-01')::date
          AND created_at <  (($2 || '-01')::date + INTERVAL '1 month')
        GROUP BY 1 ORDER BY 1`,
      [userId, monthKey, timeZone]
    ),
  ]);

  const recByDate = new Map(records.rows.map((r) => [r.work_date, r]));
  const piecesByDate = new Map(work.rows.map((r) => [r.d, Number(r.pieces)]));

  // Every calendar day of the month, present or not — «شنو صار بشهري» is a calendar
  // question, and a list of only the days someone showed up cannot answer «وين غبت».
  const days = [];
  const totals = {
    worked_days: 0, worked_minutes: 0, late_days: 0, late_minutes: 0,
    late_amount_shown: 0, absent_days: 0, off_days: 0, holiday_days: 0, pieces: 0,
  };
  const today = localParts(new Date(), timeZone).date;

  for (let i = 1; i <= monthRange(monthKey).days; i += 1) {
    const date = `${monthKey}-${String(i).padStart(2, '0')}`;
    const shift = schedule.shiftForDate(date, { week, settings, holidays });
    const rec = recByDate.get(date) || null;
    const pieces = piecesByDate.get(date) || 0;

    const presentMinutes = rec?.check_in_at && rec?.check_out_at
      ? Math.max(0, Math.floor((new Date(rec.check_out_at) - new Date(rec.check_in_at)) / 60000))
      : 0;
    const workedMinutes = Math.max(0, presentMinutes - Number(rec?.break_minutes || 0));

    // A day is only «غياب» once it is in the past, the shop was open, and nothing was
    // stamped. Today and the rest of the month are not absences yet.
    const absent = !rec && shift.counts_lateness && date < today;

    if (rec) {
      totals.worked_days += 1;
      totals.worked_minutes += workedMinutes;
      if (Number(rec.late_minutes) > 0) {
        totals.late_days += 1;
        totals.late_minutes += Number(rec.late_minutes);
        totals.late_amount_shown += Number(rec.deduction_amount);
      }
    }
    if (absent) totals.absent_days += 1;
    if (shift.holiday_ar) totals.holiday_days += 1;
    else if (shift.is_off) totals.off_days += 1;
    totals.pieces += pieces;

    days.push({
      date,
      weekday_label_ar: shift.weekday_label_ar,
      expected_start_time: rec?.expected_start_time || shift.start_time,
      expected_end_time: rec?.expected_end_time || shift.end_time,
      is_off: shift.is_off,
      holiday_ar: shift.holiday_ar,
      check_in_at: rec?.check_in_at || null,
      check_out_at: rec?.check_out_at || null,
      worked_minutes: workedMinutes,
      break_minutes: Number(rec?.break_minutes || 0),
      late_minutes: Number(rec?.late_minutes || 0),
      // ⚠️ «معروض» not «مخصوم» — see the header. This never reached the salary ledger.
      late_amount_shown: Number(rec?.deduction_amount || 0),
      absent,
      pieces,
      note_ar: rec?.admin_note_ar || null,
    });
  }

  const allowance = breaks.effectiveAllowance(settings);
  const balance = await breaks.loadBalance({ query }, userId, monthKey, allowance);

  return res.json({
    data: {
      month: monthKey,
      timezone: timeZone,
      schedule: week,
      days,
      totals,
      breaks: {
        ...balance,
        allowance_minutes: allowance,
        rows: breakRows.rows.map((b) => ({
          ...b,
          minutes: Number(b.minutes),
          free_minutes: Number(b.free_minutes),
          deducted_minutes: Number(b.deducted_minutes),
          deduction_amount: Number(b.deduction_amount),
        })),
      },
      salary,
      goal,
    },
  });
}

/**
 * GET /payroll/me/statement            (optional ?month=YYYY-MM)
 *
 * «حصيلة شهرك وراتبك» — the frozen monthly statement, read straight off the row.
 *
 * ⚠️ NOTHING HERE IS RECOMPUTED, and that is the whole point of the table (migration 099).
 * The rates, the counts and the day list were snapshotted at publish time; re-deriving any of
 * them from live attendance rows would let a later schedule edit, holiday or admin override
 * move a number the shop has already paid in cash.
 *
 * ⚠️ `published_at IS NOT NULL` is the visibility gate. An unpublished row is a draft being
 * checked and must stay invisible — hiding it in the UI alone is not the same thing.
 */
async function getMyStatement(req, res) {
  const requested = String(req.query.month || '');
  const params = [req.user.id];
  let filter = '';
  if (MONTH_RE.test(requested)) {
    params.push(requested);
    filter = 'AND month_key = $2';
  }

  const { rows } = await query(
    `SELECT month_key, day_rate, half_rate, minute_rate, grace_minutes,
            full_shifts, half_shifts, leave_days, unpaid_days,
            late_days, late_minutes, waived_minutes,
            gross, late_deduction, other_deduction, other_reason_ar, net,
            note_ar, days, published_at
       FROM staff_payroll_statements
      WHERE user_id = $1 AND published_at IS NOT NULL ${filter}
      ORDER BY month_key DESC
      LIMIT 1`,
    params
  );
  if (!rows.length) return res.json({ data: null });

  const r = rows[0];
  const n = (v) => Number(v || 0);
  return res.json({
    data: {
      month: r.month_key,
      dayRate: n(r.day_rate),
      halfRate: n(r.half_rate),
      minuteRate: n(r.minute_rate),
      graceMinutes: n(r.grace_minutes),
      fullShifts: n(r.full_shifts),
      halfShifts: n(r.half_shifts),
      leaveDays: n(r.leave_days),
      unpaidDays: n(r.unpaid_days),
      lateDays: n(r.late_days),
      lateMinutes: n(r.late_minutes),
      waivedMinutes: n(r.waived_minutes),
      gross: n(r.gross),
      lateDeduction: n(r.late_deduction),
      otherDeduction: n(r.other_deduction),
      otherReasonAr: r.other_reason_ar,
      net: n(r.net),
      noteAr: r.note_ar,
      days: Array.isArray(r.days) ? r.days : [],
      publishedAt: r.published_at,
    },
  });
}

module.exports = {
  getStaffSalary,
  setStaffSalary,
  addBonus,
  addDeduction,
  removeTransaction,
  getStaffActivity,
  getStaffGoal,
  setStaffGoal,
  getMySalary,
  getMyActivity,
  getMyGoal,
  getMySummary,
  getMyStatement,
};
