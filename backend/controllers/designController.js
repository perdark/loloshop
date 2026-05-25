const { query, tx } = require('../lib/db');
const { publicUrl } = require('../lib/upload');

async function getStudentByUserId(userId) {
  const { rows } = await query(
    `SELECT id, wholesaler_id, status FROM students WHERE user_id = $1`,
    [userId]
  );
  return rows[0];
}

function isApproved(student) {
  return !student.wholesaler_id || student.status === 'approved';
}

async function getMyDesign(req, res) {
  const student = await getStudentByUserId(req.user.id);
  if (!student) return res.status(404).json({ error: 'لم يتم العثور على ملف الطالب', code: 'ERR_NOT_FOUND' });
  const { rows } = await query(
    `SELECT * FROM designs WHERE student_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [student.id]
  );
  res.json({ data: rows[0] || null, student_status: student.status });
}

async function saveDesign(req, res) {
  const student = await getStudentByUserId(req.user.id);
  if (!student) return res.status(404).json({ error: 'لم يتم العثور على ملف الطالب', code: 'ERR_NOT_FOUND' });
  if (!isApproved(student)) {
    return res.status(403).json({
      error: 'يجب الموافقة على حسابك من قبل الممثل قبل التصميم',
      code: 'ERR_PENDING_APPROVAL',
    });
  }
  const { variant_id, sash_color, left_canvas, right_canvas, logo_url, extra_image_url, fonts_used, notes } = req.body;

  const existing = await query(`SELECT id, completed FROM designs WHERE student_id = $1`, [student.id]);
  if (existing.rows.length && existing.rows[0].completed) {
    const { rows: sRows } = await query(`SELECT edit_exception FROM students WHERE id = $1`, [student.id]);
    if (!sRows[0]?.edit_exception) {
      return res.status(403).json({ error: 'لا يمكن تعديل التصميم بعد التأكيد', code: 'ERR_FORBIDDEN' });
    }
  }

  let designId;
  if (existing.rows.length) {
    const { rows } = await query(
      `UPDATE designs SET variant_id = $1, sash_color = $2, left_canvas = $3, right_canvas = $4,
         logo_url = $5, extra_image_url = $6, fonts_used = $7, notes = $8
       WHERE id = $9 RETURNING id`,
      [variant_id || null, sash_color || null, left_canvas || null, right_canvas || null,
       logo_url || null, extra_image_url || null, fonts_used || null, notes || null, existing.rows[0].id]
    );
    designId = rows[0].id;
  } else {
    const { rows } = await query(
      `INSERT INTO designs (student_id, variant_id, sash_color, left_canvas, right_canvas, logo_url, extra_image_url, fonts_used, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [student.id, variant_id || null, sash_color || null, left_canvas || null, right_canvas || null,
       logo_url || null, extra_image_url || null, fonts_used || null, notes || null]
    );
    designId = rows[0].id;
  }

  // ensure order exists in designing state
  const order = await query(`SELECT id, status FROM orders WHERE student_id = $1 AND design_id = $2`, [student.id, designId]);
  if (!order.rows.length) {
    const product = await query(`SELECT id, base_price FROM products WHERE type = 'sash' AND active = TRUE LIMIT 1`);
    if (product.rows.length) {
      await query(
        `INSERT INTO orders (student_id, product_id, variant_id, design_id, price, status)
         VALUES ($1, $2, $3, $4, $5, 'designing')`,
        [student.id, product.rows[0].id, variant_id || null, designId, product.rows[0].base_price]
      );
    }
  }

  res.json({ data: { id: designId } });
}

async function completeDesign(req, res) {
  const student = await getStudentByUserId(req.user.id);
  if (!student) return res.status(404).json({ error: 'لم يتم العثور على ملف الطالب', code: 'ERR_NOT_FOUND' });
  if (!isApproved(student)) {
    return res.status(403).json({
      error: 'يجب الموافقة على حسابك من قبل الممثل قبل التصميم',
      code: 'ERR_PENDING_APPROVAL',
    });
  }

  const result = await tx(async (client) => {
    const d = await client.query(
      `UPDATE designs SET completed = TRUE, completed_at = NOW()
       WHERE student_id = $1 RETURNING id`,
      [student.id]
    );
    if (!d.rows.length) throw new Error('NO_DESIGN');
    await client.query(
      `UPDATE orders SET status = 'design_complete' WHERE design_id = $1 AND status = 'designing'`,
      [d.rows[0].id]
    );
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id) VALUES ($1, 'complete_design', 'design', $2)`,
      [req.user.id, d.rows[0].id]
    );
    return d.rows[0].id;
  });
  res.json({ data: { id: result, completed: true } });
}

// Staff/admin view of any student's design
async function getDesignByStudent(req, res) {
  const { studentId } = req.params;
  const { rows } = await query(
    `SELECT d.*, u.name AS student_name, u.phone, s.university_name, s.department
     FROM designs d
     JOIN students s ON s.id = d.student_id
     JOIN users u ON u.id = s.user_id
     WHERE d.student_id = $1
     ORDER BY d.created_at DESC LIMIT 1`,
    [studentId]
  );
  if (!rows.length) return res.status(404).json({ error: 'التصميم غير موجود', code: 'ERR_NOT_FOUND' });
  res.json({ data: rows[0] });
}

async function uploadLogo(req, res) {
  if (!req.file) return res.status(400).json({ error: 'لم يتم رفع ملف', code: 'ERR_VALIDATION' });
  res.json({ data: { url: publicUrl(req, 'logos', req.file.filename) } });
}

async function uploadImage(req, res) {
  if (!req.file) return res.status(400).json({ error: 'لم يتم رفع ملف', code: 'ERR_VALIDATION' });
  res.json({ data: { url: publicUrl(req, 'images', req.file.filename) } });
}

module.exports = { getMyDesign, saveDesign, completeDesign, getDesignByStudent, uploadLogo, uploadImage };
