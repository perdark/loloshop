'use strict';
// lib/staffEngagement.js — break-deduction announcements, «نجم اليوم», «رسالة لولو».
//
// The two invariants worth a DB test:
//   · a deduction is announced ONCE per break, even when the sweep runs again or an admin
//     correction replaces the salary transaction (the ledger is keyed on the break);
//   · the day-close messages are once per worker per day, and the model never decides alone
//     what reaches a phone — a failing guard falls back to the template.
require('dotenv').config();
process.env.STAFF_AI_MESSAGES = 'off';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { query } = require('../lib/db');
const eng = require('../lib/staffEngagement');
const { localParts } = require('../lib/shopTime');

const { deductionCopy, pickStars, vetMessage, dayCloseDue, templateMessage, factsFor } = eng._internals;
const TAG = `ZZTEST-eng-${crypto.randomUUID().slice(0, 8)}`;
const startedAt = new Date();
const fx = {};

// ── pure ─────────────────────────────────────────────────────────────────────────────────

test('deduction copy names the worker and the amount publicly', () => {
  const c = deductionCopy({ name: 'علي', minutes: 70, deductedMinutes: 10, amount: 5000, remainingMinutes: 0 });
  assert.match(c.public.body, /علي خلص رصيد الخروج المؤقت/);
  assert.match(c.public.body, /5,000 دينار/);
  assert.match(c.personal.body, /ينشاف لكل الموظفين/);
});

test('unapproved break with allowance left is worded as such, not «خلص الرصيد»', () => {
  const c = deductionCopy({ name: 'علي', minutes: 20, deductedMinutes: 20, amount: 1000, remainingMinutes: 200 });
  assert.match(c.public.body, /بدون موافقة/);
});

test('stars: highest wins, zero never wins', () => {
  const s = pickStars([
    { name: 'أ', user_id: 1, work_moves: 3, active_minutes: 0 },
    { name: 'ب', user_id: 2, work_moves: 9, active_minutes: 40 },
  ]);
  assert.equal(s.moves.name, 'ب');
  assert.equal(s.app.name, 'ب');
  assert.equal(pickStars([{ name: 'أ', work_moves: 0, active_minutes: 0 }]).moves, null);
});

test('vet: invented numbers, insults and English are refused', () => {
  const facts = factsFor(
    { name: 'علي', work_moves: 12, active_minutes: 95, late_minutes: 0, break_minutes: 0 },
    { rank: 1, staffCount: 5, monthBreak: null }
  );
  assert.equal(vetMessage('علي، اليوم سويت 12 حركة، عاشت إيدك!', facts).ok, true);
  assert.equal(vetMessage('علي، اليوم سويت 4500 حركة!', facts).ok, false);
  assert.equal(vetMessage('علي إنت كسول اليوم', facts).ok, false);
  assert.equal(vetMessage('Great job today Ali', facts).ok, false);
  assert.equal(vetMessage('', facts).ok, false);
});

test('template never claims work that was not done', () => {
  assert.match(templateMessage({ name: 'علي', work_moves: 0 }, { rank: 3 }), /ما انسجلت/);
  assert.match(templateMessage({ name: 'علي', work_moves: 7 }, { rank: 1 }), /الأول/);
});

test('day close: 45 min before end; الجمعة (15:00→00:00) fires before midnight; off days never', () => {
  const week = [
    { weekday: 6, start_time: '10:00', end_time: '22:00', is_off: false },
    { weekday: 5, start_time: '15:00', end_time: '00:00', is_off: false },
    { weekday: 0, start_time: '10:00', end_time: '22:00', is_off: true },
  ];
  const sat = '2026-10-17'; const fri = '2026-10-16'; const sun = '2026-10-18';
  assert.equal(dayCloseDue({ week, date: sat, minutesNow: 21 * 60 }), false);
  assert.equal(dayCloseDue({ week, date: sat, minutesNow: 21 * 60 + 15 }), true);
  assert.equal(dayCloseDue({ week, date: fri, minutesNow: 22 * 60 }), false);
  assert.equal(dayCloseDue({ week, date: fri, minutesNow: 23 * 60 + 15 }), true);
  assert.equal(dayCloseDue({ week, date: sun, minutesNow: 23 * 60 }), false);
});

// ── DB ───────────────────────────────────────────────────────────────────────────────────

