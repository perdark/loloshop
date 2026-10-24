'use strict';
// «فرّغ الرف» — owner 2026-10-25 opened it to محمد عادل by name (migration 117). The gate is
// lib/shelfAccess.js; the allowlist is data (site_settings.shelf_clear_users), never a role,
// so the other presser and every preparer stay refused.
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const { query, pool } = require('../lib/db');
const { mayClearShelf } = require('../lib/shelfAccess');

const presser = (id) => ({ id, role: 'staff', staff_type: 'presser', staff_types: ['presser'] });

test('manager and admin may clear; a plain presser/preparer may not', async () => {
  assert.equal(await mayClearShelf({ role: 'admin' }), true);
  assert.equal(await mayClearShelf({ id: 'x', role: 'staff', staff_types: ['preparer', 'manager'] }), true);
  assert.equal(await mayClearShelf(presser('00000000-0000-4000-8000-000000000000')), false);
  assert.equal(await mayClearShelf({ id: 'x', role: 'design_helper' }), false);
});

test('a presser named in site_settings.shelf_clear_users may clear', async () => {
  const before = await query(`SELECT value FROM site_settings WHERE key = 'shelf_clear_users'`);
  const id = '11111111-1111-4111-8111-111111111111';
  try {
    await query(
      `INSERT INTO site_settings (key, value) VALUES ('shelf_clear_users', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify({ user_ids: [id] })]
    );
    assert.equal(await mayClearShelf(presser(id)), true);
    assert.equal(await mayClearShelf(presser('22222222-2222-4222-8222-222222222222')), false);
  } finally {
    if (before.rows.length) {
      await query(`UPDATE site_settings SET value = $1 WHERE key = 'shelf_clear_users'`, [before.rows[0].value]);
    } else {
      await query(`DELETE FROM site_settings WHERE key = 'shelf_clear_users'`);
    }
  }
});

test.after(async () => { await pool.end().catch(() => {}); });
