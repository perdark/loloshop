// «قفل الحجز للمفرد» — site_settings key 'retail_booking_lock'.
//
// While active, a retail student with NO rep (students.wholesaler_id IS NULL) can still
// browse, configure and fill the cart, but every path that CREATES an order refuses:
// cart checkout, /orders/configure, /orders/configure-package, /orders/configure-full-set.
//
// Deliberately NOT gated: rep-linked students (they order through their ممثل), the
// wholesaler's own flows, and every staff/admin custom-order path — the shop can still
// book a walk-in by hand while the storefront is closed.
//
// The gate lives on the server, never only on the cart button: hiding the button alone
// still accepts a hand-posted request.
const { query } = require('./db');

const KEY = 'retail_booking_lock';
const DEFAULT_MESSAGE = 'انتظرونا، راح نبلّغكم أول ما ينفتح الحجز';

async function getRetailBookingLock() {
  const { rows } = await query(`SELECT value FROM site_settings WHERE key = $1`, [KEY]);
  const cfg = rows[0] ? rows[0].value : {};
  return {
    active: cfg.active === true,
    message_ar: (typeof cfg.message_ar === 'string' && cfg.message_ar.trim()) || DEFAULT_MESSAGE,
  };
}

async function setRetailBookingLock({ active, message_ar }) {
  const cfg = {
    active: !!active,
    message_ar: (typeof message_ar === 'string' && message_ar.trim()) || DEFAULT_MESSAGE,
  };
  await query(
    `INSERT INTO site_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [KEY, JSON.stringify(cfg)]
  );
  return cfg;
}

// Call AFTER the rep-linked check, with the student row. Returns true when it has
// already answered the request (423), so the caller just `return`s.
async function refuseIfRetailLocked(res, student) {
  if (!student || student.wholesaler_id) return false;
  const lock = await getRetailBookingLock();
  if (!lock.active) return false;
  res.status(423).json({ error: lock.message_ar, code: 'ERR_RETAIL_BOOKING_CLOSED' });
  return true;
}

module.exports = { getRetailBookingLock, setRetailBookingLock, refuseIfRetailLocked, DEFAULT_MESSAGE };
