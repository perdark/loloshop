'use strict';
// ADMS (ZKTeco Push SDK) wire format. Pure parsing — no database, no Express.
//
// ⚠️ The device timestamp carries NO timezone: it is the K40's own wall clock, i.e. shop
// local time, and it is what a worker points at when they dispute a late mark. Both forms
// are kept — the verbatim string AND the resolved instant — because a dispute months later
// needs both (the lesson from grandlayan/bridge, on-site 2026-08-15: the device clock ran
// 56 seconds ahead of the host and nobody noticed).
const { DEFAULT_TZ } = require('./shopTime');

const TS_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/;

function tzOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)
  );
  return asUtc - date.getTime();
}

/** 'YYYY-MM-DD HH:MM:SS' read in `timeZone` → the UTC instant it names. */
function zonedToUtc(localStr, timeZone = DEFAULT_TZ) {
  const [d, t = '00:00:00'] = String(localStr).trim().split(' ');
  const [Y, M, D] = d.split('-').map(Number);
  const [h, m, s = 0] = t.split(':').map(Number);
  const guess = Date.UTC(Y, M - 1, D, h, m, s);
  // Two passes: the offset is evaluated at the guessed instant, which is at most one
  // offset-width away from the true one, so a second pass settles it.
  // ⚠️ For Asia/Baghdad the second pass changes NOTHING and no test here can prove it does —
  // the zone has been a constant UTC+3 with no DST since 2016, so tzOffsetMs returns the same
  // value whichever instant you hand it. It is kept because it costs nothing and it is what
  // makes this function correct if it is ever pointed at a zone that observes DST, where a
  // one-pass version is wrong for the hour either side of a transition. Do not read the
  // midnight test below as evidence for it.
  const once = new Date(guess - tzOffsetMs(new Date(guess), timeZone));
  return new Date(guess - tzOffsetMs(once, timeZone));
}

function parseAttlog(text, timeZone = DEFAULT_TZ) {
  const punches = [];
  const rejects = [];
  const lines = String(text || '').split(/\r?\n/);
  const floor = Date.UTC(2020, 0, 1);
  const ceiling = Date.now() + 2 * 24 * 60 * 60 * 1000;

  for (const line of lines) {
    const raw = line.trim();
    if (!raw) continue;                       // blank lines are normal, not errors
    const cols = raw.split('\t').map((c) => c.trim());
    const [pin, ts, status, verify] = cols;
    if (!pin || !/^\d{1,32}$/.test(pin)) {
      rejects.push({ raw_line: raw, reason: 'رقم الجهاز غير صالح' });
      continue;
    }
    if (!ts || !TS_RE.test(ts)) {
      rejects.push({ raw_line: raw, reason: 'وقت غير صالح' });
      continue;
    }
    const punchedAt = zonedToUtc(ts, timeZone);
    const ms = punchedAt.getTime();
    if (!Number.isFinite(ms) || ms < floor || ms > ceiling) {
      rejects.push({ raw_line: raw, reason: 'وقت الجهاز خارج المدى المعقول' });
      continue;
    }
    const num = (v) => (v == null || v === '' || !/^-?\d+$/.test(v) ? null : Number(v));
    punches.push({
      device_pin: pin,
      device_ts: ts.length === 16 ? `${ts}:00` : ts,
      punched_at: punchedAt,
      raw_status: num(status),
      raw_verify: num(verify),
      raw_line: raw,
    });
  }
  return { punches, rejects };
}

/**
 * The reply to the device's opening `GET /iclock/cdata?options=all`. It is the device's
 * operating config, and the device will not upload until it gets one.
 * TransFlag's bit field asks for attendance logs; Realtime=1 asks it to push as they happen
 * rather than only on the interval.
 */
function handshakeBody(serial, { timeZoneOffset = 3 } = {}) {
  return [
    `GET OPTION FROM: ${serial}`,
    'Stamp=9999', 'OpStamp=9999',
    'ErrorDelay=30', 'Delay=10',
    'TransTimes=00:00;14:05', 'TransInterval=1',
    'TransFlag=1111000000',
    `TimeZone=${timeZoneOffset}`,
    'Realtime=1', 'Encrypt=0',
  ].join('\n') + '\n';
}

module.exports = { parseAttlog, zonedToUtc, handshakeBody };
