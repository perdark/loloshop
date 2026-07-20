const jwt = require('jsonwebtoken');
const { query } = require('../lib/db');

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      name: user.name,
      ver: Number(user.token_version || 0),
    },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// EventSource cannot attach an Authorization header. Give it a narrowly-scoped,
// short-lived ticket instead of putting the seven-day account JWT in server/proxy logs.
function signSseTicket(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      ver: Number(user.token_version || 0),
    },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', audience: 'production-sse', expiresIn: '60s' }
  );
}

function tokenVersionMatches(payload, user) {
  // Tokens issued before migration 067 have no `ver`; they represent version zero and
  // become invalid as soon as that user's password increments token_version.
  return Number(payload.ver || 0) === Number(user.token_version || 0);
}

async function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'غير مصرح', code: 'ERR_AUTH' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (payload.aud) throw new Error('Scoped token cannot be used as an API access token');
    const { rows } = await query(
      `SELECT id, name, phone, email, role, staff_type, staff_types, order_scope,
              phone_verified, token_version
       FROM users WHERE id = $1`,
      [payload.sub]
    );
    if (!rows.length) return res.status(401).json({ error: 'المستخدم غير موجود', code: 'ERR_AUTH' });
    if (!tokenVersionMatches(payload, rows[0])) {
      return res.status(401).json({ error: 'الجلسة منتهية', code: 'ERR_AUTH' });
    }
    req.user = rows[0];
    next();
  } catch (e) {
    return res.status(401).json({ error: 'الجلسة منتهية', code: 'ERR_AUTH' });
  }
}

/**
 * Auth for EventSource/SSE streams. The browser EventSource API can't send an
 * Authorization header, so a 60-second, SSE-only ticket arrives as `?ticket=`.
 * The normal account JWT is deliberately rejected here.
 */
async function authQuery(req, res, next) {
  const token = typeof req.query.ticket === 'string' ? req.query.ticket : null;
  if (!token) return res.status(401).json({ error: 'غير مصرح', code: 'ERR_AUTH' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      audience: 'production-sse',
    });
    const { rows } = await query(
      `SELECT id, name, phone, email, role, staff_type, staff_types, order_scope,
              phone_verified, token_version
       FROM users WHERE id = $1`,
      [payload.sub]
    );
    if (!rows.length) return res.status(401).json({ error: 'المستخدم غير موجود', code: 'ERR_AUTH' });
    if (!tokenVersionMatches(payload, rows[0])) {
      return res.status(401).json({ error: 'الجلسة منتهية', code: 'ERR_AUTH' });
    }
    req.user = rows[0];
    next();
  } catch {
    return res.status(401).json({ error: 'الجلسة منتهية', code: 'ERR_AUTH' });
  }
}

/**
 * The full set of job-types a staff member holds. Multi-role (Migration 029):
 * `users.staff_types[]` is authoritative; fall back to the single `staff_type` for any
 * row not yet backfilled. Returns [] for non-staff. Use this everywhere instead of
 * reading `user.staff_type` directly so a multi-role employee is treated as all roles.
 */
function staffTypesOf(user) {
  if (!user) return [];
  let st = user.staff_types;
  // Defensive: if the `staff_type[]` array parser wasn't registered (fresh DB / startup
  // race), pg hands back the raw literal "{designer,embroiderer}" — normalize it here so
  // multi-role logic never silently collapses to the single primary role.
  if (typeof st === 'string') st = st.replace(/^{|}$/g, '').split(',').filter(Boolean);
  if (Array.isArray(st) && st.length) return st;
  return user.staff_type ? [user.staff_type] : [];
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
    if (u.role === 'staff') {
      const mine = staffTypesOf(u);
      if (mine.includes('manager') || types.some((t) => mine.includes(t))) return next();
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
  if (user.role === 'admin' || staffTypesOf(user).includes('manager')) return true;
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
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (payload.aud) throw new Error('Scoped token cannot be used as an API access token');
    const { rows } = await query(
      `SELECT id, name, phone, email, role, staff_type, staff_types, order_scope,
              phone_verified, token_version
       FROM users WHERE id = $1`,
      [payload.sub]
    );
    if (rows.length && tokenVersionMatches(payload, rows[0])) req.user = rows[0];
  } catch {
    /* ignore — retail pricing for shop/configurator */
  }
  next();
}

module.exports = { signToken, signSseTicket, authRequired, authQuery, requireRole, requireStaffType, staffScopeAllows, staffTypesOf, optionalAuth };
