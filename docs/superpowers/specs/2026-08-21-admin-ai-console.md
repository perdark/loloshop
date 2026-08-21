# «لولو الإدارة» — the admin AI console, staff app-open tracking, and the daily staff report

**Spec date:** 2026-08-21 · **Branch:** `feat/admin-ai-console` · **Migration:** 084

Owner ask, verbatim:

> 1- make it a full page just for admin
> 2- let him know all dashboard, but separate from the ai that in storefront becarefully
> 3- Can suggest actions to admin and can make actions if admin ask or want
> 4- let admin can know if staff are opening the app or not, and have a daily report how much
>    app opened and how much staff worked and not worked etc.. admin want to see if staff
>    workinmg or not everyday and how much they work

Owner decisions taken before building (2026-08-21):

| Question | Answer |
|---|---|
| How far may the AI act? | **Suggest + execute a closed whitelist of REVERSIBLE actions, each behind an explicit «تأكيد» tap.** Destructive endpoints stay suggestion-only. |
| How does the daily report arrive? | **Nightly push + the page.** |
| Who is tracked? | **`users.role = 'staff'` only** — not `worker`, not `design_helper`, not ممثلين, not students. |

---

## 0. What already exists (do not rebuild it)

`POST /api/assistant/analytics` has shipped since the assistant landed. It is admin-only, it
routes an Arabic question onto **one key from a closed catalogue of 8 metrics**
(`backend/lib/adminMetrics.js`), runs **our** SQL, and asks the model only to phrase the
numbers we computed. Its money metrics already go through `lib/counts.js`
(`settledMoney` · `shopIncomeExpr` · `repMarginExpr`), so it and the `/admin` dashboard agree
to the dinar. The UI is `frontend/components/admin/AnalyticsAsk.tsx`, a small box embedded in
the dashboard.

This spec **extends** that machine. It does not replace it, and it does not touch the
storefront assistant.

What is genuinely absent today:

- a page (the widget is a box on a crowded dashboard);
- breadth (8 metrics — nothing about attendance, payouts, the workshop, calligraphy spend,
  visitors, or the OTP gateway);
- any ability to *do* anything;
- **any record that a staff member opened the app.** `staff_attendance_records` records بصمة
  (check-in/out, late minutes); `staff_activity_log` records production actions. Neither
  answers «هل فتح التطبيق اليوم؟». That data does not exist and must be created.

---

## 1. The separation from the storefront assistant (ask 2, "becarefully")

«لولو» the storefront mascot and «لولو الإدارة» the console share **only** the OpenRouter
transport (`lib/aiChat.js`) and the ledger table. Everything that decides what may be said,
to whom, and at what cost is separate — and in two places the two surfaces need **opposite**
behaviour, which is why sharing the code would be a defect, not a saving:

| | Storefront «لولو» | Admin console |
|---|---|---|
| Route | `POST /api/assistant/support` | `POST /api/assistant/admin/ask` · `/admin/act` |
| Auth | `optionalAuth` — anonymous allowed | `authRequired` + `requireRole('admin')` |
| Identity | HMAC-signed anon session (`lib/anonSession.js`) | the JWT. **`anonSession` is never imported here.** |
| Controller | `supportChatController.js` | `adminConsoleController.js` (new) |
| Guard | `lib/answerGuard.js` — **rejects any IQD figure not in the price book**, rejects delivery promises, rejects English | `lib/adminAnswerGuard.js` (new) — **rejects any number not present in the facts WE computed** |
| Context | the price book, the shop guide, the customer's own order | the metric catalogue. The price book is never loaded. |
| Budget | shared ceiling + a 40% anonymous slice | **its own slice** (`AI_CHAT_ADMIN_DAILY_USD_MAX`) |
| Chips | `lib/supportActions.js` — links only, never executes | `lib/adminActions.js` — proposals that CAN execute |

**Why the guards must not be shared:** the storefront guard's central assertion is "no money
figure the customer could act on unless we handed it to the model". The admin console's whole
job is money figures. A shared guard would either gag the console or open the storefront. So
the admin guard asserts a *different* property with the same shape — every digit group in the
answer must appear in the facts block we computed — which catches the one failure that
actually matters on this surface: the model inventing or re-arithmetising a number.

**Why the budget must be sliced:** the daily USD ceiling is whole-shop. Without a slice, a
flood of student questions can switch off the owner's own console on the day he most needs it,
and a chatty console can take the marketing surface down. The existing anonymous slice already
establishes this pattern and the reasoning is written out in `lib/aiChat.js`.

---

## 2. Staff app-open tracking (ask 4, first half)

