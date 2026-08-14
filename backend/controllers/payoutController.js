/**
 * SuperQi payout destinations and manual-transfer records.
 *
 * A destination is BOTH numbers: the 16-digit SuperQi Mastercard and the
 * 9-digit SuperQi account number. Both are required on every save (owner rule,
 * 2026-07-29) — the DB columns stay nullable only for rows written before
 * migration 073, which cannot be re-saved or paid until they are completed.
 *
 * This controller never talks to a bank. It stores the recipient's numbers and
 * lets an admin record a transfer only after completing it externally.
 */

const { query } = require('../lib/db');
const {
  normalizeCardNumber,
  normalizeAccountNumber,
  isValidCardNumber,
  isValidAccountNumber,
} = require('../lib/payoutAccount');
const {
  accruedAmount,
  netDue,
  suggestedTransfer,
  mergeRecipients,
} = require('../lib/payoutMath');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECIPIENT_KINDS = new Set(['staff', 'tailor', 'workshop']);
const n = (value) => Number(value || 0);

/**
 * Payout actions were the only admin money mutations writing NOTHING to `audit_log`
 * (0 occurrences in this file before 2026-08-14), so a repointed card or a recorded
 * transfer left no trace of who did it. Never called with a card or account number —
 * only the last four digits, see the call sites.
 *
 * Deliberately non-fatal: an audit insert that throws must not roll back a transfer the
 * admin has already made in their banking app. A missing log line is recoverable; a
 * payout the shop cannot see is not.
 */
async function writePayoutAudit(actorId, action, entity, entityId, details) {
  try {
    await query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [actorId, action, entity, entityId, JSON.stringify(details)]
    );
  } catch (err) {
    console.error('[payout] audit_log write failed', action, entityId, err.message);
  }
}

function mapAccount(row) {
  return {
    provider: 'superqi_mastercard',
    card_number: row?.card_number || null,
    account_number: row?.account_number || null,
    cardholder_name: row?.cardholder_name || null,
    updated_at: row?.updated_at || null,
  };
}

async function accountForUser(userId) {
  const { rows } = await query(
    `SELECT provider, card_number, account_number, cardholder_name, updated_at
       FROM payout_accounts
      WHERE user_id = $1`,
    [userId]
  );
  return mapAccount(rows[0]);
}

function validateAccountBody(body) {
  const cardNumber = normalizeCardNumber(body?.card_number);
  if (!isValidCardNumber(cardNumber)) {
    return {
      error: 'رقم بطاقة SuperQi يجب أن يتكون من 16 رقماً',
      code: 'ERR_VALIDATION',
      field: 'card_number',
    };
  }
  const accountNumber = normalizeAccountNumber(body?.account_number);
  if (!isValidAccountNumber(accountNumber)) {
    return {
      error: 'أدخل رقم حساب SuperQi (أرقام فقط)',
      code: 'ERR_VALIDATION',
      field: 'account_number',
    };
  }
  const cardholderName = String(body?.cardholder_name || '').trim() || null;
  if (cardholderName && cardholderName.length > 120) {
    return { error: 'اسم حامل البطاقة طويل جداً', code: 'ERR_VALIDATION' };
  }
  return { cardNumber, accountNumber, cardholderName };
}

async function upsertAccount(userId, body, actorId) {
  const validated = validateAccountBody(body);
  if (validated.error) return validated;
  const { rows } = await query(
    `INSERT INTO payout_accounts
       (user_id, provider, card_number, account_number, cardholder_name, updated_at, updated_by)
     VALUES ($1, 'superqi_mastercard', $2, $3, $4, NOW(), $5)
     ON CONFLICT (user_id) DO UPDATE
       SET provider = EXCLUDED.provider,
           card_number = EXCLUDED.card_number,
           account_number = EXCLUDED.account_number,
           cardholder_name = EXCLUDED.cardholder_name,
           updated_at = NOW(),
           updated_by = EXCLUDED.updated_by
     RETURNING provider, card_number, account_number, cardholder_name, updated_at`,
    [
      userId,
      validated.cardNumber,
      validated.accountNumber,
      validated.cardholderName,
      actorId,
    ]
  );
  // Changing where someone's salary lands is a money action and belongs in the same
  // log as every other admin mutation — it was the one that wrote nothing. Only the
  // last four digits are recorded: the log answers «who repointed this card, when»,
  // and a full PAN in a table half the admin screens can read is not worth that.
  await writePayoutAudit(actorId, 'update_payout_account', 'payout_account', userId, {
    card_last4: validated.cardNumber.slice(-4),
    account_last4: validated.accountNumber.slice(-4),
    self_service: actorId === userId,
  });
  return { account: mapAccount(rows[0]) };
}

