require('dotenv').config();
const { pool } = require('./lib/db');

// ───────────────────────────────────────────────────────────────────────────
// Purge MOCK orders + mock wholesaler (and their students/designs/orders) from
// the database. Targets only seeded test data — identified by the "تجريبي"
// name marker the seeds use (e.g. "ممثل تجريبي", "طالب تجريبي").
//
//   node reset-mock.js                  → INSPECT only. Prints what WOULD be
//                                          deleted. Touches nothing.
//   CONFIRM=PURGE node reset-mock.js    → actually delete, in ONE transaction.
//
// FK note: orders.student_id is ON DELETE RESTRICT, so we delete in order:
//   order_items (cascade) ← orders ← designs (cascade w/ student) ← users
//   (cascades students/wholesalers/carts/notifications).
// Admin + staff + catalog are never touched.
// ───────────────────────────────────────────────────────────────────────────

const MARKER = '%تجريبي%';
const PURGE = process.env.CONFIRM === 'PURGE';

async function main() {
  const client = await pool.connect();
  try {
    // Candidate mock users (retail + wholesaler) by name marker.
    const users = (await client.query(
      `SELECT id, name, role, phone, email
         FROM users
        WHERE name LIKE $1 AND role IN ('retail','wholesaler')
        ORDER BY role, name`,
      [MARKER]
    )).rows;

    if (users.length === 0) {
      console.log('No mock users found (name LIKE "%تجريبي%", role retail/wholesaler). Nothing to do.');
      return;
    }

    const userIds = users.map((u) => u.id);

    // Students owned by those mock users, + their orders.
    const students = (await client.query(
      `SELECT id, user_id, full_name FROM students WHERE user_id = ANY($1)`,
      [userIds]
    )).rows;
    const studentIds = students.map((s) => s.id);

    const orders = studentIds.length
      ? (await client.query(
          `SELECT id, student_id, status FROM orders WHERE student_id = ANY($1)`,
          [studentIds]
        )).rows
      : [];

    console.log('── MOCK DATA FOUND ──────────────────────────────────────────');
    console.log(`users:    ${users.length}`);
    users.forEach((u) => console.log(`  [${u.role}] ${u.name}  ph=${u.phone || '-'}  email=${u.email || '-'}`));
    console.log(`students: ${students.length}`);
    console.log(`orders:   ${orders.length}`);
    console.log('─────────────────────────────────────────────────────────────');

    if (!PURGE) {
      console.log('\nDRY RUN — nothing deleted. Re-run with CONFIRM=PURGE to delete.');
      return;
    }

    await client.query('BEGIN');
    if (studentIds.length) {
      await client.query(`DELETE FROM orders WHERE student_id = ANY($1)`, [studentIds]); // order_items cascade
    }
    // designs cascade when students go; students/wholesalers/carts/notifications cascade when users go.
    const del = await client.query(`DELETE FROM users WHERE id = ANY($1)`, [userIds]);
    await client.query('COMMIT');
    console.log(`\nPURGED. Deleted ${del.rowCount} mock users + ${orders.length} orders + ${students.length} students (cascaded designs/carts/notifications).`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('FAILED, rolled back:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
