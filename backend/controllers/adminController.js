const bcrypt = require('bcrypt');
const { query, tx } = require('../lib/db');

async function analytics(req, res) {
  const totals = await query(
    `SELECT
       COALESCE(SUM(price), 0)::bigint AS revenue,
       COALESCE(SUM(cost), 0)::bigint AS cost,
       COALESCE(SUM(profit), 0)::bigint AS profit,
       COUNT(*)::int AS orders
     FROM orders WHERE status <> 'cancelled'`
  );
  const byStatus = await query(
    `SELECT status, COUNT(*)::int AS count FROM orders GROUP BY status`
  );
  const daily = await query(
    `SELECT DATE(created_at AT TIME ZONE 'UTC') AS date,
            COUNT(*)::int AS orders,
            COALESCE(SUM(price), 0)::bigint AS revenue
     FROM orders
     WHERE created_at > NOW() - INTERVAL '30 days'
     GROUP BY 1 ORDER BY 1`
  );
  const topWholesalers = await query(
    `SELECT w.id, u.name, COUNT(o.id)::int AS order_count
     FROM wholesalers w
     JOIN users u ON u.id = w.user_id
     LEFT JOIN students s ON s.wholesaler_id = w.id
     LEFT JOIN orders o ON o.student_id = s.id
     GROUP BY w.id, u.name
     ORDER BY order_count DESC LIMIT 5`
  );
  const status = {};
  byStatus.rows.forEach((r) => (status[r.status] = r.count));
  res.json({
    totals: totals.rows[0],
    by_status: status,
    daily: daily.rows,
    top_wholesalers: topWholesalers.rows,
  });
}

async function accounting(req, res) {
  const totals = await query(
    `SELECT COALESCE(SUM(price),0)::bigint AS revenue,
            COALESCE(SUM(cost),0)::bigint AS cost,
            COALESCE(SUM(profit),0)::bigint AS profit,
            COUNT(*)::int AS orders
     FROM orders WHERE status <> 'cancelled'`
  );
  const byBatch = await query(
    `SELECT b.id, b.name_ar, wu.name AS wholesaler_name,
            COALESCE(SUM(o.price),0)::bigint AS revenue,
            COALESCE(SUM(o.cost),0)::bigint AS cost,
            COALESCE(SUM(o.profit),0)::bigint AS profit,
            COUNT(o.id)::int AS orders
     FROM batches b
     LEFT JOIN wholesalers w ON w.id = b.wholesaler_id
     LEFT JOIN users wu ON wu.id = w.user_id
     LEFT JOIN orders o ON o.batch_id = b.id AND o.status <> 'cancelled'
     GROUP BY b.id, wu.name ORDER BY revenue DESC`
  );
  const byWholesaler = await query(
    `SELECT w.id, u.name AS wholesaler_name,
            COALESCE(SUM(o.price),0)::bigint AS revenue,
            COALESCE(SUM(o.cost),0)::bigint AS cost,
            COALESCE(SUM(o.profit),0)::bigint AS profit,
            COUNT(o.id)::int AS orders
     FROM wholesalers w
     JOIN users u ON u.id = w.user_id
     LEFT JOIN students s ON s.wholesaler_id = w.id
     LEFT JOIN orders o ON o.student_id = s.id AND o.status <> 'cancelled'
     GROUP BY w.id, u.name ORDER BY revenue DESC`
  );
  const retail = await query(
    `SELECT COALESCE(SUM(o.price),0)::bigint AS revenue,
            COALESCE(SUM(o.cost),0)::bigint AS cost,
            COALESCE(SUM(o.profit),0)::bigint AS profit,
            COUNT(o.id)::int AS orders
     FROM orders o
     JOIN students s ON s.id = o.student_id
     WHERE s.wholesaler_id IS NULL AND o.status <> 'cancelled'`
  );
  res.json({
    totals: totals.rows[0],
    by_batch: byBatch.rows,
    by_wholesaler: byWholesaler.rows,
    independent_retail: retail.rows[0],
  });
}