/**
 * Workshop crew (Team B — including ابو عبدو الفصال, who holds a `staff` role but is
 * linked into the workshop roster) do NOT manage their own payout card. An admin sets
 * it for them from /admin/payouts. Checked against the roster rather than a name or a
 * staff_type so the rule keeps holding as the roster changes.
 */
async function isWorkshopCrew(userId) {
  const { rows } = await query(
    `SELECT 1 FROM workshop_workers WHERE user_id = $1`,
    [userId]
  );
  return rows.length > 0;
}

async function getMyAccount(req, res) {
  if (await isWorkshopCrew(req.user.id)) {
    return res.json({ data: { ...mapAccount(null), eligible: false } });
  }
  res.json({ data: { ...(await accountForUser(req.user.id)), eligible: true } });
}

async function saveMyAccount(req, res) {
  if (await isWorkshopCrew(req.user.id)) {
    return res.status(403).json({
      error: 'بطاقة استلام الراتب لطاقم الورشة يضبطها المدير',
      code: 'ERR_FORBIDDEN',
    });
  }
  const result = await upsertAccount(req.user.id, req.body, req.user.id);
  if (result.error) return res.status(400).json(result);
  res.json({ data: { ...result.account, eligible: true } });
}

async function assertPayoutUser(userId) {
  const { rows } = await query(
    `SELECT u.id
       FROM users u
      WHERE u.id = $1
        AND (
          u.role IN ('staff', 'worker')
          OR EXISTS (
            SELECT 1 FROM workshop_workers w WHERE w.user_id = u.id
          )
        )`,
    [userId]
  );
  return rows.length > 0;
}

async function adminSaveAccount(req, res) {
  const { userId } = req.params;
  if (!UUID_RE.test(String(userId)) || !(await assertPayoutUser(userId))) {
    return res.status(404).json({ error: 'مستلم الراتب غير موجود', code: 'ERR_NOT_FOUND' });
  }
  const result = await upsertAccount(userId, req.body, req.user.id);
  if (result.error) return res.status(400).json(result);
  res.json({ data: result.account });
}

async function staffRecipients() {
  const { rows } = await query(
    `SELECT
       u.id AS user_id,
       u.id AS source_id,
       u.name,
       CASE
         WHEN u.staff_type = 'tailor'
           OR 'tailor'::staff_type = ANY(u.staff_types)
         THEN 'tailor'
         ELSE 'staff'
       END AS recipient_kind,
       COALESCE(ss.base_salary, 0) AS base_salary,
       COALESCE(st.bonuses, 0) AS bonuses,
       COALESCE(st.deductions, 0) AS deductions,
       pa.card_number,
       pa.account_number,
       pa.cardholder_name,
       pa.updated_at AS card_updated_at,
       lp.amount AS last_payout_amount,
       lp.paid_at AS last_payout_at,
       COALESCE(tp.paid_total, 0) AS paid_total
     FROM users u
     LEFT JOIN staff_salaries ss ON ss.user_id = u.id
     LEFT JOIN (
       SELECT user_id,
         COALESCE(SUM(amount) FILTER (WHERE type = 'bonus'), 0) AS bonuses,
         COALESCE(SUM(amount) FILTER (WHERE type = 'deduction'), 0) AS deductions
       FROM staff_salary_transactions
       WHERE deleted_at IS NULL AND source_type <> 'attendance'
       GROUP BY user_id
     ) st ON st.user_id = u.id
     LEFT JOIN payout_accounts pa ON pa.user_id = u.id
     LEFT JOIN LATERAL (
       SELECT amount, paid_at
       FROM manual_payouts mp
       WHERE mp.source_id = u.id
         AND mp.recipient_kind IN ('staff', 'tailor')
       ORDER BY paid_at DESC
       LIMIT 1
     ) lp ON TRUE
     -- Everything already transferred to this person, on the SAME predicate the
     -- last-payout lateral uses. Without it «المبلغ المقترح» is a lifetime accrual
     -- that pays the full salary again on every press (see lib/payoutMath.js).
     LEFT JOIN (
       SELECT source_id, SUM(amount) AS paid_total
       FROM manual_payouts
       WHERE recipient_kind IN ('staff', 'tailor')
       GROUP BY source_id
     ) tp ON tp.source_id = u.id
     WHERE u.role = 'staff'
     ORDER BY u.name`
  );
  return rows.map((row) => {
    const accrued = accruedAmount({
      base: row.base_salary,
      bonuses: row.bonuses,
      deductions: row.deductions,
    });
    const due = netDue(accrued, row.paid_total);
    return {
      user_id: row.user_id,
      source_id: row.source_id,
      name: row.name,
      recipient_kind: row.recipient_kind,
      accrued_amount: accrued,
      paid_total: n(row.paid_total),
      net_due: due,
      suggested_amount: suggestedTransfer(due),
      card_number: row.card_number || null,
      account_number: row.account_number || null,
      cardholder_name: row.cardholder_name || null,
      card_updated_at: row.card_updated_at || null,
      last_payout_amount: row.last_payout_amount == null ? null : n(row.last_payout_amount),
      last_payout_at: row.last_payout_at || null,
    };
  });
}

