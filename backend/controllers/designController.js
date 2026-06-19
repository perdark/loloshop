const { query, tx } = require('../lib/db');
const { publicUrl } = require('../lib/upload');
const { publish } = require('../lib/eventBus');

async function getStudentByUserId(userId) {
  const { rows } = await query(
    `SELECT id, wholesaler_id, status, gender, edit_exception FROM students WHERE user_id = $1`,
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
    `SELECT * FROM designs WHERE student_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [student.id]
  );

  // Sash side lock — only for students tied to a wholesaler.
  let sashLock = { editable_sash_side: null, locked_side_design: null };
  if (student.wholesaler_id) {
    const w = await query(
      `SELECT editable_sash_side, locked_side_design FROM wholesalers WHERE id = $1`,
      [student.wholesaler_id]
    );
    if (w.rows[0]) sashLock = w.rows[0];
  }

  res.json({
    data: rows[0] || null,
    student_status: student.status,
    student_gender: student.gender || null,
    edit_exception: !!student.edit_exception,
    // Retail (no wholesaler) confirm → cart; rep students keep the direct package/order flow.
    is_rep_student: !!student.wholesaler_id,
    editable_sash_side: sashLock.editable_sash_side,
    locked_side_design: sashLock.locked_side_design,
  });
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
  const { variant_id, sash_color, embroidery_color, left_canvas, right_canvas, logo_url, extra_image_url, fonts_used, notes } = req.body;

  const latest = await query(
    `SELECT id, completed FROM designs WHERE student_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [student.id]
  );
  const existing = latest.rows[0];
  if (existing?.completed) {
    const { rows: sRows } = await query(`SELECT edit_exception FROM students WHERE id = $1`, [student.id]);
    if (!sRows[0]?.edit_exception) {
      return res.status(403).json({ error: 'لا يمكن تعديل التصميم بعد التأكيد', code: 'ERR_FORBIDDEN' });
    }
  }

  let designId;
  if (existing) {
    designId = await tx(async (client) => {
      const { rows } = await client.query(
        `UPDATE designs SET variant_id = $1, sash_color = $2, embroidery_color = $3,
           left_canvas = $4, right_canvas = $5,
           logo_url = $6, extra_image_url = $7, fonts_used = $8, notes = $9
         WHERE id = $10 RETURNING id`,
        [variant_id || null, sash_color || null, embroidery_color || null,
         left_canvas || null, right_canvas || null,
         logo_url || null, extra_image_url || null, fonts_used || null, notes || null, existing.id]
      );
      await client.query(
        `DELETE FROM designs WHERE student_id = $1 AND id <> $2`,
        [student.id, rows[0].id]
      );
      return rows[0].id;
    });
  } else {
    const { rows } = await query(
      `INSERT INTO designs (student_id, variant_id, sash_color, embroidery_color, left_canvas, right_canvas, logo_url, extra_image_url, fonts_used, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [student.id, variant_id || null, sash_color || null, embroidery_color || null,
       left_canvas || null, right_canvas || null,
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
       WHERE id = (
         SELECT id FROM designs WHERE student_id = $1 ORDER BY updated_at DESC LIMIT 1
       )
       RETURNING id`,
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

// Designer / manager / admin: approve an individual design → its sash order enters 'converting'.
async function approveDesign(req, res) {
  const { id } = req.params; // design id
  const result = await tx(async (client) => {
    const d = await client.query(
      `UPDATE designs SET approval_status = 'approved', approved_by = $2, approved_at = NOW(),
         rejection_reason = NULL
       WHERE id = $1 RETURNING id, student_id`,
      [id, req.user.id]
    );
    if (!d.rows.length) return null;
    const o = await client.query(
      `UPDATE orders SET status = 'converting'
       WHERE design_id = $1 AND status = 'design_complete' RETURNING id, student_id`,
      [id]
    );
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'approve_design', 'design', $2, $3)`,
      [req.user.id, id, JSON.stringify({ orders: o.rows.map((r) => r.id) })]
    );
    // Activity log
    const orderId = o.rows[0]?.id || null;
    await client.query(
      `INSERT INTO staff_activity_log (user_id, action, order_id, from_stage, to_stage)
       VALUES ($1, 'approve_design', $2, 'design_complete', 'converting')`,
      [req.user.id, orderId]
    );
    const stu = await client.query(`SELECT user_id FROM students WHERE id = $1`, [d.rows[0].student_id]);
    if (stu.rows[0]) {
      await client.query(
        `INSERT INTO notifications (user_id, type, title_ar, body_ar, link)
         VALUES ($1, 'design_approved', $2, $3, '/')`,
        [stu.rows[0].user_id, 'تمت الموافقة على تصميمك', 'اعتُمد تصميم الوشاح وانتقل لتحويل التطريز']
      );
    }
    return { advanced: o.rows.length, orderId };
  });
  if (!result) return res.status(404).json({ error: 'التصميم غير موجود', code: 'ERR_NOT_FOUND' });
  if (result.orderId) {
    publish({ type: 'order', orderId: result.orderId, status: 'converting' });
    publish({ type: 'presence', orderId: result.orderId, working_staff_id: null, working_staff_name: null });
  }
  res.json({ data: { id, approval_status: 'approved', advanced: result.advanced } });
}

// Designer / manager / admin: reject a design → reopen it for editing, order back to designing.
async function rejectDesign(req, res) {
  const { id } = req.params; // design id
  const reason = (req.body && req.body.reason ? String(req.body.reason) : '').trim();
  if (!reason) return res.status(400).json({ error: 'يرجى كتابة سبب الرفض', code: 'ERR_VALIDATION' });
  const result = await tx(async (client) => {
    const d = await client.query(
      `UPDATE designs SET approval_status = 'rejected', rejection_reason = $2,
         approved_by = $3, approved_at = NULL, completed = FALSE, completed_at = NULL
       WHERE id = $1 RETURNING id, student_id`,
      [id, reason, req.user.id]
    );
    if (!d.rows.length) return null;
    const o = await client.query(
      `UPDATE orders SET status = 'designing'
       WHERE design_id = $1 AND status = 'design_complete' RETURNING id`,
      [id]
    );
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'reject_design', 'design', $2, $3)`,
      [req.user.id, id, JSON.stringify({ reason })]
    );
    // Activity log
    const orderId = o.rows[0]?.id || null;
    await client.query(
      `INSERT INTO staff_activity_log (user_id, action, order_id, from_stage, to_stage)
       VALUES ($1, 'reject_design', $2, 'design_complete', 'designing')`,
      [req.user.id, orderId]
    );
    const stu = await client.query(`SELECT user_id FROM students WHERE id = $1`, [d.rows[0].student_id]);
    if (stu.rows[0]) {
      await client.query(
        `INSERT INTO notifications (user_id, type, title_ar, body_ar, link)
         VALUES ($1, 'design_rejected', $2, $3, '/design')`,
        [stu.rows[0].user_id, 'يحتاج تصميمك إلى تعديل', reason]
      );
    }
    return { ...d.rows[0], orderId };
  });
  if (!result) return res.status(404).json({ error: 'التصميم غير موجود', code: 'ERR_NOT_FOUND' });
  if (result.orderId) {
    publish({ type: 'order', orderId: result.orderId, status: 'designing' });
    publish({ type: 'presence', orderId: result.orderId, working_staff_id: null, working_staff_name: null });
  }
  res.json({ data: { id, approval_status: 'rejected' } });
}

async function uploadLogo(req, res) {
  if (!req.file) return res.status(400).json({ error: 'لم يتم رفع ملف', code: 'ERR_VALIDATION' });
  res.json({ data: { url: publicUrl(req, 'logos', req.file.filename) } });
}

async function uploadImage(req, res) {
  if (!req.file) return res.status(400).json({ error: 'لم يتم رفع ملف', code: 'ERR_VALIDATION' });
  res.json({ data: { url: publicUrl(req, 'images', req.file.filename) } });
}

module.exports = {
  getMyDesign, saveDesign, completeDesign, getDesignByStudent,
  approveDesign, rejectDesign, uploadLogo, uploadImage,
};
