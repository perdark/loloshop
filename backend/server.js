require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const fs = require('fs');
const path = require('path');

const isProd = process.env.NODE_ENV === 'production';

if (isProd) {
  try {
    const publicUrl = new URL(process.env.PUBLIC_URL || '');
    if (publicUrl.protocol !== 'https:' || publicUrl.username || publicUrl.password) throw new Error();
  } catch {
    console.error('FATAL: PUBLIC_URL must be an absolute HTTPS URL in production.');
    process.exit(1);
  }
}

// JWT security cannot depend on NODE_ENV being labelled correctly. This project has run
// production services with development settings before; a missing/default/short key must
// therefore fail closed in every environment that starts the API.
const jwtSecret = process.env.JWT_SECRET || '';
if (Buffer.byteLength(jwtSecret, 'utf8') < 32 || /change-me|replace-me|example/i.test(jwtSecret)) {
  console.error('FATAL: JWT_SECRET must be a non-default secret of at least 32 bytes.');
  process.exit(1);
}

for (const name of ['STAFF_PORTAL_KEY', 'WORKSHOP_PORTAL_KEY', 'DESIGN_TEAM_PORTAL_KEY', 'TV_BOARD_KEY']) {
  const value = process.env[name];
  if (value && (Buffer.byteLength(value, 'utf8') < 16 || /change-me|replace-me|example/i.test(value))) {
    console.error(`FATAL: ${name} must be a non-default secret of at least 16 bytes, or left empty to disable it.`);
    process.exit(1);
  }
}

const app = express();
// Trust only a reverse proxy on this host by default. Numeric `1` trusted a forged
// X-Forwarded-For header whenever Node was reachable directly, bypassing IP limits.
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

const corsOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (!isProd) {
  for (const o of ['http://localhost:3000', 'http://127.0.0.1:3000']) {
    if (!corsOrigins.includes(o)) corsOrigins.push(o);
  }
}
if (isProd && !corsOrigins.length) {
  console.error('FATAL: CORS_ORIGIN must be set in production (no reflect-any fallback).');
  process.exit(1);
}
app.use(
  cors({
    origin: corsOrigins.length ? corsOrigins : false,
    credentials: true,
  })
);
// ⚠️ MOUNTED BEFORE express.json() AND AT THE ROOT, both deliberately. The fingerprint
// device's paths (/iclock/*) are fixed in its firmware, so they cannot live under /api, and
// its bodies are tab-separated text/plain that this app's JSON parser must never see.
// ⚠️ MOUNTED ON THE /iclock PATH, NOT THE ROOT. A bare app.use(router) runs this router's
// middleware for EVERY request in the app — and it installs express.text({type:'*/*'}),
// which would consume every JSON body before express.json() ever sees it, leaving req.body a
// STRING on every POST in the shop. Measured, not theorised. Do not "simplify" this back.
app.use('/iclock', require('./routes/iclock'));

app.use(express.json({ limit: '5mb' }));
app.use(
  '/uploads',
  express.static(path.join(__dirname, '..', 'uploads'), {
    maxAge: 0,
    etag: true,
    setHeaders: (res) => {
      res.setHeader('Content-Disposition', 'attachment');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // Upload URLs can contain customer artwork/PII. Do not leave them in shared
      // browser, proxy, or service-worker caches after logout.
      res.setHeader('Cache-Control', 'private, no-store');
    },
  })
);

app.get('/api/health', async (req, res) => {
  const payload = { ok: true, time: new Date().toISOString() };
  try {
    const { query } = require('./lib/db');
    await query('SELECT 1');
    payload.db = true;
    res.json(payload);
  } catch (err) {
    // Detail stays in the server log only. Driver errors name hosts, schema, and
    // connection state, and this endpoint is public (uptime monitoring hits it). (LS-15)
    console.error('Health DB check failed:', err.message);
    res.status(503).json({
      ok: false,
      db: false,
      code: 'ERR_DB_UNAVAILABLE',
      time: payload.time,
    });
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/join', require('./routes/join'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/batches', require('./routes/batches'));
app.use('/api/staff', require('./routes/staff'));
app.use('/api/production', require('./routes/production'));
app.use('/api/cart', require('./routes/cart'));
app.use('/api/wholesaler', require('./routes/wholesaler'));
app.use('/api/notifications', require('./routes/notifications'));
// The app-presence beacon (migration 087). Its own router because it is the one signal that
// must reach EVERY signed-in role — /api/staff is role-locked, which is why 084 saw only staff.
app.use('/api/app', require('./routes/app'));
app.use('/api/products', require('./routes/products'));
app.use('/api/catalog', require('./routes/catalog'));
app.use('/api/designs', require('./routes/designs'));
app.use('/api/fonts', require('./routes/fonts'));
app.use('/api/payroll', require('./routes/payroll'));
app.use('/api/calligraphy', require('./routes/calligraphy'));
app.use('/api/tv', require('./routes/tv'));
app.use('/api/track', require('./routes/track'));
app.use('/api/workshop', require('./routes/workshop'));
app.use('/api/design-team', require('./routes/designTeam'));
app.use('/api/assistant', require('./routes/assistant'));

// Push delivery. The drain reads COMMITTED `notifications` rows and sends them to registered
// phones (backend/lib/pushOutbox.js). Started here rather than in worker.js because the worker
// exits when pg-boss cannot start, and a calligraphy queue outage must not also silence every
// notification. It is inert until FCM/APNs credentials exist, and its timer is unref'd so it
// never delays the SIGTERM shutdown below.
require('./lib/pushOutbox').start();

// Ensure calligraphy upload dirs exist at boot
['calligraphy/sheets', 'calligraphy/plates', 'calligraphy/elements'].forEach((d) => {
  const p = path.join(__dirname, '..', 'uploads', d);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

app.use((err, req, res, next) => {
  // Errors flagged `expose` carry a safe Arabic message + status (e.g. OTP rate
  // limit) — surface them as-is. Everything else is an unexpected 500.
  if (err && err.expose && err.status) {
    return res.status(err.status).json({
      error: err.message,
      code: err.code || 'ERR_SERVER',
    });
  }
  console.error('Unhandled:', err);
  res.status(500).json({ error: 'خطأ في الخادم', code: 'ERR_SERVER' });
});

const port = parseInt(process.env.PORT || '4000', 10);
const server = app.listen(port, () => console.log(`LoloShop API on :${port}`));

// Graceful shutdown — on PM2 reload/deploy, stop accepting new connections and let
// in-flight requests (and SSE streams) finish instead of being killed mid-write.
function shutdown(signal) {
  console.log(`${signal} received — closing server…`);
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
  // Hard cap so a stuck connection can't block the deploy forever.
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
