'use strict';
// «منو نقلها؟» must not stop one stage short — the card reads BOTH ledgers.
//
// THE FINDING (prod, 2026-09-12). `getOrder`'s stage_history read only `staff_activity_log`.
// It is not the only thing that has ever moved an order: the 2026-08-31
// `npm run stranded-orders -- --fix` run moved **474** pieces and wrote only an `audit_log` row
// (`scripts/stranded-orders.js` predates the card and still does this by design — it is a
// nobody-moved-it correction). Those pieces then showed a history that stops before the stage
// they are actually standing in, which on the floor reads as «وصلت لهنا لوحدها — محد نطاها تم
// ولا رجّعها». Measured the same day: 268 retail orders at الكوي were there because of that run
// and every one of them had a blank card.
//
// The two halves this pins are opposite mistakes, and both are easy to make on a tidy-up:
//   · DROP the audit half  → the gap comes back.
//   · Let the audit half through for a move an activity row ALREADY describes → every ordinary
//     transition is printed twice, and the card becomes unreadable exactly when it is busiest.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const { query } = require('../lib/db');
const { getOrder } = require('../controllers/productionController');

function fakeRes() {
  const out = {};
  return {
    out,
    status(c) { out.status = c; return this; },
    json(b) { out.body = b; return this; },
  };
}

async function historyOf(orderId, admin) {
  const res = fakeRes();
  await getOrder({ params: { id: orderId }, user: admin, query: {} }, res);
  assert.equal(res.out.status, undefined, 'getOrder should not have errored');
  return res.out.body.data.stage_history || [];
}

test('a move recorded only in audit_log still shows on the card, exactly once', async (t) => {
  const admin = await query(
    "SELECT id, role, staff_type FROM users WHERE role = 'admin' LIMIT 1"
  );
  if (!admin.rows.length) return t.skip('no admin on this database');
  const user = { ...admin.rows[0] };

  // An order the stranded-orders script moved: an audit status_change with a NULL actor and no
  // activity twin. This is the shape the card used to drop on the floor.
  const stranded = await query(
    `SELECT DISTINCT al.entity_id AS id
       FROM audit_log al
      WHERE al.entity = 'order' AND al.action = 'status_change'
        AND al.actor_id IS NULL
        AND al.details->>'by' LIKE 'script:%'
        AND NOT EXISTS (
              SELECT 1 FROM staff_activity_log t
               WHERE t.order_id = al.entity_id AND t.to_stage IS NOT NULL
                 AND t.to_stage::text = al.details->>'to'
                 AND t.created_at BETWEEN al.created_at - INTERVAL '5 seconds'
                                      AND al.created_at + INTERVAL '5 seconds')
      LIMIT 1`
  );
  if (!stranded.rows.length) return t.skip('no script-moved order on this snapshot');

  const hist = await historyOf(stranded.rows[0].id, user);
  assert.ok(hist.length > 0, 'the card must not be blank for a piece a script moved');
  const systemMove = hist.find((h) => h.action === 'route_fix');
  assert.ok(systemMove, 'and the move must be there, named as an automatic correction');
  assert.equal(systemMove.staff_name, null, 'nobody is named for a move nobody made');
  assert.ok(systemMove.to_label, 'it says where the piece went, in Arabic');
});

test('an ordinary advance is printed once, not twice', async (t) => {
  const admin = await query(
    "SELECT id, role, staff_type FROM users WHERE role = 'admin' LIMIT 1"
  );
  if (!admin.rows.length) return t.skip('no admin on this database');
  const user = { ...admin.rows[0] };

  // performAdvance writes an audit row AND an activity row for the same move, one tx apart.
  const both = await query(
    `SELECT sal.order_id AS id, sal.from_stage::text AS f, sal.to_stage::text AS t,
            sal.created_at
       FROM staff_activity_log sal
      WHERE sal.action = 'advance' AND sal.user_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM audit_log al
                     WHERE al.entity = 'order' AND al.entity_id = sal.order_id
                       AND al.action = 'status_change'
                       AND al.details->>'to' = sal.to_stage::text
                       AND al.created_at BETWEEN sal.created_at - INTERVAL '5 seconds'
                                             AND sal.created_at + INTERVAL '5 seconds')
      ORDER BY sal.created_at DESC LIMIT 1`
  );
  if (!both.rows.length) return t.skip('no double-logged advance on this snapshot');
  const row = both.rows[0];

  const hist = await historyOf(row.id, user);
  const same = hist.filter(
    (h) =>
      h.to_stage === row.t &&
      Math.abs(new Date(h.at).getTime() - new Date(row.created_at).getTime()) < 5000
  );
  assert.equal(same.length, 1, 'one move, one line — the audit twin must be suppressed');
  assert.notEqual(same[0].action, 'route_fix', 'a human move keeps its name, not «تصحيح مسار آلي»');
});