test('setup fixtures', async () => {
  const today = localParts(new Date()).date;
  const u = await query(
    `INSERT INTO users (name, password_hash, role, phone)
     VALUES ($1, 'x', 'staff', $2) RETURNING id`,
    [TAG, `0799${Math.floor(Math.random() * 1e7).toString().padStart(7, '0')}`]
  );
  fx.userId = u.rows[0].id;
  const r = await query(
    `INSERT INTO staff_attendance_records (user_id, work_date, expected_start_time, expected_end_time, check_in_at)
     VALUES ($1, $2::date, '10:00', '22:00', NOW() - INTERVAL '3 hours') RETURNING id`,
    [fx.userId, today]
  );
  const txn = await query(
    `INSERT INTO staff_salary_transactions (user_id, type, amount, reason_ar, source_type)
     VALUES ($1, 'deduction', 6000, $2, 'attendance_break') RETURNING id`,
    [fx.userId, TAG]
  );
  fx.txnId = txn.rows[0].id;
  const b = await query(
    `INSERT INTO staff_attendance_breaks
       (user_id, attendance_id, work_date, month_key, left_at, returned_at, minutes, state,
        approval, deducted_minutes, deduction_per_minute, deduction_amount, deduction_transaction_id)
     VALUES ($1, $2, $3::date, $4, NOW() - INTERVAL '70 minutes', NOW() - INTERVAL '1 minute', 69,
             'returned', 'approved', 12, 500, 6000, $5) RETURNING id`,
    [fx.userId, r.rows[0].id, today, today.slice(0, 7), fx.txnId]
  );
  fx.breakId = b.rows[0].id;
  await query(
    `INSERT INTO staff_activity_log (user_id, action) VALUES ($1, 'advance'), ($1, 'advance')`,
    [fx.userId]
  );
});

test('a deduction is announced once — to the worker AND to everyone else', async () => {
  await eng.announceBreakDeductions();
  const mine = await query(
    `SELECT type FROM notifications WHERE user_id = $1 AND type = 'break_deduction'`, [fx.userId]
  );
  assert.equal(mine.rowCount, 1);
  const pub = await query(
    `SELECT user_id FROM notifications WHERE type = 'break_deduction_public' AND body_ar LIKE $1`,
    [`${TAG}%`]
  );
  const { rows: audience } = await query(
    `SELECT COUNT(*)::int AS n FROM users WHERE role IN ('staff','admin') AND deleted_at IS NULL`
  );
  assert.equal(pub.rowCount, audience[0].n - 1, 'everyone except the worker');
  assert.ok(!pub.rows.some((r) => r.user_id === fx.userId));

  // A second sweep, and an admin correction that REPLACES the transaction, announce nothing.
  const t2 = await query(
    `INSERT INTO staff_salary_transactions (user_id, type, amount, reason_ar, source_type)
     VALUES ($1, 'deduction', 4000, $2, 'attendance_break') RETURNING id`,
    [fx.userId, TAG]
  );
  await query(`UPDATE staff_salary_transactions SET deleted_at = NOW() WHERE id = $1`, [fx.txnId]);
  await query(
    `UPDATE staff_attendance_breaks SET deduction_amount = 4000, deduction_transaction_id = $2 WHERE id = $1`,
    [fx.breakId, t2.rows[0].id]
  );
  await eng.announceBreakDeductions();
  const again = await query(
    `SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'break_deduction'`, [fx.userId]
  );
  assert.equal(again.rowCount, 1);
});

test('day close: one message per worker per day, admin gets the digest', async () => {
  await eng.runDayClose(new Date(), { force: true });
  await eng.runDayClose(new Date(), { force: true });
  const msgs = await query(`SELECT body_ar, source FROM staff_ai_messages WHERE user_id = $1`, [fx.userId]);
  assert.equal(msgs.rowCount, 1);
  assert.equal(msgs.rows[0].source, 'template'); // STAFF_AI_MESSAGES=off
  const notes = await query(
    `SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'staff_ai_message'`, [fx.userId]
  );
  assert.equal(notes.rowCount, 1);
  const digest = await query(
    `SELECT 1 FROM notifications WHERE type = 'staff_ai_digest' AND body_ar LIKE $1`, [`%${TAG}%`]
  );
  assert.ok(digest.rowCount >= 1);
});

test('cleanup', async () => {
  await query(
    `DELETE FROM notifications
      WHERE created_at >= $1
        AND type IN ('break_deduction_public', 'staff_day_star', 'staff_ai_digest', 'staff_ai_message')`,
    [startedAt]
  );
  await query(`DELETE FROM staff_ai_messages WHERE created_at >= $1`, [startedAt]);
  await query(`DELETE FROM staff_salary_transactions WHERE user_id = $1`, [fx.userId]);
  await query(`DELETE FROM users WHERE id = $1`, [fx.userId]);
  const { pool } = require('../lib/db');
  if (pool && pool.end) await pool.end();
});
