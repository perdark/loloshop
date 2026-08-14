# Eleven production bugs — parallel track plan (2026-08-13)

Investigation was read-only against the **live prod DB** (`142.93.110.202`, local Postgres 17).
Dump: `~/Desktop/_private/loloshop-db/loloshop-prod-2026-08-13.dump`. No code was changed.

---

## What is VERIFIED CLEAN — do not re-investigate

Measured against live data, not assumed:

- Accounting reconciles exactly: 28,088,000 (ممثلين) + 49,423,800 (تجزئة) = **77,511,800** = totals.
- `billableOrderSql` correctly excludes pending/rejected rep orders from revenue.
- **0** live orders missing spec lines · **0** orders pointing at a deleted design · **0** students
  without a user · **0** orders without a student · **0** bundles spanning two students ·
  **0** duplicate pieces · **0** negative profit.
- Only **one** code path destroys user data (Track B below). The other six writers of
  `customer_image_url` / `customer_text` / `final_design_url` are guarded or intentional.
- 55 `delete_order` rows in `audit_log` are deliberate manager deletions, recorded with actor+time.

**Nothing is lost except the student reference photos.** Files still exist on disk.

---

## Branch plan

`ai-assistant` is **11 commits ahead of `main` and CANNOT be deployed yet** (owner, 2026-08-13).
All three tracks therefore branch from **`main`** (`871a257`).

⚠️ **If a track branch sits at `4eb01c8` it was cut from `ai-assistant` by mistake** — merging it
would ship the whole AI assistant (plus migrations 078/079) to production. Check with
`git log --oneline -1` in each worktree; it must read `871a257`.

| track | branches from | overlaps `ai-assistant`? |
|---|---|---|
| A — admin numbers | `main` | ⚠️ **yes, all 4 files** — accepted debt, see below |
| B — calligraphy | `main` | no — clean |
| C — designer console | `main` | no — clean |

### ⚠️ Debt this creates — write it into HANDOFF.md when Track A lands

Track A changes the meaning of «الربح» in `adminController.js`, `lib/counts.js`,
`lib/adminMetrics.js`, `frontend/app/admin/page.tsx`. **`ai-assistant` modifies all four.**
`lib/counts.js:53-57` states the dashboard and the AI assistant must compute revenue
*identically* — so when `ai-assistant` is finally merged, **«لولو»'s revenue/profit definition
must be updated to match Track A**, or the assistant will quote a different profit than the
dashboard. That is the exact failure that file warns against.

### Deploy rule — non-negotiable

`.github/workflows/ci.yml:49` — **any push to `main` that passes CI deploys straight to the live
shop** (1,141 users). So:

1. Each track finishes on its **own branch**.
2. Merge **one track at a time**; open the live site and check it before the next merge.
3. Track B carries **migration 080** — it must be applied in the same deploy as its code.
4. Subagent/temp worktrees under `/tmp` **die when the session ends** — commit before stopping.
5. `npm test` does not exist in `backend/`. The real command is `node --test test/` (185 tests).

---

## TRACK A — the admin numbers (bugs 9, 10, 11) · ~2.5 h · branch `fix/admin-numbers`

**Owns:** `backend/controllers/adminController.js`, `backend/lib/counts.js`,
`backend/lib/adminMetrics.js`, `frontend/app/admin/page.tsx`
**Must not touch:** anything under `calligraphy*`, `staffController.js`, the rep students page.

### Bug 11 — «إجمالي الربح» reports the REPS' profit as the shop's *(highest value)*

`frontend/app/admin/page.tsx:479-480` states the shop's own rule:
«التكلفة = … **حصة الإدارة** في طلبات الممثلين» · «الربح = الإيراد − التكلفة».

