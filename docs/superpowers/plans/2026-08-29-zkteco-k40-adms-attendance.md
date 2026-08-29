# ZKTeco K40 Pro (ADMS) attendance — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> Steps use checkbox (`- [ ]`) syntax.

**Goal:** Punches from a ZKTeco K40 Pro reach LoloShop over ADMS and become
`staff_attendance_records` rows, with the raw stream kept forever so the derivation rule can be
corrected and re-run over history.

**Architecture:** The device dials out (ADMS push) to `/iclock/*` on the Express API. Punches
land append-only in `punch_raw`; a pure, re-runnable derivation upserts them into the existing
`staff_attendance_records`. Malformed rows are quarantined in `punch_reject` so one bad line
never freezes the device's upload queue.

**Tech stack:** Express 5, PostgreSQL (Neon), Node `node --test`. **Zero new npm packages** —
a new dependency carrying an advisory blocks the deploy (`npm audit` runs in CI).

**Spec:** `docs/superpowers/specs/2026-08-29-zkteco-k40-adms-attendance-design.md`

**Prior art:** `~/Desktop/active/grand/grandlayan/db/migrations/027_attendance_v2_spine.sql` and
`~/Desktop/active/grand/bridge/README.md` — a K40 integration live since 2026-08-13, proven
against real hardware on 2026-08-15 (193 punches, 0 duplicates). Read both before Task 2 or 3.
Its *bridge* is the pull protocol and is irrelevant here (ADMS replaces it); its *server* half
is the reference.

## Global Constraints

- **No new npm dependencies.** CI runs `npm audit --omit=dev --audit-level=moderate` on both
  workspaces and a new advisory blocks the auto-deploy.
- **Every push to `main` auto-deploys.** All work lands on `feat/zkteco-adms-attendance`.
- **`lib/staffSchedule.js` stays the ONLY resolver** of weekday hours, holidays and the
  after-midnight rule. Do not add a second copy. Call `resolveStamp(punchDate, …)` with the
  punch's own `Date` — it already accepts one.
- **`weekday` is Postgres `EXTRACT(DOW)`** — 0 = الأحد … 6 = السبت, الجمعة is **5**.
- **Error responses:** `{ error: '<Arabic message>', code: 'ERR_*' }`.
- **Backend tests run from `backend/`** as `node --test test/*.test.js`. Never from the repo
  root (dotenv misses `.env`, 147 tests fail for unrelated reasons).
- **New tables go in BOTH** `db/migrations/094_*.sql` and `db/schema.sql` — `npm run migrate`
  applies `schema.sql`, and `scripts/deploy.sh` runs it on every deploy.
- **Arabic is the only UI language.** No English strings in user-visible copy.
- Shop timezone is `Asia/Baghdad`; use `DEFAULT_TZ` from `backend/lib/shopTime.js`.

---

## Task 1: Migration 094 — the raw-punch spine

**Blocking.** Tasks 2, 3 and 4 all need these tables.

**Files:**
- Create: `db/migrations/094_attendance_device.sql`
- Modify: `db/schema.sql` (append the same DDL, idempotent)

**Produces:** tables `attendance_devices`, `punch_raw`, `punch_reject`, `staff_device_pins`.

- [ ] **Step 1: Write the migration**

