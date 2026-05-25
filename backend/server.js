require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || '*', credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/join', require('./routes/join'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/batches', require('./routes/batches'));
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
