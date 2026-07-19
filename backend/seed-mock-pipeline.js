require('dotenv').config();
const bcrypt = require('bcrypt');
const { query, pool } = require('./lib/db');

// Per-run throwaway password for seeded accounts, printed once by the caller.
let __seedPw = null;
function seedPassword() {
  if (!__seedPw) {
    __seedPw = process.env.SEED_PASSWORD || require('crypto').randomBytes(9).toString('base64url');
    console.log(`[seed] account password for this run: ${__seedPw}`);
  }
  return __seedPw;
}


// ───────────────────────────────────────────────────────────────────────────
// Mock production-pipeline seed.
//
// Creates one staff account per staff_type + a single retail mock order parked
// at the START of the line (design_complete, with a pending design). Re-running
// is safe: it RESETS the mock order back to design_complete so you can walk the
// whole pipeline again without rebuilding anything.
//
//   npm run seed:mock
//
//   designer     0771000001   approves the design          design_complete → converting
//   digitizer    0771000002   advances                     converting      → embroidery
//   embroiderer  0771000003   advances                     embroidery      → pressing
//   presser      0771000004   advances                     pressing        → preparing
//   preparer     0771000005   advances                     preparing → ready → delivered
//   manager      0771000006   sees the whole line + monitor (/staff)
// ───────────────────────────────────────────────────────────────────────────

const STAFF = [
  { type: 'designer',    phone: '0771000001', name: 'مصمم (تجريبي)' },
  { type: 'digitizer',   phone: '0771000002', name: 'محوّل تطريز (تجريبي)' },
  { type: 'embroiderer', phone: '0771000003', name: 'مطرّز (تجريبي)' },
  { type: 'presser',     phone: '0771000004', name: 'كوّاء (تجريبي)' },
  { type: 'preparer',    phone: '0771000005', name: 'مجهّز (تجريبي)' },
  { type: 'manager',     phone: '0771000006', name: 'مدير إنتاج (تجريبي)' },
];

const CUSTOMER_PHONE = '0771999999'; // retail student who "placed" the mock order

async function ensureStaff() {
  // No shipped default: dev and prod share one database, so a seeded password IS a
  // production credential. Generated per run and printed once. (LS-10)
  const hash = await bcrypt.hash(seedPassword(), 10);
  for (const s of STAFF) {
    const existing = await query(`SELECT id FROM users WHERE phone = $1`, [s.phone]);
    if (existing.rows.length) {
      // Keep type/scope correct on re-run.
      await query(
        `UPDATE users SET role = 'staff', staff_type = $2, order_scope = 'both',
                          phone_verified = TRUE WHERE id = $1`,
        [existing.rows[0].id, s.type]
      );
      console.log(`  = staff ${s.type.padEnd(11)} ${s.phone} (exists)`);
    } else {
      await query(
        `INSERT INTO users (name, phone, password_hash, role, staff_type, order_scope, phone_verified)
         VALUES ($1, $2, $3, 'staff', $4, 'both', TRUE)`,
        [s.name, s.phone, hash, s.type]
      );
      console.log(`  + staff ${s.type.padEnd(11)} ${s.phone} (created)`);
    }
  }
}

async function ensureSashProduct() {
  const found = await query(
    `SELECT p.id AS product_id, v.id AS variant_id
       FROM products p
       LEFT JOIN product_variants v ON v.product_id = p.id
      WHERE p.type = 'sash'
      ORDER BY v.id NULLS LAST LIMIT 1`
  );
  if (found.rows.length && found.rows[0].variant_id) return found.rows[0];

  // No sash yet — create a minimal one so the script is self-sufficient.
  const p = await query(
    `INSERT INTO products (type, name_ar, description, base_price, customizable)
     VALUES ('sash', 'وشاح تخرج (تجريبي)', 'وشاح تجريبي للاختبار', 50000, TRUE) RETURNING id`
  );
  const v = await query(
    `INSERT INTO product_variants (product_id, color, material, size, price)
     VALUES ($1, 'أبيض', 'ساتان', 'قياس واحد', 50000) RETURNING id`,
    [p.rows[0].id]
  );
  console.log('  + created a mock sash product + variant');
  return { product_id: p.rows[0].id, variant_id: v.rows[0].id };
}

