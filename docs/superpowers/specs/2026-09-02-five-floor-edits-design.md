# Five floor-reported edits — design (2026-09-02)

Owner's message (verbatim, numbered as sent):

> 1- البصمة يمكن بيها خلل مدا تطلع للادمن كلها صح
> 2- التطريز محمد عماد عنده شغل هواي اولا خليه يكدر يصمم ويستعمل الخط العربي ثانيا رح نسوي مرحلة جديدة كالاتي التطريز هسة ناخذ مثال الوشاح لازم يخلص الخلف والامام بعدين ينرفع للكوي ، هذا صح للتجزءة اما الممثلين لما ينطي وشاح من الخلف تم تروح القطعة ك وشاح من الخلف والامام كذلك مو يعني القطعة تبقة وتنتضر بس تروح لمرحلة جديدة مسؤول عليها برزان يلي هي التجميع وخاصة بس ب طلاب الممثلين يجمع القطع وشاح من امام ومن خلف وقبعة كذلك وروب كذلك وكلشي ، ولما يجمع يودي للكوي قطعة كاملة كما هو عليه الحال للكوي
> 3- مو مبين منو خله القطعة تروح للمرحلة السابقة اريد يطلع بالقطعة كل شخص اشتغل عليها عند كل الموظفين لان ديصير اكو مفقودات
> 4- النشاط والحركات تقريبا broken لدرجة غير قابلين للاستعمال
> 5- الui كذلك مو متناسق وية كل التلفونات ويحتاج مرات فراغات او غير امور

Plan: `docs/superpowers/plans/2026-09-02-five-floor-edits.md`. Tracks are numbered after the
owner's items (1 · 2A · 2B · 3 · 4 · 5).

---

## What the code says today (read 2026-09-02, tree = `origin/main` @ `9185490`, all deployed)

### 1 · البصمة
- Since 2026-08-30 the **K40 device is the only way to punch**; `check-in`/`check-out` are
  unrouted (`routes/staff.js:28-34`). The admin's day table (`/admin/attendance`, «سجل اليوم»)
  reads only the DERIVED rows `staff_attendance_records` via `attendanceController.listRecords`
  (`:714`). Raw punches (`punch_raw`) surface only as «أرقام بدون موظف» and «نبضات مرفوضة» on the
  device tab (`AttendanceDevicePanel.tsx`). **The admin cannot see the sequence of punches a
  worker made**, only what the machine decided they meant.
- A day is read from the punch SEQUENCE (`lib/attendanceDevice.js`), and four documented traps
  turn a real punch into something the admin does not expect:
  · leaving before `end_time` opens a **break**, not a خروج (HANDOFF «THE ACCEPTED FLAW»);
  · a second punch within **5 minutes** is dropped (`PUNCH_COOLDOWN_MINUTES`);
  · on a **midnight-crossing shift** (مضر محمد, 22:16→10:15) no punch can close the day; the next
    day's first punch closes it (`closeStaleOpenDay`);
  · after an internet outage the device re-sends **in one batch and every punch gets the batch's
    arrival time** (`punched_at` = server clock, owner rule 2026-08-30); the repair is a manual
    override reading `device_ts`.
  Each of these is invisible on the admin screen except as a missing خروج or a wrong late count.
- The local DB copy (`127.0.0.1:5433`, data ends 2026-08-30) holds only the device's first day:
  12 punches, 7 applied, 8 records opened and **2 closed**. The 2026-08-30 backlog collapse is
  already recorded in HANDOFF. **Prod (since 2026-08-31) has not been measured** — Task 1.1 does
  that over SSH, read-only, before anything is built.
- The day table has **9 columns** (`page.tsx:488-496`) and is unreadable on a phone; the admin
  «uses laptop + phone» (CLAUDE.md).

### 2A · محمد عماد and الخط العربي
- The calligraphy tool is gated at three places, and **`embroiderer` is excluded at all three**:
  `routes/calligraphy.js` `allowCalligraphyUser` (admin · manager · designer · design_helper),
  `app/staff/calligraphy/page.tsx:27-30`, `StaffSidebar.tsx:271-281`.
- «تحويل للتطريز» (`sendOrder`) is a STRICTER gate (`requireDesignerOrAdmin`) and must stay so —
  it is the side door `advanceBlockReason` exists to close.
- **Uncommitted in the working tree:** the auto-digitiser (`backend/lib/digitize/`, migration
  097, `test/digitize.test.js` 19/19, `CalligraphyTool.tsx` +61, `calligraphyController.js` +95)
  — «صورة الاسم» → Tajima `.DST` on the server, replacing 15–20 min of Wilcom per name. PROGRESS
  says it is **«NOT VERIFIED ON A MACHINE OR BY THE EMBROIDERER»**. The one person who can verify
  it is the person item 2A is about.

