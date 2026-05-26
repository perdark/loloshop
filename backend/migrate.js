require('dotenv/config');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }

const pool = new Pool({
  connectionString: url,
  ssl: url.includes('neon') || url.includes('sslmode') ? { rejectUnauthorized: false } : false,
});

async function run() {
  const file = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(__dirname, '../db/schema.sql');

  console.log('Running:', file);
  const sql = fs.readFileSync(file, 'utf8');
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log('Done ✓');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(e => { console.error(e.message); process.exit(1); });
