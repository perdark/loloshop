'use strict';
// «قفل الحجز للمفرد» — lib/retailBookingLock.js.
//
// Pins both halves together: while the lock is on, a retail student WITHOUT a rep is refused
// on every order-creating path (423), and a rep-linked student still gets the rep-flow answer
// it always got (403 ERR_REP_ORDER_FLOW) — the lock must never reach them. The admin custom
// order lives in adminCustomOrderController and never calls the gate at all.

const test = require('node:test');
const assert = require('node:assert');
const { query } = require('../lib/db');
const lockLib = require('../lib/retailBookingLock');
const cart = require('../controllers/cartController');
const orders = require('../controllers/orderController');

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

async function studentUser(linked) {
  const { rows } = await query(
    `SELECT u.id, u.role, u.name FROM users u JOIN students s ON s.user_id = u.id
      WHERE u.role = 'retail' AND s.wholesaler_id IS ${linked ? 'NOT ' : ''}NULL
      ORDER BY u.created_at LIMIT 1`
  );
  return rows[0] || null;
}

async function withLock(cfg, fn) {
  const prev = (await query(`SELECT value FROM site_settings WHERE key = 'retail_booking_lock'`)).rows[0];
  try {
    await lockLib.setRetailBookingLock(cfg);
    await fn();
  } finally {
    if (prev) {
      await query(`UPDATE site_settings SET value = $1::jsonb WHERE key = 'retail_booking_lock'`, [JSON.stringify(prev.value)]);
    } else {
      await query(`DELETE FROM site_settings WHERE key = 'retail_booking_lock'`);
    }
  }
}

test('lock ON: a retail student without a rep is refused on every order-creating path', async (t) => {
  const user = await studentUser(false);
  if (!user) return t.skip('no unlinked retail student in this DB');
  await withLock({ active: true, message_ar: 'مقفول للاختبار' }, async () => {
    const paths = [
      ['cart checkout', cart.checkout, {}],
      ['configureOrder', orders.configureOrder, { product_id: '00000000-0000-0000-0000-000000000000' }],
      ['configureFullSet', orders.configureFullSet, { package_id: '00000000-0000-0000-0000-000000000000' }],
    ];
    for (const [name, fn, body] of paths) {
      const res = fakeRes();
      await fn({ user, body }, res);
      assert.strictEqual(res.statusCode, 423, `${name} was not refused`);
      assert.strictEqual(res.body.code, 'ERR_RETAIL_BOOKING_CLOSED', name);
      assert.strictEqual(res.body.error, 'مقفول للاختبار', `${name} must show the admin's message`);
    }
  });
});

test('lock ON: a rep-linked student is NOT touched by the lock', async (t) => {
  const user = await studentUser(true);
  if (!user) return t.skip('no rep-linked retail student in this DB');
  await withLock({ active: true }, async () => {
    const res = fakeRes();
    await cart.checkout({ user, body: {} }, res);
    assert.strictEqual(res.body.code, 'ERR_REP_ORDER_FLOW');
    assert.strictEqual(await lockLib.refuseIfRetailLocked(fakeRes(), { wholesaler_id: 'x' }), false);
  });
});

test('lock OFF: the gate lets an unlinked student through, and an empty message falls back', async () => {
  await withLock({ active: false, message_ar: '   ' }, async () => {
    const res = fakeRes();
    assert.strictEqual(await lockLib.refuseIfRetailLocked(res, { wholesaler_id: null }), false);
    assert.strictEqual(res.body, null);
    const cfg = await lockLib.getRetailBookingLock();
    assert.strictEqual(cfg.active, false);
    assert.strictEqual(cfg.message_ar, lockLib.DEFAULT_MESSAGE);
  });
});
