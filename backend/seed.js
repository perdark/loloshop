require('dotenv').config();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { query, pool } = require('./lib/db');
const { assertPasswordOk } = require('./lib/password');

async function ensureAdmin() {
  const phone = '07783571996';
  const exists = await query(`SELECT id FROM users WHERE phone = $1`, [phone]);
  if (exists.rows.length) {
    console.log('Admin exists.');
    return;
  }
  // No baked-in password. `admin123` shipped in this file for months and is exactly the
  // kind of default that survives into production. Supply SEED_ADMIN_PASSWORD, or take the
  // generated one printed once below. (LS-10)
  const password = process.env.SEED_ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');
  assertPasswordOk(password, 'privileged');
  const hash = await bcrypt.hash(password, 10);
  await query(
    `INSERT INTO users (name, phone, email, password_hash, role, phone_verified)
     VALUES ($1, $2, $3, $4, 'admin', TRUE)`,
    ['Admin', phone, 'admin@loloshop.com', hash]
  );
  console.log(`Admin created: ${phone}`);
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.log(`Generated admin password (shown once, store it now): ${password}`);
  }
}

async function ensureProducts() {
  const existing = await query(`SELECT type FROM products`);
  const types = new Set(existing.rows.map((r) => r.type));

  let sashId, robeId;
  if (!types.has('sash')) {
    const r = await query(
      `INSERT INTO products (type, name_ar, description, base_price, customizable)
       VALUES ('sash', 'وشاح تخرج كلاسيكي', 'وشاح ساتان مع طباعة ذهبية', 50000, TRUE) RETURNING id`
    );
    sashId = r.rows[0].id;
    console.log('Sash product created.');
  }
  if (!types.has('robe')) {
    const r = await query(
      `INSERT INTO products (type, name_ar, description, base_price, customizable)
       VALUES ('robe', 'روب تخرج قياسي', 'روب تخرج بقماش فاخر', 75000, FALSE) RETURNING id`
    );
    robeId = r.rows[0].id;
    console.log('Robe product created.');
  }

  if (sashId) {
    const sashVariants = [
      { color: 'أبيض', price: 50000 },
      { color: 'رمادي فاتح', price: 50000 },
      { color: 'أخضر داكن', price: 55000 },
      { color: 'أسود', price: 55000 },
      { color: 'كحلي', price: 55000 },
      { color: 'عنابي', price: 60000 },
    ];
    for (const v of sashVariants) {
      await query(
        `INSERT INTO product_variants (product_id, color, material, size, price)
         VALUES ($1, $2, 'ساتان', 'قياس واحد', $3)`,
        [sashId, v.color, v.price]
      );
    }
    console.log(`${sashVariants.length} sash variants created.`);
  }

  if (robeId) {
    const sizes = ['S', 'M', 'L', 'XL', 'XXL'];
    for (const size of sizes) {
      await query(
        `INSERT INTO product_variants (product_id, color, material, size, price)
         VALUES ($1, 'أسود', 'قماش فاخر', $2, 75000)`,
        [robeId, size]
      );
    }
    console.log(`${sizes.length} robe variants created.`);
  }
}

async function main() {
  await ensureAdmin();
  await ensureProducts();
  console.log('Seed complete.');
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