```sql
-- Migration 094: جهاز البصمة (ZKTeco K40 Pro) عبر ADMS.
--
-- الجهاز يتصل بالخادم من جهته (ADMS push)، فما نحتاج فتح منفذ براوتر المحل
-- ولا IP ثابت ولا حاسبة شغّالة بالمحل.
--
-- ⚠️ punch_raw سجل الحقيقة: يُضاف فقط وما ينكتب فوكه أبداً. الاشتقاق
--    (lib/attendanceDevice.js) دالة يُعاد تشغيلها، فتصليح القاعدة يصلّح
--    التاريخ كله. هذا الدرس مأخوذ من grandlayan/027.
--
-- ⚠️ بخلاف grandlayan، جدول الحضور عدنا (staff_attendance_records) **مو**
--    ذاكرة مؤقتة: بي late_minutes مجمّدة وقت الكتابة، وارتباط الاستراحات
--    (staff_attendance_breaks.attendance_id)، وتعديلات المديرين. فالاشتقاق
--    يعمل UPSERT ولا مرة DELETE، وما يلمس صفاً status='overridden'.
CREATE TABLE IF NOT EXISTS attendance_devices (
  serial_number   TEXT PRIMARY KEY,
  label_ar        TEXT NOT NULL DEFAULT 'جهاز البصمة',
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at    TIMESTAMPTZ,
  last_ip         TEXT,
  firmware_note   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS punch_raw (
  id            BIGSERIAL PRIMARY KEY,
  device_sn     TEXT NOT NULL,
  -- رقم التسجيل داخل الجهاز، نص كما وصل. مو user_id: الربط وقت الاشتقاق،
  -- فنبضة موظف مو مربوط تنخزن بدل ما تنرفض وتضيع.
  device_pin    TEXT NOT NULL,
  -- ساعة الجهاز نفسه بلا منطقة زمنية — هي وقت المحل اللي يشوفه الموظف.
  device_ts     TIMESTAMP NOT NULL,
  -- نفس اللحظة محسوبة بـAsia/Baghdad. الاشتقاق يشتغل على هذا العمود.
  punched_at    TIMESTAMPTZ NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_status    SMALLINT,
  raw_verify    SMALLINT,
  raw_line      TEXT,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  attendance_id UUID REFERENCES staff_attendance_records(id) ON DELETE SET NULL,
  ignored_reason TEXT
);

-- المفتاح الوحيد اللي يخلي الاستقبال idempotent. الجهاز **يعيد الإرسال**:
-- إذا انقطع الإنترنت يخزن داخلياً ويكب كل شي مرة وحدة لمّا يرجع.
-- ⚠️ `nulls not distinct` ضرورية: raw_status يجي NULL من بعض الإصدارات،
--    وبالسلوك الافتراضي كل NULL «مميّزة» فنفس النبضة تعدّي مرتين.
CREATE UNIQUE INDEX IF NOT EXISTS punch_raw_dedupe_ux
  ON punch_raw (device_sn, device_pin, device_ts, raw_status) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS punch_raw_pin_ts_ix ON punch_raw (device_pin, device_ts);
CREATE INDEX IF NOT EXISTS punch_raw_unmapped_ix
  ON punch_raw (device_sn, device_pin) WHERE user_id IS NULL;

-- الجهاز يعيد إرسال الدفعة للأبد لحد ما تاخذ 200. لو رفضنا الدفعة كاملة
-- بسبب صف واحد خربان، كل النبضات وراه تتجمّد بصمت. فالصف الخربان ينعزل هنا.
CREATE TABLE IF NOT EXISTS punch_reject (
  id         BIGSERIAL PRIMARY KEY,
  device_sn  TEXT,
  raw_line   TEXT,
  reason     TEXT NOT NULL,
  at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS punch_reject_at_ix ON punch_reject (at DESC);

-- الربط: رقم الجهاز ← موظف. نحن اللي نوزّع الأرقام وندزّها للجهاز (§4).
CREATE TABLE IF NOT EXISTS staff_device_pins (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pin         INTEGER NOT NULL UNIQUE CHECK (pin BETWEEN 1 AND 65534),
  pushed_name TEXT,
  push_state  TEXT NOT NULL DEFAULT 'pending'
                CHECK (push_state IN ('pending', 'sent', 'confirmed', 'failed')),
  enrolled_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- طابور الأوامر نحو الجهاز — يسحبها بـGET /iclock/getrequest.
CREATE TABLE IF NOT EXISTS device_commands (
  id          BIGSERIAL PRIMARY KEY,
  device_sn   TEXT NOT NULL,
  body        TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'queued'
                CHECK (state IN ('queued', 'sent', 'done', 'failed')),
  result_code TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at     TIMESTAMPTZ,
  done_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS device_commands_queue_ix
  ON device_commands (device_sn, id) WHERE state = 'queued';
```

