'use strict';
// Migration 093 — دوام الأسبوع، الإجازات، والدوام اللي يعبر منتصف الليل.
//
// THE BUG. `checkIn` computed lateness against ONE global start time on all seven days
// (attendanceController, pre-093) while the shop opens 3 م الجمعة, so every Friday check-in
// was recorded ~6 hours late. Nothing was deducted for it — nothing writes an attendance
// salary transaction except lib/attendanceBreak.js — but the record said «متأخر» with an
// amount, and both /staff/me and the admin reports display that.
//
// These are pure-function tests on lib/staffSchedule.js, which is deliberately the only
// place the rule lives. A second copy of it is exactly how the bug happened.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../lib/staffSchedule');

// The shipped seed: السبت–الخميس 09:00–22:00، الجمعة 15:00–00:00.
const WEEK = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  label_ar: s.WEEKDAY_LABEL_AR[weekday],
  start_time: weekday === 5 ? '15:00' : '09:00',
  end_time: weekday === 5 ? '00:00' : '22:00',
  is_off: false,
  crosses_midnight: weekday === 5,
}));

const NO_OVERRIDE = { start_time: '09:00', end_time: '18:00', is_user_override: false };
const OVERRIDE = { start_time: '11:00', end_time: '20:00', is_user_override: true };

// 2026-08-28 is a Friday; 2026-08-29 the Saturday after it. Fixed dates, never `new Date()`.
const FRIDAY = '2026-08-28';
const SATURDAY = '2026-08-29';

/** A real instant at a given Baghdad (UTC+3) wall clock, so localParts resolves predictably. */
const baghdad = (date, hh, mm) =>
  new Date(`${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+03:00`);

test('EXTRACT(DOW) numbering: الجمعة is 5', () => {
  assert.strictEqual(s.dayOfWeek(FRIDAY), 5);
  assert.strictEqual(s.dayOfWeek(SATURDAY), 6);
  assert.strictEqual(s.WEEKDAY_LABEL_AR[5], 'الجمعة');
});

test('الجمعة resolves to 15:00 → 00:00, and is recognised as crossing midnight', () => {
  const shift = s.shiftForDate(FRIDAY, { week: WEEK, settings: NO_OVERRIDE });
  assert.strictEqual(shift.start_time, '15:00');
  assert.strictEqual(shift.end_time, '00:00');
  assert.strictEqual(shift.crosses_midnight, true);
  assert.strictEqual(shift.counts_lateness, true);
  assert.strictEqual(s.shiftMinutes('15:00', '00:00'), 540, 'تسع ساعات، مو سالب');
});

test('THE BUG: a 15:05 Friday stamp is ON TIME, not six hours late', () => {
  const shift = s.resolveStamp(baghdad(FRIDAY, 15, 5), { week: WEEK, settings: NO_OVERRIDE });
  assert.strictEqual(shift.date, FRIDAY);
  assert.strictEqual(shift.start_time, '15:00');
  assert.strictEqual(s.lateMinutesFor(shift, shift.minutes_now, 15), 0);
  // The pre-093 arithmetic, kept here as the thing that must never come back: measured
  // against 09:00 the same stamp was 6h05 late, minus the grace.
  const oldWay = Math.max(0, shift.minutes_now - s.timeToMinutes('09:00') - 15);
  assert.strictEqual(oldWay, 350, 'this is what the old code recorded — 350 دقيقة تأخير');
});

test('a genuinely late Friday stamp is still late', () => {
  const shift = s.resolveStamp(baghdad(FRIDAY, 16, 30), { week: WEEK, settings: NO_OVERRIDE });
  assert.strictEqual(s.lateMinutesFor(shift, shift.minutes_now, 15), 75, '16:30 − 15:00 − 15د');
});

test('a normal day is unchanged — 09:20 with a 15-minute grace is 5 minutes late', () => {
  const shift = s.resolveStamp(baghdad(SATURDAY, 9, 20), { week: WEEK, settings: NO_OVERRIDE });
  assert.strictEqual(shift.start_time, '09:00');
  assert.strictEqual(s.lateMinutesFor(shift, shift.minutes_now, 15), 5);
});

// ── the midnight rule ────────────────────────────────────────────────────────────────────

// ⚠️ الجمعة as shipped ends at EXACTLY 00:00, so it has no after-midnight window at all:
// the shift is over the instant the date rolls over. A 00:10 stamp is therefore a NEW
// السبت shift, and that is correct rather than a gap. `checkOut` never needs the rule — it
// finds the open record by `check_out_at IS NULL`, not by date — so a worker stamping out at
// 00:10 still closes their Friday row. The rule below matters the moment an admin edits
// الجمعة to end at, say, 01:00, which the screen lets them do.
test('MIDNIGHT: with الجمعة ending at 00:00 there is no window — 00:10 is السبت', () => {
  const shift = s.resolveStamp(baghdad(SATURDAY, 0, 10), { week: WEEK, settings: NO_OVERRIDE });
  assert.strictEqual(shift.belongs_to_previous_day, false);
  assert.strictEqual(shift.date, SATURDAY);
});

