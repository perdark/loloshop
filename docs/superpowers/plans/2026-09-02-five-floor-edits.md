# Five Floor Edits — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the owner's five 2026-09-02 requests — attendance visible and repairable, the embroiderer on the calligraphy tool, an assembly stage for rep pieces, a full «who worked on it» trail on every piece, a usable activity log, and a phone-consistent staff UI.

**Architecture:** Every change rides the existing shapes: `order_status` enum + `nextStageFor`/`STAGE_AUTHZ` for the stage, `staff_activity_log` ∪ `audit_log` for the trail, `punch_raw` for attendance evidence, one shared activity builder for both activity screens. No new tables. Status stays the single source of truth for where a piece is; the assembly board READS zone progress, it never derives status from it.

**Tech Stack:** Express 5 + `pg` (Neon in dev, local pg17 copy on `127.0.0.1:5433`), `node --test` (run from `backend/` as `node --test test/*.test.js`), Next.js 16 + React 19 + Tailwind v4, Claude in Chrome for phase 9.

**Spec:** `docs/superpowers/specs/2026-09-02-five-floor-edits-design.md` — read its Decisions table (D1–D8) first; every task below assumes the defaults.

## Global Constraints

- Backend tests: `cd backend && node --test test/*.test.js` (never the bare `test/` form — Node 26 landmine). A DB-touching test must retire its fixture inside its own test (adminNumbers landmine).
- `db/schema.sql` is re-applied on EVERY deploy: every new DDL line must be idempotent (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`), and a numbered migration in `db/migrations/` must carry the same lines.
- Line staff never receive money or contact fields; names/stages/times are fine (D7).
- `QUEUE_STAGES` = «مرحلتي»; `LINE_VIEW_STAGES` = «what I may look at and move». Never derive one from the other.
- Arabic RTL, `dir="rtl"`, brand tokens only (no blue/purple/navy, no Inter). Copy in Iraqi Arabic like the rest of the staff UI.
- Frontend must pass `npx tsc --noEmit` and `npm run lint`; `Record<OrderStatus, …>` maps are the guard that every new status is labelled.
- After every task: PROGRESS.md entry; after every track: HANDOFF.md only if a landmine opened or closed.
- Commits in repo style: `type(scope): Arabic-or-English sentence`, one task per commit.
- Phase 9 (`verify` skill, real browser) and phase 10 (`security-review`) before each deploy. `/code-review` before the last push of a track.

---

# Track 2A — محمد عماد on الخط العربي (+ commit the DST work)

### Task 2A.1: Commit the parked digitiser on its own branch

**Files:**
- Commit (already in tree, uncommitted): `backend/lib/digitize/*`, `backend/test/digitize.test.js`, `db/migrations/097_calligraphy_dst.sql`, `backend/controllers/calligraphyController.js`, `backend/lib/calligraphyEngine.js`, `backend/routes/calligraphy.js`, `db/schema.sql`, `frontend/components/calligraphy/CalligraphyTool.tsx`, `frontend/lib/calligraphy.ts`, `frontend/app/admin/orders/page.tsx`, `HANDOFF.md`, `PROGRESS.md`
- Leave out: `appstore/` (untracked, unrelated — ask the owner what it is before adding).

- [ ] **Step 1: Confirm the tree is what PROGRESS describes**

Run: `cd /home/mint/Desktop/active/loloshop && git status --short && git diff --stat`
Expected: the 9 modified files + 4 untracked paths listed above, nothing else.

- [ ] **Step 2: Run the digitiser tests**

Run: `cd backend && node --test test/digitize.test.js test/calligraphyCost.test.js`
Expected: `# pass 19` for digitize, all pass for cost (numbers per PROGRESS 2026-08-31 (c)).

- [ ] **Step 3: Branch and commit**

```bash
git checkout -b feat/calligraphy-dst
git add backend/lib/digitize backend/test/digitize.test.js db/migrations/097_calligraphy_dst.sql \
  backend/controllers/calligraphyController.js backend/lib/calligraphyEngine.js backend/routes/calligraphy.js \
  db/schema.sql frontend/components/calligraphy/CalligraphyTool.tsx frontend/lib/calligraphy.ts \
  frontend/app/admin/orders/page.tsx HANDOFF.md PROGRESS.md
git commit -m "feat(calligraphy): «صورة الاسم» يصير ملف تطريز DST على السيرفر — مو مجرَّب على الماكنة بعد"
```

### Task 2A.2: One access predicate, embroiderer included

**Files:**
- Create: `backend/lib/calligraphyAccess.js`
- Modify: `backend/routes/calligraphy.js:18-49` (replace the two inline guards' role logic)
- Test: `backend/test/calligraphyAccess.test.js`

**Interfaces:**
- Produces: `mayUseTool(user) → boolean`, `mayPushOrder(user) → boolean`, `TOOL_STAFF_TYPES`, `PUSH_STAFF_TYPES` (exported from `lib/calligraphyAccess.js`).

- [ ] **Step 1: Write the failing test**

```js
// backend/test/calligraphyAccess.test.js
'use strict';
// Who may open الخط العربي, and who may push an order out of التصميم with it. The two are
// different questions on purpose: محمد عماد (المطرّز) generates and downloads plates/DST for
// his own station; «تحويل للتطريز» stays the designer's (advanceBlockReason's side door).
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const { mayUseTool, mayPushOrder } = require('../lib/calligraphyAccess');

const staff = (...types) => ({ role: 'staff', staff_type: types[0], staff_types: types });

test('1. embroiderer may use the tool', () => {
  assert.equal(mayUseTool(staff('embroiderer')), true);
});
test('2. embroiderer may NOT push an order to التطريز', () => {
  assert.equal(mayPushOrder(staff('embroiderer')), false);
});
test('3. designer and manager may do both; presser neither', () => {
  assert.equal(mayUseTool(staff('designer')), true);
  assert.equal(mayPushOrder(staff('designer')), true);
  assert.equal(mayUseTool(staff('manager')), true);
  assert.equal(mayPushOrder(staff('manager')), true);
  assert.equal(mayUseTool(staff('presser')), false);
  assert.equal(mayPushOrder(staff('presser')), false);
});
test('4. multi-role: presser+embroiderer may use the tool', () => {
  assert.equal(mayUseTool(staff('presser', 'embroiderer')), true);
});
test('5. admin always; retail never', () => {
  assert.equal(mayUseTool({ role: 'admin' }), true);
  assert.equal(mayPushOrder({ role: 'admin' }), true);
  assert.equal(mayUseTool({ role: 'retail' }), false);
});
```

- [ ] **Step 2: Run it — expect a module-not-found failure**

Run: `cd backend && node --test test/calligraphyAccess.test.js`
Expected: FAIL `Cannot find module '../lib/calligraphyAccess'`.

- [ ] **Step 3: Write the predicate**

```js
// backend/lib/calligraphyAccess.js
'use strict';
// Who may use الخط العربي. Two lists on purpose — see routes/calligraphy.js header.
// `embroiderer` was added 2026-09-02 (owner: «خليه يكدر يصمم ويستعمل الخط العربي»); he
// generates and downloads plates + DST for his own station and never pushes an order.
const { staffTypesOf } = require('../middleware/auth');

const TOOL_STAFF_TYPES = ['manager', 'designer', 'embroiderer'];
const PUSH_STAFF_TYPES = ['manager', 'designer'];

function hasAny(user, types) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role !== 'staff') return false;
  return staffTypesOf(user).some((t) => types.includes(t));
}
const mayUseTool = (user) => hasAny(user, TOOL_STAFF_TYPES);
const mayPushOrder = (user) => hasAny(user, PUSH_STAFF_TYPES);

module.exports = { mayUseTool, mayPushOrder, TOOL_STAFF_TYPES, PUSH_STAFF_TYPES };
```

In `backend/routes/calligraphy.js` replace the staff branch of `allowCalligraphyUser` and the body of `requireDesignerOrAdmin`:

```js
const { mayUseTool, mayPushOrder } = require('../lib/calligraphyAccess');
// inside allowCalligraphyUser, replace the `if (u.role === 'admin') … if (u.role === 'staff') {…}` block with:
    if (mayUseTool(u)) return next();
// requireDesignerOrAdmin becomes:
function requireDesignerOrAdmin(req, res, next) {
  if (mayPushOrder(req.user)) return next();
  return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
}
```
Keep the `design_helper` DB check in `allowCalligraphyUser` exactly as it is.

- [ ] **Step 4: Run the tests**

Run: `cd backend && node --test test/calligraphyAccess.test.js test/calligraphyCost.test.js test/calligraphyReviewedLine.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/calligraphyAccess.js backend/routes/calligraphy.js backend/test/calligraphyAccess.test.js
git commit -m "feat(calligraphy): المطرّز يكدر يفتح الخط العربي — والتحويل للتطريز باقي للمصمم"
```

### Task 2A.3: Frontend gates match the backend

**Files:**
- Modify: `frontend/app/staff/calligraphy/page.tsx:27-30, 36-37`
- Modify: `frontend/components/staff/StaffSidebar.tsx:271-281`
- Modify: `frontend/components/calligraphy/CalligraphyTool.tsx:~676-681` (only to CONFIRM `canPush` stays designer/manager)

- [ ] **Step 1: Page gate**

```tsx
// app/staff/calligraphy/page.tsx
  const allowed =
    user.role === "admin" ||
    myTypes.includes("manager") ||
    myTypes.includes("designer") ||
    myTypes.includes("embroiderer");
  // … and the EmptyState copy:
          message="أداة الخط العربي مخصّصة للمصممين والمطرّزين والمديرين فقط."
```

- [ ] **Step 2: Sidebar link**

```tsx
// StaffSidebar.tsx — the canCalligraphy predicate
  const canCalligraphy =
    isAdmin || myTypes.includes("manager") || myTypes.includes("designer") || myTypes.includes("embroiderer");
```
Update the comment above it: it now mirrors `lib/calligraphyAccess.js TOOL_STAFF_TYPES`, not `requireStaffType('designer')`.

- [ ] **Step 3: Confirm the push button stays hidden for him**

Open `CalligraphyTool.tsx` around line 676; `canPush` must still read `designer || manager || admin`. Do not touch it. Add one comment line: `// embroiderer opens the tool (2026-09-02) but never sees «تحويل للتطريز».`

- [ ] **Step 4: Type-check + lint**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 5: Verify in a browser (phase 9, local)**

Start `backend` (`npm run dev`) and `frontend` (`npm run dev`) against the local DB copy. Give محمد عماد a known password on the LOCAL copy only:
```bash
cd backend && node -e "require('bcrypt').hash('Test12345!',10).then(h=>console.log(h))"
# then, with the printed hash:
node -e "const {query}=require('./lib/db');query(\"UPDATE users SET password_hash=\$1 WHERE name='محمد عماد' AND role='staff'\",[process.argv[1]]).then(r=>{console.log(r.rowCount);process.exit(0)})" '<hash>'
```
Log in as him with Claude in Chrome at 390×844: sidebar shows «الخط العربي»; the tool opens; the DST button shows coverage beside the file; NO «تحويل للتطريز» button. Screenshot both states.

- [ ] **Step 6: Commit + PROGRESS**

```bash
git add frontend/app/staff/calligraphy/page.tsx frontend/components/staff/StaffSidebar.tsx frontend/components/calligraphy/CalligraphyTool.tsx PROGRESS.md
git commit -m "feat(staff): «الخط العربي» بالقائمة عند المطرّز"
```
PROGRESS entry must say: DST is verified on a machine ONLY when محمد عماد stitches one file on a test piece; until then coverage < 0.95 = «افتح هذا أولاً».

---

# Track 1 — البصمة: see every punch, repair with one tap

### Task 1.1: Measure production before building (read-only)

**Files:** none changed. Output goes into the spec's «What the code says today → 1» as a dated paragraph.

- [ ] **Step 1: Find the app on the box**

Run: `ssh revo 'pm2 jlist | node -e "let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>JSON.parse(s).forEach(p=>console.log(p.name,p.pm2_env.pm_cwd)))"'`
Expected: a line naming the API process and its `backend/` directory. (If SSH hangs >20 s, the laptop's VPN/network is the issue — do not retry more than twice; ask the owner.)

- [ ] **Step 2: Run the punch-sequence report (SELECT only)**

Save on the box as `/tmp/att-report.js` inside that `backend/` directory and run `node /tmp/att-report.js`:

```js
require('dotenv').config();
const { query } = require('./lib/db');
(async () => {
  const seq = await query(`
    SELECT COALESCE(u.name, 'رقم ' || p.device_pin) AS who,
           to_char(p.punched_at AT TIME ZONE 'Asia/Baghdad', 'MM-DD') AS d,
           string_agg(to_char(p.device_ts, 'HH24:MI') || ' ' || COALESCE(p.ignored_reason, '✓'), ' | ' ORDER BY p.device_ts) AS seq
      FROM punch_raw p LEFT JOIN users u ON u.id = p.user_id
     WHERE p.punched_at > NOW() - INTERVAL '14 days'
     GROUP BY 1, 2 ORDER BY 2, 1`);
  console.table(seq.rows);
  const reasons = await query(`SELECT COALESCE(ignored_reason,'(applied)') r, COUNT(*)::int n FROM punch_raw WHERE punched_at > NOW() - INTERVAL '14 days' GROUP BY 1 ORDER BY 2 DESC`);
  console.table(reasons.rows);
  const days = await query(`
    SELECT to_char(r.work_date,'MM-DD') d, COUNT(*)::int recs, COUNT(r.check_out_at)::int outs,
           COUNT(*) FILTER (WHERE r.status='overridden')::int overridden,
           (SELECT COUNT(*) FROM staff_attendance_breaks b WHERE b.work_date=r.work_date AND b.state='out')::int open_breaks,
           (SELECT COUNT(*) FROM staff_attendance_breaks b WHERE b.work_date=r.work_date AND b.auto_closed)::int auto_closed
      FROM staff_attendance_records r WHERE r.work_date > CURRENT_DATE - 14 GROUP BY r.work_date ORDER BY 1`);
  console.table(days.rows);
  const collapse = await query(`
    SELECT to_char(punched_at AT TIME ZONE 'Asia/Baghdad','MM-DD HH24:MI') arrived, COUNT(*)::int n,
           MIN(device_ts)::text first_device, MAX(device_ts)::text last_device
      FROM punch_raw WHERE punched_at > NOW() - INTERVAL '14 days'
     GROUP BY 1 HAVING COUNT(*) >= 3 ORDER BY 1`);
  console.table(collapse.rows); // a row here = a batch that collapsed onto one arrival minute
  process.exit(0);
})();
```

- [ ] **Step 3: Write the finding**

In the spec, under §1, add «Measured on prod YYYY-MM-DD:» with the four tables and ONE sentence naming which trap(s) produced the wrong screen (early-departure break · cooldown · midnight · batch collapse · unmapped pin). If `collapse` is empty, Task 1.4 is skipped — say so.

### Task 1.2: `GET /admin/attendance/punches` — the raw punches of a shop-day

**Files:**
- Modify: `backend/controllers/attendanceDeviceController.js` (add `listPunches`, export it)
- Modify: `backend/routes/admin.js:104` (add route)
- Test: `backend/test/attendanceDeviceAdmin.test.js` (append)

**Interfaces:**
- Produces: `GET /api/admin/attendance/punches?date=YYYY-MM-DD[&user_id=]` → `{ data: Punch[] }`, `Punch = { id, device_ts, punched_at, device_pin, user_id, staff_name, attendance_id, ignored_reason, meaning }`, `meaning ∈ 'in'|'out'|'break_out'|'break_back'|'duplicate'|'unmapped'|'ignored'`.

- [ ] **Step 1: Failing test** (append to `attendanceDeviceAdmin.test.js`, reusing that file's fixture helpers and `mockRes`)

```js
test('punches: a day lists every raw punch with what it meant', async () => {
  // fixture: one mapped worker, 4 punches (in, break out, break back, out) via the file's ingest helper,
  // plus one punch from an unmapped pin on the same day.
  const res = await call(devices.listPunches, { user: ctx.admin, query: { date: ctx.workDate } });
  assert.equal(res.statusCode, 200);
  const rows = res.body.data;
  assert.deepEqual(rows.filter((r) => r.user_id === ctx.workerId).map((r) => r.meaning),
    ['in', 'break_out', 'break_back', 'out']);
  assert.equal(rows.find((r) => r.user_id == null).meaning, 'unmapped');
  assert.ok(rows.every((r) => r.device_ts && r.punched_at));
});
```

- [ ] **Step 2: Run — expect `devices.listPunches is not a function`**

Run: `cd backend && node --test test/attendanceDeviceAdmin.test.js`

- [ ] **Step 3: Implement**

```js
// attendanceDeviceController.js
const dev = require('../lib/attendanceDevice');
const { localParts, DEFAULT_TZ } = require('../lib/shopTime');

// What a raw punch MEANT. attendance_id + no reason = it opened or closed a day; the two break
// reasons are edges, not errors; everything else is the reason text itself.
function meaningOf(p, rec) {
  if (p.user_id == null) return 'unmapped';
  if (p.ignored_reason === dev.REASON_BREAK_START) return 'break_out';
  if (p.ignored_reason === dev.REASON_BREAK_END) return 'break_back';
  if (p.ignored_reason === dev.REASON_TOO_SOON) return 'duplicate';
  if (p.ignored_reason) return 'ignored';
  if (rec && rec.check_in_at && new Date(rec.check_in_at).getTime() === new Date(p.punched_at).getTime()) return 'in';
  if (rec && rec.check_out_at && new Date(rec.check_out_at).getTime() === new Date(p.punched_at).getTime()) return 'out';
  return rec ? 'out' : 'in';
}

/** GET /admin/attendance/punches?date=&user_id= — every raw punch of one shop-day. */
async function listPunches(req, res) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query?.date || ''))
    ? String(req.query.date) : localParts(new Date(), DEFAULT_TZ).date;
  const params = [date];
  let userClause = '';
  if (req.query?.user_id) { params.push(String(req.query.user_id)); userClause = `AND p.user_id = $${params.length}`; }
  const { rows } = await query(
    `SELECT p.id, p.device_ts, p.punched_at, p.device_pin, p.user_id, p.attendance_id, p.ignored_reason,
            u.name AS staff_name, r.check_in_at, r.check_out_at
       FROM punch_raw p
       LEFT JOIN users u ON u.id = p.user_id
       LEFT JOIN staff_attendance_records r ON r.id = p.attendance_id
      WHERE (r.work_date = $1 OR (p.attendance_id IS NULL AND (p.punched_at AT TIME ZONE 'Asia/Baghdad')::date = $1))
        ${userClause}
      ORDER BY p.punched_at ASC, p.id ASC`,
    params
  );
  res.json({ data: rows.map((p) => ({
    id: p.id, device_ts: p.device_ts, punched_at: p.punched_at, device_pin: p.device_pin,
    user_id: p.user_id, staff_name: p.staff_name, attendance_id: p.attendance_id,
    ignored_reason: p.ignored_reason,
    meaning: meaningOf(p, p.attendance_id ? { check_in_at: p.check_in_at, check_out_at: p.check_out_at } : null),
  })) });
}
```
Export `REASON_BREAK_START`, `REASON_BREAK_END`, `REASON_TOO_SOON` from `lib/attendanceDevice.js` if they are not already in its `module.exports`. Route: `router.get('/attendance/punches', devices.listPunches);`.

- [ ] **Step 4: Run tests** — `node --test test/attendanceDeviceAdmin.test.js test/attendanceDevice.test.js test/iclockRoute.test.js` → all pass.

- [ ] **Step 5: Commit** — `git commit -m "feat(attendance): الأدمن يشوف كل بصمة وصلت وشنو معناها"`

### Task 1.3: The day table shows punches, missing exits, and works on a phone

**Files:**
- Modify: `frontend/lib/admin.ts` (add `getAttendancePunches(date, userId?)` + `AttendancePunch` type in `lib/types.ts`)
- Modify: `frontend/app/admin/attendance/page.tsx:480-560` (day table), header area near the date picker
- Create: `frontend/components/admin/AttendancePunchList.tsx`

- [ ] **Step 1: API wrapper**

```ts
// lib/types.ts
export type PunchMeaning = "in" | "out" | "break_out" | "break_back" | "duplicate" | "unmapped" | "ignored";
export interface AttendancePunch {
  id: number; deviceTs: string; punchedAt: string; devicePin: string;
  userId: string | null; staffName: string | null; attendanceId: string | null;
  ignoredReason: string | null; meaning: PunchMeaning;
}
// lib/admin.ts
export async function getAttendancePunches(date: string, userId?: string): Promise<AttendancePunch[]> {
  const { data } = await api.get<{ data: Record<string, unknown>[] }>("/admin/attendance/punches", { params: { date, user_id: userId } });
  return (data.data ?? []).map((r) => ({
    id: Number(r.id), deviceTs: String(r.device_ts), punchedAt: String(r.punched_at), devicePin: String(r.device_pin),
    userId: (r.user_id as string) ?? null, staffName: (r.staff_name as string) ?? null,
    attendanceId: (r.attendance_id as string) ?? null, ignoredReason: (r.ignored_reason as string) ?? null,
    meaning: r.meaning as PunchMeaning,
  }));
}
```

- [ ] **Step 2: The punch list component**

```tsx
// components/admin/AttendancePunchList.tsx
"use client";
import type { AttendancePunch, PunchMeaning } from "@/lib/types";
const MEANING: Record<PunchMeaning, { label: string; cls: string }> = {
  in:         { label: "دخول",          cls: "text-emerald-700" },
  out:        { label: "خروج",          cls: "text-ink" },
  break_out:  { label: "خروج مؤقت",     cls: "text-amber-700" },
  break_back: { label: "عودة",          cls: "text-amber-700" },
  duplicate:  { label: "مكررة (٥ دقائق)", cls: "text-muted" },
  unmapped:   { label: "رقم بدون موظف", cls: "text-danger" },
  ignored:    { label: "مهملة",         cls: "text-muted" },
};
const T = new Intl.DateTimeFormat("ar-IQ", { timeZone: "Asia/Baghdad", hour: "numeric", minute: "2-digit" });
export function AttendancePunchList({ punches }: { punches: AttendancePunch[] }) {
  if (!punches.length) return <p className="py-2 text-xs text-muted">ما وصلت بصمات لهذا اليوم.</p>;
  return (
    <ol className="divide-y divide-line text-xs">
      {punches.map((p) => (
        <li key={p.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5">
          <span className="w-14 tabular-nums text-ink">{T.format(new Date(p.deviceTs))}</span>
          <span className={`font-semibold ${MEANING[p.meaning].cls}`}>{MEANING[p.meaning].label}</span>
          {p.ignoredReason && !["break_out", "break_back"].includes(p.meaning) && (
            <span className="text-muted">{p.ignoredReason}</span>
          )}
          {/* the server clock, only when it disagrees with the device by > 2 min — the batch-collapse tell */}
          {Math.abs(new Date(p.punchedAt).getTime() - new Date(p.deviceTs).getTime()) > 120_000 && (
            <span className="text-danger">وصلت للسيرفر {T.format(new Date(p.punchedAt))}</span>
          )}
        </li>
      ))}
    </ol>
  );
}
```
(`device_ts` is a naive timestamp; the API returns it as ISO without zone — format it with `timeZone: "UTC"` if `new Date()` shifts it. Check one value against the K40 display before shipping.)

- [ ] **Step 3: Wire into the day view**

In `page.tsx`: fetch punches with `getAttendancePunches(date)` alongside `records` in the same `Promise.all`; group by `userId`. Under each record row add a chevron «البصمات (n)» that toggles an `AttendancePunchList` row. Above the table print `بصمات بدون موظف: {count}` as a link to the device tab when `> 0`. For a record with `checkInAt && !checkOutAt` show the existing status cell as «ما سجّل خروج» and a button «اعتبر آخر بصمة خروج» that calls the existing `PATCH /admin/attendance/records/:id/override` with `check_out_at` = that worker's LAST punch `punchedAt` for the day (read `overrideRecord` at `attendanceController.js:794-835` for the exact body keys — send only those it reads). Toast the result and reload.

- [ ] **Step 4: Phone layout**

Wrap the `<table>` in `hidden md:block`; add a `md:hidden space-y-3` list rendering each record as a card: name (bold) · «دخول 9:05 · خروج —» · «تأخير 12 د» · status pill · the punch toggle · the action button full-width. Tap targets ≥ 44 px (`min-h-11`).

- [ ] **Step 5: Verify** (Claude in Chrome, admin login, local copy, dates 2026-08-29/30) at 390×844 and 1280×800: rows expand, meanings match the K40's sequence, the missing-exit button appears on 2026-08-30 rows and works (reload shows خروج filled and status «معدَّل من الإدارة»). Screenshot each.

- [ ] **Step 6: `tsc` + lint + commit** — `git commit -m "feat(admin): جدول البصمة يعرض البصمات الخام ويشتغل على التلفون، وخروج ناقص ينصلح بضغطة"`

### Task 1.4 (only if Task 1.1 found batch collapses): «اعتمد وقت الجهاز»

**Files:**
- Modify: `backend/controllers/attendanceController.js` (add `useDeviceTime`), `backend/routes/admin.js`
- Test: `backend/test/attendanceDeviceAdmin.test.js`

- [ ] **Step 1: Failing test** — a record whose two applied punches carry `device_ts` 09:00/17:00 but `punched_at` 20:55/20:55; after `POST /admin/attendance/records/:id/use-device-time` the record's `check_in_at`/`check_out_at` equal the device instants in Asia/Baghdad, `late_minutes` is recomputed via `lib/staffSchedule.lateMinutesFor`, `status = 'overridden'`, `overridden_by = admin`, `admin_note_ar` starts with «اعتُمد وقت الجهاز».

- [ ] **Step 2: Implement** — load the record's applied punches (`attendance_id = $1 AND ignored_reason IS NULL ORDER BY device_ts`), first = in, last = out (only if ≥ 2), convert `device_ts` with `(device_ts AT TIME ZONE 'Asia/Baghdad')` in SQL, recompute lateness with the SAME function `checkIn` uses, write inside `tx`, audit_log action `attendance_use_device_time`. Refuse (409) when the record is already `overridden` unless `?force=1`.

- [ ] **Step 3: Route + FE button** «اعتمد وقت الجهاز» beside the punch list, shown only when any punch shows the red «وصلت للسيرفر» tell.

- [ ] **Step 4: Tests pass, commit** — `git commit -m "feat(attendance): «اعتمد وقت الجهاز» يصلّح يوم انضغطت بصماته بدفعة وحدة"`

---

# Track 4 — النشاط والحركات usable

### Task 4.1: Reproduce in a browser first

- [ ] **Step 1:** Local dev servers + local DB copy; set a temp password (Task 2A.3 step 5 recipe) for برزان and for the admin account if unknown.
- [ ] **Step 2:** Claude in Chrome at 390×844 — admin → `/staff/team` → برزان → «الراتب والنشاط»; برزان → `/staff/me`; a workshop worker → `/workshop` (portal login via `STAFF_PORTAL_KEY` — see `workshopController.portalLogin`). Screenshot each.
- [ ] **Step 3:** In PROGRESS.md, list every concrete defect seen (raw keys, missing names, 403, cut at 8, flat 200-row wall, anything else). Tasks 4.2–4.4 fix the known ones; add a step for anything new.

### Task 4.2: One activity builder for both screens

**Files:**
- Create: `backend/lib/staffActivity.js`
- Modify: `backend/controllers/salaryController.js:355-426` (both handlers call the builder)
- Test: `backend/test/staffActivity.test.js`

**Interfaces:**
- Produces: `activityFor(userId, { month?: 'YYYY-MM', limit?: number }) → Row[]`, `Row = { id, source: 'stage'|'audit', action, from_stage, to_stage, zone, created_at, order_id, product_name, student_name }`.
- Both endpoints accept `?month=YYYY-MM` (default: current month, Asia/Baghdad) and return `{ data: Row[], meta: { month } }`.

- [ ] **Step 1: Failing test**

```js
// backend/test/staffActivity.test.js
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { query } = require('../lib/db');
const { activityFor } = require('../lib/staffActivity');
const TAG = `ZZTEST-act-${crypto.randomUUID().slice(0, 8)}`;
const fx = { users: [], orders: [] };
// setup: one staff user (deleted_at-stamped like embroideryChecklistGate.test.js), one retail
// student + order (copy that file's fixture SQL), then:
//   INSERT staff_activity_log (user_id, action, order_id, from_stage, to_stage) 'advance' embroidery→pressing
//   INSERT audit_log (actor_id, action, entity, entity_id, details) 'embroidery_zone' {zone:'sash_back',done:true}
test('1. both kinds of work come back, newest first, with names', async () => {
  const rows = await activityFor(fx.staffId, {});
  assert.deepEqual(rows.map((r) => r.action), ['embroidery_zone', 'advance']);
  assert.equal(rows[0].zone, 'sash_back');
  assert.equal(rows[1].product_name, fx.productName);
  assert.equal(rows[1].student_name, `${TAG}-student`);
});
test('2. month filter excludes another month', async () => {
  const rows = await activityFor(fx.staffId, { month: '2020-01' });
  assert.equal(rows.length, 0);
});
test('3. bad month → throws ERR_VALIDATION', async () => {
  await assert.rejects(() => activityFor(fx.staffId, { month: '2020-13' }), /ERR_VALIDATION/);
});
test('cleanup', async () => { /* delete fixture rows by TAG, inside this file */ });
```

- [ ] **Step 2: Run — expect module not found.**

- [ ] **Step 3: Implement**

```js
// backend/lib/staffActivity.js
'use strict';
// One query behind «النشاط» on /staff/team (admin) and /staff/me (the worker). Two sources,
// because the embroiderer's real work is zone ticks in audit_log, not stage moves.
const { query } = require('./db');
const { localParts, DEFAULT_TZ } = require('./shopTime');
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthBounds(month) {
  const key = month || localParts(new Date(), DEFAULT_TZ).date.slice(0, 7);
  if (!MONTH_RE.test(key)) { const e = new Error('شهر غير صالح'); e.code = 'ERR_VALIDATION'; throw e; }
  const [y, m] = key.split('-').map(Number);
  const from = `${key}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { key, from, next };
}

async function activityFor(userId, { month, limit = 500 } = {}) {
  const { key, from, next } = monthBounds(month);
  const { rows } = await query(
    `WITH src AS (
       SELECT sal.id::text AS id, 'stage' AS source, sal.action, sal.from_stage::text AS from_stage,
              sal.to_stage::text AS to_stage, NULL::text AS zone, sal.created_at, sal.order_id
         FROM staff_activity_log sal
        WHERE sal.user_id = $1
       UNION ALL
       SELECT al.id::text, 'audit', al.action, NULL, NULL, al.details->>'zone', al.created_at, al.entity_id::uuid
         FROM audit_log al
        WHERE al.actor_id = $1 AND al.entity = 'order'
          AND al.action IN ('embroidery_zone', 'tailor_complete', 'tailor_reopen', 'return_to_customer')
     )
     SELECT s.*, p.name_ar AS product_name, u.name AS student_name
       FROM src s
       LEFT JOIN orders o ON o.id = s.order_id
       LEFT JOIN products p ON p.id = o.product_id
       LEFT JOIN students st ON st.id = o.student_id
       LEFT JOIN users u ON u.id = st.user_id
      WHERE (s.created_at AT TIME ZONE 'Asia/Baghdad') >= $2::timestamp
        AND (s.created_at AT TIME ZONE 'Asia/Baghdad') <  $3::timestamp
      ORDER BY s.created_at DESC
      LIMIT $4`,
    [userId, from, next, limit]
  );
  return rows.map((r) => ({ ...r, month: key }));
}
module.exports = { activityFor, monthBounds };
```
Check `audit_log.entity_id`'s column type in `db/schema.sql` before writing the `::uuid` cast (drop the cast if it is already uuid). `salaryController.getStaffActivity`/`getMyActivity` become: resolve user → `try { rows = await activityFor(id, { month: req.query.month }) } catch (e) { if (e.code === 'ERR_VALIDATION') return res.status(400).json({ error: e.message, code: e.code }); throw e; }` → `res.json({ data: rows, meta: { month: rows[0]?.month ?? monthBounds(req.query.month).key } })`.

- [ ] **Step 4: Tests pass** — `node --test test/staffActivity.test.js test/payrollSummary.test.js test/payrollStatement.test.js`.

- [ ] **Step 5: Commit** — `git commit -m "fix(payroll): سجل النشاط صار يشمل التطريز والفصال ويتصفّى بالشهر"`

### Task 4.3: One `ActivityList` component, Arabic everywhere, grouped by day

**Files:**
- Modify: `frontend/lib/constants.ts` (add `ACTIVITY_ACTION_LABELS`, `ZONE_LABELS`)
- Modify: `frontend/lib/types.ts:496-503` (`StaffActivity` gains `productName`, `studentName`, `zone`, `source`)
- Modify: `frontend/lib/admin.ts:1938-1957` (map the new fields; accept `month`)
- Modify: `frontend/lib/staff.ts:1394-1416` (accept `month`; same row shape → `MyActivityRow` becomes an alias of `StaffActivity`)
- Create: `frontend/components/staff/ActivityList.tsx`
- Modify: `frontend/app/staff/team/page.tsx:419-436`, `frontend/app/staff/me/page.tsx:87-98, 237-262`

- [ ] **Step 1: Labels**

```ts
// lib/constants.ts
export const ACTIVITY_ACTION_LABELS: Record<string, string> = {
  advance: "قدّم مرحلة",
  revert: "رجّع مرحلة",
  advance_shawl: "قدّم الشال",
  revert_shawl: "رجّع الشال",
  approve_design: "اعتمد التصميم",
  reject_design: "رفض التصميم",
  claim: "بدأ الشغل",
  embroidery_zone: "طرّز منطقة",
  tailor_complete: "أنهى الفصال",
  tailor_reopen: "رجّع الفصال",
  return_to_customer: "رجّعها للطالب",
  route_fix: "تصحيح مسار آلي",
};
export const ZONE_LABELS: Record<string, string> = {
  sash_right: "الوشاح — جهة الاسم", sash_left: "الوشاح — جهة السنة", sash_back: "الوشاح — من الخلف",
  sash_front: "الوشاح — من الأمام", cap_top: "القبعة — من الأعلى", cap_side: "القبعة — من الجانب",
  robe_sleeve_right: "الروب — الردن الأيمن", robe_sleeve_left: "الروب — الردن الأيسر",
};
```

- [ ] **Step 2: The component**

```tsx
// components/staff/ActivityList.tsx
"use client";
import Link from "next/link";
import { ACTIVITY_ACTION_LABELS, ORDER_STATUS_LABELS, ZONE_LABELS } from "@/lib/constants";
import type { StaffActivity } from "@/lib/types";
const DAY = new Intl.DateTimeFormat("ar-IQ", { timeZone: "Asia/Baghdad", weekday: "long", day: "numeric", month: "long" });
const TIME = new Intl.DateTimeFormat("ar-IQ", { timeZone: "Asia/Baghdad", hour: "numeric", minute: "2-digit" });
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Baghdad" });
export function ActivityList({ rows, linkOrders = true }: { rows: StaffActivity[]; linkOrders?: boolean }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-ink-soft">ما في نشاط بهذا الشهر.</p>;
  const groups = new Map<string, StaffActivity[]>();
  for (const r of rows) { const k = dayKey(r.createdAt); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(r); }
  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([k, list]) => (
        <section key={k}>
          <h3 className="mb-1 text-xs font-semibold text-muted">{DAY.format(new Date(list[0].createdAt))} · {list.length}</h3>
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {list.map((a) => {
              const verb = ACTIVITY_ACTION_LABELS[a.action] ?? a.action;
              const detail = a.zone ? ZONE_LABELS[a.zone] ?? a.zone
                : a.fromStage && a.toStage ? `${ORDER_STATUS_LABELS[a.fromStage]} ← ${ORDER_STATUS_LABELS[a.toStage]}` : null;
              const body = (
                <div className="flex min-h-11 items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className={`text-sm font-medium ${a.action.startsWith("revert") ? "text-danger" : "text-ink"}`}>
                      {verb}{a.productName ? ` — ${a.productName}` : ""}{a.studentName ? ` · ${a.studentName}` : ""}
                    </p>
                    {detail && <p className="truncate text-xs text-ink-soft">{detail}</p>}
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted">{TIME.format(new Date(a.createdAt))}</span>
                </div>
              );
              return <li key={a.id}>{linkOrders && a.orderId ? <Link href={`/staff/orders/${a.orderId}`}>{body}</Link> : body}</li>;
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Use it** — team page: replace the «النشاط الأخير» block with a month `<Select>` (this month + previous 5) and `<ActivityList rows={activity} />`; drop `slice(0, 8)`; «سجل المعاملات» gets a «عرض الكل» toggle instead of `slice(0, 10)`. Me page: replace its list with `<ActivityList rows={activity} />` and the same month select; delete the local `ACTION_LABELS`/`stageLabel`.

- [ ] **Step 4: `tsc` + lint + browser check** (both pages at 390×844: Arabic verbs, names, day headers, month switch reloads).

- [ ] **Step 5: Commit** — `git commit -m "fix(staff): النشاط يقرأ بالعربي، مجمّع باليوم، وبأسماء الطلاب والقطع"`

### Task 4.4: Managers can read what the sidebar offers them (D8)

**Files:**
- Modify: `backend/routes/staff.js` (add three GET routes under `requireStaffType('manager')`)
- Modify: `frontend/lib/admin.ts` (`getStaffSalary`, `getStaffActivity`, `getStaffGoal` pick `/admin/...` for admin, `/staff/...` for staff)
- Test: `backend/test/staffActivity.test.js` (append: manager 200, presser 403 on the staff route via the route's guard function)

- [ ] **Step 1:** Read `routes/staff.js` head to see its `router.use(...)` guard and `requireStaffType` import; add
```js
// «الموظفون» is offered to managers by the sidebar; these are the READ half of /admin/staff/:id/*.
router.get('/team/:id/salary', requireStaffType('manager'), salary.getStaffSalary);
router.get('/team/:id/activity', requireStaffType('manager'), salary.getStaffActivity);
router.get('/team/:id/goal', requireStaffType('manager'), salary.getStaffGoal);
```
- [ ] **Step 2:** In `admin.ts` add `const teamBase = () => (getCurrentUser()?.role === "admin" ? "/admin/staff" : "/staff/team");` (use whatever helper the file already uses to read the cached user; if none, read `localStorage` the same way `lib/api.ts` reads the token) and use it in the three getters. Writes keep `/admin/staff`.
- [ ] **Step 3:** Browser check as a manager (give a manager a temp password on the local copy): panel loads, write buttons (bonus/deduction/salary) hidden for non-admin — add `isAdmin &&` around them in `team/page.tsx` if they are not already gated.
- [ ] **Step 4:** Commit — `git commit -m "fix(staff): المدير يكدر يقرأ راتب ونشاط الموظف بدل ما تطلع «تعذر تحميل»"`

---

# Track 3 — «منو اشتغل عليها» on every piece, for everyone

### Task 3.1: Shawl reverts are logged like shawl advances

**Files:**
- Modify: `backend/controllers/productionController.js:1614-1626` (inside the shawl branch of `revert`), `:979` (getOrder filter), `:1270-1285` (`shawlOrderDetail`'s `hist` query)
- Test: `backend/test/shawlPiece.test.js` (extend test 8)

- [ ] **Step 1: Failing test** — after `revert` on a shawl piece, `staff_activity_log` has a row `action='revert_shawl'` with the CARRIER's order_id, and the carrier's `getOrder.stage_history` does NOT include it while the shawl's own detail does.
- [ ] **Step 2: Implement** — in the shawl revert `tx`, after the audit_log insert:
```js
      await client.query(
        `INSERT INTO staff_activity_log (user_id, action, order_id, from_stage, to_stage)
         VALUES ($1, 'revert_shawl', $2, $3, $4)`,
        [req.user.id, piece.carrier_order_id, piece.status, back]
      );
```
`getOrder`: `AND sal.action NOT IN ('advance_shawl', 'revert_shawl')`. `shawlOrderDetail`'s history query: `AND sal.action IN ('advance_shawl', 'revert_shawl')`.
- [ ] **Step 3:** `node --test test/shawlPiece.test.js` → pass. Commit — `git commit -m "fix(production): «منو رجّع الشال» صار إله جواب"`.

### Task 3.2: The stage history becomes the piece's work log

**Files:**
- Modify: `backend/controllers/productionController.js:955-987` (`stageHistory` query + mapping; add `workers`)
- Modify: `frontend/lib/staff-types.ts` (`stage_history` row gains `kind`, `zone_label`, `done`; detail gains `workers: string[]`)
- Test: `backend/test/workLog.test.js`

**Interfaces:**
- Produces on `GET /production/orders/:id`: `stage_history: { kind: 'advance'|'revert'|'zone'|'tailor'|'return'|'design'|'route_fix', action, from_stage, to_stage, from_label, to_label, zone_label, done, staff_name, at }[]`, `workers: string[]` (distinct names, first-appearance order).

- [ ] **Step 1: Failing test** — fixture order; as embroiderer tick `sash_back`, as presser advance, as preparer revert; `getOrder` (as a plain `presser`, i.e. no money role) returns four entries in time order with kinds `zone, advance, revert` (+ `zone` again if the tick auto-advanced), `workers` = the three names in that order, and NO `price`/`phone` keys anywhere in the payload.
- [ ] **Step 2: Implement the query**

```js
  const stageHistory = await query(
    `SELECT 'stage' AS src, sal.action, sal.from_stage::text AS from_stage, sal.to_stage::text AS to_stage,
            NULL::jsonb AS details, sal.created_at, su.name AS staff_name
       FROM staff_activity_log sal LEFT JOIN users su ON su.id = sal.user_id
      WHERE sal.order_id = $1 AND sal.to_stage IS NOT NULL
        AND sal.action NOT IN ('advance_shawl', 'revert_shawl')
     UNION ALL
     SELECT 'audit', al.action, NULL, NULL, al.details, al.created_at, au.name
       FROM audit_log al LEFT JOIN users au ON au.id = al.actor_id
      WHERE al.entity = 'order' AND al.entity_id = $1
        AND al.action IN ('embroidery_zone', 'tailor_complete', 'tailor_reopen', 'return_to_customer')
     ORDER BY created_at ASC`,
    [id]
  );
  const ZONE_LABEL = Object.fromEntries(ZONE_DEFS.map((z) => [z.key, z.label]));
  const kindOf = (r) => r.action === 'advance' ? 'advance' : r.action === 'revert' ? 'revert'
    : r.action === 'embroidery_zone' ? 'zone' : r.action.startsWith('tailor_') ? 'tailor'
    : r.action === 'return_to_customer' ? 'return' : r.action === 'route_fix' ? 'route_fix'
    : /design/.test(r.action) ? 'design' : 'advance';
  const stage_history = stageHistory.rows.map((r) => ({
    kind: kindOf(r), action: r.action, from_stage: r.from_stage, to_stage: r.to_stage,
    from_label: r.from_stage ? (STATUS_LABEL_AR[r.from_stage] || r.from_stage) : null,
    to_label: r.to_stage ? (STATUS_LABEL_AR[r.to_stage] || r.to_stage) : null,
    zone_label: r.details?.zone ? (ZONE_LABEL[r.details.zone] || r.details.zone) : null,
    done: r.details?.done ?? null,
    staff_name: r.staff_name || null, at: r.created_at,
  }));
  const workers = [...new Set(stage_history.map((h) => h.staff_name).filter(Boolean))];
```
Add `workers` to the response beside `stage_history`. Match `audit_log.entity_id`'s type (`$1::text` if the column is TEXT).
- [ ] **Step 3:** Tests: new file + `test/shawlPiece.test.js` (its test 8 still passes). Commit — `git commit -m "feat(production): سجل القطعة يذكر كل واحد اشتغل عليها — تطريز، فصال، تقديم، إرجاع"`.

### Task 3.3: The card says what each person DID

**Files:**
- Modify: `frontend/app/staff/orders/[orderId]/page.tsx:699-750` (`StageHistoryCard`), `:1172` (pass `workers`)

- [ ] **Step 1:** Replace the `<li>` body:
```tsx
const VERB: Record<string, (h: HistoryRow) => string> = {
  advance: (h) => `قدّمها: ${h.from_label} ← ${h.to_label}`,
  revert: (h) => `رجّعها: ${h.from_label} ← ${h.to_label}`,
  zone: (h) => (h.done === false ? `ألغى تطريز ${h.zone_label}` : `طرّز ${h.zone_label}`),
  tailor: (h) => (h.action === "tailor_complete" ? "أنهى الفصال" : "رجّع الفصال"),
  return: () => "رجّعها للطالب",
  design: (h) => (h.action === "reject_design" ? "رفض التصميم" : "اعتمد التصميم"),
  route_fix: () => "تصحيح مسار آلي",
};
// li:
<span className={`font-semibold ${h.kind === "revert" ? "text-danger" : "text-ink"}`}>{(VERB[h.kind] ?? VERB.advance)(h)}</span>
<span className="text-ink-soft">{h.kind === "route_fix" ? "" : (h.staff_name ?? "غير معروف") + " · "}{formatStamp(h.at)}</span>
```
Keep the existing empty-state paragraph and the `route_fix` comment. Above the `<ol>`, when `workers.length`: `<p className="mt-2 text-xs text-ink">اشتغل عليها: {workers.join("، ")}</p>`.
- [ ] **Step 2:** `tsc`, browser check on one order with a revert (390×844): the revert line is red and says «رجّعها».
- [ ] **Step 3:** Commit — `git commit -m "feat(staff): بطاقة السجل تكول قدّمها لو رجّعها، ومنو طرّز شنو"`.

### Task 3.4: The list rows name the last mover and everyone who touched the piece

**Files:**
- Modify: `backend/controllers/productionController.js` `getQueue` (after the main SELECT, one batched query; add `last_move`, `workers` to each row — including the synthetic shawl rows via the carrier id + `*_shawl` actions)
- Modify: `frontend/lib/staff-types.ts` (`ProductionQueueItem` gains `last_move?: { staff_name, kind, from_label, to_label, at }`, `workers?: string[]`)
- Modify: `frontend/components/staff/OrderCard.tsx`, `frontend/components/staff/station/StationConsole.tsx` (piece sheet header)
- Test: `backend/test/queueStageScope.test.js` (append one assertion)

- [ ] **Step 1: Failing test** — after an `advance` by presser X, `getQueue` as a preparer returns that row with `last_move.staff_name === X.name`, `last_move.kind === 'advance'`, `workers` containing X.
- [ ] **Step 2: Implement** (after `rows` is known, before the money strip):
```js
  const ids = rows.map((r) => r.id);
  const moves = ids.length ? await query(
    `SELECT DISTINCT ON (sal.order_id) sal.order_id, sal.action, sal.from_stage::text AS from_stage,
            sal.to_stage::text AS to_stage, sal.created_at, su.name AS staff_name
       FROM staff_activity_log sal LEFT JOIN users su ON su.id = sal.user_id
      WHERE sal.order_id = ANY($1) AND sal.to_stage IS NOT NULL
        AND sal.action NOT IN ('advance_shawl', 'revert_shawl')
      ORDER BY sal.order_id, sal.created_at DESC`, [ids]) : { rows: [] };
  const crews = ids.length ? await query(
    `SELECT order_id, ARRAY_AGG(DISTINCT name) AS workers FROM (
       SELECT sal.order_id, su.name FROM staff_activity_log sal JOIN users su ON su.id = sal.user_id WHERE sal.order_id = ANY($1)
       UNION
       SELECT al.entity_id::uuid, au.name FROM audit_log al JOIN users au ON au.id = al.actor_id
        WHERE al.entity = 'order' AND al.entity_id::uuid = ANY($1) AND al.action = 'embroidery_zone'
     ) x GROUP BY order_id`, [ids]) : { rows: [] };
  const moveById = new Map(moves.rows.map((m) => [m.order_id, m]));
  const crewById = new Map(crews.rows.map((c) => [c.order_id, c.workers]));
  for (const r of rows) {
    const m = moveById.get(r.id);
    r.last_move = m ? { staff_name: m.staff_name, kind: m.action === 'revert' ? 'revert' : 'advance',
      from_label: STATUS_LABEL_AR[m.from_stage] || m.from_stage, to_label: STATUS_LABEL_AR[m.to_stage] || m.to_stage, at: m.created_at } : null;
    r.workers = crewById.get(r.id) || [];
  }
```
For shawl rows use the same shape with `action IN ('advance_shawl','revert_shawl')` keyed on the carrier id (add a second small query or extend `shawlPiece.toQueueRow`'s caller).
- [ ] **Step 3: Frontend** — `OrderCard`: one line under the status pill: `آخر نقلة: {name} {kind === "revert" ? "رجّعها" : "قدّمها"} {from} ← {to} · {time}` (revert in `text-danger`), and `اشتغل عليها: a، b` truncated to one line. Station sheet header: the same two lines under the student name.
- [ ] **Step 4:** Tests, `tsc`, browser (queue + station console at 390×844). Commit — `git commit -m "feat(staff): كل قطعة بالقائمة تكول منو آخر واحد نقلها ومنو اشتغل عليها"`.

---

# Track 2B — «التجميع» for rep pieces (D1–D4 confirmed by the owner first)

### Task 2B.1: Migration 103 — the stage and the role

**Files:**
- Create: `db/migrations/103_assembly_stage.sql`
- Modify: `db/schema.sql:52` (after the `converting` ADD VALUE), `:62` (after `tailor`)

- [ ] **Step 1: Write both**
```sql
-- Migration 103 — «التجميع» (2026-09-02). For a ممثل piece, التطريز produces SUB-PIECES
-- (وشاح من الخلف, وشاح من الأمام, …) that برزان sews into one garment before الكوي. The stage
-- sits between embroidery and pressing/preparing FOR REP PIECES ONLY (productionController
-- nextStageFor); a تجزئة piece never enters it. `assembler` (مجمّع) is the staff_type that
-- owns it — every line staff type may still see and move it (owner rule 2026-08-31).
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'assembly';
ALTER TYPE staff_type   ADD VALUE IF NOT EXISTS 'assembler';
```
Same two lines into `db/schema.sql` at the two enum blocks, each with a one-line comment pointing at migration 103.
- [ ] **Step 2: Apply locally** — `cd backend && npm run migrate:file ../db/migrations/103_assembly_stage.sql && npm run migrate` → both succeed; `node -e "…SELECT unnest(enum_range(NULL::order_status))"` lists `assembly`.
- [ ] **Step 3: Commit** — `git commit -m "feat(db): مرحلة التجميع ودور المجمّع (migration 103)"`.

### Task 2B.2: The state machine knows the stage

**Files:**
- Modify: `backend/controllers/orderController.js:31-113`
- Modify: `backend/controllers/productionController.js:70-99, 316-400, 1352-1395`
- Test: `backend/test/assemblyStage.test.js` (pure part), `backend/test/revertTarget.test.js`, `backend/test/viewerStages.test.js`, `backend/test/lineWideAccess.test.js`

**Interfaces:**
- Produces: `isRepPiece(order) → boolean` (exported), `nextStageFor`/`resolveRevertTarget` rep-aware, new keys in `ADVANCE_LABEL_AR`, `QUEUE_STAGES.assembler = ['assembly']`.

- [ ] **Step 1: Failing pure tests**
```js
// backend/test/assemblyStage.test.js (part 1 — pure)
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const { nextStageFor, resolveRevertTarget, ADVANCE_LABEL_AR } = require('../controllers/productionController');
const { canStaffTransition, TRANSITIONS } = require('../controllers/orderController');
const rep = (o) => ({ design_id: null, has_embroidery: true, needs_pressing: true, wholesaler_id: 'w1', ...o });
const retail = (o) => ({ design_id: null, has_embroidery: true, needs_pressing: true, wholesaler_id: null, ...o });
const staff = (t) => ({ role: 'staff', staff_type: t, staff_types: [t] });

test('1. a rep sash leaves التطريز for التجميع; a retail sash still goes to الكوي', () => {
  assert.equal(nextStageFor(rep({ status: 'embroidery' })), 'assembly');
  assert.equal(nextStageFor(retail({ status: 'embroidery' })), 'pressing');
  assert.equal(nextStageFor(retail({ status: 'embroidery', needs_pressing: false })), 'preparing');
});
test('2. after التجميع: الكوي if needs_pressing, else التجهيز (a cap)', () => {
  assert.equal(nextStageFor(rep({ status: 'assembly' })), 'pressing');
  assert.equal(nextStageFor(rep({ status: 'assembly', needs_pressing: false })), 'preparing');
});
test('3. revert lands where the piece came from', () => {
  assert.equal(resolveRevertTarget(rep({ status: 'pressing' })), 'assembly');
  assert.equal(resolveRevertTarget(rep({ status: 'preparing', needs_pressing: false })), 'assembly');
  assert.equal(resolveRevertTarget(rep({ status: 'assembly' })), 'embroidery');
  assert.equal(resolveRevertTarget(retail({ status: 'pressing' })), 'embroidery');
  assert.equal(resolveRevertTarget(rep({ status: 'pressing', has_embroidery: false })), null); // plain rep robe: الكوي is its first stage
});
test('4. every new edge is open to the line, closed to the designer-only rule', () => {
  for (const e of [['embroidery','assembly'],['assembly','pressing'],['assembly','preparing'],['assembly','embroidery'],['pressing','assembly'],['preparing','assembly']]) {
    assert.ok(TRANSITIONS[e[0]].includes(e[1]), e.join('→'));
    assert.equal(canStaffTransition(staff('assembler'), ...e), true, e.join('→'));
    assert.equal(canStaffTransition(staff('presser'), ...e), true, e.join('→'));
    assert.equal(canStaffTransition(staff('tailor'), ...e), false, e.join('→'));
  }
  assert.equal(canStaffTransition(staff('assembler'), 'design_complete', 'embroidery'), false);
});
test('5. labels exist for every new edge', () => {
  for (const k of ['embroidery→assembly', 'assembly→pressing', 'assembly→preparing']) assert.ok(ADVANCE_LABEL_AR[k], k);
});
```
- [ ] **Step 2: Run — expect failures on 1–5.**
- [ ] **Step 3: Implement**

`orderController.js`:
```js
const TRANSITIONS = {
  pending_approval: ['designing', 'cancelled'],
  designing: ['design_complete', 'cancelled'],
  design_complete: ['converting', 'embroidery', 'designing', 'cancelled'],
  converting: ['embroidery', 'design_complete', 'cancelled'],
  embroidery: ['assembly', 'pressing', 'preparing', 'design_complete', 'cancelled'],
  assembly: ['pressing', 'preparing', 'embroidery', 'cancelled'],
  pressing: ['preparing', 'assembly', 'cancelled'],
  preparing: ['ready', 'embroidery', 'pressing', 'assembly', 'cancelled'],
  ready: ['delivered', 'preparing', 'cancelled'],
  delivered: ['preparing'],
  cancelled: [],
  staff_review: ['embroidery', 'designing', 'cancelled'],
  printing: ['embroidery', 'pressing', 'cancelled'],
};
const LINE_STAFF = ['designer', 'digitizer', 'embroiderer', 'assembler', 'presser', 'preparer'];
// STAGE_AUTHZ — add:
  'embroidery→assembly': LINE_STAFF,
  'assembly→pressing': LINE_STAFF,
  'assembly→preparing': LINE_STAFF,
  'assembly→embroidery': LINE_STAFF,   // revert
  'pressing→assembly': LINE_STAFF,     // revert (rep piece)
  'preparing→assembly': LINE_STAFF,    // revert (rep cap — skipped الكوي)
// STATUS_LABEL_AR — add:
  assembly: 'قيد التجميع',
```
`productionController.js`:
```js
const QUEUE_STAGES = {
  designer: ['design_complete'], digitizer: ['converting'], embroiderer: ['embroidery'],
  assembler: ['assembly'],
  presser: ['pressing'], preparer: ['preparing', 'ready', 'delivered'],
  tailor: ['design_complete', 'converting', 'embroidery', 'assembly', 'pressing', 'preparing', 'ready'],
};
const LINE_VIEW_STAGES = ['converting', 'embroidery', 'assembly', 'pressing', 'preparing', 'ready', 'delivered'];
const MANAGER_STAGES = ['design_complete', 'converting', 'embroidery', 'assembly', 'pressing', 'preparing', 'ready'];

// A ممثل piece — the only kind that walks through التجميع (D2). Queue rows carry `source`,
// loadAdvanceRow/revert rows carry `wholesaler_id`; accept either so no caller has to change.
function isRepPiece(order) {
  return order.wholesaler_id != null || order.source === 'wholesaler';
}
// nextStageFor — replace the two cases:
    case 'embroidery':
      if (isRepPiece(order)) return 'assembly';
      return needs_pressing ? 'pressing' : 'preparing';
    case 'assembly':
      return needs_pressing ? 'pressing' : 'preparing';
// REVERT_MAP — add:
  assembly: 'embroidery',
// ADVANCE_LABEL_AR — add:
  'embroidery→assembly':        'إنهاء التطريز، نقل للتجميع',
  'assembly→pressing':          'إنهاء التجميع، نقل للكوي',
  'assembly→preparing':         'إنهاء التجميع، نقل للتجهيز',
// resolveRevertTarget — whole body:
function resolveRevertTarget(order) {
  const plain = !order.design_id && !order.has_embroidery;
  const rep = isRepPiece(order);
  if (order.status === 'preparing') {
    if (order.needs_pressing) return 'pressing';
    if (plain) return null;
    return rep ? 'assembly' : REVERT_MAP.preparing;
  }
  if (order.status === 'pressing') {
    if (plain) return null;
    return rep ? 'assembly' : REVERT_MAP.pressing;
  }
  return REVERT_MAP[order.status] ?? null;
}
```
In `applyZoneTick`, right after the `UPDATE orders SET embroidery_zones …` query add `emitOrderChanged(id, 'embroidery');` so the assembly board refreshes on every tick, not only on auto-advance. Export `isRepPiece`.
Update the header comment of `resolveRevertTarget` with one line: «rep pieces came through التجميع (2026-09-02), so that is what sits before الكوي for them — a legacy rep piece that never visited it still reverts there and simply shows on برزان's board as fully arrived».

- [ ] **Step 4: Update the three existing test files** — `viewerStages.test.js`: assembler → `['assembly']`; `lineWideAccess.test.js`: include the six new edges in its «every non-design edge is LINE_STAFF» loop; `revertTarget.test.js`: existing cases unchanged (they are retail — `wholesaler_id` undefined → `isRepPiece` false).
- [ ] **Step 5: Run** — `node --test test/assemblyStage.test.js test/revertTarget.test.js test/viewerStages.test.js test/lineWideAccess.test.js test/queueStageScope.test.js test/embroideryChecklistGate.test.js test/repApprovalAdvanceGate.test.js` → all pass.
- [ ] **Step 6: Commit** — `git commit -m "feat(production): قطعة الممثل تطلع من التطريز للتجميع، وترجع إله"`.

### Task 2B.3: Every other status list learns the stage

**Files:**
- Modify: `backend/controllers/staffController.js:8` (`COMPLETED_STATUSES` += `'assembly'` after `'embroidery'`)
- Modify: `backend/controllers/adminController.js:545`, `backend/controllers/wholesalerController.js:122`, `backend/controllers/orderEditController.js:491` (each status list += `'assembly'`)
- Modify: `backend/lib/shelf.js:31` (`assembly: 'في التجميع'`), `backend/lib/supportContext.js:29` (`assembly: 'قيد التجميع'`)
- Modify: `backend/controllers/tvBoardController.js:22` (`MANAGER_STAGES` += `'assembly'` after `'embroidery'`)

- [ ] **Step 1:** Apply the seven edits. `grep -rn "'embroidery', 'pressing'" backend/` must return only lines that now also carry `'assembly'`.
- [ ] **Step 2:** `node --test test/*.test.js` → same pass count as before + the new file (note the two known flaky failures in HANDOFF).
- [ ] **Step 3:** Commit — `git commit -m "chore(production): كل قائمة مراحل بالسيرفر تعرف التجميع"`.

### Task 2B.4: The assembly board endpoint

**Files:**
- Modify: `backend/controllers/productionController.js` (add `getAssemblyBoard`, export), `backend/routes/production.js` (`router.get('/assembly', c.getAssemblyBoard);`)
- Test: `backend/test/assemblyStage.test.js` (part 2 — DB)

**Interfaces:**
- Produces: `GET /api/production/assembly` → `{ data: { arriving: BoardRow[], ready: BoardRow[] } }`, `BoardRow = { id, status, student_id, student_name, wholesaler_name, batch_name, deadline, checkout_group_id, product_name, product_type, needs_pressing, zones: {key,label,done}[], done_count, total_count, can_advance, advance_label }`. Money and phone never present.

- [ ] **Step 1: Failing DB test** — rep student (approved, `wholesaler_id` set) with a sash carrying `sash_back` + `sash_front` lines. As embroiderer: tick `sash_back` → order still `embroidery`; board `arriving` has it with `done_count 1 / total_count 2`; tick `sash_front` → order `assembly`; board `ready` has it, `can_advance true`, `advance_label` «إنهاء التجميع، نقل للكوي». As assembler: `advance` → `pressing`. As presser: `revert` → `assembly`. A RETAIL sash with the same two ticks → `pressing` and never on the board. An UNAPPROVED rep sash never appears. Retire fixtures in the same file.
- [ ] **Step 2: Implement**
```js
// ---------- «التجميع» board — sub-pieces arriving, garments ready to sew ----------
// Reads status + embroidery_zones; never derives status (D1). A rep piece is «arriving» from
// its first ticked zone and «ready» once its status is 'assembly'.
async function getAssemblyBoard(req, res) {
  const u = req.user;
  if (!(isManager(u) || staffTypesOf(u).some((t) => LINE_STAFF.includes(t)))) {
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  }
  const { rows } = await query(
    `SELECT o.id, o.status::text AS status, o.needs_pressing, o.embroidery_zones, o.checkout_group_id,
            o.design_id, o.has_embroidery, o.wholesaler_approval, o.returned_to_customer,
            s.id AS student_id, s.wholesaler_id, u.name AS student_name,
            p.name_ar AS product_name, p.type::text AS product_type,
            w.name AS wholesaler_name, b.name AS batch_name, b.deadline
       FROM orders o
       JOIN students s ON s.id = o.student_id
       JOIN users u ON u.id = s.user_id
       JOIN products p ON p.id = o.product_id
       LEFT JOIN wholesalers w ON w.id = s.wholesaler_id
       LEFT JOIN batches b ON b.id = s.batch_id
      WHERE s.wholesaler_id IS NOT NULL
        AND o.wholesaler_approval = 'approved' AND o.returned_to_customer = FALSE
        AND (o.status::text = 'assembly'
             OR (o.status::text = 'embroidery'
                 AND EXISTS (SELECT 1 FROM jsonb_each_text(COALESCE(o.embroidery_zones, '{}'::jsonb)) z WHERE z.value = 'true')))
      ORDER BY b.deadline ASC NULLS LAST, u.name ASC, p.type ASC`
  );
  // Copy the exact wholesalers/batches JOIN + column names from getQueue if they differ.
  const progressById = new Map(rows.map((r) => [r.id, r.embroidery_zones || {}]));
  const zonesById = await detectZonesForOrders(rows.map((r) => r.id), progressById);
  const out = { arriving: [], ready: [] };
  for (const r of rows) {
    const zones = (zonesById.get(r.id) || []).map(({ key, label, done }) => ({ key, label, done }));
    const to = nextStageFor(r);
    const ready = r.status === 'assembly';
    out[ready ? 'ready' : 'arriving'].push({
      id: r.id, status: r.status, student_id: r.student_id, student_name: r.student_name,
      wholesaler_name: r.wholesaler_name, batch_name: r.batch_name, deadline: r.deadline,
      checkout_group_id: r.checkout_group_id, product_name: r.product_name, product_type: r.product_type,
      needs_pressing: !!r.needs_pressing, zones,
      done_count: zones.filter((z) => z.done).length, total_count: zones.length,
      can_advance: ready && !!to && canStaffTransition(u, 'assembly', to),
      advance_label: ready && to ? (ADVANCE_LABEL_AR[`assembly→${to}`] ?? null) : null,
    });
  }
  res.json({ data: out });
}
```
- [ ] **Step 3:** Tests pass; `curl` the route as an assembler token on the local copy and eyeball one row (no `price`, no `phone`).
- [ ] **Step 4:** Commit — `git commit -m "feat(production): لوحة التجميع — القطع الواصلة والجاهزة للخياطة"`. Add the endpoint to `API.md`.

### Task 2B.5: Frontend types, labels, lists

**Files:**
- Modify: `frontend/lib/types.ts:18` (`"assembly"` in `OrderStatus`; `"assembler"` in `StaffType`)
- Modify: `frontend/lib/constants.ts` (`ORDER_STATUS_LABELS.assembly = "قيد التجميع"`, `PRODUCTION_STAGE_ORDER` and `ORDER_STATUS_OPTIONS` insert after `"embroidery"`, `STAFF_TYPE_LABELS.assembler = "مجمّع"`)
- Modify: `frontend/app/staff/queue/page.tsx:35-72, 90` (`STAGES`, `STAGE_PILL.assembly = "bg-peach/60 text-orange-ink"`, `RAIL_BAR.assembly = "bg-orange/70"`, `postDesignStages`)
- Modify: `frontend/components/staff/StaffSidebar.tsx:35-41` (`MENU_STAGES` after `"embroidery"`), `:138-141` (`HOME_LABELS.assembler = "قائمة التجميع"`)
- Modify: `frontend/lib/tv.ts:169-186` (`assembly: "التجميع"`, colour `"#F2A65A"`)
- Modify: `frontend/components/staff/station/types.ts:93` (`if (status === "assembly") return "انتقلت إلى التجميع";`), `StationConsole.tsx:84` (`LINE_ORDER` after `"embroidery"`)
- Modify: `frontend/app/staff/page.tsx:571` (`STAGE_ORDER` after `"embroidery"`), `frontend/app/staff/wholesalers/[wholesalerId]/students/page.tsx:37`, `frontend/components/staff/OrderCard.tsx:20` (colour maps)

- [ ] **Step 1:** Add `"assembly"` to `OrderStatus` and run `npx tsc --noEmit` — every `Record<OrderStatus, …>` that fails is a place to fill; fill each with the values above.
- [ ] **Step 2:** `tsc` clean, `npm run lint` clean.
- [ ] **Step 3:** Commit — `git commit -m "feat(staff): التجميع بكل قائمة وشريط ولون"`.

### Task 2B.6: `AssemblyBoard` — برزان's screen

**Files:**
- Create: `frontend/components/staff/station/AssemblyBoard.tsx`
- Modify: `frontend/lib/staff.ts` (`getAssemblyBoard()` wrapper + `AssemblyRow` type in `staff-types.ts`)
- Modify: `frontend/app/staff/page.tsx:1097-1110` (route `assembler` primary type to `<AssemblyBoard />`), `frontend/app/staff/queue/page.tsx` (when `?stage=assembly`, render `<AssemblyBoard />` above the flat list for everyone)

- [ ] **Step 1: Wrapper**
```ts
export interface AssemblyRow { id: string; status: OrderStatus; student_id: string; student_name: string; wholesaler_name: string | null; batch_name: string | null; deadline: string | null; checkout_group_id: string | null; product_name: string; product_type: string; needs_pressing: boolean; zones: { key: string; label: string; done: boolean }[]; done_count: number; total_count: number; can_advance: boolean; advance_label: string | null; }
export async function getAssemblyBoard(): Promise<{ arriving: AssemblyRow[]; ready: AssemblyRow[] }> {
  const { data } = await api.get<{ data: { arriving: AssemblyRow[]; ready: AssemblyRow[] } }>("/production/assembly");
  return data.data;
}
```
- [ ] **Step 2: Component** — phone-first, two sections:
  - «جاهزة للتجميع (n)» — grouped by `student_name`; each group card: header `student_name · wholesaler_name · deadline`, one row per piece: product name, zone chips all ✅, button `advance_label` (calls `advanceOrder(id)` from `lib/staff.ts`, optimistic remove, toast «انتقلت إلى الكوي/التجهيز»). When every piece of a `checkout_group_id` is in `ready`, one extra button «نقل الطقم كامل» → `advanceBulk(ids)`.
  - «قطع واصلة (n)» — same grouping; chips ✅ for done zones, ⏳ «بعده بالتطريز» for the rest; no button; a muted line «تكتمل لمّا يطرّز {total - done} منطقة».
  - Live: subscribe like `StationConsole` does to `/production/events` and refetch on any `order` event.
  - Empty state: «ما في قطع بالتجميع هسة.»
  - Tokens: `rounded-2xl border border-line bg-surface`, chips `bg-peach/70 text-orange-ink`, buttons `min-h-11`.
- [ ] **Step 3: Wire** — `staff/page.tsx`: `if (staffType === "assembler") return (<><AttendanceReminder className="mb-4" /><AssemblyBoard /></>);` before the embroiderer/presser branch; `QUEUE_META.assembler` entry (copy the shape of the presser's). Queue page: `stage === "assembly"` → render the board above the list.
- [ ] **Step 4: Verify in a browser** (local copy; give برزان `assembler` via `/staff/team` as admin; log in as him at 390×844 and 768×1024): board shows ready/arriving; ticking a zone as محمد عماد in another tab moves the sub-piece to «واصلة» live; ticking the last one moves it to «جاهزة»; his button sends it to الكوي; المكوجي's revert brings it back. Screenshot every state.
- [ ] **Step 5:** `tsc`, lint, commit — `git commit -m "feat(staff): لوحة التجميع لبرزان — شنو وصل وشنو جاهز للخياطة"`.

### Task 2B.7: Admin can assign the role; docs

**Files:**
- Modify: `frontend/app/staff/team/page.tsx` (only if its staff-type `<Select>` enumerates a hard-coded list — if it maps `Object.keys(STAFF_TYPE_LABELS)` nothing to do)
- Modify: `PROGRESS.md`, `HANDOFF.md` (landmines), `API.md`, `PLAN.md` domain model note (one line: التجميع stage, rep-only)

- [ ] **Step 1:** Confirm «مجمّع» is selectable on `/staff/team` (create/edit staff). Assign برزان `preparer + assembler` on the LOCAL copy for verification only; on prod the admin does it after deploy.
- [ ] **Step 2:** HANDOFF landmines to add: (a) `isRepPiece` is the ONLY fork between the two routes — never add a second copy; (b) a legacy rep piece at الكوي reverts to التجميع even though it never visited it — expected, it shows as fully arrived; (c) the board never writes status; (d) `applyZoneTick` now emits on every tick.
- [ ] **Step 3:** Full suite `node --test test/*.test.js`; `/code-review`; `security-review` items: new endpoint strips money/contact, role gate is line-wide by design, rep approval gate inherited by the WHERE.
- [ ] **Step 4:** Commit — `git commit -m "docs: التجميع — القرارات والألغام"`.

---

# Track 5 — UI consistent on every phone

### Task 5.1: Tell impeccable what platform this is

**Files:**
- Modify: `PRODUCT.md` (add a «Platform» block)

- [ ] **Step 1:** Add under the product description:
```
## Platform
Web PWA + Capacitor shell. Android v1.0.4 live, iOS 1.0.4 in review. Staff surfaces (`/staff/*`, `/workshop`) are used on 360–412 px Android phones and one iPad (768 px); admin on a laptop (1280+) and a phone. Students and reps: phone only. Safe-area insets and `dvh` are required on every sticky bar.
```
- [ ] **Step 2:** Run `$impeccable doctor` and apply what it reports (the project's impeccable artifacts predate v4 — 2026-08-08).
- [ ] **Step 3:** Commit — `git commit -m "docs(product): المنصة Capacitor — حتى adapt/audit يعطون إرشاد الموبايل"`.

### Task 5.2: Measure, then fix, in one batch

- [ ] **Step 1: Measure** — local dev server; Claude in Chrome; `resize_window` to 360×740, 390×844, 768×1024; for each route below log in as the role that uses it and screenshot; run in the page `({w:document.documentElement.scrollWidth, i:innerWidth})` and record any `w > i` (horizontal overflow), and `[...document.querySelectorAll('button,a,[role=button]')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&(r.height<44||r.width<44)}).length` (small tap targets).
  Routes: `/staff` (embroiderer · presser · preparer · assembler · designer), `/staff/queue?stage=pressing`, `/staff/orders/[id]` (a sash with zones + history), `/staff/attendance`, `/staff/me`, `/staff/team` (admin), `/admin/attendance`, `/staff/calligraphy` (embroiderer), `/workshop`.
- [ ] **Step 2: Write the defect table** in PROGRESS.md: route · width · defect · file:line.
- [ ] **Step 3: `/impeccable adapt`** on the staff surfaces with that table as the brief, constrained to: overflow → `overflow-x-auto` containers or card layouts below `md`; tap targets → `min-h-11`; spacing rhythm → one scale (`px-4 py-3`, `gap-3`, `space-y-4`) across the staff pages; long Arabic names → `truncate` + `min-w-0`; sticky bars → `pb-[env(safe-area-inset-bottom)]`; headers never clipped; no new colours. v4 rule: one batched verify round + one confirm round, then stop.
- [ ] **Step 4:** `tsc`, lint, commit per screen group — `git commit -m "fix(ui): شاشات الموظفين متناسقة على ٣٦٠ و٣٩٠ و٧٦٨"`.

### Task 5.3: Verify gate and ship

- [ ] **Step 1:** `verify` skill on the same route list — pass/fail per route per width, screenshots as evidence.
- [ ] **Step 2:** `security-review` (nothing new besides the read endpoints; confirm no money/contact leak in `getAssemblyBoard`, `listPunches`, `activityFor`).
- [ ] **Step 3:** `/code-review`, push, CI green, `/api/health` 200, PM2 uptime check, one real phone.
- [ ] **Step 4:** Prod setup the admin does: برزان ← `assembler`; محمد عماد opens الخط العربي and stitches ONE DST on a test piece before trusting it.

---

## Self-review

- **Spec coverage:** 1 → Tasks 1.1–1.4 · 2A → 2A.1–2A.3 · 2B → 2B.1–2B.7 · 3 → 3.1–3.4 · 4 → 4.1–4.4 · 5 → 5.1–5.3. D1–D8 each appear in the task that implements them.
- **Placeholders:** none — every code step shows the code; the two «copy from getQueue» notes point at exact lines.
- **Type consistency:** `isRepPiece` (2B.2) is what 2B.4 calls through `nextStageFor`; `activityFor` (4.2) is what 4.3/4.4 consume; `stage_history.kind` (3.2) matches `VERB` keys (3.3); `last_move.kind` (3.4) uses `'advance'|'revert'` only; `meaning` values (1.2) match `MEANING` keys (1.3).