- [ ] **Step 2: Append the identical DDL to `db/schema.sql`**, under a
      `-- migration 094` banner. It must be byte-identical and idempotent.

- [ ] **Step 3: Apply and verify**

Run from `backend/`: `npm run migrate:file ../db/migrations/094_attendance_device.sql`
then `npm run migrate` (proves `schema.sql` is idempotent — it must not error the second time).
Expected: both succeed, and
`psql -c "\d punch_raw"` shows the `punch_raw_dedupe_ux` index.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/094_attendance_device.sql db/schema.sql
git commit -m "feat(attendance): migration 094 — the raw-punch spine for the K40"
```

---

## Task 2: `lib/iclockProtocol.js` — parse what the device sends

Pure functions, no database. Independent of Tasks 3 and 4.

**Files:**
- Create: `backend/lib/iclockProtocol.js`
- Test: `backend/test/iclockProtocol.test.js`

**Interfaces — Produces:**
```js
module.exports = {
  parseAttlog,        // (text: string) => { punches: Punch[], rejects: {raw_line, reason}[] }
  zonedToUtc,         // (localStr: 'YYYY-MM-DD HH:MM:SS', timeZone: string) => Date
  handshakeBody,      // (serial: string, opts?: {timeZoneOffset?: number}) => string
};
// Punch = { device_pin, device_ts, punched_at, raw_status, raw_verify, raw_line }
//   device_ts  : 'YYYY-MM-DD HH:MM:SS' (device clock, no timezone) — stored verbatim
//   punched_at : Date — device_ts interpreted in Asia/Baghdad
```

**Key facts:**
- ATTLOG body is tab-separated, one punch per line, lines split on `\r\n` or `\n`:
  `PIN \t YYYY-MM-DD HH:MM:SS \t status \t verify \t workcode \t reserved…`
- The timestamp carries **no timezone**. It is the device's wall clock = shop local time.
- Blank lines and trailing whitespace are normal; skip them silently, do not reject them.

- [ ] **Step 1: Write the failing tests**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAttlog, zonedToUtc } = require('../lib/iclockProtocol');

test('zonedToUtc reads the device clock as Baghdad time', () => {
  // Asia/Baghdad is UTC+3 with no DST since 2016.
  assert.equal(zonedToUtc('2026-08-29 09:04:00', 'Asia/Baghdad').toISOString(),
    '2026-08-29T06:04:00.000Z');
});

test('parseAttlog reads a normal two-punch upload', () => {
  const body = '7\t2026-08-29 09:04:00\t0\t1\t0\t0\n7\t2026-08-29 21:10:00\t1\t1\t0\t0\n';
  const { punches, rejects } = parseAttlog(body);
  assert.equal(rejects.length, 0);
  assert.equal(punches.length, 2);
  assert.equal(punches[0].device_pin, '7');
  assert.equal(punches[0].device_ts, '2026-08-29 09:04:00');
  assert.equal(punches[0].raw_status, 0);
  assert.equal(punches[0].punched_at.toISOString(), '2026-08-29T06:04:00.000Z');
});

test('parseAttlog skips blank lines rather than rejecting them', () => {
  const { punches, rejects } = parseAttlog('\r\n7\t2026-08-29 09:04:00\t0\t1\r\n\r\n');
  assert.equal(punches.length, 1);
  assert.equal(rejects.length, 0);
});

test('parseAttlog quarantines a malformed line and keeps the good ones', () => {
  // One bad row must NOT fail the batch — the device would resend it forever.
  const body = '7\t2026-08-29 09:04:00\t0\nGARBAGE\n8\t2026-08-29 09:06:00\t0\n';
  const { punches, rejects } = parseAttlog(body);
  assert.equal(punches.length, 2);
  assert.equal(rejects.length, 1);
  assert.equal(rejects[0].raw_line, 'GARBAGE');
});

test('parseAttlog quarantines an impossible device clock', () => {
  // A K40 that lost its battery reports 1970 or 2099; such a row would wreck
  // every date-range report it lands in.
  const { punches, rejects } = parseAttlog('7\t1970-01-01 00:00:00\t0\n');
  assert.equal(punches.length, 0);
  assert.equal(rejects.length, 1);
  assert.match(rejects[0].reason, /خارج المدى/);
});

test('parseAttlog tolerates a missing status column', () => {
  const { punches } = parseAttlog('7\t2026-08-29 09:04:00\n');
  assert.equal(punches.length, 1);
  assert.equal(punches[0].raw_status, null);
});
```

