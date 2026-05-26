const jwt = require('jsonwebtoken');
const { query } = require('../lib/db');

function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

async function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'غير مصرح', code: 'ERR_AUTH' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await query(
      `SELECT id, name, phone, email, role, phone_verified FROM users WHERE id = $1`,
      [payload.sub]
    );
    if (!rows.length) return res.status(401).json({ error: 'المستخدم غير موجود', code: 'ERR_AUTH' });
    req.user = rows[0];
    next();
  } catch (e) {
    return res.status(401).json({ error: 'الجلسة منتهية', code: 'ERR_AUTH' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'غير مصرح', code: 'ERR_AUTH' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
    }
    next();
  };
}

/** Token present but invalid/expired → continue as anonymous (public catalog). */
async function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await query(
      `SELECT id, name, phone, email, role, phone_verified FROM users WHERE id = $1`,
      [payload.sub]
    );
    if (rows.length) req.user = rows[0];
  } catch {
    /* ignore — retail pricing for shop/configurator */
  }
  next();
}

module.exports = { signToken, authRequired, requireRole, optionalAuth };