So for a rep order, `price − cost` = (what the student pays the rep) − (the shop's share) =
**the rep's profit**. The rep's own page labels that identical formula correctly as «ربح الممثل»
(`staffController.buildWholesalerAccountSummary` → `representative_profit`). The admin page calls
it «إجمالي الربح» / «صافي الربح».

Live numbers today:

| shown | truth |
|---|---|
| إجمالي الإيرادات 77,511,800 | includes 4,240,000 that goes to reps, never to the shop |
| إجمالي التكلفة 23,848,000 | this **is** the shop's income from reps (حصة الإدارة) |
| صافي الربح 53,663,800 | = 49,423,800 retail-with-no-cost + 4,240,000 of *reps'* profit |

**Shop's real cash in = 23,848,000 (reps) + 49,423,800 (retail) = 73,271,800 IQD**, minus a true
production cost that was never entered.

Fix direction: report the shop's income as حصة الإدارة (rep) + price (retail); show the reps'
margin as a separate, clearly-labelled figure that is *theirs*. Do **not** silently redefine
`orders.profit` (a stored generated column other code reads) — change the *presentation and the
aggregate*, and keep one definition shared with `adminMetrics`.

⚠️ **Retail cost is NULL on all 1,467 retail orders — the owner never entered it** (confirmed
2026-08-13). So retail "profit" is really revenue. Surface that honestly rather than printing a
profit figure that cannot be true.

### Bug 10 — the daily chart counts two populations on one bar

`adminController.analytics` → `daily`: `orders` counts **every** non-cancelled bundle, but
`revenue` is filtered by `billableOrderSql`. Measured: 10 Aug shows **32 orders / 1,905,000** when
only **18** produced that revenue; 7 Aug shows 3 orders from 1. Average-per-order is off by up to 3×.
Fix: count and earn from the same set, or show both explicitly.

### Bug 9 — stage counts mix workable with blocked

Admin shows a raw stage total; the staff queue additionally excludes unapproved rep orders,
returned orders, and (for a scoped account) the other source. Measured:

| stage | admin | workable | blocked |
|---|---|---|---|
| بانتظار التصميم | 1,162 | 797 | 345 unapproved + 20 returned |
| قيد الكوي | 460 | 348 | 111 |
| قيد التجهيز | 563 | 513 | 37 + 13 |
| قيد التطريز | 854 | 851 | 3 |

Fix: split every stage count into «قابل للعمل» / «موقوف بانتظار موافقة الممثل». The staff
screens are CORRECT — do not change them.

**Verify:** the three headline boxes reconcile to the breakdown; a hand-written SQL check of one
stage matches the UI; `node --test test/` still passes.

---

## TRACK B — calligraphy (bugs 4, 5, 6) · ~5–6 h · branch `fix/calligraphy-photo-loss`

**Owns:** `backend/lib/calligraphyEngine.js`, `backend/controllers/calligraphyController.js`,
`db/migrations/080_*.sql`, `db/schema.sql`, plus the readers of `customer_image_url`.
**Must not touch:** `adminController.js`, `counts.js`, `admin/page.tsx`, `staffController.js`.

### Bug 4 — the calligraphy plate DESTROYS the student's uploaded photo

`backend/lib/calligraphyEngine.js:31-33`:

```sql
UPDATE order_items SET customer_image_url = $2 WHERE id = $1
```

Unconditional. `order_items.customer_image_url` holds **both** the student's reference photo and
the generated plate — one column, two meanings. Every generate / reroll / compose overwrites the
photo, and the old URL is saved nowhere.

Measured on prod: **459 order lines** now hold a plate where a photo was; 628 link events over
those 459 lines (169 overwritten more than once); **27** carry text that explicitly refers to the
photo that was deleted.

Students literally wrote: «نفس الصوره» · «تطريز هذه الصورة فقط» · «نفس الي بالصورة بس اصغر» ·
«نبأ اوريد نفس الخط الموجود في الصورة». The AI then rendered those *words* as calligraphy and
deleted the photo they referred to.

Fix: migration 080 adds a **separate** `plate_image_url` (or equivalent); the plate never writes
the customer's column again. Update every reader: `retailQueue`, `designTeamController` JOB_SELECT,
`productionController.detectZonesWithImages`, PrepConsole, staff order page.
`calligraphyController.js:558` is already guarded (`WHERE customer_image_url IS NULL`) — copy that intent.

**Recovery:** originals are still on disk — `/var/www/loloshop/uploads/images`, 5,240 files, of
which **3,365 are unreferenced**. Match by mtime against the order line's `created_at`; ambiguous
matches need the owner's eye. Do **not** delete any upload file.

### Bug 5 — «إعادة التوليد» (`calligraphyController.reroll`)

Four defects: no `isRealName` guard (unlike `createJob`) so junk is re-billed; regenerates from
`render_text` which is often an *instruction*, not a name; uses `buildSinglePrompt` +
`cropSheet(buf, 1)` while originals come from a 10-name sheet, so scale/framing don't match; and
re-runs `autoLinkPlate`, destroying the photo again. Cost per plate is uncapped.

### Bug 6 — «يخصّني الآن» shows orders the calligraphy queue cannot

Same root cause. Those orders already carry `status='done'` plates — junk plates generated from
instruction text — so `poolFor` correctly excludes them. Measured: **55 orders** across reps sit in
a designer's «يخصّني» and are invisible in calligraphy (محمد باقر: 5 of 5).
Fix: detect instruction-like text *before* spending on generation, and give the designer a view of
already-plated lines so the queue and his list agree.

---

## TRACK C — designer console (bugs 2, 3) · ~2 h · branch `fix/designer-console`

**Owns:** `backend/controllers/staffController.js`,
`frontend/app/staff/wholesalers/[wholesalerId]/students/page.tsx`
**Must not touch:** anything Track A or B owns.

### Bug 2 — the designer sees finished work and other stations' work

`staffController.wholesalerOrders` returns **every** approved non-cancelled order in **every**
status, with no role scoping; the «الكل» view is the default. For محمد باقر that is 402 rows —
276 قيد التطريز, 120 قيد التجهيز, 1 قيد الكوي — of which only **5** are a designer's work.
Fix: default the view to the viewer's own stage (`QUEUE_STAGES[staff_type]`, already defined in
`productionController.js:60`), keep «الكل» available.