- [ ] **Step 2: Run to verify they fail**

Run from `backend/`: `node --test test/iclockProtocol.test.js`
Expected: FAIL — `Cannot find module '../lib/iclockProtocol'`.

- [ ] **Step 3: Implement**

```js
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
  // Two passes: the offset is evaluated at the guessed instant, which is at most
  // one offset-width away from the true one. A second pass settles it.
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
```

- [ ] **Step 4: Run to verify they pass**

Run from `backend/`: `node --test test/iclockProtocol.test.js` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/iclockProtocol.js backend/test/iclockProtocol.test.js
git commit -m "feat(attendance): parse the K40's ATTLOG, quarantining bad lines instead of failing the batch"
```

---

## Task 3: `lib/attendanceDevice.js` — punches become attendance

Depends on Task 1 only. Runs in parallel with Tasks 2 and 4.

**Files:**
- Create: `backend/lib/attendanceDevice.js`
- Test: `backend/test/attendanceDevice.test.js`

**Interfaces — Consumes:** `lib/staffSchedule.js` (`loadWeek`, `loadHolidays`, `resolveStamp`,
`lateMinutesFor`, `shiftDate`), `lib/shopTime.js` (`localParts`, `DEFAULT_TZ`), `lib/db.js`
(`query`, `tx`).

**Interfaces — Produces:**
```js
module.exports = {
  ingestPunches, // (client, deviceSn, punches[], rejects[]) => {stored, duplicate, rejected, derived}
  applyPunch,    // (client, punchRow) => 'created' | 'extended' | 'moved_in' | 'ignored' | 'unmapped'
  allocatePin,   // (client) => Promise<number>  — lowest free pin >= 1
};
```

**THE RULES — each one is a way this silently breaks:**

1. **Lateness comes from the punch timestamp, never `now()`.** The device buffers while the
   shop's internet is down and dumps hours later. `resolveStamp(punch.punched_at, …)`.
2. **First punch of a shift opens the record; the last extends `check_out_at`.** Nobody on a
   K40 presses a function key to declare in vs out.
3. **An out-of-order punch earlier than `check_in_at` moves the check-in back** and recomputes
   `late_minutes` / `deduction_amount` from it. The old check-in becomes the checkout if it is
   later than the current one.
4. **A punch between in and out is stored and ignored** for the record (the lunchtime
   double-touch).
5. **NEVER touch a row with `status = 'overridden'`.** An admin has ruled on that day.
6. **NEVER `DELETE` from `staff_attendance_records`.** Breaks reference it by
   `staff_attendance_breaks.attendance_id`, and `late_minutes` is frozen history.
7. **An unmapped PIN stores the punch with `user_id = NULL` and creates no record.**
8. Skip a user whose `attendance_required` is FALSE (`staff_attendance_user_settings`).

- [ ] **Step 1: Write the failing tests**

Follow the house pattern in `backend/test/optionGroupAudience.test.js`: `require('dotenv').config()`,
a `ZZTEST-` tagged fixture set created in a `before`, torn down in an `after`, driving the real
functions against the real dev database.

Cases, one test each:

```js
// 1. A punch creates the day's record with lateness from the PUNCH time, not now().
//    Insert a punch stamped 3 hours ago; assert late_minutes matches the schedule's
//    start time vs that stamp, and that the record's check_in_at equals the punch.
// 2. Re-ingesting the identical batch stores 0 and duplicates N — the device resends
//    its whole buffer after an outage.
// 3. Two punches in one shift → one record, check_out_at = the later punch.
// 4. A third punch BETWEEN them changes nothing ('ignored').
// 5. A punch earlier than an existing check_in_at moves the check-in back AND
//    recomputes late_minutes downward ('moved_in').
// 6. A punch at 00:10 on الجمعة's shift files under Friday's work_date, not Saturday.
//    (Seed staff_schedule_days weekday 5 = 15:00 → 00:00 and assert work_date.)
// 7. A punch on a date in staff_holidays records late_minutes = 0.
// 8. A punch from a PIN with no staff_device_pins row → 'unmapped', user_id NULL,
//    and zero new staff_attendance_records rows.
// 9. A record with status='overridden' is left completely untouched by a later punch.
// 10. allocatePin returns the lowest free number, skipping taken ones.
```

- [ ] **Step 2: Run to verify they fail**

Run from `backend/`: `node --test test/attendanceDevice.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Structure (write the bodies to satisfy the tests; the shape is fixed here so Task 5 can call it):