async function ensureCustomerAndStudent() {
  let userId;
  const u = await query(`SELECT id FROM users WHERE phone = $1`, [CUSTOMER_PHONE]);
  if (u.rows.length) {
    userId = u.rows[0].id;
  } else {
    // No shipped default: dev and prod share one database, so a seeded password IS a
  // production credential. Generated per run and printed once. (LS-10)
  const hash = await bcrypt.hash(seedPassword(), 10);
    const ins = await query(
      `INSERT INTO users (name, phone, password_hash, role, phone_verified)
       VALUES ('طالب تجريبي', $1, $2, 'retail', TRUE) RETURNING id`,
      [CUSTOMER_PHONE, hash]
    );
    userId = ins.rows[0].id;
  }

  const st = await query(`SELECT id FROM students WHERE user_id = $1`, [userId]);
  if (st.rows.length) {
    // Keep the demo student fully populated on re-run (e.g. study_type added later).
    await query(`UPDATE students SET study_type = 'evening' WHERE id = $1`, [st.rows[0].id]);
    return st.rows[0].id;
  }

  const ins = await query(
    `INSERT INTO students (user_id, wholesaler_id, university_name, department, full_name_third, gender, study_type, status)
     VALUES ($1, NULL, 'جامعة بغداد', 'كلية الهندسة', 'طالب تجريبي للاختبار', 'male', 'evening', 'approved')
     RETURNING id`,
    [userId]
  );
  return ins.rows[0].id;
}

async function resetMockOrder(studentId, product) {
  // One mock design + order per student. If they exist, RESET them to the start
  // of the line so the pipeline can be replayed.
  const existingDesign = await query(
    `SELECT id FROM designs WHERE student_id = $1 ORDER BY created_at LIMIT 1`,
    [studentId]
  );

  let designId;
  if (existingDesign.rows.length) {
    designId = existingDesign.rows[0].id;
    await query(
      `UPDATE designs SET approval_status = 'pending', approved_by = NULL,
              approved_at = NULL, rejection_reason = NULL, completed = TRUE,
              completed_at = NOW() WHERE id = $1`,
      [designId]
    );
  } else {
    const d = await query(
      `INSERT INTO designs (student_id, variant_id, sash_color, fonts_used,
              notes, completed, completed_at, approval_status)
       VALUES ($1, $2, 'أبيض', ARRAY['Amiri','Cairo'],
              'تصميم تجريبي للاختبار', TRUE, NOW(), 'pending') RETURNING id`,
      [studentId, product.variant_id]
    );
    designId = d.rows[0].id;
  }

  const existingOrder = await query(
    `SELECT id FROM orders WHERE student_id = $1 AND design_id = $2`,
    [studentId, designId]
  );

  let orderId;
  if (existingOrder.rows.length) {
    orderId = existingOrder.rows[0].id;
    await query(
      `UPDATE orders SET status = 'design_complete', has_embroidery = TRUE,
              needs_pressing = TRUE, delivered_at = NULL, updated_at = NOW()
       WHERE id = $1`,
      [orderId]
    );
    console.log('  = reset mock order back to design_complete');
  } else {
    const o = await query(
      `INSERT INTO orders (student_id, product_id, variant_id, design_id, price, cost,
              status, has_embroidery, needs_pressing, notes)
       VALUES ($1, $2, $3, $4, 50000, 20000, 'design_complete', TRUE, TRUE,
              'طلب تجريبي لاختبار خط الإنتاج') RETURNING id`,
      [studentId, product.product_id, product.variant_id, designId]
    );
    orderId = o.rows[0].id;
    await query(
      `INSERT INTO order_items (order_id, label_snapshot, price_snapshot, qty)
       VALUES ($1, 'لون الوشاح: أبيض', 0, 1),
              ($1, 'تطريز الاسم: نعم', 5000, 1)`,
      [orderId]
    );
    console.log('  + created mock order with 2 items');
  }
  return orderId;
}

async function main() {
  console.log('Seeding mock production pipeline…');
  await ensureStaff();
  const product = await ensureSashProduct();
  const studentId = await ensureCustomerAndStudent();
  const orderId = await resetMockOrder(studentId, product);
  console.log('\nDone.');
  console.log(`Mock order: ${orderId}`);
  console.log('Start at /staff as the designer → approve → walk the line.');
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