### The data — migration 084, `staff_app_opens`

One row per staff user per work-date, updated in place. Twelve staff × 365 days ≈ 4k rows a
year; no retention policy needed.

```sql
CREATE TABLE staff_app_opens (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date     DATE NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opens         INTEGER NOT NULL DEFAULT 1 CHECK (opens >= 0),
  platform      TEXT,
  PRIMARY KEY (user_id, work_date)
);
```

`work_date` is computed with `localParts(now, 'Asia/Baghdad').date` from **`lib/shopTime.js`** —
the helper was extracted out of `attendanceController` so both callers share one definition
(a lib importing a controller was the alternative, and worse). It is the
**same helper attendance itself uses**, so an app-open row and a بصمة row for the same evening
can never land on different dates. A shift that starts at 21:00 Baghdad must not have its opens
filed under tomorrow while its check-in is filed under today.

### What counts as one "open"

A ping increments `opens` only when `last_seen_at` is **more than 30 minutes old**; otherwise it
just moves `last_seen_at`. So "opens" means *sessions*, not page views — a preparer working
through a queue for three hours is one open, and closing the app after lunch and coming back is
two. Same shape as the storefront beacon's 5-minute dedup, with a window sized for "did they
come back", not "are they still here".

### The beacon

`POST /api/staff/app-open` — mounted on the existing `routes/staff.js`, so it inherits that
router's `authRequired` + `requireRole('staff')`. Rate-limited (20/min), and **204 on
everything**, including a tripped limit and a failed write: this is a fire-and-forget beacon on
the root layout, and a staff member with a production queue open must never see an error, a
spinner or a retry because a presence write failed. Non-staff callers never reach it because
the client no-ops for them; the role guard is the belt to that braces.

`frontend/components/StaffAppBeacon.tsx` mounts in the **root** layout, not the staff layout,
and fires only when the signed-in user's role is `staff`. Root, because a staff member who
opens the app and lands anywhere — the storefront, a deep link, `/staff/me` — has opened the
app; gating it to `/staff/*` would under-count exactly the casual opens the owner is asking
about. It re-fires on `AUTH_CHANGED_EVENT` (so a login counts) and on
`visibilitychange → visible` (so a return to foreground counts), and it reports
`nativeShellPlatform()` so the report can say phone vs iPad vs browser.

### ⚠️ It never touches payroll

App-opens are an **independent signal from بصمة**, displayed beside it and never merged into
it. Opening the app is not attendance, being absent from the app is not a deduction, and
nothing in this feature writes `staff_salary_transactions`. Attendance already owns the money
rule (`lib/attendanceBreak.js`) and it stays the only owner. The report shows the two columns
side by side precisely so the owner can see when they *disagree* — a stamped بصمة with zero
opens all day is the interesting row, and merging the signals would erase it.

---

## 3. The daily staff report (ask 4, second half)

`backend/lib/staffDailyReport.js` — `build(dateISO)` returns, for `users.role = 'staff'` who
are not soft-deleted:

```
totals: { staff, opened, not_opened, checked_in, absent, not_required, opens, worked_minutes }
rows:   [{ user_id, name, staff_type, attendance_required,
           opened, opens, first_seen_at, last_seen_at, platform,
           check_in_at, check_out_at, worked_minutes, late_minutes,
           break_minutes, status, production_actions }]
```

- `worked_minutes` = check-out − check-in, **minus break minutes**, and `NULL` (not 0) while
  someone is still checked in — "still at work" and "worked nothing" are different claims and
  the report must not print the second when it means the first.
- `attendance_required = FALSE` staff are counted in `not_required`, never in `absent`.
- `production_actions` comes from `staff_activity_log`, so a row can say *opened the app,
  stamped بصمة, and did nothing* — which is the question behind «هل يشتغل أو لا».

Endpoint: `GET /api/admin/staff-daily-report?date=YYYY-MM-DD` (defaults to today, Baghdad).

### The nightly push

pg-boss is already running as `loloshop-worker`; v10 has `boss.schedule(queue, cron, data,
{ tz })`. A new queue `staff-daily-report` is scheduled at **21:00 Asia/Baghdad**, builds the
report for that day and writes one `notifications` row per admin. `lib/pushOutbox.js` turns
that into a phone push for free — the same delivery path `maybeWarnSpend` already uses, so this
adds no FCM/APNs knowledge anywhere new.

⚠️ Idempotent by `NOT EXISTS` on a same-day `staff_daily_report` notification, exactly like the
spend warning's 24h guard. A worker restart must not re-push the evening summary.

---

## 4. The console (asks 1, 2, 3)

### Metrics — `lib/adminMetrics.js` grows from 8 to ~22