### 2B · the line and التجميع
- Stages are one enum (`order_status`), and a piece's route is `nextStageFor` in
  `productionController.js:316`: `embroidery → needs_pressing ? pressing : preparing` — the same
  for تجزئة and ممثل. There is no assembly stage.
- The embroiderer ticks zones (`applyZoneTick` `:1352`); when EVERY zone of a piece is done the
  piece **auto-advances** through `performAdvance`. Zone ticks are logged to `audit_log`
  (`embroidery_zone`) with the actor, not to `staff_activity_log`.
- Every line staff type sees and may move every stage except التصميم (owner 2026-08-31 —
  `LINE_VIEW_STAGES`, `STAGE_AUTHZ`), and `QUEUE_STAGES` says what is «مرحلتي». `viewerStages`
  reads `QUEUE_STAGES` and must not be re-derived (HANDOFF landmine).
- Rep pieces are born at `design_complete` (embroidered) or `pressing` (plain), never at التجهيز
  except caps (`lib/fullSetOrder.js:362-364`, `cartController.js:215`).
- The rep-student «شال امريكي» is a `sash_shawl_pieces` row on its own ladder (الكوي → التجهيز →
  جاهز) and must never become an `orders` row (migration 100 landmine).
- برزان is المجهز (`preparer`) — `embroideryChecklistGate.test.js:4`, PROGRESS 2026-09-01.
- Adding a stage touches ~14 backend files and ~16 frontend files (every `Record<OrderStatus,…>`
  map fails `tsc` until filled — that is the guard).

### 3 · «منو نقلها؟»
- `StageHistoryCard` shipped 2026-08-31 and moved to the top of the side column on 2026-09-01
  (`staff/orders/[orderId]/page.tsx:1918`); deployed with `9185490` (2026-09-02 02:11 Baghdad).
  It shows **name · from ← to · time** for every `staff_activity_log` row with a `to_stage`.
- What it does NOT say: **whether the move was forward or back** (an advance and a revert print
  identically — the exact thing the owner asked about), who **ticked the embroidery zones**
  (audit_log only), who finished الفصال, who returned it to the student. A **shawl revert writes
  no `staff_activity_log` row at all** (`revert` `:1614` writes only `audit_log`), so «منو رجّع
  الشال» has no answer anywhere.
- Nothing on the LIST rows (`getQueue`, `OrderCard`, station sheet) names anyone; a worker looking
  for a lost piece must open each order.

### 4 · النشاط والحركات
- `/staff/team` → «الراتب والنشاط» renders **raw keys**: `act.action` («advance») and
  `{fromStage} ← {toStage}` («embroidery ← pressing») — `team/page.tsx:426-436`. The admin
  mapper `lib/admin.ts:1947` **drops** `product_name`/`student_name` that the API already returns
  (`salaryController.getStaffActivity:360`). Only the first 8 rows show. No month filter; the API
  caps at 200 rows.
- The routes are **admin-only** (`routes/admin.js:17`), but the sidebar offers «الموظفون» to
  `manager` too (`StaffSidebar.tsx:307`); for a manager all three loads 403 and the panel says
  «تعذر تحميل بيانات الراتب» — «broken».
- `/staff/me` has Arabic labels (`ACTION_LABELS`, `stageLabel`) but prints 200 rows flat with no
  day grouping. The embroiderer's real work (zone ticks) is not in `staff_activity_log`, so his
  «سجل النشاط» under-reports him.
- `/workshop` «آخر الحركات» is the workshop-worker ledger (`workshopController.ledgerFor`) — a
  different screen; Task 4.1 reproduces all three in a browser before fixing.

### 5 · UI on phones
- `PRODUCT.md` does not record the platform, so `/impeccable adapt` and `audit` give **web**
  guidance to a Capacitor app (global CLAUDE.md, impeccable v4 note). `dvh` and `.safe-bottom`
  fixes landed 2026-08-2x (`0244763`, `bba4a51`) — page by page, not as a pass.
- No screen has been measured at 360 px (low-end Android) — the width المكوجي/المجهز/المطرّز use.

---

## Decisions (defaults chosen; the owner can flip any line)

