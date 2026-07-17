const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { query, tx } = require('../lib/db');
const { publicUrl } = require('../lib/upload');
const { persistFullSetOrder, loadWholesalerPricing } = require('../lib/fullSetOrder');
const { setBundleApproval } = require('../lib/orderApproval');
const {
  loadStudent, eligibleForFullSet, captureApproval, restoreApproval,
  captureGroupPhone, restoreGroupPhone,
} = require('./orderEditController');

const SALT_ROUNDS = 10;
const sellingAddons = (addons) => Object.fromEntries(Object.entries(addons).map(([key, pair]) => [key, pair.selling]));

async function customOrderConfig(req, res) {
  const [packages, wholesalers] = await Promise.all([
    query(
      `SELECT id, name_ar, price FROM packages
       WHERE active = TRUE AND is_full_set = TRUE
       ORDER BY sort, created_at`
    ),
    query(
      `SELECT w.id, u.name, w.university_name, w.department,
              w.wholesaler_price, w.pricing_addons
         FROM wholesalers w
         JOIN users u ON u.id = w.user_id
        ORDER BY u.name ASC`
    ),
  ]);

  const reps = [];
  for (const row of wholesalers.rows) {
    const p = await loadWholesalerPricing(row.id);
    reps.push({
      id: row.id,
      name: row.name,
      university_name: row.university_name,
      department: row.department,
      pricing: { base: p.wholesalerPrice, addons: sellingAddons(p.addons) },
    });
  }

  res.json({
    data: {
      packages: packages.rows,
      pricing: { base: 0, addons: sellingAddons((await loadWholesalerPricing(null)).addons) },
      wholesalers: reps,
    },
  });
}