Added, all on existing tables and existing money vocabulary: `staff_today` ·
`staff_attendance_summary` · `staff_worked_ranking` · `staff_not_opened` · `breaks_pending` ·
`payouts_due` · `salary_summary` · `workshop_production` · `workshop_top_workers` ·
`calligraphy_spend` · `calligraphy_jobs` · `visitors` · `otp_health` · `orders_late` ·
`rep_deadlines_near` · `stock_shelf` · `retail_vs_rep`.

The rule from the file's own header is unchanged and non-negotiable: **the model never writes
SQL and never sees the database.** It picks a key and a couple of scalar parameters that we
clamp; every query lives in that file, parameterised.

### Actions — `lib/adminActions.js` (new)

A closed registry. Each entry declares `id`, an Arabic label, a **strict param schema** (types,
bounds, and existence checks against the DB), a `confirm(params)` that renders the exact
sentence the admin is agreeing to, and `run(params, adminUser)`.

**Flow: propose → confirm → execute.**

1. The model returns `{action, params}` as JSON. That is a **proposal and nothing more.**
2. The server validates every param itself (a UUID must resolve to a real row, a date must
   parse and sit inside a sane window, an amount must be a positive integer under a ceiling).
   A param that fails validation kills the proposal — it is never repaired by the model.
3. The server signs the validated proposal: HMAC over `{adminId, action, params, exp}` on
   `JWT_SECRET`, 10-minute TTL, same primitive as `lib/anonSession.js`. **No server state.**
4. The UI renders a confirm card. `POST /api/assistant/admin/act` verifies the signature, that
   `adminId` matches the caller, and that it has not expired, then runs it and writes
   `audit_log`.

Registry (reversible only): extend a rep deadline · set a rep's pricing tier · set an order's
cost · approve or reject one break request · set a staff goal · add a salary bonus · toggle the
promo banner · toggle maintenance mode · mark a manual payout.

**Permanently excluded, with reasons:**

- **Anything that approves or rejects a rep order.** HANDOFF ruling 2026-08-14: the ~471 orders
  in «بانتظار موافقة الممثل» are parked on unresolved student↔rep disputes. That queue is not
  a backlog and an AI must not be able to touch it, individually or in bulk.
- **Every DELETE** (`deleteOrder`, `deleteWholesaler`, `deleteStaff`) — not reversible.
- **Password changes and the money-gate secret** — an AI must never move a credential.
- **`staff_attendance_settings.verification_mode`** — flipping it off `'none'` while
  `shop_latitude`/`shop_longitude` are NULL 403s every بصمة for every worker on every platform.
  It is a landmine with an ordering requirement, not a toggle.

Excluded does not mean invisible: the console still *suggests* these and deep-links to the
screen where a human does them.

### The page — `/admin/assistant`

Full page, RTL, entry in `AdminSidebar` as «لولو الإدارة». Holds:

- today's staff strip (opened / stamped / working now / absent) above the fold, because ask 4
  is a thing the owner wants to *see*, not a thing he wants to have to ask for;
- the conversation thread, restored from `ai_chat_messages` for this admin;
- the facts block under every answer (already shipped in the widget — the numbers are ours, and
  showing them makes the phrasing auditable);
- the action confirm card;
- the daily report table with a date picker.

`AnalyticsAsk` stays on `/admin` as a compact entry point and gains a link to the full page.

---

## 5. Acceptance

1. `POST /api/staff/app-open` as a staff user creates one row; a second ping within 30 min does
   not increment `opens`; a ping 31 min later does. A junk `platform` stores NULL.
2. The app-open `work_date` for a 23:30 Baghdad ping matches the `work_date` attendance would
   assign the same moment.
3. `GET /api/admin/staff-daily-report` returns a row per `role='staff'` user; someone still
   checked in has `worked_minutes: null`, not 0; `attendance_required=false` staff are in
   `not_required`, not `absent`.
4. The nightly job writes exactly one notification per admin per day, and running it twice
   writes nothing the second time.
5. The console answers an attendance question, a money question and a workshop question, and
   the money answer matches `/admin` to the dinar.
6. The admin guard rejects an answer containing a number absent from the facts block.
7. An action proposal cannot execute without the signed token; a tampered token, an expired
   token, and a token minted for a different admin are all refused.
8. No registry entry can approve/reject a rep order, delete anything, change a password, or
   move `verification_mode`.
9. Storefront «لولو» is byte-identical in behaviour: `test/` support scenarios still pass and
   the storefront guard is untouched.
10. `node --test test/` from `backend/` green; `next build` + `tsc` + lint clean.
