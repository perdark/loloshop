/**
 * الخروج المؤقت — monthly allowance + charge engine for temporary leave.
 *
 * THE MONEY RULE LIVES HERE AND NOWHERE ELSE:
 *   the monthly balance always decrements by the FULL real minutes of a break
 *   free     = approved ? min(minutes, remaining_before_this_break) : 0
 *   deducted = minutes - free
 *   amount   = deducted * deduction_per_minute   (frozen on the row at return time)
 *
 * So an approved break inside the allowance is free, an approved break that
 * crosses the allowance costs only the excess minutes, and a break the admin
 * never approved costs every minute. Unapproved minutes still consume the
 * allowance — the balance measures time out of the shop, so skipping the
 * request can never buy extra free time.
 *
 * Because a later admin decision changes how the allowance is spent, any change
 * re-runs the WHOLE month for that worker in chronological order
 * (`recomputeMonth`) instead of patching one row. That is what keeps the sum of
 * the parts equal to the balance no matter what order the admin acts in.
 *
 * The rate is frozen per row: editing the shop's deduction_per_minute later
 * never rewrites past charges (same rule as the workshop wage ledger).
 */

const DEFAULT_TZ = 'Asia/Baghdad';

/** Break deductions are real salary transactions, unlike lateness (see notes in HANDOFF). */
const BREAK_SOURCE_TYPE = 'attendance_break';
/** A break still open after this long is flagged for the admin instead of billed silently. */
const OPEN_BREAK_ALERT_MINUTES = 240;
/** Upper bound on the declared intent, so a typo can't render as "480 minutes". */
const MAX_REQUEST_MINUTES = 8 * 60;

/** Quota bucket for a moment in time: 'YYYY-MM' in the shop's timezone. */
function monthKeyFor(date = new Date(), timeZone = DEFAULT_TZ) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' })
    .formatToParts(date)
    .reduce((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value;
      return acc;
    }, {});
  return `${parts.year}-${parts.month}`;
}

/**
 * Real elapsed minutes of a break, rounded to the nearest minute but never 0 —
 * a worker who left and came back has been out, and a free sub-minute break
 * would be a loophole worth nothing to anyone.
 */
function elapsedMinutes(from, to) {
  if (!from || !to) return 0;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.max(1, Math.round(ms / 60000));
}