```js
'use strict';
// Raw punches → staff_attendance_records. The derivation, and the ONLY place the device
// touches attendance.
//
// ⚠️ Unlike grandlayan/027's attendance_day, staff_attendance_records is NOT a cache that
// may be wiped and rebuilt. It carries late_minutes frozen at write time, admin overrides,
// and staff_attendance_breaks.attendance_id pointing at it. So: UPSERT, never DELETE, and
// never touch a row an admin has ruled on.
const schedule = require('./staffSchedule');
const { DEFAULT_TZ } = require('./shopTime');

async function ingestPunches(client, deviceSn, punches, rejects = []) { /* … */ }
async function applyPunch(client, punch) { /* … */ }
async function allocatePin(client) { /* … */ }

module.exports = { ingestPunches, applyPunch, allocatePin };
```

`ingestPunches` must:
- `INSERT … ON CONFLICT DO NOTHING RETURNING id` per punch → counts stored vs duplicate;
- write every entry of `rejects` into `punch_reject`;
- call `applyPunch` for each newly-stored row;
- `UPDATE attendance_devices SET last_seen_at = NOW()`;
- return the four counts. **Never throw on one bad punch** — quarantine and continue.

- [ ] **Step 4: Run to verify they pass**

Run from `backend/`: `node --test test/attendanceDevice.test.js` → all PASS.
Then the whole suite: `node --test test/*.test.js` → no regression (508 passing on `main`).

- [ ] **Step 5: Commit**

```bash
git add backend/lib/attendanceDevice.js backend/test/attendanceDevice.test.js
git commit -m "feat(attendance): derive attendance from raw punches, timed by the finger not the upload"
```

---

## Task 4: Admin API + screen — devices, PIN map, unmapped punches

Depends on Task 1 only. Runs in parallel with Tasks 2 and 3.

**Files:**
- Create: `backend/controllers/attendanceDeviceController.js`
- Modify: `backend/routes/admin.js` (add routes under the existing `requireRole('admin')` guard)
- Create: `frontend/components/admin/AttendanceDevicePanel.tsx`
- Modify: `frontend/app/admin/attendance/page.tsx` (add a «جهاز البصمة» tab)
- Modify: `frontend/lib/admin.ts` (typed wrappers)
- Test: `backend/test/attendanceDeviceAdmin.test.js`

