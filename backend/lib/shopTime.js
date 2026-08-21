// backend/lib/shopTime.js — "what date is it at the shop right now".
//
// Extracted verbatim from attendanceController (2026-08-21) when the staff app-open signal
// needed the SAME answer. It is not a formatting nicety: the server clock is UTC and the shop
// is UTC+3, so between 21:00 and midnight Baghdad, `CURRENT_DATE` and "today at the shop" are
// different days. A بصمة row filed under one and an app-open row filed under the other join to
// nothing, and the daily report silently reports an empty day.
//
// One definition, one file — the same rule counts.js applies to money.

const DEFAULT_TZ = 'Asia/Baghdad';

/**
 * The local calendar date and minutes-since-midnight at `timeZone`.
 * Intl does the zone arithmetic, including DST, without a date library.
 * 'en-CA' because it formats as YYYY-MM-DD, which is what Postgres wants for a DATE bind.
 */
function localParts(date = new Date(), timeZone = DEFAULT_TZ) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .formatToParts(date)
    .reduce((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value;
      return acc;
    }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/**
 * «2026/8/30» — the shop's date format everywhere a human reads one.
 *
 * Owner preference 2026-08-21: numerals, not month names. `toLocaleDateString('ar-IQ', {month:
 * 'long'})` renders «٢ حزيران ٢٠٢٦`, which is correct Arabic and slower to scan than digits —
 * and on a confirmation card the owner is checking a date against one in his head, so scanning
 * speed is the whole job. Latin digits deliberately: this is the form he wrote it in, and a
 * date is the one string where Arabic-Indic digits cost more than they give.
 *
 * Year first so it sorts and never reads as ambiguous D/M vs M/D. No leading zeros.
 */
function fmtShopDate(value, timeZone = DEFAULT_TZ) {
  // ⚠️ null/undefined/'' FIRST, before `new Date()` sees them. `new Date(null)` is epoch 0 —
  // a perfectly valid Date — so a NaN check alone lets a missing deadline render as «1970/1/1»
  // inside an Arabic sentence the owner is about to confirm. Caught by its own test.
  if (value === null || value === undefined || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  // Go through Intl so the date is the one at the SHOP, not the one at UTC — the same
  // off-by-one-day trap localParts exists for.
  const [y, m, day] = localParts(d, timeZone).date.split('-');
  return `${Number(y)}/${Number(m)}/${Number(day)}`;
}

module.exports = { localParts, fmtShopDate, DEFAULT_TZ };