async function workshopRecipients() {
  const { rows } = await query(
    `SELECT
       u.id AS user_id,
       w.id AS source_id,
       u.name,
       COALESCE(p.production, 0) AS production,
       COALESCE(a.bonuses, 0) AS bonuses,
       COALESCE(a.deductions, 0) AS deductions,
       pa.card_number,
       pa.account_number,
       pa.cardholder_name,
       pa.updated_at AS card_updated_at,
       lp.amount AS last_payout_amount,
       lp.paid_at AS last_payout_at,
       COALESCE(tp.paid_total, 0) AS paid_total
     FROM workshop_workers w
     JOIN users u ON u.id = w.user_id
     LEFT JOIN (
       SELECT worker_id, SUM(amount) AS production
       FROM workshop_production_entries
       GROUP BY worker_id
     ) p ON p.worker_id = w.id
     LEFT JOIN (
       SELECT worker_id,
         COALESCE(SUM(amount) FILTER (WHERE kind = 'bonus'), 0) AS bonuses,
         COALESCE(SUM(amount) FILTER (WHERE kind = 'deduction'), 0) AS deductions
       FROM workshop_adjustments
       GROUP BY worker_id
     ) a ON a.worker_id = w.id
     LEFT JOIN payout_accounts pa ON pa.user_id = u.id
     LEFT JOIN LATERAL (
       SELECT amount, paid_at
       FROM manual_payouts mp
       WHERE mp.source_id = w.id AND mp.recipient_kind = 'workshop'
       ORDER BY paid_at DESC
       LIMIT 1
     ) lp ON TRUE
     -- See the note on the staff query: without this the suggestion is a lifetime
     -- accrual that re-pays the whole production run on every press.
     LEFT JOIN (
       SELECT source_id, SUM(amount) AS paid_total
       FROM manual_payouts
       WHERE recipient_kind = 'workshop'
       GROUP BY source_id
     ) tp ON tp.source_id = w.id
     WHERE w.active = TRUE
     ORDER BY u.name`
  );
  return rows.map((row) => {
    const accrued = accruedAmount({
      production: row.production,
      bonuses: row.bonuses,
      deductions: row.deductions,
    });
    const due = netDue(accrued, row.paid_total);
    return {
      user_id: row.user_id,
      source_id: row.source_id,
      name: row.name,
      recipient_kind: 'workshop',
      accrued_amount: accrued,
      paid_total: n(row.paid_total),
      net_due: due,
      suggested_amount: suggestedTransfer(due),
      card_number: row.card_number || null,
      account_number: row.account_number || null,
      cardholder_name: row.cardholder_name || null,
      card_updated_at: row.card_updated_at || null,
      last_payout_amount: row.last_payout_amount == null ? null : n(row.last_payout_amount),
      last_payout_at: row.last_payout_at || null,
    };
  });
}

/**
 * The payout board, deduplicated. Exported so the money tests can assert against the
 * real rows rather than a mock — the defects this closes were all in the SQL and the
 * merge, which a mocked query would have happily reproduced.
 */
