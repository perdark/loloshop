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

// ⚠️ AN EDIT CAN SEND A PIECE BACKWARDS, AND IT IS THE ONE MOVE NEITHER LEDGER SPELLS OUT.
// `orderEditController` writes the new status inside its own UPDATE and records it as
// status_before/status_after on a `staff_order_edit` row — never a `status_change`, never an
// activity row. Measured on prod 2026-09-12: **100** orders were walked back to «بانتظار
// التصميم» this way (39 from التطريز · 32 from التجهيز · 29 from الكوي), each one a piece that
// vanished off a station's board with nobody named anywhere on the screen.
test('an edit that walked the piece backwards names who did it', async (t) => {
  const admin = await query(
    "SELECT id, role, staff_type FROM users WHERE role = 'admin' LIMIT 1"
  );
  if (!admin.rows.length) return t.skip('no admin on this database');
  const user = { ...admin.rows[0] };

  const moved = await query(
    `SELECT al.entity_id AS id, al.details->>'status_before' AS before,
            al.details->>'status_after'  AS after
       FROM audit_log al
      WHERE al.entity = 'order' AND al.action = 'staff_order_edit'
        AND al.actor_id IS NOT NULL
        AND al.details->>'status_before' IS DISTINCT FROM al.details->>'status_after'
      ORDER BY al.created_at DESC LIMIT 1`
  );
  if (!moved.rows.length) return t.skip('no stage-moving edit on this snapshot');

  const hist = await historyOf(moved.rows[0].id, user);
  const edit = hist.find((h) => h.kind === 'edit' && h.from_stage === moved.rows[0].before);
  assert.ok(edit, 'the edit that moved the piece must appear in the log');
  assert.ok(edit.staff_name, 'and it must name the person — this is the whole point');
  assert.equal(edit.to_stage, moved.rows[0].after);
  assert.ok(edit.from_label && edit.to_label, 'a stage-moving edit says from where to where');
});

test('an edit that moved nothing does not invent a stage pair', async (t) => {
  const admin = await query(
    "SELECT id, role, staff_type FROM users WHERE role = 'admin' LIMIT 1"
  );
  if (!admin.rows.length) return t.skip('no admin on this database');
  const user = { ...admin.rows[0] };

  const same = await query(
    `SELECT al.entity_id AS id
       FROM audit_log al
      WHERE al.entity = 'order' AND al.action = 'staff_order_edit'
        AND al.details->>'status_before' = al.details->>'status_after'
      ORDER BY al.created_at DESC LIMIT 1`
  );
  if (!same.rows.length) return t.skip('no no-op edit on this snapshot');

  const hist = await historyOf(same.rows[0].id, user);
  const edits = hist.filter((h) => h.kind === 'edit');
  assert.ok(edits.length > 0, 'the edit is still listed — it is work somebody did');
  // Without this the card renders «رجّعه: الكوي ← الكوي», which is worse than saying nothing.
  for (const e of edits.filter((x) => x.from_stage === x.to_stage)) {
    assert.equal(e.from_label, null, 'an edit that moved nothing carries no from_label');
    assert.equal(e.to_label, null, 'and no to_label');
  }
});