**Endpoints:**

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/attendance/devices` | list devices + `last_seen_at` + today's punch count |
| `POST` | `/api/admin/attendance/devices` | register a serial (`serial_number`, `label_ar`) |
| `PATCH` | `/api/admin/attendance/devices/:sn` | toggle `active`, rename |
| `GET` | `/api/admin/attendance/pins` | every staff member + their pin + `push_state` |
| `PUT` | `/api/admin/attendance/pins/:userId` | set/allocate a pin, queue the name push |
| `DELETE` | `/api/admin/attendance/pins/:userId` | unlink, queue the device delete |
| `GET` | `/api/admin/attendance/unmapped` | distinct `device_pin`s with `user_id IS NULL`, counts, first/last seen |
| `POST` | `/api/admin/attendance/unmapped/:pin/assign` | `{ user_id }` — link, then re-derive that pin's punches |
| `GET` | `/api/admin/attendance/rejects` | recent `punch_reject` rows |

**Arabic copy — use exactly these:**
- Tab: «جهاز البصمة»
- «أرقام جهاز بلا اسم» (unmapped list)
- «آخر اتصال بالجهاز» · «لم يتصل بعد»
- «نبضات مرفوضة» · «اربط بموظف» · «رقم الجهاز» · «حالة الإرسال»
- push_state: `pending` «بالانتظار» · `sent` «انرسل» · `confirmed` «تأكد» · `failed` «فشل»

**⚠️ Assigning an unmapped pin must re-derive that pin's stored punches**, oldest first, so the
worker's history appears the moment they are linked. That is the whole reason punches are
stored raw before they are understood.

- [ ] **Step 1: Write the failing test** — registering a device, allocating a pin (asserting
      `allocatePin` skips taken numbers), and that assigning an unmapped pin backfills
      `staff_attendance_records` for punches that arrived before the link existed.
- [ ] **Step 2: Run it, confirm it fails.** `node --test test/attendanceDeviceAdmin.test.js`
- [ ] **Step 3: Implement controller + routes, then the React panel.**
      Mobile-first, `dir="rtl"`, tap targets ≥44px. Admin is laptop-primary but this screen
      gets used standing next to the device — build it for a phone.
- [ ] **Step 4: Run tests + `npm run build` in `frontend/`.** Both clean.
- [ ] **Step 5: Commit.**

---

## Task 5: `routes/iclock.js` — the device-facing endpoint

Depends on Tasks 1, 2, 3. **Do this after they land** — it is the wiring.

**Files:**
- Create: `backend/routes/iclock.js`
- Modify: `backend/server.js` (mount at root, BEFORE the `/api/*` routers)

**⚠️ Body parsing:** these bodies are `text/plain`, and `express.json()` at `server.js:62` will
not parse them. Apply `express.text({ type: '*/*', limit: '2mb' })` **on this router only** —
mounting it globally changes how every other route in the app reads its body.

**⚠️ An unknown serial gets `200` with an empty body, not `403`.** Some firmware retries a 4xx
forever, turning one misconfigured device into a self-inflicted flood. Drop it server-side and
log it.

| Route | Reply |
|---|---|
| `GET /iclock/cdata?SN=&options=all` | `handshakeBody(sn)` from Task 2, `text/plain` |
| `POST /iclock/cdata?SN=&table=ATTLOG` | parse → `ingestPunches` → `OK: <stored>` |
| `GET /iclock/getrequest?SN=` | next queued `device_commands` row as `C:<id>:<body>`, else `OK` |
| `POST /iclock/devicecmd` | mark the command done/failed → `OK` |

- [ ] **Step 1: Write the failing test** (`backend/test/iclockRoute.test.js`) — drive the router
      with `node:http` against a real Express app: a handshake, an ATTLOG upload that lands
      rows, the same upload again landing zero, and an unknown serial getting 200 + no rows.
