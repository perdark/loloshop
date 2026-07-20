require('dotenv').config();
const { pool } = require('./lib/db');

// ───────────────────────────────────────────────────────────────────────────
// Reset the LoloShop database to a clean handoff state.
//
//   node reset-keep-admin.js                 → dry run, prints what WOULD go
//   CONFIRM=RESET node reset-keep-admin.js    → actually wipes
//   CONFIRM=RESET KEEP=catalog node ...       → also keep products/options
//
// KEEPS:  every user with role='admin' (logins intact).
// By default also KEEPS the product catalog (products/variants/options/packages)
// so the shop still has things to sell. Set KEEP=none to wipe catalog too.
//
// WIPES:  staff + wholesaler + retail users, students, designs, orders,
//         order_items, carts, notifications, batches, otp/reset rows, audit log,
//         and all staff payroll/activity/goal rows.
//
// Runs in ONE transaction — all-or-nothing. Safe to re-run.
// ───────────────────────────────────────────────────────────────────────────

const CONFIRM = process.env.CONFIRM === 'RESET';
const KEEP = (process.env.KEEP || 'catalog').toLowerCase(); // 'catalog' | 'none'

// Order matters only for the non-CASCADE deletes; we lean on CASCADE where the
// schema defines it. These are truncated unconditionally (transactional data).
const WIPE_ALWAYS = [
  'cart_items', 'carts',
  'order_items', 'orders',
  'designs', 'students', 'wholesalers',
  'notifications', 'batches',
  'staff_salary_transactions', 'staff_salaries', 'staff_activity_log', 'staff_goals',
  'otp_send_events', 'otp_codes', 'password_resets', 'audit_log',
];

// Catalog tables — kept by default, wiped only when KEEP=none.
const CATALOG = [
  'package_rules', 'packages',
  'product_locked_options', 'product_price_roles', 'option_price_roles',
  'options', 'option_groups',
  'product_images', 'product_variants', 'products',
  'design_templates',
];

async function tableExists(client, t) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [t]);
  return r.rows.length > 0;
}

async function main() {
  const client = await pool.connect();
  try {
    const admins = await client.query(`SELECT id, name, phone FROM users WHERE role='admin'`);
    console.log(`Admins to KEEP (${admins.rows.length}):`);
    admins.rows.forEach((a) => console.log(`  • ${a.name} — ${a.phone}`));
    if (admins.rows.length === 0) {
      throw new Error('No admin user found — refusing to wipe (you would be locked out).');
    }

    const targets = [...WIPE_ALWAYS, ...(KEEP === 'none' ? CATALOG : [])];
    console.log(`\nKEEP catalog: ${KEEP !== 'none'}`);
    console.log(`Tables to clear: ${targets.join(', ')}`);
    console.log(`Non-admin users will be deleted.\n`);

    if (!CONFIRM) {
      console.log('DRY RUN — nothing changed. Re-run with CONFIRM=RESET to apply.');
      return;
    }

    await client.query('BEGIN');
    for (const t of targets) {
      if (await tableExists(client, t)) {
        await client.query(`TRUNCATE TABLE ${t} CASCADE`);
        console.log(`  truncated ${t}`);
      }
    }
    const del = await client.query(`DELETE FROM users WHERE role <> 'admin'`);
    console.log(`  deleted ${del.rowCount} non-admin users`);
    // When keeping the catalog, still drop the seeded mock/test products
    // (name marker "تجريبي") so only the real catalog remains. Orders are
    // already gone above, so the product_id RESTRICT no longer blocks this.
    if (KEEP !== 'none') {
      const mp = await client.query(`DELETE FROM products WHERE name LIKE '%تجريبي%'`);
      console.log(`  deleted ${mp.rowCount} mock products (تجريبي)`);
    }
    await client.query('COMMIT');
    console.log('\n✓ Reset complete. Admin login(s) intact.');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n✗ Rolled back — no changes. Reason:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
