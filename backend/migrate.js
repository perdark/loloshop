require('dotenv/config');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) { console.error('DATABASE_URL not set'); process.exit(1); }
if (rawUrl.includes('neon.tech') && process.env.NODE_ENV !== 'production') {
  console.error('Refusing to migrate the shared Neon database from a non-production environment.');
  process.exit(1);
}

// `pg` lets SSL query parameters override the explicit TLS object. Remove them
// so certificate verification below is authoritative, matching lib/db.js.
let connectionString = rawUrl;
try {
  const u = new URL(rawUrl);
  u.searchParams.delete('sslmode');
  u.searchParams.delete('channel_binding');
  connectionString = u.toString();
} catch { /* leave as-is if not a valid URL */ }

let dbHost = '';
try { dbHost = new URL(rawUrl).hostname.toLowerCase(); } catch { /* validated by pg */ }
const isLocalDb = !dbHost || ['localhost', '127.0.0.1', '::1'].includes(dbHost);
const useSsl = rawUrl.includes('neon.tech') || (process.env.NODE_ENV === 'production' && !isLocalDb);

const pool = new Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: true } : false,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Neon serverless can abort the first connection while it cold-starts.
// Retry transient connection errors so migrate doesn't fail spuriously.
async function connectWithRetry(attempts = 5) {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await pool.connect();
    } catch (e) {
      const transient = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', '57P01', 'XX000'].includes(e.code)
        || /terminat|timeout|reset|ECONNREFUSED/i.test(e.message || '');
      if (i === attempts || !transient) throw e;
      const wait = 500 * i;
      console.warn(`Connect attempt ${i}/${attempts} failed (${e.code || e.message}); retrying in ${wait}ms…`);
      await sleep(wait);
    }
  }
}

async function run() {
  const file = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(__dirname, '../db/schema.sql');

  console.log('Running:', file);
  const sql = fs.readFileSync(file, 'utf8');
  const client = await connectWithRetry();
  try {
    await client.query(sql);
    console.log('Done ✓');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => {
  // Log the FULL error — connection-level aborts often have an empty .message,
  // which previously made migrate fail silently with exit 1 and no diagnostics.
  console.error('Migration failed:');
  console.error('  message :', e.message || '(empty)');
  if (e.code) console.error('  code    :', e.code);
  if (e.detail) console.error('  detail  :', e.detail);
  if (e.position) console.error('  position:', e.position);
  if (e.where) console.error('  where   :', e.where);
  console.error(e.stack);
  process.exit(1);
});
