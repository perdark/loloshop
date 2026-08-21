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

module.exports = { localParts, DEFAULT_TZ };
