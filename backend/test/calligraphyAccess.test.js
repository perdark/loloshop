'use strict';
// Who may open الخط العربي, and who may push an order out of التصميم with it. The two are
// different questions on purpose: محمد عماد (المطرّز) generates and downloads plates for
// his own station; «تحويل للتطريز» stays the designer's (advanceBlockReason's side door).
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const { mayUseTool, mayPushOrder } = require('../lib/calligraphyAccess');

const staff = (...types) => ({ role: 'staff', staff_type: types[0], staff_types: types });

test('1. embroiderer may use the tool', () => {
  assert.equal(mayUseTool(staff('embroiderer')), true);
});
test('2. embroiderer may NOT push an order to التطريز', () => {
  assert.equal(mayPushOrder(staff('embroiderer')), false);
});
test('3. designer and manager may do both; presser neither', () => {
  assert.equal(mayUseTool(staff('designer')), true);
  assert.equal(mayPushOrder(staff('designer')), true);
  assert.equal(mayUseTool(staff('manager')), true);
  assert.equal(mayPushOrder(staff('manager')), true);
  assert.equal(mayUseTool(staff('presser')), false);
  assert.equal(mayPushOrder(staff('presser')), false);
});
test('4. multi-role: presser+embroiderer may use the tool', () => {
  assert.equal(mayUseTool(staff('presser', 'embroiderer')), true);
});
test('5. admin always; retail never', () => {
  assert.equal(mayUseTool({ role: 'admin' }), true);
  assert.equal(mayPushOrder({ role: 'admin' }), true);
  assert.equal(mayUseTool({ role: 'retail' }), false);
});

// ── «تحويل للتطريز» for أيادي التصميم (owner 2026-10-25) ─────────────────────────────
// allowPushUser is the route gate on POST /calligraphy/orders/:id/send. An ACTIVE design-team
// member is admitted (and flagged, so sendOrder skips the staff-only edge check); a
// design_helper with no active membership, an embroiderer, and a presser are refused.
const { allowPushUser } = require('../lib/calligraphyAccess');
const { query, pool } = require('../lib/db');

function runGate(user) {
  return new Promise((resolve, reject) => {
    const req = { user };
    const res = {
      status(code) { return { json: () => resolve({ code, req }) }; },
    };
    allowPushUser(req, res, (err) => (err ? reject(err) : resolve({ code: 'next', req })));
  });
}

test('6. allowPushUser: designer passes without the design-team flag; embroiderer/presser 403', async () => {
  const d = await runGate(staff('designer'));
  assert.equal(d.code, 'next');
  assert.equal(d.req.designTeamPusher, undefined);
  assert.equal((await runGate(staff('embroiderer'))).code, 403);
  assert.equal((await runGate(staff('presser'))).code, 403);
});

test('7. allowPushUser: design_helper with NO active membership is refused', async () => {
  const r = await runGate({ role: 'design_helper', id: '00000000-0000-4000-8000-000000000000' });
  assert.equal(r.code, 403);
});

test('8. allowPushUser: an ACTIVE design-team member passes and is flagged', async (t) => {
  const { rows } = await query(
    `SELECT m.user_id FROM design_team_members m JOIN users u ON u.id = m.user_id
      WHERE m.active = TRUE AND u.role = 'design_helper' LIMIT 1`
  );
  if (!rows.length) return t.skip('no active design_helper member in this DB');
  const r = await runGate({ role: 'design_helper', id: rows[0].user_id });
  assert.equal(r.code, 'next');
  assert.equal(r.req.designTeamPusher, true);
});

test.after(async () => { if (pool && pool.end) await pool.end().catch(() => {}); });