| # | Decision | Default | If flipped |
|---|---|---|---|
| D1 | When does a rep piece's STATUS become «قيد التجميع»? | **When its LAST zone is ticked** (today's auto-advance, retargeted). From the FIRST tick the sub-piece («وشاح — من الخلف») already appears on برزان's board as «واصل», so nothing waits and the embroiderer's list, batch mode and checklist are untouched. | Flip at first tick: the embroiderer must keep ticking zones on pieces that are no longer «مرحلتي», batch mode (all backs, then all fronts) has to read two stages, and `applyZoneTick`'s stage guard widens. More code, more places to lose a piece. |
| D2 | Which rep pieces pass through التجميع? | ⚠️ **OVERRULED BY THE OWNER 2026-09-06: ALL rep pieces, not only embroidered ones** («all pieces just wholesalers»). That is the row's own «If flipped» column, so the extra work is known and is the reason this track grew: plain robes/caps never pass through التطريز, so their **birth status** changes in `fullSetOrder.js` and `cartController.js`, and the rep-facing «آخر حالة» changes for every plain piece a ممثل is watching today. Retail pieces are untouched — التجميع is rep-only. The شال امريكي keeps its own ladder. | *(superseded)* Only embroidered rep pieces, which was the original default: it rides the existing auto-advance out of التطريز and births nothing new. |
| D3 | After التجميع? | **الكوي if `needs_pressing`, else التجهيز** (a cap never visits الكوي) — the same rule both directions, so revert lands where the piece came from. | — |
| D4 | Who owns التجميع? | **New staff type `assembler` (مجمّع)**; the admin gives برزان `preparer + assembler` on `/staff/team`. Every line staff type may still see and move it (2026-08-31 rule). | Fold it into `preparer`'s queue: برزان's «مرحلتي» becomes four stages and the board loses its own home. |
| D5 | What does «يصمم ويستعمل الخط العربي» mean for محمد عماد? | **Access to the الخط العربي tool** (generate plates, reroll, download, and the new DST button) — NOT «تحويل للتطريز», which stays the designer's. The DST feature ships with him as its tester. | If «يصمم» means the Fabric sash designer (`/design`): a different track; ask. |
| D6 | Attendance repairs | **Every reinterpretation is an explicit admin tap**, never automatic: «اعتبر آخر بصمة خروج» and (if prod shows batch collapses) «اعتمد وقت الجهاز». The server-clock rule stays. | — |
| D7 | Who sees names on pieces? | **Every staff role** («عند كل الموظفين») — names, stages, zones, times. **No money, no contact**, same as `StageHistoryCard` today. | — |
| D8 | Manager on «الموظفون» | Managers get **read** access to salary/activity/goal (they already pass `canSeeMoney`); writes stay admin. | Hide «الموظفون» from managers instead (one sidebar line). |
| D9 | Rep pieces ALREADY in flight when التجميع ships | **Leave every existing piece exactly where it is — no backfill, no migration that moves rows.** التجميع applies to pieces born or advanced after the deploy. Owner delegated this 2026-09-06 («i got u the right»). Moving live pieces under the workers' hands is precisely how «140 at التصميم, 137 at التطريز» happened; a worker who opens their board and finds yesterday's pieces gone has no way to tell a feature from a loss. | Backfill rep pieces past التطريز into التجميع: one UPDATE, and every rep piece on the line changes stage overnight with no announcement. |
| D10 | Migration numbers | **`104_assembly_stage.sql`, not the 103 the plan reserved** — 103 was taken by «ملاحظة» on 2026-09-06. And the enum value lands in its **own** migration ahead of the code: `ALTER TYPE … ADD VALUE` cannot be used in the same transaction that adds it. | — |

## Ship order and AI-speed estimates

| Order | Track | Estimate | Why here |
|---|---|---|---|
| 1 | 2A · الخط العربي for محمد عماد + commit DST | 45 min | Smallest; unblocks the person with the most work today. |
| 2 | 1.1 · measure attendance on prod (read-only) | 30 min | Decides which of the four traps is the real complaint before building 1.2–1.4. |
| 3 | 4 · النشاط | 2–3 h | Pure display + one shared query; no schema. |
| 4 | 3 · منو اشتغل عليها | 2–3 h | Small backend union + card verbs + list line. |
| 5 | 1.2–1.4 · البصمة | 3–4 h | Raw punches visible + one-tap repairs + phone layout. |
| 6 | 2B · التجميع | 6–8 h | New stage + role + board; largest blast radius; needs D1–D4 confirmed. |
| 7 | 5 · UI pass | 3–4 h | `/impeccable adapt` + `verify` on the staff surfaces, last so it measures the new screens too. |

Session rules that apply (global CLAUDE.md): one track per session, `/effort max` on 2B and 1,
phase 9 `verify` and phase 10 `security-review` before each deploy, PROGRESS.md after every task.