- [ ] **Step 2: Run it, confirm it fails.**
- [ ] **Step 3: Implement the router and mount it.**
- [ ] **Step 4: Run the whole suite from `backend/`: `node --test test/*.test.js`.**
- [ ] **Step 5: Commit.**

---

## Task 6: Get it on the box and pointed at the device

Not code. Do it with the owner present.

- [ ] **Step 1: Back up the prod DB FIRST.**
      ⚠️ `pg_dump` as the app user fails on prod (`permission denied for table
      _backfill_sash_carrier_20260821`). Use:
      `sudo -u postgres pg_dump -d loloshop -Fc -f /tmp/pre-094.dump && mv /tmp/pre-094.dump /root/`
- [ ] **Step 2: Merge the branch to `main`.** CI auto-deploys and runs `npm run migrate`,
      which applies 094 from `schema.sql`.
- [ ] **Step 3: Expose a port for the device WITHOUT touching Caddy.**
      RevoArt's `supabase-caddy` owns :80/:443 on this shared box and fronts a second
      production site — editing it risks two products. Instead open one port in UFW and let
      the API listen on it. Record the chosen port in `HANDOFF.md`.
- [ ] **Step 4: Register the serial** at `/admin/attendance → جهاز البصمة` **before** pointing
      the device at us. An unregistered serial is dropped silently by design.
- [ ] **Step 5: On the device** — Menu → Comm → Cloud Server Setting: server address
      `169.58.114.255`, port as chosen, and set the device clock (grand measured a K40 running
      56 seconds fast).
- [ ] **Step 6: Touch one finger and watch.**
      `SELECT * FROM punch_raw ORDER BY id DESC LIMIT 5;` — a row means the whole chain works.
      Then `SELECT * FROM punch_reject ORDER BY id DESC LIMIT 20;` — anything here is a dialect
      mismatch, and its `raw_line` names it exactly. This is the R1 checkpoint.

---

## Task 7: Push names to the device

Only after Task 6 proves the device talks to us.

**Files:** `backend/lib/attendanceDevice.js` (add `queueUserPush`), `backend/routes/iclock.js`.

Queue on the `getrequest` channel:
`DATA UPDATE USERINFO PIN=<pin>\tName=<name>\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=`

⚠️ **Arabic on the K40 screen depends on a firmware language pack.** If it renders boxes, the
fallback is a Latin transliteration — which is why `staff_device_pins.pushed_name` is a column
an admin edits, not a value derived from `users.name`. Deleting a worker queues
`DATA DELETE USERINFO PIN=<pin>`.

- [ ] Test that a queued command is handed out exactly once and marked `sent`.
- [ ] Test that a `devicecmd` report moves it to `done`.
- [ ] Commit.

---

## Task 8: Remove the phone بصمة — NOT the same day

**⚠️ This task ships only after a full day of real punches has been watched.** The owner asked
for it immediately; the reason to wait is that `late_minutes` is frozen at write time and a day
with no rows cannot be repaired by a later backfill. Removing the phone stamp before the device
is proven risks a day nobody can be paid for correctly.

**Files:** `backend/controllers/attendanceController.js` (`checkIn`, `checkOut` → `403`
`ERR_ATTENDANCE_DEVICE_ONLY`), `frontend/components/staff/StaffAttendanceCard.tsx`,
`frontend/components/staff/StaffAttendancePanel.tsx`, `frontend/components/staff/AttendanceReminder.tsx`.

**⚠️ Ships in the SAME commit as admin hand-entry** (`POST /api/admin/attendance/records`,
creating a record marked manual with the admin's id). `overrideRecord` can only edit a row that
exists; without hand-entry a dead device means no attendance at all.

- [ ] Test: the old endpoints 403 with the Arabic message and the right code.
- [ ] Test: an admin can create a record by hand, and it is marked as manual.
- [ ] Frontend: the stamp buttons are gone; today's record still renders read-only.
- [ ] Commit both halves together.
