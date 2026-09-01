'use strict';
// GET /payroll/me/statement — «حصيلة شهرك وراتبك» (migration 099).
//
// ⚠️ THE TWO INVARIANTS THIS FILE EXISTS TO PIN:
//
// 1. `published_at IS NULL` HIDES A STATEMENT COMPLETELY. A draft is a month somebody is still
//    checking; if it leaks, a worker reads a figure the shop has not agreed to pay and the
//    correction is a conversation, not a code change. Hiding it in the UI is not the same
//    thing — the gate has to be in the query.
//
// 2. THE ENDPOINT READS, IT NEVER RECOMPUTES. The row is a snapshot frozen at publish time.
//    A test that asserted `net === gross - deductions` would pass while the endpoint quietly
//    started deriving numbers again, so this file writes a net that DOES NOT match its own
//    line items and demands that exact number back.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { getMyStatement } = require('../controllers/salaryController');
const { query } = require('../lib/db');

const TAG = `ZZTEST-stmt-${crypto.randomUUID().slice(0, 8)}`;
const ctx = {};
const newPhone = () => `079${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

function mockRes() {
  const res = {
    statusCode: 200, body: null,
    status(c) { res.statusCode = c; return res; },
    json(b) { res.body = b; return res; },
  };
  return res;
}

async function statement({ month, published, net, other }) {
  await query(
    `INSERT INTO staff_payroll_statements
       (user_id, month_key, day_rate, half_rate, minute_rate, grace_minutes,
        full_shifts, half_shifts, leave_days, unpaid_days,
        late_days, late_minutes, waived_minutes,
        gross, late_deduction, other_deduction, other_reason_ar, net, note_ar, days, published_at)
     VALUES ($1,$2, 16600, 8300, 1000, 15,
             20, 1, 2, 8,
             3, 45, 120,
             350000, 45000, $4, $5, $3, $6, $7::jsonb, $8)
     ON CONFLICT (user_id, month_key) DO UPDATE
       SET net = EXCLUDED.net, published_at = EXCLUDED.published_at`,
    [
      ctx.userId, month, net,
      other || 0,
      other ? `${TAG} خصم` : null,
      `${TAG} ملاحظة`,
      JSON.stringify([{ d: 1, w: 'السبت', in: '10:15', kind: 'full', shift: '10:00', late: 0, wiped: 0, pay: 16600, cut: 0 }]),
      published ? new Date().toISOString() : null,
    ]
  );
}

// ⚠️ THE FIXTURE USER IS BORN SOFT-DELETED (`deleted_at = NOW()`) AND MUST STAY THAT WAY.
// `pushBroadcast.audienceSql('devices')` counts EVERY row in `users WHERE deleted_at IS NULL`,
// and `anonymousDevicePush.test.js` reads that live COUNT, sends against it and asserts the
// error names it back. Files run in parallel, so a plain fixture user appearing (or its cleanup
// DELETE disappearing) mid-test straddles those two reads and fails a test that has nothing to
// do with payroll — measured, off by exactly one. Same trap `adminNumbers.test.js` documents.
// A soft-deleted row is a valid FK target for a statement and is invisible to every audience
// query, so nothing here can move a number somewhere else.
test.before(async () => {
  const u = await query(
    `INSERT INTO users (name, phone, password_hash, role, deleted_at)
     VALUES ($1,$2,'x','staff', NOW()) RETURNING id`,
    [`${TAG} موظف`, newPhone()]
  );
  ctx.userId = u.rows[0].id;
});

test.after(async () => {
  await query(`DELETE FROM staff_payroll_statements WHERE user_id = $1`, [ctx.userId]);
  await query(`DELETE FROM users WHERE id = $1`, [ctx.userId]);
});

test('an UNPUBLISHED statement is invisible to the worker', async () => {
  await statement({ month: '2026-03', published: false, net: 999999 });
  const res = mockRes();
  await getMyStatement({ user: { id: ctx.userId }, query: {} }, res);
  assert.equal(res.body.data, null, 'a draft month must not reach the worker');
});

test('a published statement comes back whole, and net is READ not recomputed', async () => {
  // 350,000 gross − 45,000 late − 5,000 other = 300,000 by arithmetic. The row says 301,234.
  // The endpoint must hand back what the shop froze, not what the line items imply.
  await statement({ month: '2026-04', published: true, net: 301234, other: 5000 });

  const res = mockRes();
  await getMyStatement({ user: { id: ctx.userId }, query: {} }, res);
  const d = res.body.data;

  assert.ok(d, 'a published statement must be returned');
  assert.equal(d.month, '2026-04');
  assert.equal(d.net, 301234, 'net is the frozen figure, never gross minus deductions');
  assert.equal(d.gross, 350000);
  assert.equal(d.lateDeduction, 45000);
  assert.equal(d.otherDeduction, 5000);
  assert.equal(d.minuteRate, 1000, 'the rate is frozen on the row, not read from settings');
  assert.equal(d.graceMinutes, 15);
  assert.equal(d.waivedMinutes, 120, 'forgiven lateness is shown, not hidden');
  assert.equal(d.unpaidDays, 8);
  assert.equal(d.leaveDays, 2);
  assert.ok(Array.isArray(d.days) && d.days.length === 1, 'the day list rides along');
  assert.equal(d.noteAr, `${TAG} ملاحظة`);
});

test('the newest PUBLISHED month wins, and ?month= picks one exactly', async () => {
  // 2026-03 is still a draft from the first test; 2026-04 is published.
  await statement({ month: '2026-05', published: true, net: 111111 });

  const latest = mockRes();
  await getMyStatement({ user: { id: ctx.userId }, query: {} }, latest);
  assert.equal(latest.body.data.month, '2026-05');

  const picked = mockRes();
  await getMyStatement({ user: { id: ctx.userId }, query: { month: '2026-04' } }, picked);
  assert.equal(picked.body.data.month, '2026-04');

  // Asking for the draft month by name still gets nothing.
  const draft = mockRes();
  await getMyStatement({ user: { id: ctx.userId }, query: { month: '2026-03' } }, draft);
  assert.equal(draft.body.data, null);

  // A junk month is ignored rather than 500ing — it falls back to "the newest".
  const junk = mockRes();
  await getMyStatement({ user: { id: ctx.userId }, query: { month: 'nope' } }, junk);
  assert.equal(junk.body.data.month, '2026-05');
});
