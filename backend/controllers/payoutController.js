/**
 * SuperQi Mastercard payout destinations and manual-transfer records.
 *
 * This controller never talks to a bank. It stores the recipient's card number
 * and lets an admin record a transfer only after completing it externally.
 */

const { query } = require('../lib/db');
const { normalizeCardNumber, isValidCardNumber } = require('../lib/payoutAccount');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECIPIENT_KINDS = new Set(['staff', 'tailor', 'workshop']);
const n = (value) => Number(value || 0);

function mapAccount(row) {
  return {
    provider: 'superqi_mastercard',
    card_number: row?.card_number || null,
    cardholder_name: row?.cardholder_name || null,
    updated_at: row?.updated_at || null,
  };
}

async function accountForUser(userId) {
  const { rows } = await query(
    `SELECT provider, card_number, cardholder_name, updated_at
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
    };
  }
  const cardholderName = String(body?.cardholder_name || '').trim() || null;
  if (cardholderName && cardholderName.length > 120) {
    return { error: 'اسم حامل البطاقة طويل جداً', code: 'ERR_VALIDATION' };
  }
  return { cardNumber, cardholderName };
}

async function upsertAccount(userId, body, actorId) {
  const validated = validateAccountBody(body);
  if (validated.error) return validated;
  const { rows } = await query(
    `INSERT INTO payout_accounts
       (user_id, provider, card_number, cardholder_name, updated_at, updated_by)
     VALUES ($1, 'superqi_mastercard', $2, $3, NOW(), $4)
     ON CONFLICT (user_id) DO UPDATE
       SET provider = EXCLUDED.provider,
           card_number = EXCLUDED.card_number,
           cardholder_name = EXCLUDED.cardholder_name,
           updated_at = NOW(),
           updated_by = EXCLUDED.updated_by
     RETURNING provider, card_number, cardholder_name, updated_at`,
    [userId, validated.cardNumber, validated.cardholderName, actorId]
  );
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
       pa.cardholder_name,
       pa.updated_at AS card_updated_at,
       lp.amount AS last_payout_amount,
       lp.paid_at AS last_payout_at
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
     WHERE u.role = 'staff'
     ORDER BY u.name`
  );
  return rows.map((row) => ({
    user_id: row.user_id,
    source_id: row.source_id,
    name: row.name,
    recipient_kind: row.recipient_kind,
    suggested_amount: n(row.base_salary) + n(row.bonuses) - n(row.deductions),
    card_number: row.card_number || null,
    cardholder_name: row.cardholder_name || null,
    card_updated_at: row.card_updated_at || null,
    last_payout_amount: row.last_payout_amount == null ? null : n(row.last_payout_amount),
    last_payout_at: row.last_payout_at || null,
  }));
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
       pa.cardholder_name,
       pa.updated_at AS card_updated_at,
       lp.amount AS last_payout_amount,
       lp.paid_at AS last_payout_at
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
     WHERE w.active = TRUE
     ORDER BY u.name`
  );
  return rows.map((row) => ({
    user_id: row.user_id,
    source_id: row.source_id,
    name: row.name,
    recipient_kind: 'workshop',
    suggested_amount: n(row.production) + n(row.bonuses) - n(row.deductions),
    card_number: row.card_number || null,
    cardholder_name: row.cardholder_name || null,
    card_updated_at: row.card_updated_at || null,
    last_payout_amount: row.last_payout_amount == null ? null : n(row.last_payout_amount),
    last_payout_at: row.last_payout_at || null,
  }));
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
  const [staff, workshop, history] = await Promise.all([
    staffRecipients(),
    workshopRecipients(),
    payoutHistory(),
  ]);
  res.json({ data: { recipients: [...staff, ...workshop], history } });
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

  const account = await accountForUser(userId);
  if (!account.card_number) {
    return res.status(409).json({
      error: 'لا يمكن تسجيل التحويل قبل إضافة بطاقة SuperQi',
      code: 'ERR_PAYOUT_ACCOUNT_REQUIRED',
    });
  }

  const { rows } = await query(
    `INSERT INTO manual_payouts
       (user_id, recipient_kind, source_id, amount, card_number_snapshot, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, user_id, recipient_kind, source_id, amount,
               card_number_snapshot, note, paid_at, created_at`,
    [userId, requestedKind, sourceId, amount, account.card_number, note, req.user.id]
  );
  res.status(201).json({ data: { ...rows[0], amount: n(rows[0].amount) } });
}

module.exports = {
  getMyAccount,
  saveMyAccount,
  adminSaveAccount,
  adminDashboard,
  recordManualPayout,
};
