const { Pool, types } = require('pg');
const dns = require('dns');
require('dotenv').config();

// Force IPv4 resolution — Neon hosts often resolve to unreachable IPv6 on some networks
dns.setDefaultResultOrder('ipv4first');

const rawUrl = process.env.DATABASE_URL || '';
const useSsl = rawUrl.includes('neon.tech') || process.env.NODE_ENV === 'production';

// Strip sslmode/channel_binding from the URL (we set ssl explicitly below);
// avoids the pg-connection-string "SSL modes treated as verify-full" deprecation warning.
let connectionString = rawUrl;
try {
  const u = new URL(rawUrl);
  u.searchParams.delete('sslmode');
  u.searchParams.delete('channel_binding');
  connectionString = u.toString();
} catch { /* leave as-is if not a valid URL */ }

const pool = new Pool({
  connectionString,
  // 25 is safe: prod connects through Neon's pooled (-pooler / PgBouncer) endpoint.
  max: 25,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 20000,  // Neon free compute cold-starts; default 0/short → ETIMEDOUT
  keepAlive: true,
  keepAliveInitialDelayMillis: 5000,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Postgres pool error:', err);
});

// `pg` does NOT auto-parse custom enum array types (e.g. `staff_type[]`); without a
// parser they arrive as the raw Postgres literal string "{designer,embroiderer}" instead
// of a JS array, which silently breaks multi-role logic (staffTypesOf) AND any JSON sent
// to the frontend. The array OID is database-specific, so look it up once at startup and
// register a parser that turns "{a,b}" into ['a','b']. Self-heals if a query races startup
// because staffTypesOf() also tolerates the string form defensively.
(async () => {
  try {
    const { rows } = await pool.query(`SELECT oid FROM pg_type WHERE typname = '_staff_type'`);
    if (rows.length) {
      types.setTypeParser(Number(rows[0].oid), (val) =>
        val == null ? val : val.replace(/^{|}$/g, '').split(',').filter(Boolean)
      );
    }
  } catch (e) {
    console.error('Failed to register _staff_type array parser:', e.message);
  }
})();

const TRANSIENT = ['ETIMEDOUT', 'ENETUNREACH', 'ECONNRESET', 'ECONNREFUSED'];
function isTransient(e) {
  if (TRANSIENT.includes(e.code)) return true;
  return Array.isArray(e.errors) && e.errors.some((x) => TRANSIENT.includes(x.code));
}

// Retry transient connection failures (Neon cold-start / flaky route).
async function query(text, params) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const t0 = Date.now();
      const result = await pool.query(text, params);
      const ms = Date.now() - t0;
      if (ms > 500) {
        // Developer-only diagnostics (pm2 logs). SQL text only — never params (PII).
        console.warn(`SLOW QUERY ${ms}ms: ${String(text).replace(/\s+/g, ' ').slice(0, 80)}`);
      }
      return result;
    } catch (e) {
      lastErr = e;
      if (!isTransient(e) || attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  throw lastErr;
}

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, tx };