// «طلب لطالب موجود» — an existing student picked from the search. No user creation;
// persistFullSetOrder is an upsert per student, so a second call EDITS the student's
// bundle instead of duplicating it. Approval: a pre-existing bundle keeps its exact
// state (captureApproval/restoreApproval); a fresh bundle mirrors the name-only path
// (rep-linked → auto-approved via setBundleApproval, independent → NULL = direct order).
async function createForExistingStudent(req, res) {
  const student = await loadStudent(String(req.body.student_id));
  if (!student) return res.status(404).json({ error: 'الطالب غير موجود', code: 'ERR_NOT_FOUND' });
  // Never target a retail self-registered student: the طقم form would bind to (and
  // could cancel pieces inside) their retail cart bundle, and re-price it rep-style.
  if (!eligibleForFullSet(student)) {
    return res.status(403).json({ error: 'لا يمكن إنشاء طلب طقم لطالب تجزئة من هنا', code: 'ERR_FORBIDDEN' });
  }

  const prev = await captureApproval(student.id);
  const prevContact = await captureGroupPhone(prev);
  const isRepLinked = student.wholesaler_id != null;

  // FIX #2 (2026-07-17): for a PRE-EXISTING bundle, thread its captured approval state
  // into persistFullSetOrder so the restore happens atomically, inside the SAME
  // transaction as the piece writes (same fix as orderEditController.saveFullSetOrder —
  // no more post-commit restoreApproval() window where a crash could strand the bundle
  // at 'pending'). A FRESH bundle (prev.exists===false) has no prior state to restore —
  // it's left 'pending' by persist and decided below (unchanged: rep-linked → auto-approve
  // via setBundleApproval, independent → restoreApproval sets NULL).
  const approvalParam = prev.exists
    ? {
        state: prev.state,
        approved_at: prev.wholesaler_approved_at,
        // Same fallback restoreApproval used: keep the ORIGINAL approver when one is on
        // record, else attribute to this actor (mirrors orderEditController.saveFullSetOrder).
        approved_by: prev.wholesaler_approved_by || req.user.id || null,
        reject_reason: prev.wholesaler_reject_reason,
      }
    : undefined;

  const result = await persistFullSetOrder({
    student: { id: student.id, name: student.name, phone: student.phone ?? '', wholesaler_id: student.wholesaler_id },
    body: req.body,
    actorUserId: req.user.id,
    approval: approvalParam,
  });
  if (result.status !== 201) return res.status(result.status).json(result.json);
  const cgId = result.json.data.checkout_group_id;

  let approval;
  if (!prev.exists && isRepLinked) {
    approval = 'approved';
    try {
      await setBundleApproval({ checkoutGroupId: cgId, decision: 'approved', actorUserId: req.user.id });
    } catch (e) {
      console.error(`custom order (existing student): approval flip failed for checkout_group ${cgId}:`, e.message);
      approval = 'pending';
    }
  } else if (prev.exists) {
    // Already restored atomically inside persistFullSetOrder's own transaction above.
    approval = prev.state ?? null;
  } else {
    // Fresh, independent (non-rep) bundle → stays a direct admin order (NULL).
    approval = await restoreApproval({
      checkoutGroupId: cgId, prev, isRepLinked, actorUserId: req.user.id,
    });
  }
  await restoreGroupPhone({ checkoutGroupId: cgId, ...prevContact });

  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'admin_custom_order_create', 'student', $2, $3::jsonb)`,
    [req.user.id, student.id, JSON.stringify({
      existing_student: true, checkout_group_id: cgId,
      wholesaler_id: student.wholesaler_id || null, wholesaler_approval: approval,
    })]
  );
  res.status(201).json({ data: { student_id: student.id, ...result.json.data, wholesaler_approval: approval } });
}

async function createCustomOrder(req, res) {
  if (req.body?.student_id) return createForExistingStudent(req, res);
  const name = String(req.body?.student_name || '').trim();
  if (!name) return res.status(400).json({ error: 'اسم الطالب مطلوب', code: 'ERR_VALIDATION' });
  if (name.length > 120) {
    return res.status(400).json({ error: 'اسم الطالب طويل جداً', code: 'ERR_VALIDATION' });
  }

  const wholesalerId = req.body?.wholesaler_id ? String(req.body.wholesaler_id) : null;
  let wholesaler = null;
  if (wholesalerId) {
    const w = await query(
      `SELECT id, university_name, department FROM wholesalers WHERE id = $1`,
      [wholesalerId]
    );
    if (!w.rows.length) {
      return res.status(404).json({ error: 'الممثل غير موجود', code: 'ERR_NOT_FOUND' });
    }
    wholesaler = w.rows[0];
  }

  const hash = await bcrypt.hash(crypto.randomUUID(), SALT_ROUNDS);
  const created = await tx(async (client) => {
    const u = await client.query(
      `INSERT INTO users (name, phone, email, password_hash, role)
       VALUES ($1, NULL, NULL, $2, 'retail')
       RETURNING id`,
      [name, hash]
    );
    const s = await client.query(
      `INSERT INTO students (user_id, wholesaler_id, full_name_third, university_name, department, status)
       VALUES ($1, $2, $3, $4, $5, 'approved')
       RETURNING id`,
      [
        u.rows[0].id,
        wholesaler?.id || null,
        name,
        wholesaler?.university_name || null,
        wholesaler?.department || null,
      ]
    );
    return { userId: u.rows[0].id, studentId: s.rows[0].id };
  });

  const cleanupUser = async (reason) => {
    const has = await query(`SELECT 1 FROM orders WHERE student_id = $1 LIMIT 1`, [
      created.studentId,
    ]).catch(() => ({ rows: [] }));
    if (has.rows.length) {
      console.error(
        `admin custom order: ${reason} but orders already exist for student ${created.studentId} — left in place`
      );
      return;
    }
    await query(`DELETE FROM users WHERE id = $1`, [created.userId]).catch((e) =>
      console.error('admin custom order cleanup failed:', e.message)
    );
  };

  let result;
  try {
    result = await persistFullSetOrder({
      student: { id: created.studentId, name, phone: '', wholesaler_id: wholesaler?.id || null },
      body: req.body,
      actorUserId: req.user.id,
    });
  } catch (err) {
    await cleanupUser('persistFullSetOrder threw');
    throw err;
  }

  if (result.status !== 201) {
    await cleanupUser('persistFullSetOrder rejected');
    return res.status(result.status).json(result.json);
  }

  if (wholesaler?.id) {
    try {
      await setBundleApproval({
        checkoutGroupId: result.json.data.checkout_group_id,
        decision: 'approved',
        actorUserId: req.user.id,
      });
    } catch (e) {
      console.error(
        `admin custom order: approval flip failed for checkout_group ${result.json.data.checkout_group_id}:`,
        e.message
      );
    }
  } else {
    await query(
      `UPDATE orders
          SET wholesaler_approval = NULL,
              wholesaler_reject_reason = NULL,
              wholesaler_approved_at = NULL,
              wholesaler_approved_by = NULL,
              updated_at = NOW()
        WHERE checkout_group_id = $1`,
      [result.json.data.checkout_group_id]
    );
  }

  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'admin_custom_order_create', 'student', $2, $3::jsonb)`,
    [
      req.user.id,
      created.studentId,
      JSON.stringify({
        checkout_group_id: result.json.data.checkout_group_id,
        wholesaler_id: wholesaler?.id || null,
      }),
    ]
  );

  res.status(201).json({
    data: { student_id: created.studentId, ...result.json.data },
  });
}

async function uploadImage(req, res) {
  if (!req.file) return res.status(400).json({ error: 'الملف مطلوب', code: 'ERR_VALIDATION' });
  res.json({ data: { url: publicUrl(req, 'images', req.file.filename) } });
}

module.exports = { customOrderConfig, createCustomOrder, uploadImage };
