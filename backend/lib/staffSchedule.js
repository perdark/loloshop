// backend/lib/staffSchedule.js — "when was this person due at the shop, and on which day".
//
// ONE answer, ONE file, the way lib/shopTime.js is the only answer to "what date is it at the
// shop" and lib/counts.js is the only answer to "what is money". A second copy of this rule is
// exactly how the Friday bug happened: `checkIn` computed lateness against a single global
// 09:00 with no notion of a weekday at all, so every Friday check-in (the shop opens 3 م) was
// recorded roughly six hours late — for months, on a path nothing tested.
//
// Resolution order, outermost wins:
//   1. staff_holidays          — a date everyone is off. Never late, never a deduction.
//   2. staff_attendance_user_settings — this person's personal hours (pre-existing behaviour:
//      a personal override still beats the shop's weekday, on every day of the week).
//   3. staff_schedule_days     — the shop's row for that weekday (migration 093).
//   4. staff_attendance_settings — the single pre-093 pair, kept as the last resort so a
//      database missing a weekday row still behaves exactly as it did before.
//
// ⚠️ `weekday` is POSTGRES EXTRACT(DOW) NUMBERING — 0 = الأحد … 6 = السبت. الجمعة is 5.
// JS `getUTCDay()` agrees with it, which is why dayOfWeek() below can avoid a date library.

const { localParts, DEFAULT_TZ } = require('./shopTime');

const WEEKDAY_LABEL_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/** 'HH:MM[:SS]' → minutes since midnight. Mirrors attendanceController.timeToMinutes. */
function timeToMinutes(value) {
  const [h, m] = String(value || '00:00').split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

const hhmm = (v) => String(v || '').slice(0, 5);

/**
 * EXTRACT(DOW) for a 'YYYY-MM-DD' string.
 * Parsed as UTC midnight deliberately: the string is ALREADY the shop's local date (it came
 * from localParts), so re-interpreting it in the server's zone would shift it back a day on a
 * UTC box — the same off-by-one-day trap lib/shopTime.js exists for.
 */
function dayOfWeek(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

/** 'YYYY-MM-DD' shifted by whole days, still as a plain date string. */
function shiftDate(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A shift that ends at or before it starts runs past midnight (الجمعة 15:00 → 00:00). */
function crossesMidnight(start, end) {
  return timeToMinutes(end) <= timeToMinutes(start);
}

/** Total scheduled minutes, midnight-crossing included. Same rule attendanceController uses. */
function shiftMinutes(start, end) {
  const s = timeToMinutes(start);
  let e = timeToMinutes(end);
  if (e <= s) e += 24 * 60;
  return Math.max(0, e - s);
}

async function loadWeek(db = null) {
  const q = db ? db.query.bind(db) : require('./db').query;
  const { rows } = await q(
    `SELECT weekday, start_time, end_time, is_off, updated_at
       FROM staff_schedule_days ORDER BY weekday`
  );
  return rows.map((r) => ({
    weekday: Number(r.weekday),
    label_ar: WEEKDAY_LABEL_AR[Number(r.weekday)],
    start_time: hhmm(r.start_time),
    end_time: hhmm(r.end_time),
    is_off: !!r.is_off,
    crosses_midnight: crossesMidnight(r.start_time, r.end_time),
    updated_at: r.updated_at,
  }));
}

/** { 'YYYY-MM-DD': 'عيد الفطر' } for a closed date range. */
async function loadHolidays(from, to, db = null) {
  const q = db ? db.query.bind(db) : require('./db').query;
  const { rows } = await q(
    `SELECT to_char(work_date, 'YYYY-MM-DD') AS d, label_ar
       FROM staff_holidays WHERE work_date BETWEEN $1::date AND $2::date`,
    [from, to]
  );
  const out = {};
  for (const r of rows) out[r.d] = r.label_ar;
  return out;
}

/**
 * The shift a given calendar date carries, ignoring "which shift is a stamp in right now".
 * `settings` is the row loadEffectiveSettings already produced — passing it in keeps this
 * function free of any opinion about per-user overrides beyond "the override wins".
 */
function shiftForDate(dateStr, { week, settings, holidays = {} }) {
  const holiday = holidays[dateStr] || null;
  const weekday = dayOfWeek(dateStr);
  const row = week.find((w) => w.weekday === weekday) || null;

  // A personal override replaces the shop's HOURS but not its holidays: a shop-wide عيد is
  // still a day off for someone with custom hours.
  const usesOverride = !!settings?.is_user_override;
  const start = usesOverride ? hhmm(settings.start_time) : row ? row.start_time : hhmm(settings?.start_time);
  const end = usesOverride ? hhmm(settings.end_time) : row ? row.end_time : hhmm(settings?.end_time);

  return {
    date: dateStr,
    weekday,
    weekday_label_ar: WEEKDAY_LABEL_AR[weekday],
    start_time: start,
    end_time: end,
    // An override does not make a closed shop day open — `is_off` is the shop's, always.
    is_off: !!row?.is_off,
    holiday_ar: holiday,
    // The one flag every caller must respect: no lateness, no deduction, whatever the hour.
    counts_lateness: !row?.is_off && !holiday,
    crosses_midnight: crossesMidnight(start, end),
    source: usesOverride ? 'user' : row ? 'week' : 'settings',
  };
}

/**
 * Which shift a stamp taken at `now` belongs to.
 *
 * ⚠️ THE MIDNIGHT RULE. الجمعة runs 15:00 → 00:00, so a بصمة at 00:10 falls on Saturday's
 * calendar date while belonging to Friday's shift. If yesterday's shift crosses midnight and
 * the clock has not yet reached its end time, the stamp is filed under YESTERDAY — date and
 * schedule together, so `work_date` and `expected_start_time` can never disagree.
 *
 * This lives here, once, precisely so no caller re-derives it. checkOut does NOT need it: it
 * finds the open record by `check_out_at IS NULL`, never by date.
 */
function resolveStamp(now, { week, settings, holidays = {}, timeZone = DEFAULT_TZ }) {
  const local = localParts(now, timeZone);
  const yesterday = shiftDate(local.date, -1);
  const prev = shiftForDate(yesterday, { week, settings, holidays });

  if (prev.crosses_midnight && local.minutes < timeToMinutes(prev.end_time)) {
    return { ...prev, minutes_now: local.minutes, belongs_to_previous_day: true };
  }
  return {
    ...shiftForDate(local.date, { week, settings, holidays }),
    minutes_now: local.minutes,
    belongs_to_previous_day: false,
  };
}

/**
 * Minutes late for a stamp, honouring the grace period and the "never late on a day off" rule.
 * Returns 0 — not a negative — for an early arrival, matching the previous behaviour.
 */
function lateMinutesFor(shift, minutesNow, graceMinutes) {
  if (!shift.counts_lateness) return 0;
  const start = timeToMinutes(shift.start_time);
  // On a midnight-crossing shift a stamp can land AFTER midnight and still be on time; its
  // minutes-since-midnight is tiny, so add a day before comparing or 00:10 reads as "early".
  const now = shift.crosses_midnight && minutesNow < start ? minutesNow + 24 * 60 : minutesNow;
  return Math.max(0, now - start - Number(graceMinutes || 0));
}

module.exports = {
  WEEKDAY_LABEL_AR,
  loadWeek,
  loadHolidays,
  shiftForDate,
  resolveStamp,
  lateMinutesFor,
  shiftMinutes,
  crossesMidnight,
  timeToMinutes,
  dayOfWeek,
  shiftDate,
};