/** The effective monthly allowance: the per-staff override, else the shop default. */
function effectiveAllowance(settings) {
  const value = Number(settings?.break_monthly_minutes);
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

/** The rule, as a pure function — everything else here just feeds it. */
function computeCharge({ minutes, approved, remainingBefore, perMinute }) {
  const total = toInt(minutes);
  const remaining = toInt(remainingBefore);
  const rate = toInt(perMinute);
  const freeMinutes = approved ? Math.min(total, remaining) : 0;
  const deductedMinutes = total - freeMinutes;
  return { freeMinutes, deductedMinutes, amount: deductedMinutes * rate };
}

/**
 * `work_date` → 'YYYY-MM-DD'.
 *
 * ⚠️ NEVER `toISOString()` ON A DATE FROM THE DRIVER. `pg` hands a `date` column back as a JS
 * Date at the SERVER's local midnight, and prod runs Europe/Berlin — so a 2026-09-02 break
 * became `2026-09-01T22:00:00Z` and every reader lost a day. That is why علي اديب's live
 * 40,000 IQD deduction reads «بتاريخ 2026-09-01» for a break he took on the 2nd, and the same
 * value feeds serializeBreak, i.e. what the worker is shown. Read the calendar fields instead;
 * they are already the date the driver parsed.
 */
function dateOnly(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function deductionReason(row) {
  return `خصم خروج مؤقت — ${row.deductedMinutes} دقيقة بتاريخ ${dateOnly(row.work_date)}`;
}

async function softDeleteTxn(client, id, actorId, reason) {
  await client.query(
    `UPDATE staff_salary_transactions
        SET deleted_at = NOW(), deleted_by = $2, delete_reason_ar = $3
      WHERE id = $1 AND deleted_at IS NULL`,
    [id, actorId, reason]
  );
}

/**
 * Make the salary ledger match the break's computed charge.
 * Returns the id of the live deduction transaction, or null when nothing is owed.
 * Amount changes replace the row (soft-delete + insert) so the history stays readable.
 */
async function syncDeductionTxn(client, row, actorId) {
  const current = row.deduction_transaction_id
    ? (
        await client.query(
          `SELECT id, amount FROM staff_salary_transactions
            WHERE id = $1 AND deleted_at IS NULL
            FOR UPDATE`,
          [row.deduction_transaction_id]
        )
      ).rows[0] || null
    : null;

  if (row.amount > 0) {
    if (current && Number(current.amount) === row.amount) return current.id;
    if (current) await softDeleteTxn(client, current.id, actorId, 'إعادة حساب خصم الخروج المؤقت');
    const inserted = await client.query(
      `INSERT INTO staff_salary_transactions
         (user_id, type, amount, reason_ar, source_type, source_id, created_by)
       VALUES ($1, 'deduction', $2, $3, $4, $5, $6)
       RETURNING id`,
      [row.user_id, row.amount, deductionReason(row), BREAK_SOURCE_TYPE, row.id, actorId]
    );
    return inserted.rows[0].id;
  }

  if (current) {
    await softDeleteTxn(client, current.id, actorId, 'خروج مؤقت مصرَّح — لا خصم');
  }
  return null;
}

/**
 * Re-run a worker's whole month in chronological order and reconcile the salary
 * ledger. Called after every event that can move the numbers: a return, an
 * approval, a rejection, an admin duration correction.
 *
 * NB the allowance is read live (a policy number), while each row's rate stays
 * frozen. Raising the allowance therefore forgives past deductions, and lowering
 * it can create them — which is what an admin changing the policy means.
 */
async function recomputeMonth(client, { userId, monthKey, allowanceMinutes, actorId = null }) {
  const { rows } = await client.query(
    `SELECT id, user_id, work_date, minutes, approval, free_minutes, deducted_minutes,
            deduction_per_minute, deduction_amount, deduction_transaction_id
       FROM staff_attendance_breaks
      WHERE user_id = $1 AND month_key = $2 AND state = 'returned'
      ORDER BY left_at ASC NULLS LAST, created_at ASC
      FOR UPDATE`,
    [userId, monthKey]
  );

  const allowance = toInt(allowanceMinutes);
  let used = 0;
  let deductedMinutes = 0;
  let deductionAmount = 0;

  for (const row of rows) {
    const minutes = toInt(row.minutes);
    const charge = computeCharge({
      minutes,
      approved: row.approval === 'approved',
      remainingBefore: allowance - used,
      perMinute: row.deduction_per_minute,
    });
    used += minutes;
    deductedMinutes += charge.deductedMinutes;
    deductionAmount += charge.amount;

    const txnId = await syncDeductionTxn(client, { ...row, ...charge }, actorId);
    const unchanged =
      Number(row.free_minutes) === charge.freeMinutes &&
      Number(row.deducted_minutes) === charge.deductedMinutes &&
      Number(row.deduction_amount) === charge.amount &&
      row.deduction_transaction_id === txnId;
    if (unchanged) continue;

    await client.query(
      `UPDATE staff_attendance_breaks
          SET free_minutes = $2, deducted_minutes = $3, deduction_amount = $4,
              deduction_transaction_id = $5, updated_at = NOW()
        WHERE id = $1`,
      [row.id, charge.freeMinutes, charge.deductedMinutes, charge.amount, txnId]
    );
  }

  return {
    month_key: monthKey,
    monthly_minutes: allowance,
    used_minutes: used,
    remaining_minutes: Math.max(0, allowance - used),
    deducted_minutes: deductedMinutes,
    deduction_amount: deductionAmount,
    break_count: rows.length,
  };
}

/** Read-only balance for a worker's month. Only returned breaks count. */
async function loadBalance(db, userId, monthKey, allowanceMinutes) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(minutes), 0)::int          AS used_minutes,
            COALESCE(SUM(deducted_minutes), 0)::int AS deducted_minutes,
            COALESCE(SUM(deduction_amount), 0)::bigint AS deduction_amount,
            COUNT(*)::int                           AS break_count
       FROM staff_attendance_breaks
      WHERE user_id = $1 AND month_key = $2 AND state = 'returned'`,
    [userId, monthKey]
  );
  const allowance = toInt(allowanceMinutes);
  const used = Number(rows[0].used_minutes);
  return {
    month_key: monthKey,
    monthly_minutes: allowance,
    used_minutes: used,
    remaining_minutes: Math.max(0, allowance - used),
    deducted_minutes: Number(rows[0].deducted_minutes),
    deduction_amount: Number(rows[0].deduction_amount),
    break_count: Number(rows[0].break_count),
  };
}

/**
 * Freeze a break that is currently out: real minutes + the rate that applied
 * when it ended. Charges are computed by the following recomputeMonth call.
 */
async function finishBreak(client, breakRow, { returnedAt, perMinute, autoClosed = false }) {
  const minutes = elapsedMinutes(breakRow.left_at, returnedAt);
  const { rows } = await client.query(
    `UPDATE staff_attendance_breaks
        SET state = 'returned', returned_at = $2, minutes = $3,
            deduction_per_minute = $4, auto_closed = $5, updated_at = NOW()
      WHERE id = $1 AND state = 'out'
      RETURNING *`,
    [breakRow.id, new Date(returnedAt).toISOString(), minutes, toInt(perMinute), !!autoClosed]
  );
  return rows[0] || null;
}

/** The worker's currently-open break (requested or out), if any. */
async function openBreakFor(db, userId) {
  const { rows } = await db.query(
    `SELECT * FROM staff_attendance_breaks
      WHERE user_id = $1 AND state IN ('requested', 'out')
      ORDER BY requested_at DESC
      LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

function serializeBreak(row, now = new Date()) {
  if (!row) return null;
  const openMinutes = row.state === 'out' ? elapsedMinutes(row.left_at, now) : 0;
  return {
    id: row.id,
    user_id: row.user_id,
    staff_name: row.staff_name || null,
    attendance_id: row.attendance_id,
    work_date: dateOnly(row.work_date),
    month_key: row.month_key,
    reason_ar: row.reason_ar,
    requested_minutes: row.requested_minutes == null ? null : Number(row.requested_minutes),
    requested_at: row.requested_at,
    left_at: row.left_at,
    returned_at: row.returned_at,
    minutes: Number(row.minutes) || 0,
    state: row.state,
    approval: row.approval,
    left_without_approval: !!row.left_without_approval,
    decided_by: row.decided_by,
    decided_at: row.decided_at,
    decision_note_ar: row.decision_note_ar,
    free_minutes: Number(row.free_minutes) || 0,
    deducted_minutes: Number(row.deducted_minutes) || 0,
    deduction_per_minute: Number(row.deduction_per_minute) || 0,
    deduction_amount: Number(row.deduction_amount) || 0,
    deduction_transaction_id: row.deduction_transaction_id,
    auto_closed: !!row.auto_closed,
    admin_note_ar: row.admin_note_ar,
    // live values for a break in progress
    open_minutes: openMinutes,
    open_too_long: row.state === 'out' && openMinutes >= OPEN_BREAK_ALERT_MINUTES,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

module.exports = {
  DEFAULT_TZ,
  BREAK_SOURCE_TYPE,
  OPEN_BREAK_ALERT_MINUTES,
  MAX_REQUEST_MINUTES,
  monthKeyFor,
  elapsedMinutes,
  effectiveAllowance,
  computeCharge,
  recomputeMonth,
  loadBalance,
  finishBreak,
  openBreakFor,
  serializeBreak,
};
