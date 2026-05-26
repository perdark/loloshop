require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const isProd = process.env.NODE_ENV === 'production';

if (isProd && (!process.env.JWT_SECRET || /change-me/i.test(process.env.JWT_SECRET))) {
  console.error('FATAL: JWT_SECRET is missing or default in production. Set a strong secret.');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);
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
app.use(express.json({ limit: '5mb' }));
app.use(
  '/uploads',
  express.static(path.join(__dirname, '..', 'uploads'), {
    maxAge: '7d',
    etag: true,
    setHeaders: (res) => {
      res.setHeader('Content-Disposition', 'attachment');
      res.setHeader('X-Content-Type-Options', 'nosniff');
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
    console.error('Health DB check failed:', err.message);
    res.status(503).json({
      ok: false,
      db: false,
      error: err.message,
      hint: 'Check DATABASE_URL in backend/.env',
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
app.use('/api/wholesaler', require('./routes/wholesaler'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/products', require('./routes/products'));
app.use('/api/catalog', require('./routes/catalog'));
app.use('/api/designs', require('./routes/designs'));
app.use('/api/fonts', require('./routes/fonts'));

app.use((err, req, res, next) => {
  console.error('Unhandled:', err);
  res.status(500).json({ error: 'خطأ في الخادم', code: 'ERR_SERVER' });
});

const port = parseInt(process.env.PORT || '4000', 10);
app.listen(port, () => console.log(`LoloShop API on :${port}`));