### Bug 3 — back button loses the designer's place

Filters/zone/selection ARE persisted (sessionStorage, per rep) but scroll position is not, and the
list refetches from empty on return so there is no height to restore into. With 400+ rows it reads
as "it forgot where I was". Confirm in a browser first, then restore scroll.

---

## AFTER the three tracks land (serial — they collide with A and B)

- **Bug 7 — units.** No single definition of «طلب»: admin counts bundles, staff/rep consoles count
  piece rows, TV mixes both. Prod ratio **2.98 pieces per bundle** → same rep reads 148 / 420.
  Must follow Track A. ~3–4 h.
- **Bug 8 — المجهز's قائمة الإنتاج.** Merge وشاح zone chips (currently 7 retail zones, incl.
  يمين/يسار/خلف separately); search matches student/university/department/rep but **not** the
  التطريز text and is client-side over the loaded page only; no next/back on order details; no
  missing-piece view (`checkout_group_id` already groups a student's cap+sash). Shares
  `productionController` with Track B. ~3–4 h.
- **Bug 1 — admin presence panel.** The feature already EXISTS: `productionController.monitor`
  returns `working` (staff name + student + product + status) and `/staff` renders it on the منتور
  tab for manager+admin. 36 orders are claimed in prod right now. It is simply not on `/admin`.
  Same files as Track A. ~1.5 h.

---

## ⛔ «بانتظار موافقة الممثل» — DO NOT TOUCH. NOT OUR CALL.

**Owner ruling, 2026-08-14. This overrides everything this section used to say.**

An earlier version of this file called the ~471 orders sitting at «بانتظار موافقة الممثل» "the
highest-value action available" and pointed at `POST /api/admin/orders/:checkoutGroupId/approve` as
the way to clear them. **That advice was wrong and has been removed. Do not act on it, do not
re-derive it, and do not put it back.**

Those orders are **not a queue we are allowed to drain**. They are parked on unresolved disputes
between students and their ممثل — money, sizes, who promised what. The «pending» state is doing
real work: it is the shop staying *out* of an argument it is not party to. An admin bulk-approve
would silently take a side in every one of those disputes at once, commit the shop to fulfilling
orders whose terms are still contested, and destroy the only record that the dispute existed.

**Consequences of touching it are social, not technical, which is exactly why no test or migration
will catch the mistake and why it cannot be undone by a revert.**

So:

- ⛔ Never bulk-approve, auto-approve, expire, or "clean up" rows in this state.
- ⛔ Never propose it as a quick win because the money looks stranded. It is not stranded; it is
  *withheld*, deliberately.
- ✅ Reporting the count is fine — the split «قابل للعمل» / «بانتظار موافقة الممثل» that bug 9
  added to `/admin` is exactly the right treatment: make the backlog visible, change nothing.
- ✅ If someone asks why production queues and `/admin` disagree, this is most of the gap. That is
  an explanation, not a to-do.

Individual approvals are the **ممثل's** to make, one at a time, after they settle it with their
student. Not ours, and not in bulk.
