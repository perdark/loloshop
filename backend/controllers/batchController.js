const { query } = require('../lib/db');

async function wholesalerIdForUser(userId) {
  const { rows } = await query(`SELECT id FROM wholesalers WHERE user_id = $1`, [userId]);
  return rows[0]?.id;
}

// admin: create
async function createBatch(req, res) {
  const { name_ar, wholesaler_id, deadline } = req.body;
  if (!name_ar) return res.status(400).json({ error: 'الاسم مطلوب', code: 'ERR_VALIDATION' });
  const { rows } = await query(
    `INSERT INTO batches (name_ar, wholesaler_id, deadline) VALUES ($1, $2, $3) RETURNING id`,
    [name_ar, wholesaler_id || null, deadline || null]
  );
  res.status(201).json({ data: { id: rows[0].id } });
}

// admin: update
async function updateBatch(req, res) {
  const { id } = req.params;
  const { name_ar, wholesaler_id, deadline } = req.body;
  const { rows } = await query(
    `UPDATE batches SET
       name_ar = COALESCE($1, name_ar),
       wholesaler_id = COALESCE($2, wholesaler_id),
       deadline = COALESCE($3, deadline)
     WHERE id = $4 RETURNING id, name_ar, wholesaler_id, deadline`,
    [name_ar ?? null, wholesaler_id ?? null, deadline ?? null, id]
  );
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  res.json({ data: rows[0] });
}

// admin: list all (with grand totals). wholesaler: own batches only.
async function listBatches(req, res) {
  const params = [];
  let where = '';
  if (req.user.role === 'wholesaler') {
    const wId = await wholesalerIdForUser(req.user.id);
    if (!wId) return res.json({ data: [] });
    params.push(wId);
    where = `WHERE b.wholesaler_id = $1`;
  }
  const { rows } = await query(
    `SELECT b.id, b.name_ar, b.deadline, b.wholesaler_id, wu.name AS wholesaler_name,
            COALESCE(SUM(o.price), 0)::bigint AS grand_total,
            COUNT(DISTINCT o.id)::int AS order_count
     FROM batches b
     LEFT JOIN wholesalers w ON w.id = b.wholesaler_id
     LEFT JOIN users wu ON wu.id = w.user_id
     LEFT JOIN orders o ON o.batch_id = b.id AND o.status <> 'cancelled'
     ${where}
     GROUP BY b.id, wu.name
     ORDER BY b.created_at DESC`,
    params
  );
  res.json({ data: rows });
}

// admin or owning wholesaler: detail with per-student totals
async function getBatch(req, res) {
  const { id } = req.params;
  const b = await query(
    `SELECT b.id, b.name_ar, b.deadline, b.wholesaler_id FROM batches b WHERE b.id = $1`,
    [id]
  );
  if (!b.rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  const batch = b.rows[0];

  if (req.user.role === 'wholesaler') {
    const wId = await wholesalerIdForUser(req.user.id);
    if (batch.wholesaler_id !== wId) {
      return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
    }
  }

  // students of this batch's wholesaler + their order totals within the batch
  const students = await query(
    `SELECT s.id, u.name, s.full_name_third, s.status,
            COALESCE(SUM(o.price), 0)::bigint AS total,
            CASE WHEN COUNT(o.id) FILTER (WHERE o.status <> 'cancelled') = 0
                 THEN NULL
                 ELSE COALESCE(SUM(o.cost) FILTER (WHERE o.status <> 'cancelled'), 0)::bigint
            END AS cost,
            CASE WHEN COUNT(o.id) FILTER (WHERE o.status <> 'cancelled') = 0
                 THEN NULL
                 ELSE COALESCE(SUM(o.profit) FILTER (WHERE o.status <> 'cancelled'), 0)::bigint
            END AS profit,
            COUNT(o.id) FILTER (WHERE o.status <> 'cancelled')::int AS order_count
     FROM students s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN orders o ON o.student_id = s.id AND o.batch_id = $1
     WHERE s.wholesaler_id = $2
     GROUP BY s.id, u.name, s.full_name_third, s.status
     ORDER BY u.name`,
    [id, batch.wholesaler_id]
  );
  const grand_total = students.rows.reduce((sum, r) => sum + Number(r.total), 0);

  res.json({
    data: {
      id: batch.id, name_ar: batch.name_ar, deadline: batch.deadline,
      wholesaler_id: batch.wholesaler_id,
      students: students.rows,
      grand_total,
    },
  });
}

module.exports = { createBatch, updateBatch, listBatches, getBatch };
