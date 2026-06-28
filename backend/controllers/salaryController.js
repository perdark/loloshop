/**
 * Payroll controller — staff salary + activity.
 * Tables: staff_salaries, staff_salary_transactions, staff_activity_log
 * All monetary amounts are IQD stored as BIGINT.
 */

const { query, tx } = require('../lib/db');

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
  const txRows = await query(
    `SELECT id, type, amount, reason_ar, source_type, source_id, created_by, created_at
     FROM staff_salary_transactions
     WHERE user_id = $1 AND deleted_at IS NULL
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
 * GET /admin/staff/:id/activity
 * Return staff_activity_log rows (newest first, limit 200).
 * Joins: orders → products for product_name; orders → students → users for student_name.
 */
async function getStaffActivity(req, res) {
  const { id } = req.params;
  const { err } = await resolveStaffUser(id);
  if (err) return res.status(err.status).json(err.body);

  const { rows } = await query(
    `SELECT
       sal.id,
       sal.action,
       sal.from_stage,
       sal.to_stage,
       sal.created_at,
       sal.order_id,
       p.name_ar  AS product_name,
       u.name     AS student_name
     FROM staff_activity_log sal
     LEFT JOIN orders o         ON o.id = sal.order_id
     LEFT JOIN products p       ON p.id = o.product_id
     LEFT JOIN students st      ON st.id = o.student_id
     LEFT JOIN users u          ON u.id = st.user_id
     WHERE sal.user_id = $1
     ORDER BY sal.created_at DESC
     LIMIT 200`,
    [id]
  );

  res.json({ data: rows });
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
 * GET /payroll/me/activity  (or /staff/me/activity)
 * Staff member reads their own activity log.
 */
async function getMyActivity(req, res) {
  const userId = req.user.id;

  const { rows } = await query(
    `SELECT
       sal.id,
       sal.action,
       sal.from_stage,
       sal.to_stage,
       sal.created_at,
       sal.order_id,
       p.name_ar  AS product_name,
       u.name     AS student_name
     FROM staff_activity_log sal
     LEFT JOIN orders o         ON o.id = sal.order_id
     LEFT JOIN products p       ON p.id = o.product_id
     LEFT JOIN students st      ON st.id = o.student_id
     LEFT JOIN users u          ON u.id = st.user_id
     WHERE sal.user_id = $1
     ORDER BY sal.created_at DESC
     LIMIT 200`,
    [userId]
  );

  res.json({ data: rows });
}

/** GET /payroll/me/goal — the logged-in staff member's own goal + progress. */
async function getMyGoal(req, res) {
  res.json({ data: await buildGoalSummary(req.user.id) });
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
};