async function listRecipients() {
  const [staff, workshop] = await Promise.all([staffRecipients(), workshopRecipients()]);
  return mergeRecipients(staff, workshop);
}

async function payoutHistory() {
  const { rows } = await query(
    `SELECT
       mp.id,
       mp.user_id,
       mp.recipient_kind,
       mp.source_id,
       mp.amount,
       mp.card_number_snapshot,
       mp.account_number_snapshot,
       mp.note,
       mp.paid_at,
       mp.created_at,
       recipient.name,
       admin_user.name AS created_by_name
     FROM manual_payouts mp
     JOIN users recipient ON recipient.id = mp.user_id
     LEFT JOIN users admin_user ON admin_user.id = mp.created_by
     ORDER BY mp.paid_at DESC
     LIMIT 100`
  );
  return rows.map((row) => ({ ...row, amount: n(row.amount) }));
}

async function adminDashboard(req, res) {
  const [recipients, history] = await Promise.all([listRecipients(), payoutHistory()]);
  res.json({ data: { recipients, history } });
}

async function resolveRecipient(userId, sourceId, requestedKind) {
  if (requestedKind === 'workshop') {
    const { rows } = await query(
      `SELECT w.id
         FROM workshop_workers w
        WHERE w.id = $1 AND w.user_id = $2`,
      [sourceId, userId]
    );
    return rows.length ? 'workshop' : null;
  }

  const { rows } = await query(
    `SELECT
       CASE
         WHEN staff_type = 'tailor'
           OR 'tailor'::staff_type = ANY(staff_types)
         THEN 'tailor'
         ELSE 'staff'
       END AS recipient_kind
       FROM users
      WHERE id = $1 AND role = 'staff' AND id = $2`,
    [sourceId, userId]
  );
  return rows[0]?.recipient_kind || null;
}

async function recordManualPayout(req, res) {
  const { user_id: userId, source_id: sourceId, recipient_kind: requestedKind } = req.body || {};
  const amount = Number(req.body?.amount);
  const note = String(req.body?.note || '').trim() || null;

  if (
    !UUID_RE.test(String(userId))
    || !UUID_RE.test(String(sourceId))
    || !RECIPIENT_KINDS.has(requestedKind)
    || !Number.isSafeInteger(amount)
    || amount <= 0
    || (note && note.length > 500)
  ) {
    return res.status(400).json({ error: 'بيانات التحويل غير صحيحة', code: 'ERR_VALIDATION' });
  }

  const actualKind = await resolveRecipient(userId, sourceId, requestedKind);
  if (!actualKind || actualKind !== requestedKind) {
    return res.status(404).json({ error: 'مستلم الراتب غير موجود', code: 'ERR_NOT_FOUND' });
  }

  // Both numbers must be on file before money is recorded as moved — the log
  // snapshots exactly what the admin copied. Rows saved before migration 073
  // carry only a card and are blocked here until an admin completes them.
  const account = await accountForUser(userId);
  if (!account.card_number || !account.account_number) {
    return res.status(409).json({
      error: 'لا يمكن تسجيل التحويل قبل إضافة رقم بطاقة SuperQi ورقم الحساب',
      code: 'ERR_PAYOUT_ACCOUNT_REQUIRED',
    });
  }

  const { rows } = await query(
    `INSERT INTO manual_payouts
       (user_id, recipient_kind, source_id, amount, card_number_snapshot,
        account_number_snapshot, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, user_id, recipient_kind, source_id, amount,
               card_number_snapshot, account_number_snapshot, note, paid_at, created_at`,
    [
      userId,
      requestedKind,
      sourceId,
      amount,
      account.card_number,
      account.account_number,
      note,
      req.user.id,
    ]
  );
  await writePayoutAudit(req.user.id, 'record_manual_payout', 'manual_payout', rows[0].id, {
    recipient_user_id: userId,
    recipient_kind: requestedKind,
    source_id: sourceId,
    amount,
    card_last4: account.card_number.slice(-4),
  });

  res.status(201).json({ data: { ...rows[0], amount: n(rows[0].amount) } });
}

module.exports = {
  getMyAccount,
  saveMyAccount,
  adminSaveAccount,
  adminDashboard,
  recordManualPayout,
  listRecipients,
};