async function updateOrderCost(req, res) {
  const { id } = req.params;
  const { cost } = req.body;
  if (cost == null || cost < 0) {
    return res.status(400).json({ error: 'تكلفة غير صالحة', code: 'ERR_VALIDATION' });
  }
  const { rows } = await query(
    `UPDATE orders SET cost = $1 WHERE id = $2 RETURNING id, price, cost, profit`,
    [cost, id]
  );
  if (!rows.length) return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'update_cost', 'order', $2, $3)`,
    [req.user.id, id, JSON.stringify({ cost })]
  );
  res.json({ data: rows[0] });
}

async function listWholesalers(req, res) {
  const { rows } = await query(
    `SELECT w.id, u.name, u.phone, u.email, w.referral_code, w.deadline, w.created_at,
       (SELECT COUNT(*)::int FROM students s WHERE s.wholesaler_id = w.id) AS student_count,
       (SELECT COUNT(*)::int FROM students s WHERE s.wholesaler_id = w.id AND s.status = 'pending_approval') AS pending_count
     FROM wholesalers w JOIN users u ON u.id = w.user_id
     ORDER BY w.created_at DESC`
  );
  const data = rows.map((r) => ({
    ...r,
    referral_url: `${process.env.FRONTEND_URL}/join/${r.referral_code}`,
  }));
  res.json({ data });
}

async function createWholesaler(req, res) {
  const { name, phone, email, password, referral_code, deadline } = req.body;
  if (!name || !phone || !password || !referral_code) {
    return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  }
  const slugOk = /^[a-z0-9-]+$/.test(referral_code);
  if (!slugOk) {
    return res.status(400).json({ error: 'الرابط يجب أن يحتوي على حروف صغيرة وأرقام وشرطات', code: 'ERR_VALIDATION' });
  }
  const exists = await query(`SELECT id FROM users WHERE phone = $1`, [phone]);
  if (exists.rows.length) {
    return res.status(409).json({ error: 'الرقم مستخدم', code: 'ERR_PHONE_TAKEN' });
  }
  const codeExists = await query(`SELECT id FROM wholesalers WHERE referral_code = $1`, [referral_code]);
  if (codeExists.rows.length) {
    return res.status(409).json({ error: 'الرمز مستخدم', code: 'ERR_VALIDATION' });
  }
  const hash = await bcrypt.hash(password, 10);
  const result = await tx(async (client) => {
    const u = await client.query(
      `INSERT INTO users (name, phone, email, password_hash, role, phone_verified)
       VALUES ($1, $2, $3, $4, 'wholesaler', TRUE) RETURNING id`,
      [name, phone, email || null, hash]
    );
    const w = await client.query(
      `INSERT INTO wholesalers (user_id, referral_code, deadline, approved_by_admin)
       VALUES ($1, $2, $3, TRUE) RETURNING id, referral_code`,
      [u.rows[0].id, referral_code, deadline || null]
    );
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'create_wholesaler', 'wholesaler', $2, $3)`,
      [req.user.id, w.rows[0].id, JSON.stringify({ name, referral_code })]
    );
    return w.rows[0];
  });
  res.status(201).json({
    data: {
      id: result.id,
      referral_url: `${process.env.FRONTEND_URL}/join/${result.referral_code}`,
    },
  });
}

async function updateDeadline(req, res) {
  const { id } = req.params;
  const { deadline, extend_days } = req.body;
  let sql, params;
  if (deadline) {
    sql = `UPDATE wholesalers SET deadline = $1 WHERE id = $2 RETURNING id, deadline`;
    params = [deadline, id];
  } else if (extend_days) {
    sql = `UPDATE wholesalers SET deadline = COALESCE(deadline, NOW()) + ($1 || ' days')::interval
           WHERE id = $2 RETURNING id, deadline`;
    params = [extend_days, id];
  } else {
    return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  }
  const { rows } = await query(sql, params);
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'extend_deadline', 'wholesaler', $2, $3)`,
    [req.user.id, id, JSON.stringify({ deadline, extend_days })]
  );
  res.json({ data: rows[0] });
}

async function wholesalerStudents(req, res) {
  const { id } = req.params;
  const { rows } = await query(
    `SELECT s.id, u.name, u.phone, s.status, s.university_name, s.department,
       (SELECT status FROM orders WHERE student_id = s.id ORDER BY created_at DESC LIMIT 1) AS order_status
     FROM students s JOIN users u ON u.id = s.user_id
     WHERE s.wholesaler_id = $1
     ORDER BY s.created_at DESC`,
    [id]
  );
  res.json({ data: rows });
}

async function toggleEditException(req, res) {
  const { id } = req.params;
  const { rows } = await query(
    `UPDATE students SET edit_exception = NOT edit_exception WHERE id = $1 RETURNING id, edit_exception`,
    [id]
  );
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'toggle_edit_exception', 'student', $2, $3)`,
    [req.user.id, id, JSON.stringify({ edit_exception: rows[0].edit_exception })]
  );
  res.json({ data: rows[0] });
}

module.exports = {
  analytics, accounting, updateOrderCost,
  listWholesalers, createWholesaler, updateDeadline,
  wholesalerStudents, toggleEditException,
};
