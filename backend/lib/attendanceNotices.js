'use strict';
/**
 * What the K40 could not tell anybody.
 *
 * ⚠️ THE DEVICE ALWAYS ANSWERS «OK». routes/iclock.js replies `OK: n` to every upload — that
 * is the ADMS protocol, not a decision we get to make — so the K40 beeps green on any valid
 * finger and the WORKER walks away believing their press registered. Whether it actually did
 * anything is decided later, in lib/attendanceDevice.js, and until 2026-09-08 that decision
 * went into `punch_raw.ignored_reason` and was read by nothing: not `listRejects` (that reads
 * `punch_reject`, i.e. lines we could not PARSE), not `listUnmapped` (unknown PINs only), and
 * not the worker's phone.
 *
 * Measured on prod 2026-09-06 → 09-08: of 14 break-key presses by mapped workers, **5 were
 * discarded in silence** — every one of them a «رجعت» pressed with no open break. مضر محمد's
 * next action 19 seconds after one of them was to open a break request on his PHONE instead,
 * which is a worker discovering the failure by accident. That is the whole of «البصمة ما
 * تشتغل ولا تظهر».
 *
 * So a punch that changed nothing now produces a notification, and a break opened AT THE
 * DEVICE tells the admin the same way the phone flow always has.
 *
 * ⚠️ THE ARROWS ARE NOT DECORATION AND THEY ARE NOT THE ZKTeco LABELS. Owner ruling, twice
 * (2026-09-06 and 2026-09-08): **← starts the break (أطلع), → ends it (رجعت)** — the shop's
 * own sticker, which is inverted from the device's English "Break-In"/"Break-Out". Every
 * string below names the key the worker should press next, so getting this backwards would
 * teach the mistake instead of fixing it. It is pinned by PUNCH_STATE in attendanceDevice.js.
 *
 * ⚠️ CALL THIS AFTER THE TRANSACTION COMMITS, NEVER INSIDE IT. A failed INSERT aborts the
 * whole Postgres transaction, so a deleted recipient would take the punch batch down with it
 * — the same rule attendanceBreakController's notify helpers already state.
 */

const { query } = require('./db');
const { DEFAULT_TZ } = require('./shopTime');

const NOTICE_TYPE = 'attendance_device';

/** A device-punch notice kind → the two messages it produces. */
const COPY = {
  // The worker pressed → «رجعت» with nothing open. The commonest failure on prod.
  break_end_no_open: {
    worker: {
      title: 'ما انسجل رجوعك',
      body: () =>
        'ضغطت (→) رجعت بس ما عندك خروج مؤقت مفتوح. لما تطلع اضغط (←) أول، ولما ترجع اضغط (→).',
    },
    admin: {
      title: 'بصمة خروج مؤقت ما انسجلت',
      body: (name) => `${name} ضغط (→) رجعت وما عنده خروج مؤقت مفتوح — ما انسجل شي.`,
    },
  },
  // The worker pressed ← «أطلع» while already out. Re-opening would abandon the running
  // break, so applyPunch refuses — and now says so.
  break_start_already_out: {
    worker: {
      title: 'أنت أصلاً بخروج مؤقت',
      body: () => 'ضغطت (←) أطلع وأنت أصلاً خارج. اضغط (→) رجعت لما توصل المحل.',
    },
    admin: {
      title: 'بصمة خروج مؤقت ما انسجلت',
      body: (name) => `${name} ضغط (←) أطلع وهو أصلاً بخروج مؤقت.`,
    },
  },
  // Not a failure — the event the admin could not see. Only the OPEN is announced: a worker
  // walking out is the actionable moment, and announcing the return as well would double the
  // volume for something the breaks table already shows.
  break_started: {
    admin: {
      title: 'خروج مؤقت',
      body: (name, at) => `${name} طلع بخروج مؤقت ${at}.`,
    },
  },
};

function timeAr(value, timeZone = DEFAULT_TZ) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('ar-IQ', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

async function insertOne(userId, { title, body, link }) {
  await query(
    `INSERT INTO notifications (user_id, type, title_ar, body_ar, link)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, NOTICE_TYPE, title, body, link]
  );
}

async function insertAdmins({ title, body, link }) {
  await query(
    `INSERT INTO notifications (user_id, type, title_ar, body_ar, link)
     SELECT id, $1, $2, $3, $4 FROM users WHERE role = 'admin'`,
    [NOTICE_TYPE, title, body, link]
  );
}

/**
 * Deliver the notices one punch batch produced. Never throws: a notification is an
 * accelerator, and losing one must not turn a stored punch into a 500 the device retries.
 *
 * `notices` is what `ingestPunches` returns — `[{ kind, user_id, at }]`.
 */
async function deliverPunchNotices(notices = []) {
  if (!notices.length) return 0;
  let sent = 0;

  const ids = [...new Set(notices.map((n) => n.user_id).filter(Boolean))];
  let names = new Map();
  try {
    const { rows } = await query(`SELECT id, name FROM users WHERE id = ANY($1::uuid[])`, [ids]);
    names = new Map(rows.map((r) => [r.id, r.name]));
  } catch (err) {
    console.error('[attendance-notice] name lookup failed:', err.message);
  }

  for (const notice of notices) {
    const copy = COPY[notice.kind];
    if (!copy) continue;
    const name = names.get(notice.user_id) || 'موظف';
    try {
      if (copy.worker) {
        await insertOne(notice.user_id, {
          title: copy.worker.title,
          body: copy.worker.body(name, timeAr(notice.at)),
          link: '/staff',
        });
        sent += 1;
      }
      if (copy.admin) {
        await insertAdmins({
          title: copy.admin.title,
          body: copy.admin.body(name, timeAr(notice.at)),
          link: '/admin/attendance',
        });
        sent += 1;
      }
    } catch (err) {
      console.error(`[attendance-notice] ${notice.kind} failed:`, err.message);
    }
  }
  return sent;
}

module.exports = { deliverPunchNotices, NOTICE_TYPE, COPY };
