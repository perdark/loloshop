'use strict';
// 101's copy inside db/schema.sql must be IDEMPOTENT — «فجأة رجعت للكوي».
//
// THE FAILURE THIS PINS (measured on prod 2026-09-12). `scripts/deploy.sh` runs
// `npm run migrate`, which applies db/schema.sql, on EVERY deploy. The migration FILE
// (db/migrations/101_legacy_unpressed_to_kawi.sql) is guarded correctly: it selects into a temp
// table and updates only what that run just selected. The COPY in schema.sql was restructured
// into three statements, and the last one drives the UPDATE off the whole
// `legacy_pressing_restore_log` TABLE — 307 permanent rows — with no guard but
// `o.status = 'preparing'`:
//
//     UPDATE orders o SET status='pressing' … FROM legacy_pressing_restore_log l
//      WHERE o.id = l.order_id AND o.status='preparing' AND l.new_status='pressing';
//
// So every deploy dragged back to الكوي every one of those 307 orders that المكوجي had since
// pressed and advanced to التجهيز — silently, because the `route_fix` INSERT above it is guarded
// on `NOT EXISTS(action='route_fix')` and therefore never logged the second move, and no
// audit_log row is written either. Prod carried 49 such orders, 46 of them physically sitting in
// a bin on رف التجهيز, and the batches are visible as identical-microsecond `orders.updated_at`
// groups minutes after each deploy (11 rows 09-07 23:51 · 6 rows 09-08 16:55 · 14 rows 09-08 23:29).
//
// ⚠️ This runs the REAL text out of db/schema.sql, not a copy of it. A test holding its own copy
// of the SQL is the same mistake as schema.sql holding its own copy of the migration.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pool } = require('../lib/db');

const SCHEMA = path.resolve(__dirname, '../../db/schema.sql');
const START = 'DO $legacy101$';
const END = '-- 102 — LEGACY';

function legacy101Sql() {
  const sql = fs.readFileSync(SCHEMA, 'utf8');
  const from = sql.indexOf(START);
  const to = sql.indexOf(END, from);
  assert.ok(from !== -1, 'db/schema.sql no longer contains the 101 DO block');
  assert.ok(to > from, 'db/schema.sql no longer contains the 102 banner after 101');
  return sql.slice(from, to);
}

async function statusOf(client, id) {
  const { rows } = await client.query('SELECT status::text AS s FROM orders WHERE id = $1', [id]);
  return rows[0].s;
}

test('schema.sql\'s 101 never drags a pressed piece back out of التجهيز', async () => {
  const block = legacy101Sql();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // A piece with exactly 101's shape: plain non-cap, opened at التجهيز before the routing change.
    const { rows: pr } = await client.query(
      `INSERT INTO products (type, name_ar, base_price, active, sort)
       VALUES ('robe', 'ZZ اختبار ترحيل 101', 1000, FALSE, 9999) RETURNING id`
    );
    const { rows: us } = await client.query(
      `INSERT INTO users (name, role, phone, password_hash)
       VALUES ('ZZ اختبار 101', 'retail', '0770000101x', 'x') RETURNING id`
    );
    const { rows: st } = await client.query(
      `INSERT INTO students (user_id, university_name, full_name_third) VALUES ($1, 'ZZ', 'ZZ') RETURNING id`,
      [us[0].id]
    );
    const { rows: or } = await client.query(
      `INSERT INTO orders (student_id, product_id, price, status, needs_pressing, created_at)
       VALUES ($1, $2, 1000, 'preparing', TRUE, '2026-07-01') RETURNING id`,
      [st[0].id, pr[0].id]
    );
    const orderId = or[0].id;

    // First deploy: the correction fires, exactly as it did on 2026-09-01.
    await client.query(block);
    assert.equal(await statusOf(client, orderId), 'pressing', 'the legacy correction should fire once');
    const { rows: fix } = await client.query(
      `SELECT count(*)::int n FROM staff_activity_log WHERE order_id = $1 AND action = 'route_fix'`,
      [orderId]
    );
    assert.equal(fix[0].n, 1, 'and it should say so in words — «تصحيح مسار آلي»');

    // المكوجي presses it and sends it to التجهيز, writing the row performAdvance writes.
    await client.query(`UPDATE orders SET status = 'preparing' WHERE id = $1`, [orderId]);
    await client.query(
      `INSERT INTO staff_activity_log (user_id, action, order_id, from_stage, to_stage)
       VALUES ($1, 'advance', $2, 'pressing', 'preparing')`,
      [us[0].id, orderId]
    );

    // Next deploy. The piece is pressed, folded and in a bin. It must stay where the worker put it.
    await client.query(block);
    assert.equal(
      await statusOf(client, orderId),
      'preparing',
      'a deploy must not pull a pressed piece back to الكوي'
    );

    // …and it must not have invented a second «تصحيح مسار آلي» either.
    const { rows: fix2 } = await client.query(
      `SELECT count(*)::int n FROM staff_activity_log WHERE order_id = $1 AND action = 'route_fix'`,
      [orderId]
    );
    assert.equal(fix2[0].n, 1, 'no second route_fix row');
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
});
