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
      `SELECT id, name, phone, email, role, staff_type, order_scope, phone_verified FROM users WHERE id = $1`,
      [payload.sub]
    );
    if (!rows.length) return res.status(401).json({ error: 'المستخدم غير موجود', code: 'ERR_AUTH' });
    req.user = rows[0];
    next();
  } catch (e) {
    return res.status(401).json({ error: 'الجلسة منتهية', code: 'ERR_AUTH' });
  }
}

/**
 * Auth for EventSource/SSE streams. The browser EventSource API can't send an
 * Authorization header, so the JWT arrives as `?token=`. Same verification as
 * authRequired otherwise. SECURITY: the token rides in the URL (may land in
 * access logs) — only used for the read-only events stream.
 */
async function authQuery(req, res, next) {
  const token =
    (typeof req.query.token === 'string' && req.query.token) ||
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null);
  if (!token) return res.status(401).json({ error: 'غير مصرح', code: 'ERR_AUTH' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await query(
      `SELECT id, name, phone, email, role, staff_type, order_scope, phone_verified FROM users WHERE id = $1`,
      [payload.sub]
    );
    if (!rows.length) return res.status(401).json({ error: 'المستخدم غير موجود', code: 'ERR_AUTH' });
    req.user = rows[0];
    next();
  } catch {
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

/**
 * Gate by staff job-type. `admin` role and the `manager` staff_type always pass
 * (manager has admin-like reach over staff/orders); other staff pass only when their
 * staff_type is in the allowed list. Coarse route-level guard — per-stage rules live
 * in the controllers.
 */
function requireStaffType(...types) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'غير مصرح', code: 'ERR_AUTH' });
    const u = req.user;
    if (u.role === 'admin') return next();
    if (u.role === 'staff' && (u.staff_type === 'manager' || types.includes(u.staff_type))) {
      return next();
    }
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  };
}

/**
 * Does this staff member handle an order of the given source? `manager` staff_type and
 * `admin` role handle both. Otherwise users.order_scope ('retail'|'wholesaler'|'both')
 * must match the order's source. `isRetailOrder` = the order's student has no wholesaler.
 */
function staffScopeAllows(user, isRetailOrder) {
  if (user.role === 'admin' || user.staff_type === 'manager') return true;
  const scope = user.order_scope || 'both';
  if (scope === 'both') return true;
  return scope === (isRetailOrder ? 'retail' : 'wholesaler');
}

/** Token present but invalid/expired → continue as anonymous (public catalog). */
async function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await query(
      `SELECT id, name, phone, email, role, staff_type, order_scope, phone_verified FROM users WHERE id = $1`,
      [payload.sub]
    );
    if (rows.length) req.user = rows[0];
  } catch {
    /* ignore — retail pricing for shop/configurator */
  }
  next();
}

module.exports = { signToken, authRequired, authQuery, requireRole, requireStaffType, staffScopeAllows, optionalAuth };