test('MIDNIGHT: a shift ending at 01:00 DOES reach back — date and hours together', () => {
  const week = WEEK.map((w) => (w.weekday === 5 ? { ...w, end_time: '01:00' } : w));
  const shift = s.resolveStamp(baghdad(SATURDAY, 0, 10), { week, settings: NO_OVERRIDE });
  assert.strictEqual(shift.belongs_to_previous_day, true);
  assert.strictEqual(shift.date, FRIDAY, 'work_date must be Friday, not Saturday');
  assert.strictEqual(shift.start_time, '15:00', 'and the hours must be Friday\'s, together');
});

test('MIDNIGHT: that stamp is 9h10 late, not "early" — the after-midnight clock is not small', () => {
  const week = WEEK.map((w) => (w.weekday === 5 ? { ...w, end_time: '01:00' } : w));
  const shift = s.resolveStamp(baghdad(SATURDAY, 0, 10), { week, settings: NO_OVERRIDE });
  // 00:10 is 10 minutes since midnight; naively 10 − 900 is negative and clamps to 0, which
  // would silently forgive a nine-hour late arrival. The +24h correction is what prevents it.
  assert.strictEqual(s.lateMinutesFor(shift, shift.minutes_now, 0), 550);
});

test('MIDNIGHT: 08:00 Saturday is Saturday — the rule only reaches back while the shift runs', () => {
  const shift = s.resolveStamp(baghdad(SATURDAY, 8, 0), { week: WEEK, settings: NO_OVERRIDE });
  assert.strictEqual(shift.belongs_to_previous_day, false);
  assert.strictEqual(shift.date, SATURDAY);
});

test('MIDNIGHT: 00:10 after a NON-crossing day stays on its own date', () => {
  // Thursday 09:00–22:00 does not cross midnight, so Friday 00:10 is Friday.
  const shift = s.resolveStamp(baghdad(FRIDAY, 0, 10), { week: WEEK, settings: NO_OVERRIDE });
  assert.strictEqual(shift.belongs_to_previous_day, false);
  assert.strictEqual(shift.date, FRIDAY);
});

// ── holidays and closed days ─────────────────────────────────────────────────────────────

test('a holiday means no lateness whatever the hour', () => {
  const holidays = { [SATURDAY]: 'عيد' };
  const shift = s.resolveStamp(baghdad(SATURDAY, 14, 0), { week: WEEK, settings: NO_OVERRIDE, holidays });
  assert.strictEqual(shift.holiday_ar, 'عيد');
  assert.strictEqual(shift.counts_lateness, false);
  assert.strictEqual(s.lateMinutesFor(shift, shift.minutes_now, 0), 0);
});

test('a closed weekday means no lateness either', () => {
  const week = WEEK.map((w) => (w.weekday === 6 ? { ...w, is_off: true } : w));
  const shift = s.resolveStamp(baghdad(SATURDAY, 14, 0), { week, settings: NO_OVERRIDE });
  assert.strictEqual(shift.is_off, true);
  assert.strictEqual(s.lateMinutesFor(shift, shift.minutes_now, 0), 0);
});

// ── the per-user override, whose precedence must not change ──────────────────────────────

test('a personal override still beats the weekday — on الجمعة too', () => {
  const shift = s.resolveStamp(baghdad(FRIDAY, 11, 5), { week: WEEK, settings: OVERRIDE });
  assert.strictEqual(shift.start_time, '11:00');
  assert.strictEqual(shift.source, 'user');
  assert.strictEqual(s.lateMinutesFor(shift, shift.minutes_now, 15), 0);
});

test('but a shop holiday still applies to someone with personal hours', () => {
  const holidays = { [SATURDAY]: 'عيد' };
  const shift = s.resolveStamp(baghdad(SATURDAY, 14, 0), { week: WEEK, settings: OVERRIDE, holidays });
  assert.strictEqual(shift.counts_lateness, false);
});

test('with no weekday row at all it falls back to the pre-093 single pair', () => {
  const shift = s.shiftForDate(FRIDAY, { week: [], settings: NO_OVERRIDE });
  assert.strictEqual(shift.start_time, '09:00');
  assert.strictEqual(shift.source, 'settings');
});

// ── the DB side ──────────────────────────────────────────────────────────────────────────

test('the seeded week is seven rows and الجمعة is 15:00 → 00:00', async () => {
  const week = await s.loadWeek();
  assert.strictEqual(week.length, 7, 'migration 093 seeds all seven days');
  const friday = week.find((w) => w.weekday === 5);
  assert.strictEqual(friday.start_time, '15:00');
  assert.strictEqual(friday.end_time, '00:00');
  assert.strictEqual(friday.crosses_midnight, true);
  for (const w of week) assert.strictEqual(w.label_ar, s.WEEKDAY_LABEL_AR[w.weekday]);
});
