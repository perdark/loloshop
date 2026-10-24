'use strict';
// Owner 2026-10-25: «ايادي التصميم تكون تقريبا كموظفة تكدر تنطي تم للطلب». Drives the real
// sendOrder as an ACTIVE design-team member and asserts the advance is recorded under HER id
// in staff_activity_log — the row payroll and staff goals count. Before this, the same click
// had to be made by a designer/manager and the helper's work went down under their name.
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const { query, pool } = require('../lib/db');
const production = require('../controllers/productionController');
const { sendOrder } = require('../controllers/calligraphyController');

function call(fn, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(body) { resolve({ status: this.statusCode, body }); },
    };
    Promise.resolve(fn(req, res)).catch(reject);
  });
}

test('an active design-team member sends an order to التطريز under her own id', async (t) => {
  const member = await query(
    `SELECT u.id, u.role, u.name FROM design_team_members m JOIN users u ON u.id = m.user_id
      WHERE m.active = TRUE AND u.role = 'design_helper' LIMIT 1`
  );
  if (!member.rows.length) return t.skip('no active design_helper member in this DB');
  const candidates = await query(
    `SELECT id FROM orders WHERE status = 'design_complete' ORDER BY created_at DESC LIMIT 50`
  );
  let row = null;
  for (const c of candidates.rows) {
    const r = await production.loadAdvanceRow(c.id);
    if (r && !production.advanceBlockReason(r) && production.nextStageFor(r) === 'embroidery') { row = r; break; }
  }
  if (!row) return t.skip('no sendable design_complete order in this DB');
  const user = member.rows[0];
  const before = new Date();
  try {
    const out = await call(sendOrder, { params: { orderId: row.id }, user, designTeamPusher: true });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.body.data.status, 'embroidery');
    const log = await query(
      `SELECT user_id FROM staff_activity_log
        WHERE order_id = $1 AND from_stage = 'design_complete' AND to_stage = 'embroidery'
          AND created_at >= $2`,
      [row.id, before]
    );
    assert.equal(log.rows.length, 1);
    assert.equal(log.rows[0].user_id, user.id);
  } finally {
    await query(`UPDATE orders SET status = 'design_complete' WHERE id = $1`, [row.id]);
    await query(`DELETE FROM staff_activity_log WHERE order_id = $1 AND created_at >= $2`, [row.id, before]);
    await query(`DELETE FROM audit_log WHERE entity_id = $1 AND created_at >= $2 AND action = 'status_change'`, [row.id, before]);
  }
});

test('without the gate flag, a design_helper is still refused by the staff edge check', async (t) => {
  const candidates = await query(
    `SELECT id FROM orders WHERE status = 'design_complete' ORDER BY created_at DESC LIMIT 50`
  );
  let row = null;
  for (const c of candidates.rows) {
    const r = await production.loadAdvanceRow(c.id);
    if (r && !production.advanceBlockReason(r) && production.nextStageFor(r) === 'embroidery') { row = r; break; }
  }
  if (!row) return t.skip('no sendable design_complete order in this DB');
  const out = await call(sendOrder, {
    params: { orderId: row.id },
    user: { id: '00000000-0000-4000-8000-000000000000', role: 'design_helper' },
  });
  assert.equal(out.status, 403);
  const still = await query(`SELECT status FROM orders WHERE id = $1`, [row.id]);
  assert.equal(still.rows[0].status, 'design_complete');
});

test.after(async () => { await pool.end().catch(() => {}); });
