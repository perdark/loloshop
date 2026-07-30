# HANDOFF

Rolling session handoff for whoever picks up next (human or Claude). Newest entry
on top. Keep entries short: **what changed · why · how it works · verified · open
follow-ups**. This file is auto-loaded into context via `@HANDOFF.md` in `CLAUDE.md`.

---

## 2026-07-30 (b) — 🍏 APPLE REJECTION FIXED: the camera crash was a MISSING PLIST STRING, not app code · in-app account deletion built (5.1.1v)

**Uncommitted. Migration 076 applied to the laptop dev DB + mirrored into `db/schema.sql` — prod needs
`npm run migrate` before the pm2 reload (`scripts/deploy.sh` L17 already does this).** The camera fix is on the
**`ios-appstore` branch** (worktree at `<scratchpad>/ios-wt`), NOT main — `codemagic.yaml` only exists there.
Gates: backend **161/161** (+8 new) · live HTTP e2e **15/15** · `tsc` 0 · `eslint` 0 · **browser-verified at 390px,
console clean**. `next build` NOT run locally (disk 90%); it runs on the server.

**⚠️ THE KEY INSIGHT — the two fixes deploy by completely different routes.** The iOS app is a **webview shell**
pointing at `lolo-shop96.com`, so **account deletion goes live by deploying the website (push main → VPS); it needs
NO rebuild and NO new binary.** Only the camera crash needs a Codemagic rebuild + re-upload.

**① Guideline 2.1(a) — the crash. Not an app bug: a missing Info.plist key.** There is **no `Info.plist` anywhere in
the repo**; `codemagic.yaml` runs `npx cap add ios`, which regenerates `ios/` from Capacitor's template on **every
build**. That template has no `NSCameraUsageDescription`, and **iOS terminates any process that touches the camera
without it**. The storefront attaches logos/designs with a plain `<input type="file" accept="image/*">`; tapping it in
WKWebView offers "Take Photo" → camera → instant kill, on every device, every time. There is **no `@capacitor/camera`
plugin** — the camera is reached purely through the webview's native picker, so **zero JS changed**.
**Fix:** a new codemagic step after `cap sync` injects `NSCameraUsageDescription` + `NSPhotoLibraryUsageDescription`
via `plutil -replace`, and **`exit 1`s if the keys are absent afterwards** — a silent no-op here is what a rejection
looks like two days later. Also sets `ITSAppUsesNonExemptEncryption=false`, which answers "Missing Compliance" **in
the binary** instead of re-answering it in ASC after every upload. **Committing the strings once would not work** —
they are wiped by `cap add` before they are ever compiled. Same regeneration trap already noted for the parked
`NSLocationWhenInUseUsageDescription`; that string is deliberately **NOT** added (GPS stays parked, and requesting a
permission the app doesn't use invites App Privacy questions).

**② Guideline 5.1.1(v) — deletion. `/delete-account` said "message @lolo_shop96", which Apple rejects outright**
(customer service is not an acceptable route outside highly-regulated industries).

**Owner decisions locked (2026-07-30):** ① **retail students only** (`SELF_DELETE_ROLES`, an allow-list) — a rep
deleting mid-season detaches 100+ students and kills their referral link, and staff/workshop accounts are payroll
identities tied to attendance and wage ledgers. ② **delete anyway, warn first** — blocking on an active order is a
barrier Apple can reject for the same guideline.

**THE SCHEMA DECIDED THE DESIGN — deletion ANONYMISES, it does not row-delete.** `orders.student_id` is
**`ON DELETE RESTRICT`** and `students.user_id` is `ON DELETE CASCADE`, so `DELETE FROM users` is **refused by the DB
the moment the student has one order** — and forcing it would erase the shop's own sales and settlement records.
So: the **account** dies, the **order** stays. That is safe only because `checkout_groups` already snapshots
`customer_name`/`phone_primary`/address per order, so **an in-flight sash still gets embroidered and delivered after
the student is gone** — the retained copy is the transaction record, not the account. Verified in the browser: order
left at `embroidery` with its delivery snapshot intact while the account read `حساب محذوف`.
Login becomes impossible on **two independent counts**: `phone` is NULLed (login looks accounts up BY phone) and
`password_hash` is replaced with a bcrypt hash of 32 random bytes. `token_version` is bumped, killing every issued JWT
and SSE ticket instantly. Cart, notifications, OTPs, password resets and trusted devices are deleted.

**What shipped.**
- **Migration 076** — `users.deleted_at` + a partial index. Tombstone only; nothing grants access from it.
- **NEW `backend/controllers/accountController.js`** — `deleteAccount` (password re-confirmed, whole scrub in one
  `tx`) + `deletionPreview` (feeds the warning). The UPDATE carries `AND deleted_at IS NULL`, so a double-tap or two
  racing tabs erase exactly once — **there is a test that fires two concurrent deletes and asserts `token_version`
  moves by exactly one and only one audit row exists**. The audit row deliberately stores **no name or phone** —
  copying the data you just erased back into the DB is not deletion.
- **`middleware/auth.js`** — the deleted check went into a **new shared `sessionValid()`** used by all three auth
  paths (`authRequired`/`authQuery`/`optionalAuth`) rather than pasted three times.
- **FE:** NEW `/account` screen (identity card, order links, danger zone with the active-order warning and a
  password-confirmed two-step delete, plus a terminal «تم حذف حسابك» state) · **«حسابي» added to the visible student
  nav** — a reviewer who cannot find the delete option reports it missing · `/delete-account` rewritten to describe
  and link the in-app flow.
- **NEW `npm run demo-account`** — recreates/resets the App Review demo login. **This is not optional housekeeping:
  Apple asks the reviewer to walk the deletion flow, and if they walk it on `07700000000` the account is GONE and the
  next submission fails with "we could not sign in".** Proven end-to-end: deleted the account over HTTP, ran the
  script, logged in again. It also warns when `DEMO_LOGIN_PHONES`/`DEMO_LOGIN_EXPIRES_AT` are missing (setting only
  the phone list leaves the bypass silently inert — the 2026-07-24 trap).

**Two things the browser caught that the tests could not.** ① The header kept showing «خروج» and «حسابي» after
deletion, because `StudentNav` re-checks auth only on `pathname` change and the flow **ends on `/account` without
navigating** — it looked like the deletion hadn't worked. Fixed with a `loloshop:auth-changed` event dispatched from
`logout()` (the native `storage` event only reaches OTHER tabs, so same-tab state had no way to notice). ② The
device token survived `logout()` by design; deletion now uses `logoutAndForgetDevice()`, since there is no account
left to keep the device trusted for.
**Also worth recording:** during testing the tab appeared to jump to `/` after a wrong password, which reads exactly
like "it deleted my account anyway". It did **not** — the DB showed `deleted_at NULL`, phone intact, no audit row,
and a clean replay stayed on `/account` for 8s with an empty navigation log. It was a dev-server reload artifact;
no app code redirects to `/`. The wrong-password path is verified correct in both the e2e and the browser.

### Open follow-ups
- **Two separate deploys, in this order.** ① **Website** (account deletion): push main → VPS. `scripts/deploy.sh`
  runs `npm run migrate` (L17, applies `db/schema.sql` which carries 076) **before** `pm2 reload` (L23), so the
  column lands by itself. This alone satisfies 5.1.1(v) — the app is a webview shell. ② **iOS binary** (camera):
  commit + push the `codemagic.yaml` change **on `ios-appstore`**, trigger the build, select the new binary in ASC.
  **Pushing main can never fix the crash — `codemagic.yaml` does not exist on main and Codemagic builds from
  `ios-appstore`.**
- **⚠️ IF THE `codemagic.yaml` EDIT IS LOST** (it was made in a git worktree under the session scratchpad, which is
  temp storage — `git worktree list` to check if it still exists): re-add it by hand on the `ios-appstore` branch as
  a new step in `workflows.ios-appstore.scripts`, placed **after** "Bake the real LoloShop icon" and **before**
  "Set up code signing". The whole step is:

  ```yaml
      - name: Inject the iOS privacy usage strings (FIXES the camera crash)
        script: |
          set -e
          PLIST="ios/App/App/Info.plist"
          plutil -replace NSCameraUsageDescription -string \
            "لالتقاط صورة لشعار جامعتك أو تصميمك وإرفاقها بطلب الوشاح." "$PLIST"
          plutil -replace NSPhotoLibraryUsageDescription -string \
            "لاختيار صورة الشعار أو التصميم من ألبومك وإرفاقها بطلب الوشاح." "$PLIST"
          plutil -replace ITSAppUsesNonExemptEncryption -bool false "$PLIST"
          for KEY in NSCameraUsageDescription NSPhotoLibraryUsageDescription; do
            plutil -extract "$KEY" raw "$PLIST" >/dev/null 2>&1 \
              || { echo "FATAL: $KEY missing from $PLIST — camera would crash on device"; exit 1; }
          done
          plutil -p "$PLIST" | grep -E "NSCamera|NSPhotoLibrary|ITSAppUsesNonExempt"
  ```

  It must run **after** `npx cap sync ios` because `npx cap add ios` regenerates `Info.plist` from Capacitor's
  template on every build and wipes anything committed into it. The `exit 1` loop is deliberate: without it a
  silently failed injection ships another crashing binary.
- **Reply to Apple in App Store Connect** with a **screen recording on a physical device** showing: sign in with the
  demo account → «حسابي» → «حذف حسابي نهائياً» → password → «تم حذف حسابك». Apple asked for this explicitly, and
  they want it in the App Review Notes for future submissions. **Then run `npm run demo-account` on prod to restore
  the login before resubmitting.**
- **Verify the camera on a real device before resubmitting** — this is the one fix I could not test here (no Mac, no
  iPhone). The build now fails if the plist keys are absent, so the failure mode is a red build, not a silent
  rejection, but the actual "Take Photo" tap should still be walked on TestFlight.
- **`ios-appstore` is still behind main and its lockfile is still desynced** (`@capacitor/ios` in package.json, not
  in package-lock). Building the app from that branch is fine — the shell just loads the live site — but do not merge
  it to main without running `npm install` in `frontend/` first.
- Unchanged on the board: the attendance-breaks feature above is still uncommitted in the same tree (my changes do
  not touch it), the payout-card feature + its `suggested_amount` lifetime-accrual bug, staff GPS parked. Still
  untracked and must not be committed: `frontend/public/dev-login.html`, `frontend/public/dev-token-tmp.json`.

---

## 2026-07-30 — NEW «الخروج المؤقت»: leave-the-shop button beside بصمة · 10h/month allowance · over-quota and unapproved minutes are real salary deductions

**Uncommitted on main.** Migration **075 applied to the laptop dev DB** + mirrored into `db/schema.sql` — **prod needs
`npm run migrate` before the pm2 reload** (`scripts/deploy.sh` already does this at L17). Gates: BE `node --check` 0 ·
**backend tests 153/153** (+26 new) · FE `tsc` 0 · `eslint` 0 errors. **NO browser walkthrough — stopped at the owner's
request mid-verification; the two screens are code+test-verified only.** Spec:
`docs/superpowers/specs/2026-07-30-attendance-temporary-leave-design.md`.

**The report.** «Add another button beside بصمة — some staff need to get out of the shop for an hour or 5/15 min. Everyone
has 10 hours a month to get out safely and any other time no.»

**Owner decisions locked (2026-07-30):** ① **free only if approved AND inside the allowance** — over-quota minutes and
any unapproved break are deducted («will get − on this money if admin didn't allow it»). ② **admin must approve first**,
with an explicit «خرجت بدون موافقة» escape hatch, because software can't stop someone physically leaving and the
unapproved case is the whole point of the deduction rule. ③ **break time is not worked time**. ④ break ends on **«رجعت»**,
charged on real elapsed minutes. ⑤ deducted minutes use the **existing `deduction_per_minute`** (1,000 IQD/min live).
⑥ **unapproved minutes still consume the allowance** — the balance measures time out of the shop, so skipping the request
can't buy free time; a minute is never deducted twice.

**⚠️ THE FINDING THAT SHAPED THE FEATURE — lateness deductions never actually reach the salary.**
`staff_attendance_records.deduction_amount` is computed and shown, but **nothing has ever inserted the matching
transaction**, and both `salaryController.js:47` and `payoutController.js:182` explicitly exclude
`source_type='attendance'` — a guard written for a feature that was never wired. So «مبلغ التأخير» on the attendance
screen is display-only today. Break deductions deliberately use **`source_type='attendance_break'`**, so they DO reduce
`buildSalarySummary`'s balance and the payout suggestion — which is what the owner asked for. **Whether lateness should
behave the same way is an open owner decision**, not something this batch changed.

**What shipped.**
- **Migration 075** (`db/migrations/075_attendance_breaks.sql` + schema.sql mirror): `break_monthly_minutes` on
  `staff_attendance_settings` (default **600**) and a **nullable** override on `staff_attendance_user_settings`
  (NULL = inherit) — the same two-layer shape as start/end/grace. New `staff_attendance_breaks` with `month_key`
  ('YYYY-MM' in Baghdad tz = the quota bucket), `state` (`requested|out|returned|cancelled`) × `approval`
  (`pending|approved|rejected`) as **two orthogonal fields**, `left_without_approval`, the frozen rate + computed
  charge columns, and `auto_closed`. **`uq_attendance_break_open`** is a partial unique index → one live break per
  worker enforced by the DB, not just a JS check (there is a test that drops to 23505 to prove it).
- **NEW `backend/lib/attendanceBreak.js` owns the entire money rule.** Because a later admin decision changes how the
  allowance was spent, **every change re-runs the worker's whole month in chronological order** (`recomputeMonth`)
  instead of patching one row — that is what keeps the sum of the parts equal to the balance no matter what order the
  admin acts in. Approving a returned break cancels its deduction via **soft-delete** (`deleted_at` +
  `delete_reason_ar`), matching the existing manual-transaction pattern. **Rate frozen per row** (workshop-ledger rule);
  **allowance read live**, so both settings endpoints re-price the current month immediately rather than letting the
  screen drift from the ledger.
- **NEW `backend/controllers/attendanceBreakController.js`** — staff request/leave/return/cancel/mine + admin
  list/balances/approve/reject/correct-duration, mounted in `routes/staff.js` and `routes/admin.js` (`breaks/balances`
  declared before `:id` so it isn't shadowed).
- **`worked_minutes` now excludes break time** (new `present_minutes` + `break_minutes` on every serialized record, via
  one `BREAK_MINUTES_SQL` subquery added to getToday/listRecords/calendar). **مدة العمل on `/admin/attendance` will read
  lower than before** — intended, and the staff card names the subtraction under the number.
- **بصمة الخروج auto-closes a forgotten break** at the checkout moment (`checkOut` is now wrapped in a `tx`), and drops
  an un-acted request. This is the guard against the feature's biggest footgun: 8 forgotten hours at 1,000/min would be
  480,000 IQD. Admin duration correction is the second guard.
- **FE:** NEW `components/staff/StaffBreakControl.tsx` — three states in one component (idle button + allowance bar /
  waiting with the «خرجت بدون موافقة» escape hatch / live timer + «رجعت»), mounted on **both** attendance surfaces
  (`StaffAttendanceCard` full + the compact `/staff` row — both had to change, as expected). Polls only while a break is
  live (20s ±5s), because a worker on «بانتظار موافقة المدير» has no other way to learn the admin answered. NEW
  «الخروج المؤقت» section on `/admin/attendance`: pending queue with one-tap approve/reject («أوافق وألغي الخصم» when the
  break is already charged), per-staff monthly balances, full log, duration-correction modal, allowance fields in both
  settings forms.
- **26 new tests** covering the rule as pure math, the chronological allowance spend, unapproved-consumes-allowance,
  approve-after-return cancelling the deduction, the frozen rate surviving a rate change, month bucketing across the
  Baghdad midnight, the DB uniqueness guard, checkout auto-close, `worked_minutes` exclusion, and every guard.

**Two real bugs the gates caught (not test noise).** ① `notifyAdmins` did `SELECT admins` then N inserts — an admin
account deleted in between fails the FK and **took the whole break request down with it**. Collapsing it to one
statement was not enough (READ COMMITTED re-checks the FK mid-statement), so **notifications now run AFTER the tx
commits** and can never fail the break; an error inside a Postgres tx aborts the whole tx, so it genuinely cannot be
caught in place. ② eslint's `react-hooks/purity` caught `Date.now()` inside a `useMemo` in the live timer — impure during
render and it would drift after the tab sleeps; it is now state seeded from the server's `open_minutes` and recomputed
from `left_at` each tick.

### Open follow-ups
- **Browser walkthrough pending** (the only gate not run): staff request → admin approve → «طلعت» → «رجعت» → confirm the
  balance drops; then an over-quota break and a «خرجت بدون موافقة» to confirm the deduction appears and that approving it
  afterwards removes it. **Dev servers left UP:** BE :4000 (plain `node server.js`), FE :3000 (`next dev`).
  Fresh 7-day tokens were minted for ابو عبدو (staff) and Admin — re-mint with `signToken` if they expire.
- **⚠️ A stale automation Chrome (`--user-data-dir=~/.cache/chrome-devtools-mcp/chrome-profile`) was holding the profile
  and blocked chrome-devtools.** Killing it is what verification needs first next time.
- **Owner decision open:** should lateness deductions also hit the salary balance, the way break deductions now do?
  Today «مبلغ التأخير» is display-only (see the finding above).
- **The allowance is a policy number read live**, so changing it retroactively re-prices the current month (deliberate,
  and the settings endpoints recompute immediately). Past months are never touched.
- Unchanged on the board: the payout-card feature still uncommitted (~68 files, `suggested_amount` lifetime-accrual bug),
  the 5 iOS ASC blockers, the unmerged `ios-appstore` branch + lockfile desync, staff GPS parked. Still untracked and must
  not be committed: `frontend/public/dev-login.html`, `frontend/public/dev-token-tmp.json` (live JWT).

---

## 2026-07-29 — ✅ PUSHED + DEPLOYED: الورشة piece rates split by customer (ممثلين / تجزئة) · payout card removed from workshop crew

**Pushed to main (`8832922`) → CI green (frontend · backend · Deploy to VPS) → live.** Migration **072 applied to prod by
the deploy** (`scripts/deploy.sh` runs `npm run migrate` at L17 before `pm2 reload` at L23). Gates: **backend 123/123**
(+5) · `tsc` 0 · `eslint` 0 · live e2e on the dev DB · **browser-verified** as a real workshop worker and as staff.
Spec: `docs/superpowers/specs/2026-07-29-workshop-retail-piece-rates-design.md` · plan:
`docs/superpowers/plans/2026-07-29-workshop-retail-piece-rates.md`.

**⚠️ OWNER ACTION REQUIRED — the split is live but numerically meaningless until you do this.** Migration 072 seeded every
تجزئة rate **equal to its ممثلين rate** (deliberate: shipping zeros would have paid workers 0 the first time anyone tapped
تجزئة). Go to **`/admin/workshop` → أسعار القطع** and enter the real retail wages. Until then retail work pays the
wholesale rate.

**The report.** «the syrian workers the prices are different on wholesaler (that already built) and the retail students
(not built) so just add a section for retail students working.»

**Owner decisions locked (2026-07-29):** ① **same jobs, second price** — every operation×product keeps its ممثلين price and
gains a تجزئة price; no fallback, both explicit. ② **the worker states the audience** via a toggle at the top of سجّل شغلك.
③ **labels + split totals** — worker sees the two totals separately, admin نظرة عامة filters. Per-worker breakdown was NOT
chosen. **Out of scope (unchanged):** workshop production is still standalone bulk piecework with **no link to `orders`** —
nobody verifies that the 20 retail robes a worker claims actually exist.

**What shipped.**
- **Migration 072** (`db/migrations/072_workshop_rate_audience.sql` + schema.sql mirror): `audience TEXT NOT NULL DEFAULT
  'wholesale' CHECK (audience IN ('wholesale','retail'))` on `workshop_piece_rates` AND `workshop_production_entries`. The
  unique key becomes `(operation, product, audience)` via `uq_workshop_rate` — **the old
  `workshop_piece_rates_operation_product_key` is DROPPED**. `DEFAULT 'wholesale'` is the backfill: every pre-existing rate
  and entry becomes ممثلين, which is what they were. Retail rates seeded by copying wholesale.
- **`workshopController.js` — three call sites had to move together**, because the migration invalidates all of them:
  `upsertRate`'s `ON CONFLICT(operation,product)` (would throw on every call), `insertProduction`'s rate lookup (post-migration
  it matched TWO rows with no ORDER BY — this computes real wages), and `ratesMatrix`'s `${op}:${product}` map key (audience
  rows collided, last-one-wins). All three now carry audience. `ledgerFor` + `dashboard` return
  `production_wholesale`/`production_retail` (+ `pieces_*`).
- **The audience has NO DEFAULT anywhere.** `validatePiece` rejects a missing/unknown audience with «حدد لمين هالشغل: ممثلين
  أو تجزئة»; the worker's submit button stays disabled until tapped. Deliberate — the 2026-07-26 session lost an order to a
  Chrome-autofilled `<select>`, and this field decides the wage.
- **Rates stay frozen per entry** (`rate`/`amount` copied at insert) — editing a price never rewrites past wages. Tested.
- **NO `?audience=` API filter** — حوافز/خصومات belong to no audience, so a server-side slice would return a المستحق that
  doesn't reconcile with its own parts. The admin filter is presentation-only and المستحق renders under الكل alone.
- **`RateRow` now returns 20 rows instead of 10**, which silently doubles every product/operation dropdown. Both recording
  forms scope their pickers to one audience — worth remembering if a third recording surface is ever added.
- **Payout card removed from the workshop crew** (owner, same session): `PayoutAccountPanel` off `/workshop`, and the two
  `/workshop/me/payout-account` routes deleted. **This also fixed a latent deploy-breaker** — see below.

**Two tests the reviewer proved were worthless, now real.** A migration test asserted `COUNT(*) WHERE audience NOT IN (...)`
against a table with **0 rows** — it passed unconditionally and proved nothing; it now inserts an entry *without* naming an
audience and asserts it lands as `wholesale`. A uniqueness test checked that no duplicates *happened to exist* rather than
that the DB *rejects* one; it now attempts a colliding insert and asserts `23505`. Both verified by dropping the constraint
in a rollback sandbox and confirming they then fail.

**⚠️ THE CATCH WORTH REMEMBERING — the branch would have broken the production build.** `frontend/app/workshop/page.tsx` is
tracked, but it imported `@/components/payments/PayoutAccountPanel` and `@/lib/payments`, which are part of the **still-
uncommitted** payout feature — **0 of those files are tracked in git**. A tracked file importing untracked files typechecks
fine locally (the files are on disk) and fails `next build` on the VPS. Caught pre-push by grepping every committed-on-branch
file for references to untracked code, then **stashing all 68 uncommitted files and re-running the gates against exactly what
prod would see** (tsc 0, 120/120 — the 3 missing tests live in the untracked payout file). **Do this check whenever a feature
branch is cut while another feature sits uncommitted in the same tree.**

### Open follow-ups
- **Enter the real تجزئة rates** (top of this entry). Nothing else about this feature matters until that is done.
- **Deploy window:** migration 072 drops the unique constraint that the *old* deployed `upsertRate` targets, so
  `PUT /workshop/rates` 500s for the seconds between `npm run migrate` and `pm2 reload`. Admin-only, rarely used, inherent to
  any unique-key change. Already past for this deploy.
- **The payout-card feature is STILL uncommitted (~68 files in the tree) and did NOT deploy** — deliberately. Blocking issue:
  **`suggested_amount` is a lifetime accrual that manual payouts never reduce** (staff `base_salary + bonuses − deductions`,
  workshop `production + bonuses − deductions`; neither subtracts `manual_payouts`). Pay محمد عادل his 501,000 and the screen
  still suggests 501,000 next month — a pay button beside a number that never drops. Also: **ابو عبدو appears twice** in the
  recipients list (once `tailor` via `role='staff'`, once `workshop` via `workshop_workers`) so the counter reads 11 for 10
  people; **مضر محمد's suggested amount renders as −775,000**; and changing someone's card leaves **no history** (upsert keeps
  only `updated_by`, no `audit_log` row) unlike every other money path in this repo.
- **Also uncommitted in that batch:** the eligibility gate added this session — workshop crew (checked against the
  `workshop_workers` roster, NOT by name or staff_type, so it keeps holding) get `eligible:false` from
  `/payroll/me/payout-account` and a 403 on PUT; `/staff/me` hides the panel. Verified for ابو عبدو (hidden) vs محمد عادل
  (shown). Admins have no card panel of their own — they set everyone else's from `/admin/payouts`.
- **Android icon/splash assets** (`capacitor-assets generate --android`, versionCode 3 / 1.0.2) also still uncommitted.
- **Process note from the owner, applies to future sessions:** the full brainstorm → spec → plan → per-task
  implementer/reviewer pipeline was **too heavy for a change this size** («u took a lot of time for a simple feature»).
  Tasks 3-5 were done directly in minutes at the same quality. Reserve the ceremony for genuinely large or risky work; for a
  few-file feature go straight to editing with a verification pass at the end.
- Unchanged on the board: the 5 iOS ASC blockers, the unmerged `ios-appstore` branch + lockfile desync, staff GPS parked.
  Still untracked and must not be committed: `frontend/public/dev-login.html`, `frontend/public/dev-token-tmp.json` (live JWT).

---

## 2026-07-26 (b) — ✅ PUSHED: «طلب مستقل بدون ممثل» is a real retail order builder · admin's «طلب مخصص» dead end fixed · hydration + autofill bugs

**Pushed to main → auto-deploys.** No migration. Gates: **backend tests 111/111** (+11 new) · FE `tsc` 0 · `eslint` 0
errors · **browser-verified end to end** on the laptop dev DB (a real 2-piece order created and re-opened in the editor).
Spec: `docs/superpowers/specs/2026-07-26-independent-retail-order-builder-design.md`.

**The report.** «still طلب مستقل بدون ممثل is not enough and bad, i want it like all informations of students and all
products for retail students.» Plus, earlier the same session: «the custom order is not working, also غير مصرح».

**① The admin «طلب مخصص» dead end (fixed first — it blocked everything else).** `backend/routes/staff.js:9` guards the
WHOLE `/api/staff/*` router with `requireRole('staff')`, which blocks the **admin** role by design (the comment on
line 20 says so). But `app/staff/custom-order/page.tsx` claimed `isManager = role === 'admin' || …` and
`StaffSidebar.tsx:100` pointed admins at `/staff/custom-order` — so the page rendered, its config 403'd, and the admin
got «تعذر تحميل نموذج الطلب». Classic [[project_state_machine_single_source]]: the frontend mirroring an authz rule the
backend owns. **Fix is frontend-only** (backend authz deliberately NOT widened): the sidebar sends admins to
`/admin/custom-order`, and `/staff/custom-order` now redirects them there instead of guessing.

**② The finding that shaped the rebuild: the problem was the IDENTITY, not the form.** `createCustomOrder` made the
independent student with `users.phone = NULL` / `students.gender = NULL`, and
`eligibleForFullSet = wholesaler_id != null || phone == null` makes such a student **permanently a طقم student**
(`editContext` → `full_set`, `saveRetailConfiguration` → 403, search → `full_set_eligible: true`). So a pretty retail
creation form alone would have produced retail-priced orders that **the طقم editor re-prices rep-style on the next
edit** — the [[project_order_write_paths_sync]] money-bug class. Owner accepted the consequence: **phone is now
REQUIRED** for an independent student (and gender, because `priceSelections` rejects gender-restricted options when
`studentGender` is null).

**③ NEW `POST /api/production/retail-orders`** (`orderEditController.createRetailOrders`, admin + manager). Takes
`{student|student_id, pieces[1..10], group}` → creates/resolves the student, **one** `checkout_group`, one `orders` row
per piece. Every piece priced by `priceSelections({role:'retail'})` — never the rep addon table. Per-piece routing
(embroidery → `design_complete`, plain cap → `preparing`, else `pressing`), `wholesaler_approval = NULL`, per-piece
duplicate pre-check → 409 `ERR_DUPLICATE_PIECE` + 23505 race backstop, duplicate-product-in-one-payload → 400, and
**everything in ONE `tx`** so a half-created student or 2-of-3 pieces can't be left behind. `users.phone` is UNIQUE →
**409 `ERR_PHONE_TAKEN` naming the existing student** (never silently attaches to whoever owns the number). The old
single-piece `POST /students/:id/retail-order` is now a thin adapter over the same core — one write path, not two.

**④ NEW `components/staff/RetailOrderBuilder.tsx`** replaces `RetailSingleOrderForm`. «+ أضف قطعة» → picker over all
four families from `getShopFeed()` → the shared `RetailPieceOptions` (byte-identical to the storefront — verified side
by side on وشاح ملكي: same 5 groups, same labels, same optionality, same price) → per-piece card with ✎/✕, one delivery
section, one total. Serves **both** «طالب جديد + مستقل» and «طالب موجود + تجزئة», so the two retail surfaces can't
drift. Products already in the order are disabled in the picker. Validation names the offending piece
(«قبعة سادة: اختر: لون القبعة»).

**⑤ Two bugs found in the browser, not the code review.**
- **Hydration error:** `<Spinner>` renders a `<div>` and was wrapped in `<p>` in 4 places (2 of them in the new file) —
  invalid HTML, logged as a React hydration error on every load. All 4 → `<div>`.
- **⚠️ Chrome autofilled the gender `<select>` to «ذكر»** without the admin touching it (and نوع الدراسة to «صباحي»).
  Gender decides which option groups render AND price, so an unnoticed default silently builds the wrong order. Gender
  is now a **radio group** (autofill-proof, one tap on a phone) and every new-student field carries
  `autoComplete="off"`. **Worth remembering: never put a required, semantically-guessable field in a bare `<select>`.**

**Verified in the browser** (dev DB): created «سارة تجريبية للاختبار» + وشاح ملكي 25,000 + قبعة سادة 15,000 → one
`checkout_group`, prices at the retail book, sash `design_complete` / cap `preparing` with `needs_pressing=false`,
`wholesaler_approval` NULL on both, and **`eligibleForFullSet = false`** — then re-opened the sash in the editor and
confirmed it renders the **retail** editor («طلب تجزئة» + «نوع القطعة» swap picker), not the طقم form. That last check
is the whole point of the design.

### Open follow-ups
- **Test row left in the laptop dev DB** (harmless, snapshot-only): student «سارة تجريبية للاختبار» / `07701234567`
  with 2 orders. Delete when it gets noisy.
- «طالب جديد» **with a rep selected** is unchanged — `FullSetOrderForm`, rep التسعيرة, approval flow. Only the
  independent path became retail.
- The single-piece `POST /students/:id/retail-order` now has **no frontend caller** (the builder posts to
  `/retail-orders`). Kept as a tested adapter; delete it if nothing external uses it.
- Governorate is still a free-text input — there is no governorate list constant in the frontend.
- **`frontend/node_modules` had to be reinstalled from scratch this session** — a half-finished npm install left
  `.bin/next` unlinked and `next dev` printed "Ready" then exited after 1s. If :3000 dies that way again, `rm -rf
  node_modules && npm install` (clear `node_modules/@img/.sharp-*` leftovers first if `ENOTEMPTY`).
- Still untracked and must not be committed: `frontend/public/dev-login.html`, `frontend/public/dev-token-tmp.json`
  (the latter holds a live admin JWT).
- Unchanged on the board: the 5 iOS ASC blockers, the unmerged `ios-appstore` branch + lockfile desync, staff GPS parked.

---

## 2026-07-26 — Finished the two half-built features: تبديل المنتج (retail piece swap) + «طلب مخصص» for تجزئة students · the (student, product) invariant now has an Arabic answer

**Uncommitted on main.** No migration. Gates: BE `node --check` 0 · **backend tests 100/100** (was 22/23 failing on the
retail-order path when this session started; +3 new) · FE `tsc` 0 · `eslint` 0. **NO browser test** — port 3000 is
running a different project this session, so the two new screens are code-verified only (see follow-ups).

**Where it stood.** The 07-25 session left the BACKEND of two features in the working tree with **no UI for either**,
and one failing test. Nothing in `frontend/` referenced `swap_candidates`, `keep_price`, `force_design_rework`,
`full_set_eligible` or `POST /production/students/:id/retail-order`.

**① The failing test was a real defect, not a bad fixture.** `uq_orders_student_product_nodesign` (`db/schema.sql:310`)
allows **one live design-less order per (student, product)**. `createRetailOrder` INSERTed blind, so ordering a product
the student already holds raised a raw **23505 → 500** with no Arabic message. The SWAP path had the same hole
(swapping a piece ONTO a product the student already owns). Both now:
- pre-check via NEW `liveOrderForProduct(studentId, productId, exceptOrderId)` → **409 `ERR_DUPLICATE_PIECE`** carrying
  **`existing_order_id`** so the UI can point at the order to edit instead;
- keep a 23505 catch as the race backstop (check and write are not atomic);
- and `swapCandidates` now filters out products the student already holds — **the picker can't offer a target that
  would 409**. Three tests cover it (create-duplicate, swap-onto-owned, candidate-hidden).
- `editContext` also returns **`can_force_rework`** — whether «أرجع الطلب إلى بانتظار التصميم» is meaningful is a
  state-machine question, so it is answered server-side from `REWORKABLE_STAGES` rather than mirrored in the UI
  ([[project_state_machine_single_source]] — a frontend copy of that set is how ghost buttons that 409 get built).
- `students-search` now also returns `gender` (the retail form's option groups are gender-scoped).

**② تبديل المنتج — UI in `RetailOrderEditForm.tsx`.** A «نوع القطعة» radio-card picker (current piece + same-family
siblings with their retail base price). Picking one reloads the priced product **without resetting the admin's
in-progress edits** (a `initialised` ref splits first-load-fills-from-order from later swap-reloads; selections are
pruned to groups that still exist, which for a same-family swap is a no-op by construction). Plus two checkboxes:
**«تثبيت السعر الحالي»** (`keep_price` — shows the recomputed price struck through next to the price that will
actually be saved) and **«أرجع الطلب إلى بانتظار التصميم»** (`force_design_rework`, rendered only when
`can_force_rework`; the copy names what it destroys — zones, final design, shelf slot). The confirm modal states the
product change, the applied price and the rework explicitly.

**③ «طلب مخصص» for تجزئة — NEW `components/staff/RetailSingleOrderForm.tsx`.** `CustomOrderForm` (shared by
`/admin/custom-order` and `/staff/custom-order`) now branches on `full_set_eligible`: a self-registered تجزئة student
gets a single-piece retail form (product picker from `getShopFeed()` — admin/staff resolve to the **retail** price
role, verified in `priceRoleForUser`), options, robe measurements, delivery fields, price breakdown, confirm. It calls
`POST /production/students/:id/retail-order` itself (that endpoint accepts admin AND manager, so one component serves
both pages) and the host page routes to the created order. `pickStudent` **no longer calls the طقم read-back for a
تجزئة student** — that endpoint 403s for them by design and used to toast «تعذر تحميل طلب الطالب» and unpick.

**④ Shared fields extracted — NEW `components/admin/RetailPieceFields.tsx`** (`RetailPieceOptions`,
`RobeMeasurementFields`, `robeMeasurementsError`, `emptyRobeMeasurements`). Both retail surfaces post to endpoints
priced by the same server-side `priceSelections(role:'retail')`, so they must offer the same fields; one copy is what
guarantees it. `RetailOrderEditForm` was re-pointed at it (net −120 lines there).

### Open follow-ups
- **Browser walkthrough not done.** Worth clicking: (a) `/staff/orders/<retail order>/edit` — swap picker, keep-price
  strike-through, rework checkbox; (b) `/admin/custom-order` → «طالب موجود» → pick a تجزئة student → the single-piece
  form; (c) the 409 path — order a product the student already has and confirm the Arabic message. Dev fixtures on the
  laptop DB: تجزئة students نضال حيدر علي / حسين احمد صادق صبري; retail robe orders `61cf8f68…`, `71e33416…`
  (20 siblings each, so the picker is well populated).
- The retail create form makes **one piece per submit** (stated in the UI). A second piece = a second طلب.
- Governorate is a free-text input — there is no governorate list constant in the frontend today.
- Still untracked and must not be committed: `frontend/public/dev-login.html`, `frontend/public/dev-token-tmp.json`
  (the latter holds a live 7-day admin JWT).
- Everything else on the board is unchanged: the 5 iOS ASC blockers, the unmerged `ios-appstore` branch + lockfile
  desync, staff GPS parked.

---

## 2026-07-24 — 🍏 iOS submission: reviewer demo login was DEAD in prod (fixed) · listing metadata written · 5 ASC blockers left

**Session paused mid-submission — user tired, resuming next session. NOTHING expires; the ASC draft and the uploaded
build both persist.** Only prod change this session = one env var (below). No code committed, no rebuild needed.

**① THE REAL FIND — the App Review demo login was broken on prod and would have failed review.**
`POST /api/auth/login {07700000000, Lolo#Review2026}` against lolo-shop96.com returned **`otp_required: true`** — Apple's
reviewer would have hit the WhatsApp OTP wall on an Iraqi number they don't own → guaranteed rejection.
**Cause:** the 2026-07-19 security batch added a SECOND gate, `DEMO_LOGIN_EXPIRES_AT`, that was never set in prod.
`isDemoLoginPhone` (`backend/lib/otp.js:44-48`) parses the deadline FIRST — unset → `NaN` → `return false`, so the
allow-list is **silently inert** even though `DEMO_LOGIN_PHONES=07700000000` was correctly present. **Setting only the
phone list looks configured but does nothing.**
**Fix applied to prod** (`.env` backed up to `.env.bak-pre-demo-expiry-20260724`): added
`DEMO_LOGIN_EXPIRES_AT=2026-08-21` + `pm2 restart loloshop-api --update-env`. **Verified live:** login now returns a
token, `otp_required:false`; token works on `/api/auth/me` `/api/catalog/shop` `/api/orders/mine` (all 200), unauth
control still 401. Account confirmed `role='retail'`, id `fd00c7e2…`. Memory `project_play_reviewer_demo_login` updated
with the two-var requirement + the curl verification command.
**⚠️ The bypass DIES 2026-08-21** — if review is rejected and resubmitted after that, push the date forward + restart.

**② Listing metadata written + verified against Apple's limits** (Promotional 129/170 · Description 976/4000 ·
Keywords 92/100 · Review Notes 2583/4000). All URLs verified 200: `/` `/privacy` `/terms` `/delete-account`
(the last one matters — Apple REQUIRES in-app account deletion for any app with sign-up; we have it).
Review Notes deliberately (a) tell the reviewer the OTP is bypassed so they don't read login as broken, and (b) name the
configurator + live production tracking as the non-webview functionality — that is the **4.2 minimum-functionality**
defense. Contact: Furqan Wesam · +9647713644460 · fn.the.gamer@gmail.com. Release = **Manually release**.

**③ Five ASC blockers remain (all in the browser, nothing to build):**
1. **13-inch iPad screenshot** — decision made: KEEP iPad support (staff use iPads), just add screenshots; do NOT
   drop iPad (that needs a target change + full rebuild + re-upload). **1 of 4 captured**:
   `~/Desktop/loloshop-ios-assets/screenshots-ipad/01-home.png` at **2048×2732** (valid for the 13" slot).
   Method: chrome-devtools `emulate` viewport **`1024x1366x2`** → screenshot → exact 2048×2732, no scaling needed.
   **NB `/shop` 301s to `/`** — the catalog is a section on the home page (`/#catalog`), so a plain `/shop` capture is a
   duplicate of the home viewport. Remaining 3: catalog (`/#catalog`), a product page
   (e.g. `/product/5b5c3ff7-4f6d-4aba-8744-17d1110bc0ce`), and `/sizes`. Screenshot files MUST be written inside the repo
   root (MCP workspace restriction) then moved out.
2. **Content Rights** (App Information) → No third-party content.
3. **Age Rating** (App Information) → answer None to all → 4+.
4. **Privacy Policy URL** → `https://lolo-shop96.com/privacy`.
5. **App Privacy questionnaire** → data collected: name, phone, photo uploads, order history. **Verified there are NO
   analytics/tracking SDKs** (grepped for gtag/GA/GTM/Pixel/Mixpanel/Amplitude/Sentry/PostHog/Vercel Analytics — none),
   no ads, no IDFA. Physical goods + cash ⇒ no IAP (correctly skipped).

### Open follow-ups
- **Staff GPS is PARKED until the app is approved (owner decision).** Today it is harmless: live
  `staff_attendance_settings.verification_mode = 'none'` ⇒ `verified` is always true, so attendance stamp-in works on
  iPhone with no location permission and just stores `latitude: null`.
  **⚠️ FOOTGUN: do NOT switch `verification_mode` to `location`/`both`/`network_or_location`** until (a) an iOS build
  ships with `NSLocationWhenInUseUsageDescription` and (b) `shop_latitude`/`shop_longitude` are set — they are **NULL
  right now**, so location mode would 403 «لا يمكن تسجيل البصمة خارج نطاق المحل» for EVERY user on EVERY platform
  (`attendanceController.js:409`, `:490`). iOS 1.1 work = plist string via a `codemagic.yaml` step (the iOS project is
  regenerated each CI run, so a one-off file edit will not survive), then **test on TestFlight whether plain
  `navigator.geolocation` actually returns coordinates inside Capacitor's WKWebView** — if not, use `@capacitor/geolocation`.
- Branch `ios-appstore` still NOT merged; the `frontend/package-lock.json` desync is still open (`@capacitor/ios` is in
  package.json but NOT installed locally). **`npm install` was deliberately NOT run — disk is at 97% (2.3G free)** and
  would risk ENOSPC. Free disk before merging.
- Untracked junk still present and must not be committed: `frontend/public/dev-login.html`,
  `frontend/public/dev-token-tmp.json`.

---

## 2026-07-23 — 🍏 iOS App Store: build pipeline WORKS end-to-end (Codemagic, NO Mac) · binary with real icon uploaded to App Store Connect · listing ~60%, submission NOT sent

**No Mac / no iPhone used — all via Codemagic cloud CI.** Branch **`ios-appstore`** (NOT merged to main — hazard below).
Website/prod untouched. Full working `codemagic.yaml` is the reference for any future Capacitor iOS app. Memory:
[[project_mobile_apps_capacitor]].

**What got done (Apple account → green build with the real icon uploaded):**
- Apple Developer acct ($99) activated. ASC **API key** (role Admin, `.p8` saved), **bundle id `com.loloshop96.app`**
  registered (+Push cap), **app record: Apple ID `6793976053`**, «لولو شوب», ar-SA, SKU loloshop-ios.
- Codemagic connected to the GitHub repo. ASC integration named **`revoart_asc`** (account-wide — reuse for future apps).
  **`CERTIFICATE_PRIVATE_KEY`** added as a **Secure** var in Codemagic group **`ios_signing`**.
- **`codemagic.yaml` at repo ROOT** (workflow `ios-appstore`): install → generate iOS (SPM) → bake icon → sign → timestamp
  build number → build-ipa → upload to ASC. **GREEN.** A build with the **real LoloShop icon** is uploaded + selected.
- Assets at **`~/Desktop/loloshop-ios-assets/`**: `AppIcon-1024.png` + **4 screenshots at 1284×2778** (captured LIVE from
  lolo-shop96.com via chrome-devtools at viewport `428x926x3`). Listing metadata drafted + given to user (Arabic description,
  keywords, Support URL lolo-shop96.com, Marketing URL instagram, Copyright «2026 Lolo Shop»).

**⚠️ EVERY failure hit this session + its fix — DO NOT re-debug these:**
1. **Apple "Failed to verify your identity"** (brand-new paid account login) — NOT a browser bug. New account still activating
   + **home Wi-Fi IP flagged**. **FIX: sign in over phone mobile-data / hotspot** (different IP). Worked instantly.
2. **Codemagic "repository doesn't contain a mobile application"** — app is in `frontend/`. **FIX: `working_directory: frontend`
   (the yaml MUST stay at repo root)** + "Set type manually" to get past the scanner wizard.
3. **Signing "No matching profiles found … app_store"** — the declarative `ios_signing` block only FETCHES, never creates.
   **FIX: drop `ios_signing`; use `app-store-connect fetch-signing-files --type IOS_APP_STORE --create`.**
4. **"App.xcworkspace does not exist" then "No Podfile found"** — **Capacitor 8 uses Swift Package Manager, NOT CocoaPods**
   (no Podfile, no .xcworkspace). **FIX: NO pod install; build `ios/App/App.xcodeproj` via `build-ipa --project` (not --workspace).**
5. **"Cannot save Signing Certificates without certificate private key"** — the first distribution cert needs a private key.
   **FIX: generated RSA key at `~/Desktop/loloshop-ios-cert-key.pem`, added as Secure var `CERTIFICATE_PRIVATE_KEY` (group
   `ios_signing`), passed `--certificate-key=@env:CERTIFICATE_PRIVATE_KEY`. Key MUST be stable across builds** (a per-build key
   hits Apple's cert limit).
6. **"App Store distribution fail" (TestFlight)** — cosmetic: the binary uploaded fine; only external-TestFlight submit needs
   "Test Information". **FIX: `submit_to_testflight: false` (upload only).**
7. **Screenshot dimensions rejected** — uploaded 1290×2796 (6.7″) into the 6.5″ slot. **FIX: 1284×2778 (valid for both slots).**
8. **Default Capacitor placeholder icon** (generic blue X — was on BOTH stores; Play only showed the logo because it was
   uploaded to the listing separately; **Apple takes the icon FROM THE BUILD — no separate upload**). **FIX: `@capacitor/assets`
   + `frontend/resources/icon.png|splash.png|splash-dark.png` (rendered from the 4672px `frontend/public/logo.png`) + CI step
   `npx capacitor-assets generate --ios`.** Needed a rebuild.
9. **Upload "bundle version must be higher than 1"** — `get-latest-app-store-build-number` returned 0 → recomputed 1.
   **FIX: timestamp build number `agvtool new-version -all $(date +%s)`.**
10. **"Missing Compliance" (export compliance)** — **ANSWER: "None of the algorithms mentioned above"** (app only uses
    OS-provided HTTPS, implements no crypto → exempt, no docs to upload).

**WHERE THE USER STOPPED — resume here (in the App Store submission):**
- Finish **export compliance** → "None of the algorithms mentioned above".
- **Pricing → Free** · **Age Rating → 4+** (answer "None" to all) · **Content Rights → No** third-party content.
- **App Privacy** questionnaire — data collected: name, phone, photos/logo uploads, order history — answer accurately.
- **App Review Information** ⚠️ — reviewer contact + **demo login `07700000000` / `Lolo#Review2026`** (OTP-skip via
  `DEMO_LOGIN_PHONES` env — [[project_play_reviewer_demo_login]]). **VERIFY this login works on the LIVE site first** (env must
  be set in prod) or the reviewer can't pass the WhatsApp OTP → rejection.
- Then **Submit for review** (Apple review ~1–3 days).

### Open follow-ups / hazards
- **⚠️ 4.2 (Minimum Functionality) rejection risk** — LoloShop is a webview shell loading lolo-shop96.com; Apple's #1 reason
  to reject wrappers (Android sailed through; Apple is stricter). If rejected: harden with real APNs push + native splash +
  native camera for logo upload. Physical goods + cash = exempt from IAP/30% (no payment work).
- **⚠️ Branch `ios-appstore` NOT merged to main** — main auto-deploys the website AND CI uses `npm ci`, which BREAKS on the
  unsynced lockfile (`@capacitor/ios` + `@capacitor/assets` were added to `frontend/package.json` without updating
  `frontend/package-lock.json`). **Before merging: run `npm install` in `frontend/` to sync the lockfile.** Until then keep
  iOS work on the branch — it never touches prod.
- **Android has the SAME placeholder icon on the phone** (Play shows the logo only because it was uploaded to the listing).
  `frontend/resources/` now holds the source — next Android `.aab` rebuild: `npx capacitor-assets generate --android`.
- Secrets on disk to back up: **`~/Desktop/loloshop-ios-cert-key.pem`** (signing private key — needed to reuse the same
  distribution cert on future builds) + the ASC `.p8` (user saved it). A chrome-devtools tab may still be open on lolo-shop96.com.

---

## 2026-07-21 (b) — ✅ PUSHED: قطعة · طلب · طالب — one unit vocabulary · TV board rebuilt · dead delivery panels deleted

**Pushed to main (`303c9f0`) → auto-deploys.** No new migration (069+070 ride along from the earlier sessions;
`scripts/deploy.sh` runs `npm run migrate` at line 17 BEFORE `pm2 reload` at line 23, so the ordering hazard is
handled automatically). Gates: **backend tests 72/72** (7 new) · `tsc` 0 · `eslint` 0 errors · live HTTP against
`/api/admin/analytics` + `/api/tv/snapshot` · browser-verified on `/admin` and `/tv`.
Spec: `docs/superpowers/specs/2026-07-21-counts-units-design.md`.

**The report.** «The numbers for admin/wholesaler/staff and at TV have bad UI/UX and bad logic — nobody understands
how many students or orders or pieces they have. I don't want to add a clarify, I want to debug and solve it.»

**What was actually wrong (measured on the dev DB, not guessed).** An `orders` row is one PIECE; the bundle
(`checkout_group_id`) is what a human calls an order. Both were labelled «طلب»: **1727 pieces / 578 bundles /
553 students** — the same shop read as 1727 «طلب» on the TV and 578 on `/admin`. An audit of **56 counts found
~25 label/SQL mismatches**.

**The structural error: a bundle has no status.** 76% of bundles span 2-3 statuses at once (وشاح at التطريز while
the قبعة is still بانتظار التصميم), so per-stage bundle counts summed to **1035 against a real 578 — a 79%
overcount** that could never reconcile. Pieces sum exactly (1023+475+107+107+9+6 = 1727).

**The second finding — the pipeline has no exit.** 1727 pieces created since 2026-06-23, **6** reached «جاهز»,
**0** ever marked «مُسلَّم** (0 audit rows; `delivered_at`/`delivered_by` never written). Every TV panel measuring
delivery was a permanent zero **including the هدف اليوم goal bar, which could never move**.

**Owner decisions locked (2026-07-21):** «طلب» = the bundle · «قطعة» = the piece · «طالب» = the person, never
interchangeable (note «طقم» was rejected — it already means the full-set package). Funnel shows both columns.
Hero = work-remaining per role. **«جاهز» is the finish line for now**; dead مُسلَّم panels are DELETED, not
relabelled. Rank ladder measures **retail طلب** with the owner's **3000 goal**. Thresholds keep their stored
values as pieces. **Scope this pass = admin + TV only.**

**What shipped.**
- **NEW `backend/lib/counts.js`** — sole owner of every order count (`countPieces/Bundles/Students`,
  `countBundlesInProgress`, `stageFunnel`, `summary`, parameterised `buildScope`). `COALESCE(checkout_group_id, id)`
  now lives in ONE file instead of the ~15 it was copy-pasted across. **Money/settlement queries deliberately untouched.**
- **NEW `frontend/components/ui/Count.tsx`** — `unit` is a **required** prop, so a new screen physically cannot
  render a unitless number and invent a fourth meaning. Handles Arabic singular/dual/plural.
- **`/admin`:** hero «طلب قيد التنفيذ» (any piece not yet جاهز) + secondary «إجمالاً · قطعة · طالب»; stage chart
  relabelled to قطعة with a second thin bar «طلاب لديهم قطعة هنا» **named in the legend** so it can never be summed;
  **the disclaimer at the old `page.tsx:462-463` — which documented the mismatch instead of fixing it — is deleted**;
  money-ledger count relabelled **«طلبات محتسبة»** to name its settlement scope (492) against the operational hero (578).
- **`/tv`:** ~17 counts re-sourced to bundles (lifetime, KPIs, best day/month, YoY, universities, governorate,
  deadlines, orders-in graph); `pipeline.wip` left as pieces (it was already correct). Delivered tiles + the
  always-empty «مُسلَّم» series **removed**. **Goal bar now measures pieces advanced today (status_change actions),
  so it actually moves** — was hard-wired to deliveries and stuck at 0 forever.
- **Rank ladder rebuilt:** was fed `COUNT(*)` pieces, inflating the rank ~3×. Now retail bundles, **11 rungs
  (البداية → أسطورة) topping out at the owner's 3000**, and **mirrored onto `/admin`** via a shared exported
  `rankFor()` so the two screens can never disagree. Live: تاجر موثوق, 218 retail, 32 to سيّد الأوشحة, 79%.
- Also fixed: the station sheet's «التفاصيل» link was a ~24px tap target (`text-[11px]`/`py-1`) on the iPad+phone
  the stations run on — now `min-h-11` (`86e1d28`).

### Open follow-ups
- **Pass 2 — rep + staff screens still use the old wording.** Until then «طلب» means the bundle on `/admin` and
  something looser on `/staff`. Worst known case: admin says a rep has 40 «طلب» (bundles, `adminController.js:540`)
  while `app/staff/queue/page.tsx:599` says 118 «طلب» (pieces) for the same rep.
- **Known limitation (documented in spec §6c):** date-bucketed bundle counts (best day, best month, YoY graph)
  count a bundle once per bucket its pieces fall into, so the monthly series sums to **592 vs a true 578** (~2.4%).
  Fix = date each bundle by its first piece (`DISTINCT ON … ORDER BY created_at`) across 4 queries. Headline
  figures unaffected.
- **The delivery step is still not part of anyone's workflow.** `FINISHED_STATUSES` in `lib/counts.js` already
  includes `delivered`; if the رف collect flow becomes the real handover, point «قيد التنفيذ» at it. Until then
  the hero reads 577/578 because almost nothing is ever closed — **honest, but not yet actionable.**
- Latent, untouched: `batchController.js` ships `order_count` twice with different units (`:48` bundles, `:97`
  pieces) in one response; `wholesalerController.js:36` `pending_count` counts students but reads as orders.
- **`frontend/public/dev-login.html` is deliberately left UNTRACKED** — it is a dev localStorage-token helper and
  `public/` is served in prod. Do not commit it.

---

## 2026-07-21 — Calligraphy: «تجزئة» review-before-generate board · retail made visible at all · draft no longer lost on navigation

**Uncommitted on main.** Migration **069 applied to the laptop dev DB** (`ALTER TYPE calligraphy_source ADD VALUE 'retail'`,
additive + backward compatible) and mirrored into `db/schema.sql` — **prod needs `npm run migrate` BEFORE the pm2 reload**.
Gates: BE `node --check` 0 ×2 · FE `tsc` 0 / `eslint` 0 · **live HTTP e2e on the dev DB, self-cleaned (0 leftovers)** ·
**browser-verified as designer مضر محمد**. A concurrent session was working on التجهيز (`productionController.js`,
`lib/shelf.js`, `routes/production.js`) — this batch touches NONE of those files (productionController was read only).

**The report.** «Designer copies a retail student's name in مراجعة التصاميم → goes to الخط العربي → pastes → goes back to copy
the next one → the previous name is gone.» Two independent causes behind one symptom:

**① The draft was thrown away on every navigation.** `CalligraphyTool`'s sessionStorage mirror deliberately EXCLUDED
textarea drafts (only filters/search/scroll were restored), so every route change reset `typedText` to `""` **and** `mode`
back to «تلقائي» — losing both the accumulated list and the tab. Now `mode` + `typedVariant` + `typedText` are mirrored
(bounded to 40k chars so a pathological paste can't blow the quota and take the filter snapshot down with it). `txtLines`
stays excluded on purpose — a `File` can't be restored, so a restored list would claim a file that is no longer picked.
Browser-verified: 3 names + «الوجه الخلفي» → `/staff` → back → names, tab and variant all intact.

**② Retail was structurally invisible to the whole calligraphy tool — THAT is why they were copy-pasting.** `poolFor()`
matches four EXACT rep-form labels (`تطريز الوشاح من الأمام` …); retail orders emit their own (`تطريز يمين: تطريز يمين`,
`القبعة من الجانب: بكتابة` …). Measured on the dev snapshot: **1000 rep zones in the pool, 0 retail**, while **232 retail
orders / 482 zones** sat at «بانتظار التصميم» with embroidery text. And **142/142 `source='typed'` plates had
`order_item_id = NULL`** — every hand-typed retail plate was an orphan that could never auto-link or be «تحويل للتطريز».

**Owner rule locked (2026-07-21):** ممثل students = generate in bulk, review AFTER · تجزئة students = review BEFORE, then
generate. The DB shows exactly why: rep text is clean (structured form), retail `customer_text` is free-form instruction —
`"في الاعلى (كلية التقنيات)، اسفل هذه العبارة لوغو الجامعة…"`, `"تطريز من اليمين الدكتورة بان مع حرف ح"`. A human must read
it and decide what actually gets stitched («الدكتورة بان ح») before a paid generation runs.

**What shipped.**
- **NEW `GET /calligraphy/retail-queue`** (`calligraphyController.retailQueue`): retail orders (`students.wholesaler_id IS
  NULL`) at `design_complete`, not returned, product `sash|cap`. Zone detection is **heuristic, mirroring
  productionController's `ZONE_DEFS` regexes** (the pattern already trusted by the embroiderer checklist) instead of exact
  labels — so a zone the embroiderer sees is a zone the designer can plate. `ردن` skipped (robe sleeve is not a calligraphy
  variant). Returns per zone: raw text, customer photo, `has_plate`; per order: student, university/department, instagram,
  notes. Read-only.
- **NEW `components/calligraphy/RetailReviewBoard.tsx`** + a **«تجزئة» tab** (first among the manual modes — it is a real
  daily queue, not a fallback). Per zone: **«نص الطالب كما كتبه (لا يتغيّر)»** read-only + photo, an editable
  **«النص المطلوب توليده»** pre-filled with the raw text, and a variant picker with **NO default** (owner's choice).
- **Selection is GLOBAL, generation is ONE batch (owner correction mid-session).** The first cut had a «توليد» button per
  student card; owner: «our sheet 10 names … it is bad to check and generate just order — make it just a checkbox then
  generate all, then designer checks again, then next phase (per piece)». A sheet holds `MIN_BATCH`=10 names and costs the
  same for 1 or 10, so per-student generation burns a sheet on 2-3 zones. Now: tick zones across as many students as you
  like → one sticky bar («N منطقة محدّدة» + per-variant breakdown) → one «توليد المحدّد». **Sheets are single-VARIANT**, so
  the bar warns per variant, not on the total, and an under-filled batch raises a confirm («توليد بأوراق غير ممتلئة؟»,
  listing «أمامي — 3 من 10») — allowed, never silent. Ticked count also shows on each collapsed card.
- **`source='retail'` in `createJob`.** Dedup by `order_item_id` like the wholesaler path. **The render text is trusted,
  the target is NOT:** every `order_item_id` is re-resolved against the DB and dropped unless it belongs to a retail order,
  and `student_id` is taken from the DB, never the caller — otherwise a crafted call could staple artwork onto a rep's
  order via `autoLinkPlate`. e2e: rep item under `source='retail'` → 400 · random uuid → 400 · spoofed `student_id` →
  overridden to the real owner.
- **The two hard rules are enforced server-side, not just in UI:** the cleaned text lives ONLY on the plate (verified: order
  `customer_text` stayed `"التخديرية أية علي"` after generating `"اية علي"`), and plates carry `order_item_id` so
  auto-link + «تحويل للتطريز» work exactly like the rep flow. Drafts/variant picks/open card survive navigation too
  (`loloshop-calligraphy-retail`), guarded by `loadedOnce` so the prune never wipes restored state against the pre-fetch list.
- **The automatic queue is UNCHANGED** — `poolFor` still can't see retail, so retail can never be bulk-generated. That is
  the rule, not an oversight.
- **Dead UI deleted (owner, same session).** ① Grid chips **«مُرسلة» + «بدون طلب» removed** — measured on live plates:
  بانتظار الإرسال **16** (the real to-do: plate done, order not yet pushed), مُرسلة **94** (archive, no action possible),
  بدون طلب **222** (orphans from the old copy-paste flow). Only «الكل» + «بانتظار الإرسال» survive. ② **«ملف TXT» mode
  deleted end-to-end** — tab, file input, `FileReader`, `txtLines`/`fileRef`, the `buildItems` branch, `CalSource`
  member, and `'txt'` dropped from `createJob`'s accepted sources (**0 plates ever used it**; the enum VALUE stays in the
  DB for safety). ③ The **«مراجعة قبل التوليد» explainer banner deleted** — the screen teaches itself (student's words sit
  directly above the field you type into) and the sheet-economics warning lives in the batch bar where it matters.
- **أيادي التصميم gets all of it free** (same shared component on `/design-support/calligraphy`). Verified with a
  `design_helper` token (temp membership created + deleted, 1 row before/after): `/retail-queue` → 200/232 orders,
  `orders/:id/send` → **403** — محمد هيثم's approval flow untouched. They don't get «فتح الطلب» (`canOpenOrders` is
  admin/staff), which is fine: the board carries the text + photo + notes inline.

### Open follow-ups
- **Deploy = push, and `npm run migrate` must run BEFORE the pm2 reload** (069 adds the enum value the new code writes).
  Rides with the concurrent التجهيز session's work — coordinate the push.
- **⚠️ 069 is SPLIT across two sessions' work:** the `db/schema.sql` mirror was swept into the concurrent session's commit
  `2c189ab feat(shelf): migration 070` (it staged schema.sql while my edit was already in the working tree), while
  `db/migrations/069_calligraphy_retail_source.sql` is still **untracked**. Harmless (both halves are additive +
  idempotent) but commit the migration FILE before deploy, or the numbered-migration history has a hole.
- **User browser walkthrough pending.** Dev servers left UP: BE :4000 (plain `node server.js`), FE :3000 (`next dev`);
  browser open on `/staff/calligraphy` → «تجزئة» as designer مضر محمد.
- **NOT built:** the per-zone «توليد الخط» button on the order page (offered as option 2; owner picked the tab). Roll it
  later if designers want to generate without leaving the order.
- **Pre-existing data oddity found while testing (NOT fixed):** two accounts named **محمد هيثم** — `4df44c57…`
  (`role='staff'`, the active `design_team_members` lead) and `f89640d3…` (`role='design_helper'`, **no membership row**).
  As it stands the design_helper account is 403'd by `allowCalligraphyUser`. Check against prod — if he logs in with that
  account, the calligraphy tool is closed to him today.
- Retail orders at `embroidery`/`ready` (64/2 on the snapshot) are deliberately out of the board — they're past the
  designer. Widen `JOB_WHERE` if that turns out to be wrong.
- **222 orphan plates (`order_item_id IS NULL`) are now invisible** — the «بدون طلب» chip that surfaced them is gone. They
  were already unusable (nothing links them to an order), and the new تجزئة flow can't create more, but if they should be
  purged or reconciled that is a separate decision. Query: `SELECT * FROM calligraphy_plates WHERE order_item_id IS NULL`.
- **Two self-inflicted bugs caught in the browser and fixed — worth remembering:** (1) I used **`bg-card`**, which does
  **not exist** in this Tailwind v4 `@theme` (`app/globals.css` defines `--color-cream/beige/surface/surface-sink`, no
  `card`) — all 6 usages rendered fully transparent (`rgba(0,0,0,0)`) and only looked fine over a light page. It is used
  nowhere else in the repo; use **`bg-surface`**. (2) The confirm dialog used bare `position: fixed` and was trapped by an
  ancestor containing block (the tool's card has a backdrop-filter), rendering as a floating rectangle mid-page — now
  `createPortal` to `document.body` behind a `mounted` guard, same as the plate preview / StudentSheet.
- The board still lists one card **per piece** (a student with a وشاح + قبعة appears twice, each with its own zones). With
  a global batch bar that reads fine, but grouping the cards by student is the obvious next polish if it feels noisy.

---

## 2026-07-20 (b) — ✅ SHIPPED: security batch committed + merged + DEPLOYED to prod · post-deploy runbook executed

**Everything that was uncommitted/unpushed is now live on prod** (`main` @ `ff8a47e`, 19 commits pushed — the 07-16→07-19
sessions AND the whole security-fixes branch). CI green (audits now FAIL on moderate+; both apps at 0 vulns), deploy job ran
`deploy.sh` (migrate → build → pm2 reload) in 1m33s. **loloshop-worker is running in prod for the first time.**

**Pre-deploy checks that passed:** prod `.env` satisfies every new fail-closed check (JWT_SECRET 128B; all four portal keys
≥16B and — verified via `git log -S` — the current WORKSHOP_PORTAL_KEY appears NOWHERE in git history, so the 4e4cba8
rotation was already done on 07-15; MONEY_GATE_SECRET absent is fine, DB `site_settings` row is the source). Migrations
067/068 pre-applied to droplet + laptop DBs (idempotent; schema.sql also carries them). Local gates: backend syntax 0,
`tsc` 0, **backend tests 52/52** (first run ever against the isolated dev DB — no shared-Neon danger), `npm audit` 0/0.
New nginx config installed BEFORE the push: redacted portal paths in access log, HSTS, `server_tokens off`, /uploads
`private, no-store` — verified live (`server: nginx`, HSTS present).

**Post-deploy runbook executed:** converting drain = **0 rows** (nothing left). `cost>price` scan = 0.
**Duplicate scan found 3 NEW same-type sash pairs** (the exact class 07-16 predicted prod would keep creating) — but a new
shape: identical `created_at` to the microsecond = double-INSERT in one transaction (two sash product ids resolved in one
payload), not edit-forks. Repaired per the 07-16 runbook in one tx (audit rows `repair_duplicate_sash` ×3, actor NULL):
kept the latest-updated row per pair, cancelled `58a490f2`/`34397d69`/`3fa8ed8b`, label-matched NULL-fill image migration
recovered 1 sash-color photo onto kept `208e8181` (imgs 3→4). Re-scan: **0 duplicates**. No zone progress was lost (all
`embroidery_zones = {}`). `pm2-logrotate` installed. Smoke: site/api/catalog 200, login path returns proper
`ERR_INVALID_CREDENTIALS` 401, worker log shows «consuming calligraphy-generate».

### Open follow-ups
- **Old JWTs from before the deploy remain valid until expiry (≤7d)** — token_version starts at 0 for everyone; revocation
  begins working on the first password change. Nothing to do.
- The identical-created_at double-insert is a NEW bug shape (one request inserted two sash rows). The deployed pin+self-heal
  should prevent recurrence; if the scan ever shows a fresh pair with identical created_at again, hunt the creation path
  (payload carrying two sash product ids).
- HSTS header is currently sent twice (nginx + helmet) — harmless, tidy later.
- Consider changing the money-gate passphrase (`lolo2026` per memory) now that the DB is settled — owner decision.
- LS-02 secrets rotation + the Contabo move remain the standing deferred items.

---

## 2026-07-20 — ✅ CUTOVER DONE: prod DB moved Neon → droplet-local PostgreSQL 17 · dev split to laptop-local PG · nightly backups

**Owner said «the shop is quiet» → cutover executed same night, ~40s downtime, ZERO data gap** (Neon froze at 1785 orders,
local restored 1785, verified). Prod now runs on **PostgreSQL 17 on the droplet itself** (`localhost:5432`, db/role
`loloshop`, SSL snakeoil — deployed db.js's forced-SSL path verified live). `/var/www/loloshop/backend/.env`:
old Neon URL kept as `# NEON_ROLLBACK_DATABASE_URL=` (rollback = swap back + pm2 restart; Neon data frozen at cutover).
Proof-of-life after cutover: /api/health 200, catalog 200 via lolo-shop96.com, `pg_stat_activity` shows the app connected
as `loloshop`, xact counter climbing. **Nightly backups:** `/etc/cron.d/loloshop-db-backup` → 04:10 `pg_dump -Fc` to
`/var/backups/loloshop/` (14-day retention); manual post-cutover dump already there. Pre-cutover env backed up at
`/root/env-backup-pre-cutover`.

**Dev is now truly split from prod** (the security-fixes db.js guard refuses dev→Neon anyway): laptop runs portable
**PG 17 at `~/.local/opt/pg17`**, data dir `~/.local/share/loloshop-pg17-data`, **port 5433**, autostarts via systemd
user unit `loloshop-pg17.service`. Loaded with the 21:42 cutover-day snapshot (same 1785/1163 counts).
`backend/.env` (laptop) now points at `postgresql://loloshop:loloshop_dev@127.0.0.1:5433/loloshop`; the Neon URL is kept
commented as `# NEON_OLD_DATABASE_URL=` (backup: `backend/.env.bak-neon`). Dev backend verified: health 200 + real
catalog JSON. NB dev DB is a **snapshot** — it no longer mirrors prod; refresh when needed by restoring a nightly dump
from the droplet.

### Backups & context
Neon console showed 98% usage but actual data is only **21 MB** — the metric was history/compute (24/7 pg-boss dev worker
was a big burner). Dumps (made with pg_dump 17 — local client 16 refuses; portable binaries at `~/.local/opt/pg17`):
`~/Desktop/loloshop-db-backups/loloshop-neon-2026-07-20.dump` (+`.sql.gz`), `…-2142-fresh.dump` (includes the customer
order placed mid-session — re-dumped on owner request), droplet `/root/loloshop-neon-cutover.dump` (the authoritative
cutover snapshot) + `/var/backups/loloshop/`.

### Open follow-ups
- **Migrations 067/068 + schema.sql**: next `npm run migrate` now targets droplet PG in prod / laptop PG in dev — both
  fine, nothing shared anymore. The security-fixes deploy flow is unchanged.
- **Neon**: leave frozen as rollback for a few days, then the project can be deleted/downgraded (quota problem gone).
- Copy one dump off-site (e.g. Drive) for real DR — currently laptop + droplet only.
- **Contabo move**: same runbook ports 1:1 (dump → restore → env swap). Standing scripts pattern in this entry.
- Dev DB won't auto-refresh from prod — restore a `/var/backups/loloshop/` dump when fresh data is wanted.

---

## 2026-07-19 — Security review follow-up: remaining LS fixes + dependency hardening

**Working tree only; not committed/pushed/deployed. Shared Neon was deliberately not touched.** Reviewed the three
`security-fixes` commits and closed additional defects: concurrent OTP attempt/send races, accurate per-phone rolling send
events, removal of the environment-gated master OTP and all OTP logging, JWT revocation on every password change, scoped
60-second SSE tickets (no seven-day JWT in URLs), verified DB TLS, fail-closed secret lengths, safe proxy trust, account+IP
login throttles, upload path containment/magic-header/pixel validation/account throttling, private/no-store upload caching,
Android backup disabled, insecure seed re-runs fixed, and committed portal-key disclosure redacted. Sensitive ignored files
are mode `600`; the stale commented deploy key and unused SMTP credentials were removed from local `backend/.env`. A
non-production process now refuses the shared Neon host, and the reviewer login allow-list is inert without a ≤30-day expiry.

Dependencies upgraded (Multer 2.2.0, Next 16.2.10, Fabric 7.4.0 plus patched transitive packages); backend and frontend
production/full `npm audit` now report **0 vulnerabilities**. Verification: backend JS syntax 0, frontend TypeScript 0,
production Next build passes, JWT scope tests pass, upload boundary tests pass. Existing DB-backed tests were not rerun because
they write to the shared Neon database.

**Before deploy:** rotate the workshop portal key exposed by commit `4e4cba8`; revoke/rotate the removed GitHub deploy key if
it was ever registered; install the updated `nginx-ssl.conf`; and let `npm run migrate` apply schema additions 067
(`users.token_version`) and 068 (`otp_send_events`) **before PM2 reload**. Migration 066 was already applied; migration files
065/066 are now consolidated under `db/migrations/`. Do not deploy the application code without the schema additions.

## 2026-07-19 — Security fixes batch 1+2: LS-01 OTP bypass killed · LS-04/10/14/15/16 · email auth deleted

**Branch `security-fixes` (3 commits: `7571497`, `41b0810`, `87c63cb`). NOT pushed — PROD IS STILL FULLY VULNERABLE until it
is.** Migration **066 applied to Neon** (additive + backward compatible with the deployed old code, so prod keeps working
meanwhile). Gates: BE `node --check` 0 · **tests 38/38** (23 new) · **live HTTP e2e 14/14 on Neon, self-cleaned** · FE `tsc` 0 /
`eslint` 0. `next build` NOT run locally (disk 96%; it runs on the server). Source: `SECURITY_AUDIT_REPORT_2026-07-16.md`.

**① LS-01 (High) — OTP alone was a login, for EVERY role including admin.** `POST /auth/resend-otp` was unauthenticated and let
the caller pick `{phone, purpose}`; `login-verify`/`verify-otp` then minted a JWT from `{phone, code}` with **no password check
and no role restriction**. Anyone who could read a victim's WhatsApp OTP signed in as them. **Fix:** OTP rows carry a secret
`challenge_id` + `user_id`; a challenge is issued only by a flow that already proved something (correct bcrypt password for
login, a just-created account for registration) and verification is addressed **BY CHALLENGE, never by phone** — the caller
can't name the account it wants a token for. `verifyOtp(phone,code,purpose)` **deleted** so no legacy path survives.
Registration-verify hard-refuses non-`retail`. Resend takes only a challenge and refreshes that row **in place** (rotating the
id stranded clients whose response was lost on a flaky network), metered by a new `sends` column. **Also closed:** phone-OTP
reset used a stale deny-list, so `worker`/`design_helper` (migrations 060/062) were takeover-able with one intercepted OTP →
now an allow-list (`retail`, `wholesaler`). Side benefit: the unauthenticated "send a WhatsApp to any number" primitive is gone
— a Zentramsg sender-ban vector.

**② LS-04** `?role=wholesaler` leaked the rep price book to anonymous callers and (via `getShop`'s `audience`) wholesaler-only
products to retail accounts → now **admin + production managers only**, deliberately not every `role='staff'`.
**③ LS-10** NEW `backend/lib/password.js` at every `bcrypt.hash` site: **8 chars for everyone**, plus a ban list scoped to
credentials this repo shipped. **No shape rules** — `abcdefgh`/`qwertyui`/`aaaaaaaa` are deliberately ACCEPTED (owner: signup
friction costs students). **Applies only when a password is SET — old short passwords still log in** (test proves it). Seeds no
longer hardcode `admin123`/`staff123`/`cust123`/`test1234`. **Live DB scanned: 0 weak passwords across all 7 privileged
accounts.** **④ LS-14** `getDesignByStudent` enforces `staffScopeAllows` + strips phone for non-designers (NB: endpoint has no
FE caller, `designs` table is dead). **⑤ LS-15** health returns `ERR_DB_UNAVAILABLE`, detail to log only. **⑥ LS-16**
`poweredByHeader:false` + anti-framing/nosniff/referrer/permissions headers.

**⑦ Email auth DELETED** (owner). SMTP was never configured in prod → the flow was already dead, and it carried a reset-token
endpoint + nodemailer (3 high-severity advisories) for nothing. Gone: email on register + join, `/auth/forgot-password`,
`/auth/reset-password`, `lib/email.js`, `/reset-password/[token]`, the nodemailer dep. **NEW `npm run set-password -- <phone>
[pw]`** is the admin's recovery path — without it, deleting email would have stranded the admin account entirely (phone-OTP
reset excludes privileged roles by design). **⑧ Registration errors now name the field** (`{error, code, field}`) so the form
pins the message under the right input instead of a blanket «تعذّر إنشاء الحساب».

### Open follow-ups
- **⚠️ NOT PUSHED. Prod runs the vulnerable code until it is.** Browser walkthrough by the user still pending.
- **⚠️ `HANDOFF.md` + `docs/HANDOFF-archive.md` are uncommitted from an EARLIER session** — HANDOFF.md deletes ~1473 lines that
  moved into the archive file, which is still **untracked**. Commit the two TOGETHER or that history is lost from git.
- **Deferred to the server move (~2026-07-21, DB moves to the new box):** **LS-03** DB TLS (the Neon-CA fix would be wrong on
  self-hosted Postgres), the **nginx half of LS-06** (CSP + HSTS + `server_tokens off`), and **LS-02 secrets rotation** — best
  done while env vars are being re-created anyway. That move is also the chance to finally **split dev from prod** (one shared
  Neon DB today — that's what made a test-cleanup line dangerous mid-session).
- **Not started:** LS-09 (revoke JWTs on password reset — needs a `token_version` column), LS-05 (dep updates), LS-07 (URL
  credentials), LS-08 (upload validation/quotas), LS-11/12/13.
- Admin-facing **email metadata** fields (staff, wholesaler, design-team records) were left in place — contact info, not auth.
- `otp_codes` has no retention policy (1208 rows since June 19) and migrations live in **two** directories (`db/migrations/`
  and `backend/db/migrations/`) — consolidate before one gets skipped.

---

## 2026-07-18 — Season scaling prep: in-process caching · polling calm-down · pg-boss calligraphy worker · infra dials

**Committed locally on main, NOT pushed (push = prod deploy — owner approves first). No migration** (pg-boss auto-created its
own `pgboss` schema on the shared Neon DB — additive). Gates: BE `node --check` 0 on every touched file · memoCache unit tests
5/5 (`node --test backend/test/`) · FE `tsc` 0 / `eslint` 0 errors · **live HTTP e2e on Neon, all self-cleaned**: cache 11/11 +
catalog 12/12 + engine 9/9 + queue 8/9 (the 1 "fail" was a wrong test expectation about pg-boss singleton semantics — documented
in `lib/queue.js`, no product defect). Spec: `docs/superpowers/specs/2026-07-18-season-scaling-prep-design.md` · plan:
`docs/superpowers/plans/2026-07-18-season-scaling-prep.md` · runbook: `docs/ops/2026-07-18-season-rollout.md`.

**Why.** Joining season months 8–10: baseline ~200 users/hour + referral spikes (+1000 students in minutes from one rep link).
**Owner decisions locked:** rate limits UNCHANGED (DDoS concern — accepted risk: CGNAT can throttle a wave to ~10 joins/hour/IP;
emergency valve = raise `max` in routes/join.js + routes/auth.js + pm2 reload). No «تحقق الآن» button. Monitoring developer-only.
Neon dev-branch split + CI artifact builds DROPPED for now (Tasks 0/10 in the plan — revivable unchanged).

**① In-process TTL cache — NEW `backend/lib/memoCache.js`** (get/set/del-prefix/wrap, 500-entry LRU-ish bound, single-process
only — comment warns re cluster mode). Cached reads: join-code lookup `join:<code>` 60s hits-only (`joinController.getReferral`);
full-set packages `pkg:fullset` 60s + rep pricing `reppricing:<wid>` 60s (BOTH `orderController.repFullSetContext` — whose
per-student approval/existing reads stay LIVE — and `wholesalerController.fullSetPackages`/`publicPricingFor`, which cache the
same `loadWholesalerPricing` result); storefront `cat:shop:<audience>:<role>` + `cat:prod:<id>:<role>:<priv>` 120s +
`settings:promo` 60s (`catalogController` — getShop/getProductFull bodies extracted to `buildShopFeed`/`buildProductFull`,
404s/misses never cached). **Invalidation:** `adminController.updatePricing` → del reppricing; `updatePromo` → del settings+cat;
package mutations call `clearCatalogCache()`; PLUS a **route-level hook** in `routes/catalog.js` (+ the 2 legacy POSTs in
`routes/products.js`): any non-GET admin request with status <400 clears `cat:`+`pkg:fullset` on res finish — new endpoints can't
forget. **Money/settlement/approval data is never cached.** `persistFullSetOrder` still reads pricing live (money path untouched).

**② Polling calm-down.** `lib/hooks/usePolling.ts` gained a 4th arg `jitterMs` (setTimeout chain, ±jitter, min 1s; hidden-tab
skip already existed). `NotificationBell` 30s → **60s±15s**; `/my-order` waiting-screen approval poll 12s → **45s±10s** (was
~83 req/s at 1000 waiting students; now ~22 with jitter spread). Staff consoles untouched (15s).

**③ pg-boss calligraphy worker.** NEW `backend/lib/queue.js` (lazy shared boss, `enqueueGeneration(jobId)` fire-and-forget,
singletonKey best-effort, retryLimit 2 backoff, expireInSeconds 20min = per-attempt cap AND crash-recovery window) + NEW
`backend/worker.js` (PM2 app **loloshop-worker**, drains a job batch-by-batch via the engine, throws on no-progress → pg-boss
retry). `processNext`'s body extracted VERBATIM to NEW `backend/lib/calligraphyEngine.js` `processNextBatch(jobId, req=null)`
(returns `{data}` or `{error:{status,message,code},data}`; controller = thin wrapper, response shapes/statuses unchanged; shared
helpers toPlate/autoLinkPlate/attachOrderContext/jobCounts/jobCost/promptVariant/BATCH re-exported from the engine).
`lib/upload.js publicUrl` now tolerates `req=null` (worker context → PUBLIC_URL/localhost). `createJob` + `queueGenerate`
enqueue after insertPlates. **FE `CalligraphyTool.runCreatedJob`**: was a client-driven `/process` loop → now polls `getCalJob`
every 4s (close the tab, generation continues); **watchdog: ~2 min no progress → toast + falls back to the OLD client loop**
(worker down ≠ dead feature). Kill-mid-job e2e-proven: first batch survives, `/process` drains the rest.

**④ Infra dials.** `lib/db.js`: pool 10→**25** (prod uses the `-pooler` endpoint — verified) + **SLOW QUERY warn >500ms**
(SQL first 80 chars, never params). `ecosystem.config.js`: api 300M→**800M**, web 500M→**1G**, + the worker app (500M).

### Open follow-ups
- **Deploy = push** (owner approves; rides with the other uncommitted 07-17 session work in the tree — coordinate). After
  deploy walk `docs/ops/2026-07-18-season-rollout.md`: nginx /uploads block, `pm2 install pm2-logrotate` + reload (picks up
  loloshop-worker), UptimeRobot on /api/health (developer-only), smoke list there.
- **User browser walkthrough pending** (steps appended to TESTING-WALKTHROUGH.md §2026-07-18): waiting-screen slow poll,
  bell 60s, catalog invalidation-on-edit, calligraphy generate-with-tab-closed. Dev servers UP: BE :4000 (plain `node
  server.js`), FE :3000, worker (`node worker.js`, detached).
- Dropped-not-dead: Neon dev/prod branch split (Task 0) + CI artifact builds (Task 10) — plan tasks intact for later revival.
- If PM2 **cluster mode** is ever enabled: memoCache + eventBus + express-rate-limit are all single-process — move to a shared
  store first.

---

## 2026-07-17 (c) — Navigation batch: sessionStorage state-restore on 5 screens · multi-role sidebar links · orphan pages deleted

**Uncommitted on main** (frontend only). Gates: `tsc` 0 · `eslint` 0 (fixed the 2 hook-deps warnings the agents left). Built via
4 parallel frontend subagents (one per screen) + direct edits; stale `.next/dev/types` deleted so tsc passes post-deletion.
**Browser walkthrough = user** (dev servers UP: BE :4000 plain `node server.js`, FE :3000 `next dev`).

**① State restoration** («يرجع وينسى مكانه» — the same bug class fixed for the stations on 07-16) ported via the SAME
StationConsole sessionStorage-mirror pattern (lazy-init when the screen mounts behind a client auth gate, mount-effect+`restored`
flag when it can SSR; `loadedOnce` guards so prune/validate effects never wipe restored state against the pre-fetch empty list):
- `/staff/queue` — key `loloshop-console:production`. stage/source/rep/zone live in the URL → restored via one mount
  `router.replace` when the incoming URL is bare; `effectiveZone = zoneParam ?? storedZoneFallback` makes the FIRST fetch use the
  restored zone (no double-fetch). Prunes dead rep/batch → الكل; clamps restored page.
- `/admin/orders` — key `loloshop-admin-orders` (all filters + viewMode + sort). **`?wholesaler=` URL wins over the snapshot**
  (stored forced `{}` when present) so the rep-card → approval-default flow from (a) is byte-identical; prune keeps invalid
  rep/batch out after first load.
- `/staff/wholesalers/[id]/students` — key `loloshop-rep-console:<id>`; tab/zone/view/search + **checkbox selection** persist;
  the old «wipe selection on every refetch» line replaced by prune-to-live-advanceable-rows after first load. Effect-restore
  (page renders pre-auth → lazy init would hydration-mismatch).
- `QueueView` on `/staff` — key `loloshop-staff-home-queue` (activeTab/sourceFilter/zoneFilter). Lazy-init (mounts behind gate).
- `CalligraphyTool` — key `loloshop-calligraphy` (grid chip, plates+queue ممثل filters, search, sticky-bar open). First queue
  fetch uses the restored `queueWid`; رep prune after wholesalers load; job-restore no longer force-collapses the sticky bar.

**② Sidebar multi-role links** (old audit finding #7): `getNavLinks` now takes the `staff_types[]` union — home link labelled by
the FIRST queue role (mirrors `/staff` routing), «الفصال» added for ANY tailor-role holder, console link once; pure tailor gets no
/staff link (it's a redirect bounce). Role chip shows all roles joined با «·». `StaffSidebar.tsx`.

**③ Orphan pages deleted** (nothing linked to them): `/verify-otp` + `components/auth/VerifyOtpForm.tsx` (dead since inline OTP
2026-06-19; robots.ts entry removed), `/wholesaler/batch` + `/wholesaler/package` (nav removed 2026-06-16), and
`/admin/wholesalers/[id]/students` (dead duplicate — the admin wholesalers page links to the STAFF console route which already
switches to the `/admin/*` API). Kept: `/vip/preview` (deliberate mock). Also **sitemap.ts advertised nonexistent `/showcase`** —
removed. NB deleting pages leaves stale `.next/dev/types` validators → `rm -rf .next/dev/types` before trusting tsc.

### Open follow-ups
- **User browser walkthrough pending**: e.g. /admin/orders set filters → open order → back (filters+rep+approval kept);
  rep console tick boxes → open order → back (selection kept); قائمة الإنتاج drill into rep/دفعة → back; calligraphy filters →
  student link → back; a multi-role (tailor+embroiderer) account sees BOTH sidebar links. Then commit+push (rides the money-repair
  session's deploy).
- Designer StationConsole (عرض بالطلب for التصميم) still not built — offered, no user decision yet.

---

## 2026-07-17 (b) — Designer gets full student contact (phone · instagram · intake) on the order page

**Uncommitted on main** (backend `controllers/productionController.js` + a comment in FE `app/staff/orders/[orderId]/page.tsx`).
Gates: `node --check` 0 · **verified over real HTTP** (designer JWT مضر محمد, dev :4000 — restarted `node server.js` to load it).

**Why.** User: designers need to see انستغرام + phone + all student info (they contact the student to confirm the artwork —
same rationale as the أيادي التصميم desk, 2026-07-15). Until now the designer got the lean strip: contact nulled, intake nulled.

**What.** `getOrder`: `canSeeContact = frontDesk || designer` (any staff holding the `designer` type, sole or multi); the lean
intake-null now skips designers → full intake card (customer name, phones, instagram, governorate, event date, notes).
**Money stays hidden** — `canSeeMoney` unchanged (price deleted, `intake.deposit` deleted before the intake survives). The
embroiderer/tailor/presser allow-lists are untouched (they rebuild AFTER the contact strip → still no contact). No FE change —
the «بيانات الطالب» card + intake card already render rows only when supplied. Verified: phone+instagram+intake present for the
designer, price/deposit absent, `view.layout` still `full`, design canvas still visible.

**NB (asked & answered):** «navigation for designers» is NOT done — the StationConsole (عرض بالطلب/عرض بالقطع + state restore)
covers التطريز/الفصال/الكوي only; designers still get the flat `QueueView` on `/staff`. The generic back-nav (`?from=`) does
cover their order pages. Roll `StationConsole` to the designer queue later if wanted.

---

## 2026-07-17 (d) — حذف = piece-only · admin/مدير الإنتاج order edit (full طقم + quick ✎) · custom order to EXISTING student

**Uncommitted on main** (rides the next deploy push with the other 07-17 sessions). No migration. Gates: BE `node --check` 0 ·
FE `tsc` 0 source / `eslint` 0 · **live HTTP e2e on Neon 38/38, fully self-cleaned (0 leftovers)** — script in scratchpad
`e2e-edit-delete.js`. **No browser test by Claude** — 7-day admin/manager tokens + click-steps appended to
`TESTING-WALKTHROUGH.md` §2026-07-17 (untracked, don't commit). Spec:
`docs/superpowers/specs/2026-07-17-piece-delete-admin-manager-order-edit-design.md` · plan in `docs/superpowers/plans/` (both committed).

**① حذف القطعة (was: whole-bundle delete).** `productionController.deleteOrder` + `adminController.deleteOrder` now delete ONLY
the given order row (order_items cascade); siblings survive; the empty `checkout_groups` row is deleted with the last piece.
Response `{deleted:1, remaining, checkout_group_deleted}`; audit details gain `piece_only:true` + `remaining_order_ids`. UI
(queue + order page): buttons/modals/toasts say «حذف القطعة» and explain that the rest of the bundle stays. Accepted edge
(inherent, surfaced in the walkthrough): the طقم price rides the sash row, so deleting just the sash removes the priced row.

**② Order edit for admin + مدير الإنتاج — NEW `backend/controllers/orderEditController.js`**, mounted in `routes/production.js`
behind `requireStaffType()` (admin role + manager staff pass):
- `GET /production/orders/:id/edit-context` · `POST /production/students/:studentId/full-set-order` ·
  `PATCH /production/orders/:id/details` · `GET /production/students-search` ·
  `GET /production/students/:studentId/full-set-order` · `POST /production/uploads/image`.
- **Full form** = the rep's `FullSetOrderForm` pre-filled via `readFullSetOrder`, saved via `persistFullSetOrder` (single source
  of truth — pin/self-heal apply). **KEY MECHANISM: approval preservation.** persist flips bundles to `pending` on every save
  (rep-flow semantics); the edit endpoint captures the bundle's `wholesaler_approval` BEFORE and **restores it exactly AFTER**
  (`captureApproval`/`restoreApproval`): approved→approved (at/by kept), NULL→NULL (admin direct orders never enter the approval
  flow), pending→pending, rejected→rejected+reason. e2e-verified for all states.
- **Eligibility guard** (`eligibleForFullSet`): student is rep-linked OR name-only (users.phone IS NULL). Retail self-registered
  students are 403'd + hidden from students-search — the طقم form would re-price their cart bundles rep-style and its
  deselect-cancel could kill cart pieces (prevGroup edge). They get the quick ✎ edit instead.
- `student_info` on the POST dual-writes name (users + students + group customer_name) and IG (students + group); group phones.
  `restoreGroupPhone` keeps an admin-set group phone from being wiped back to '' by a later save that omits student_info.
- **Quick ✎ edit** (`PATCH .../details`): spec-line `customer_text` (only lines that already carry typed content — never option/
  price rows, foreign item ids 400), student name/IG, group phones/notes. Audit `staff_order_edit` both paths.
- FE: NEW `/staff/orders/[orderId]/edit` page; order page (full view) gains «تعديل الطلب» (shown when
  `available_actions.can_edit_full_set`) + ✎ on spec lines and the instagram row (`can_edit` = manager/admin; IG row now renders
  for editors even when empty). `getOrder` items now include `id`; available_actions gains `can_edit`/`can_edit_full_set`.

**③ Custom order → existing student + manager access.** `adminCustomOrderController.createCustomOrder` accepts `student_id`
(XOR `student_name`): loads the student, persists (upsert — a second call EDITS the same bundle, e2e-proven same checkout_group,
deselect-cancel works), approval = preserved if a bundle existed, else rep-linked→auto-approved (setBundleApproval) /
independent→NULL. Staff mirrors in `routes/staff.js` (`/staff/custom-order/*`, `requireStaffType()` ⇒ manager-only since
requireRole('staff') blocks admin). FE: extracted shared `components/staff/CustomOrderForm.tsx` (طالب جديد/موجود toggle, debounced
search, picked-student card, **picker pre-fills the student's existing طقم** — a blank save would wipe it via the
optional-everything upsert); `/admin/custom-order` is now a thin wrapper; NEW `/staff/custom-order` (manager-guarded) + «طلب مخصص»
in StaffSidebar's manager section. Managers see rep pricing here — accepted (managers already see money).

### Open follow-ups
- **Deploy = push** (with the concurrent 07-17 sessions' work). Backend :4000 restarted on the new code (plain `node server.js`);
  FE dev on :3000. User browser walkthrough pending (steps + tokens in TESTING-WALKTHROUGH.md).
- Quick ✎ covers TEXT lines only (colors, embroidery names, نوع…) — customer photos and priced option swaps are not editable
  (by design; use the full form for طقم pieces).
- `tsc` shows 4 pre-existing errors in stale `.next/dev/types` referencing pages deleted by the (c) navigation session — not
  source errors; they vanish on the next clean build/dev restart.

---

## 2026-07-17 — Owner-approved money repair: شال rule locked · cost backfill (+682k) · retail duplicate-proofing · rep-card counts

**Uncommitted on main** (backend: `controllers/{orderController,adminController}.js` + the (c) files). DB repairs APPLIED to Neon
(audit_log `repair_pricing_config` + `repair_order_costs`). Gates: `node --check` 0 · SQL-semantics test PASS (self-cleaned) ·
backend restarted on :4000 (plain `node server.js` — no nodemon; restart after edits or they don't load).

**Owner decisions locked (2026-07-17):** شال امريكي admin share = **20,000 لكل شال، دائماً** (rep keeps selling−20000). Settlement
rule: **cost = price − (طقم كامل base − admin_price) − (شال selling − 20000)** — admin gets everything except the package margin and
the shawl margin. Config repair: محمد باقر (flat 30000 → {admin:20000, selling:30000}) + أنس صباح (flat 25000 → {20000,25000}).

**Cost backfill (applied):** 47 live design-less wholesaler orders recomputed under the rule → **+682,000 IQD admin due** restored
(باقر +133k · مهدي +178k · مصطفى +153k · عبدالعزيز +128k · عبدالله محسن +90k). Verification: **0 rule violations, 0 cost>price**
across all live orders. `orders.profit` is GENERATED (price−cost) → auto-corrected. Item-level `admin_price_snapshot` on old rows
stays 0 (display-only; orders.cost is the accounting source).

**141 vs 148 explained (باقر):** 141 = bundles HE approved · +3 pending his approval · +4 he rejected = 148 admin-side live bundles.
Settle on approved only. His old «2M أرباح» = 310k duplicate-phantom (repaired (b)) + 163k pending/rejected + 500k cost-bug margin →
true rep cut now **1,590,000** (shawl margins restored). NB عبدالعزيز رعد خضير: 16 pending bundles, has approved NOTHING.

**Retail duplicate-proofing:** ported the (b) pin+self-heal to `orderController.configureFullSet` + `configurePackage` — pin/heal
scoped to **`package_id IS NOT NULL`** (cart orders are never pinned to or cancelled; verified by SQL-semantics test). Also fixed
`adminController.repsOverview` + dashboard `topWholesalers` counting CANCELLED orders (rep card showed 463 vs real 420 for باقر).

**«Just 141» (owner decision):** admin rep cards now count **approved live BUNDLES** (`repsOverview` → COUNT DISTINCT cg FILTER
approved; باقر card = 141 = his own number, verified live) and clicking a rep on `/admin/orders` defaults the approval filter to
«موافق عليه» (back-to-all resets it). FE `app/admin/orders/page.tsx` · `tsc` 0. NB عبدالعزيز's card now shows 0 (nothing approved —
his 16 pending are behind the «بانتظار موافقة الممثل» chip).

### Open follow-ups
- **Deploy = push** (rides with the concurrent staff-pipeline session's commits). After deploy: re-run the duplicate scan + rule-violation
  scan (queries in audit_log details / this session). Until deploy, PROD can still create duplicates + writes shawl cost at old config.
- `configurePackage` for a rep-linked student still bypasses wholesaler approval + books cost=0 (critic finding, unfixed — unclear if
  FE still calls it for rep students).
- `prevGroup` in `fullSetOrder.js` can still bind a طقم to a retail cart checkout_group (edge, unfixed).

---

## 2026-07-16 (c) — Money audit after the duplicate-sash fix: 3 «cancelled rows counted in totals» fixes + historical cost drift quantified

**Uncommitted on main** (backend only: `controllers/{batchController,wholesalerController,orderController}.js`). Audit = live-DB invariant
scans + critic agent over the money paths. Gates: `node --check` 0 ×3 · **verified over real HTTP** (rep + admin JWTs, dev :4000 —
plain `node server.js`, restarted to load the fix).

**Fixed (all = cancelled orders leaking into money sums; became visible because the (b) repair cancels duplicates):**
1. `wholesalerController.listOrdersForApproval` — rep «الطلبات» bundle amounts had NO `status <> 'cancelled'` filter → the 38 repaired
   students still showed doubled amounts (180k) AFTER the repair. Fixed + verified live: حوراء/نبأ 90k · زينب 65k · فاطمه 70k.
2. `orderController.listOrders` bundle mode — `total_price/cost/profit` summed cancelled rows. Now skips them; cancelled pieces stay
   VISIBLE as items. Verified live: bundle total 90k with the cancelled sash listed.
3. `batchController.getBatch` — student `total`/`grand_total` had no cancelled filter (cost/profit/order_count did → non-reconciling).
   One-line FILTER. NOT live-testable: **0 batches exist in the DB** — precautionary consistency fix.

**Audit findings NOT fixed (user decision pending):**
- **Historical cost (admin-due) errors on pre-2026-07-15 rows** — old prod code wrote `cost` without addon-admin: **42 orders
  understate admin due by 722,000 IQD** (e.g. رغد أركان حميد sash cost 40k, should be 75k); **3 partial pieces** stamped with the
  full-package admin base (cost 40k > price 25k — fake loss); **51 more rows differ only by config drift** (rep التسعيرة values changed
  after creation — snapshots arguably correct). **0 mismatches on orders written after Jul 15** (current prod code is correct).
  Backfill = business decision (changes rep settlements retroactively).
- `orderController.configureFullSet` + `configurePackage` (retail paths) still have the SAME featured-drift duplicate class fixed in
  (b) — product-keyed upsert, no pin/self-heal. Port the pin+self-heal or route through `persistFullSetOrder` when touching them.
- `configurePackage` for a rep-linked student bypasses wholesaler approval + books cost=0 (edge, unclear if FE still calls it).
- محمد باقر's `pricing_addons` is legacy flat format → shawl admin=selling=30k (no rep margin), unlike عبدالله محسن's 20k/25k pair.
  Admin should re-save his التسعيرة with intended admin values.
- Accepted edge (documented): the (b) self-heal is same-checkout-group only; cross-group same-type dups aren't auto-cancelled —
  deliberate, because cross-group cancel could kill retail CART orders, and approval-scoping would break admin custom orders
  (`adminCustomOrderController` sets `wholesaler_approval = NULL`).

---

## 2026-07-16 (b) — FIX: wholesaler order EDIT duplicated the sash (38 bundles double-counted, +2.6M IQD phantom revenue)

**Uncommitted on main** (only `backend/lib/fullSetOrder.js` + docs; no migration). Data repair APPLIED to the shared Neon DB.
Gates: BE `node --check` 0 · repro e2e FAIL→PASS + self-heal PASS (self-cleaning throwaway rep/student, live DB, 0 leftovers).

**Bug (user report: «orders price 135/100/75 — عبدالله محسن»).** Since the form stopped sending `package_id`, `persistFullSetOrder`
resolved each piece to the *first active product per type* (`ORDER BY featured DESC…`). «وشاح الفراشة» was created **2026-07-06 with
featured=true** → jumped ahead of the old «وشاح» parent → every EDIT of a pre-07-06 order resolved sash to a DIFFERENT product id →
the `(student_id, product_id)` upsert missed → **second live sash order inserted**, old one never cancelled (cleanup loop was
deselected-types-only). 38 bundles across 4 reps (محمد باقر 29 · عبدالله محسن 5 · عبدالعزيز 2 · مهدي 2) double-counted the sash
(65+65=130k, 90+90=180k; the user's 135k = تبارك محمد فوزي 65+65+5k cap). 36 stale dups sat at design_complete = double-production
risk. NB: 75k/100k-style totals are usually LEGIT التسعيرة add-ons (ملكي +15k, شال +25k, ردن 5k×2, قبعة ثانٍ +5k).

**Fix (`backend/lib/fullSetOrder.js`, 3 edits):** ① a student's existing live order now **pins the product per piece type** on edit
(DISTINCT ON query overrides package/first-active resolution) — catalog changes can never fork a duplicate again; ② deselect-cancel
is now piece-TYPE-based scoped to the bundle's checkout group (was single-product-id); ③ post-upsert **SELF-HEAL** cancels any other
live same-type design-less order in the same checkout group (damaged bundles auto-collapse on next edit).

**Data repair (applied, in one tx, audit_log action `repair_duplicate_sash`):** cancelled the 38 OLDER duplicates (newer order =
the rep's latest edit/spec, kept); label-matched image migration filled NULLs only → restored 1 lost شال امريكي photo (the other
candidate was the rep deliberately removing the shawl — left alone); `final_design_url` losses: 0. Re-scan: **0 duplicate bundles**.
عبدالله محسن verified before→after: حوراء 180k→90k · نبأ 180k→90k · زينب 130k→65k · فاطمه 120k→70k · الممثل test 165k→100k.

### Open follow-ups
- **⚠️ PROD still runs the buggy code until the next push** — reps editing orders on lolo-shop96.com can re-create duplicates
  meanwhile (self-heal will collapse them on next edit AFTER deploy). After deploy, re-run the duplicate scan (query in the
  audit_log details / PROGRESS entry) and cancel any new stragglers.
- Rides the next deploy together with the (separate, concurrent) staff-pipeline session's commits — coordinate the push.

---

## 2026-07-16 — Station console: «عرض بالطلب» / «عرض بالقطع» for التطريز · الفصال · الكوي (shared StationConsole)

**Committed locally on main, NOT pushed (push = prod deploy — user tests first). No migration.** Gates: BE `node --check` 0 ·
FE `tsc` 0 · `eslint` 0. Verified via **live API smoke on Neon** (read-only: 30 embroidery rows all carry `zones` with stitch
text + plate image URLs; 15/15 pressing rows carry `can_advance`+`advance_label`; bulk endpoint 400s on empty; no raw
`embroidery_zones` jsonb leak; tailor queue has `student_id` on all 396 rows). **NO browser test by Claude (user instruction —
"open the browser and I will test")**: browser left open at `/staff` logged in as محمد عماد; fresh 7-day tokens + click-steps
appended to **`TESTING-WALKTHROUGH.md`** (untracked, do not commit). Spec:
`docs/superpowers/specs/2026-07-16-station-console-two-view-modes-design.md` (committed).

**Why.** User: the التطريز/الفصال screens show a flat row per order/item — «hard UX». Real work happens two ways: **طالب طالب**
(finish one student's whole order) and **بالجملة** (enter a rep's دفعة, do ALL sashes' يمين, then كل يسار, then كل خلف; caps جانب
then أعلى). Locked decisions: التطريز includes the cap (شال امريكي stays excluded); **الفصال stays parallel + retail-only**;
scope = التطريز + الفصال + الكوي (التجهيز later maybe).

**What shipped.**
- **NEW `components/staff/station/`** — `StationConsole.tsx` (shared console, per-kind config `embroidery|tailor|pressing`) +
  `StudentSheet.tsx` (portal full-screen sheet) + `Lightbox.tsx` + `types.ts`. Mounted: `/staff` home renders it for sole-role
  embroiderer/presser (`app/staff/page.tsx` — QueueView untouched for other roles); `/staff/tailor` is now a thin wrapper around
  it. Manager console `/staff/queue` untouched.
- **«عرض بالطلب» (default):** students-only list (name + `N قطعة · X/Y مناطق` + متأخر dot) → tap → sheet: piece cards with inline
  zone checkboxes (label + **the text to stitch + plate thumbnail**, tap = fullscreen) for التطريز, or one big «تم الفصال» /
  backend-labelled «إنهاء الكوي…» button otherwise. Last zone ticked → auto-advance (existing `markEmbroideryZone` engine) → piece
  becomes a green «انتقلت إلى الكوي ✓» ghost row in the open sheet (state: `advanced` Map, deduped against live rows). Zero-zone
  embroidery piece (canvas-designed retail sash) shows manual «إكمال التطريز» (= `advance`, backend already allows exactly this).
- **«عرض بالقطع»:** التطريز = zone chips w/ pending counts (ZONE_ORDER mirrors backend ZONE_DEFS) → rows of pieces missing that
  zone (name · product · text · thumb) → select-all + sticky bulk «إكمال المنطقة (N)»; الكوي = piece-type chips وشاح/روب/شال
  + bulk «إكمال الكوي (N)». **الفصال has NO «عرض بالقطع» (user follow-up same day)** — his toggle is عرض بالطلب + «المنجزة»
  (search + إرجاع/reopen); per-piece «تم الفصال» lives in the student sheet. Row body = Link to the order (user: no side
  «التفاصيل» button; checkbox is the only selection target). Shared filters: search + الكل/تجزئة/ممثلين (hidden unless
  showSourceFilter) + ممثل/دفعة selects (derived client-side; hidden for tailor). 15s `usePolling` + `useProductionEvents`
  reload; selection pruned on data-refresh, cleared explicitly on chip/view/filter change.
- **«Getting back perfectly» (user follow-up):** the console mirrors its whole UI state (view, chips, filters, search, CHECKED
  selection, open student sheet) to **sessionStorage per station** (`loloshop-station:<kind>`) and lazy-restores on mount — so
  «التفاصيل» → back lands exactly where the worker was mid-batch. Restoration is guarded by `loadedOnce` (validation effects
  that prune selection / reset chips / auto-close the sheet only run AFTER the first fetch, else the restored state would be
  wiped against the empty pre-fetch list). Safe to lazy-init from sessionStorage: the console only mounts client-side behind
  the auth loading gate (no SSR hydration mismatch).
- **Backend (`productionController.js` + `routes/production.js`, all additive):**
  - `getQueue?station=1` → rows gain `student_id`, embroidery rows gain `zones:[{key,label,done,text,image_url}]` via NEW
    **batched `detectZonesForOrders(ids, progressById)`** (ONE order_items query, same content rule + first-match-wins as
    `detectEmbroideryZones`, شال امريكي still ignored); pressing rows gain `next_status`/`can_advance`/`advance_label` (derived
    server-side via `nextStageFor` + `canStaffTransition` + `ADVANCE_LABEL_AR` — console never re-derives the state machine).
    Raw `o.embroidery_zones` jsonb selected for progress but **deleted from every response row**.
  - NEW **`POST /production/embroidery-zone-bulk`** `{items:[{order_id, zone}]}` (cap 200, dedup) — the single-tick logic was
    extracted into shared `applyZoneTick(user, id, zone, done)` (same guards: role caller-side, scope/stage/zone-validity inside;
    same audit rows; same auto-advance path); `markEmbroideryZone` is now a thin wrapper mapping reasons→the exact same
    status codes/Arabic errors as before. Bulk = per-item skip-and-report (mirrors `advanceBulk`), returns
    `{done, advanced, skipped, results[]}`.
  - `tailorQueue` SELECT gains `o.student_id`.
- **FE lib:** `getQueue(..., station?)` + `markEmbroideryZoneBulk` + `ZoneBulkResult` in `lib/staff.ts`; `StationZone` + queue-row
  enrichment fields in `lib/staff-types.ts`; `TailorOrderRow.studentId`.

### Open follow-ups
- **User browser walkthrough pending** (then commit-push to deploy; `next build` runs on the server — disk local 94%). Steps in
  `TESTING-WALKTHROUGH.md` §2026-07-16. Dev servers left UP: BE :4000 (plain `node server.js`, pid in scratchpad logs), FE :3000
  (`next dev`). Browser tab open as محمد عماد.
- التجهيز (preparer) intentionally NOT switched to the console (user scoped it out) — roll `StationConsole` there later if wanted.
- «عرض بالقطع» bulk for التطريز ticks ONLY the selected zone per piece — by design (zone-first batching).
- Old flat presser/embroiderer queue UI still exists in `app/staff/page.tsx` (`QueueView`) for multi-role staff (e.g.
  designer+embroiderer keep the merged queue) — deliberate, so multi-role workflows didn't change out from under them.

---

## 2026-07-15 (b) — Pipeline rework: stage-2 DELETED · «بانتظار التصميم» · calligraphy workbench (auto-link + تحويل للتطريز) · كوي station + everything-but-caps routing

**Committed locally on main, NOT pushed (push = prod deploy — user tests first).** Migration **065 applied to Neon**
(`calligraphy_variant` + `'cap_side'`; dev+prod share the DB). Gates: BE `node --check` 0 · FE `tsc` 0 · `eslint` 0 errors.
Verified: self-cleaning controller e2e **25/25 on Neon** + live HTTP smoke (queue 4 zones, plates carry order context).
**No browser test by Claude (user instruction)** — minted 7-day JWTs + click-walkthrough in **`TESTING-WALKTHROUGH.md`**
(untracked, do not commit). Spec: `docs/superpowers/specs/2026-07-15-staff-pipeline-labels-calligraphy-stations-design.md`
(incl. addenda) · plan: `docs/superpowers/plans/2026-07-15-staff-pipeline-labels-calligraphy-stations.md`.

**What changed (user decisions locked mid-session):**
1. **Label:** `design_complete` → **«بانتظار التصميم»** (`orderController.STATUS_LABEL_AR` + `frontend/lib/constants.ts` — the
   only two sources; grep-verified no stragglers).
2. **Stage-2 «التحويل» deleted from the live pipeline.** `nextStageFor: design_complete → embroidery` (approved-design +
   design-less); `designController.approveDesign` + `designTeamController.approveJob` now advance to `embroidery`;
   `REVERT_MAP.embroidery = design_complete`; STAGE_AUTHZ gained `design_complete→embroidery [designer]` +
   `embroidery→design_complete [embroiderer]`. **`converting` is DRAIN-ONLY**: enum value, queues (digitizer/manager/tailor),
   and its edges kept so legacy rows flow out; frontend rails dropped the chip. **0 orders were at converting** at cutover, but
   prod keeps creating them until deploy → **after deploy run:** `UPDATE orders SET status='embroidery' WHERE status='converting';`
3. **Calligraphy auto-link + send.** «ربط بالطلب» removed (route deleted). A done plate **auto-writes**
   `order_items.customer_image_url` (`autoLinkPlate` in processNext/reroll/composePlate). NEW `GET /calligraphy/orders-zones?ids=`
   (zones + has_image + can_send + state-machine-driven send_label) + `POST /calligraphy/orders/:orderId/send` = **«تحويل للتطريز»**
   (gate: admin/staff manager|designer — design_helper 403s, keeps محمد هيثم's approval flow; catch-up links older unlinked
   plates, then `performAdvance` — same tx/audit/notifications as the order page). Labels/targets derive from
   `nextStageFor` + `ADVANCE_LABEL_AR` (now module-scoped + exported), so future pipeline changes re-label the button for free.
4. **Calligraphy workbench UI** (`CalligraphyTool.tsx`): plates **grouped by student/order** (student name clickable →
   `/staff/orders/[id]?from=<path>`; hidden for design_helper), zone ✓/✗ chips, per-group send button + confirm modal when
   zones lack images, **sticky bar** (controls collapse into «توليد المزيد», filters الكل/بانتظار الإرسال/مُرسلة/بدون طلب +
   ممثل select + name search), **«تنزيل إلى مجلد…»** (File System Access picker; ZIP fallback via NEW `POST /plates/zip`),
   ممثل filter on the auto queue (`?wholesaler_id` on GET /queue + POST /queue/generate), **cap_side** 4th queue zone
   («تطريز القبعة من الجانب», prompt reuses the cap style), back button (`backHref` prop from the wrapper pages).
5. **كوي (presser).** ROUTING: plain (no-embroidery) **sash/robe/shawl now START at `pressing`**; plain caps stay `preparing`
   (`needs_pressing = type!=='cap'` unified in all 5 creation paths: configureOrder/configureFullSet/configurePackage/cart/
   fullSetOrder). `isFirstProductionStage` + `resolveRevertTarget` know plain pieces (plain@pressing = first stage, no revert;
   plain@preparing reverts to pressing; new authz edge `preparing→pressing [preparer]`). **Existing plain orders at preparing
   were NOT migrated** (per the 2026-06-24 precedent). VIEW: dedicated `layout='presser'` station (name + product photo +
   DesignGallery + sizes/spec + قياسات + advance); backend stops nulling item images/text for presser and grants measurements;
   phone/instagram/money/delivery still stripped (e2e-verified).
6. **Orders page:** `FinalDesignUpload` + its preview + the red «لم تُرفع صورة التصميم» alert **deleted** (all layouts). NEW
   shared `components/staff/DesignGallery.tsx` (zone images + «التصميم النهائي» legacy entry, tap-fullscreen portal + تنزيل)
   mounted on the full view + كوي station. التطريز/الفصال stations untouched. Queue `getQueue` gained `has_design_images`
   (EXISTS over item images) and «تصميم مفقود» = no final_design_url AND no item images. The backend `/final-design` upload
   endpoint STAYS (design-team desk flow unchanged).

### Open follow-ups
- **User browser walkthrough pending** — tokens + steps in `TESTING-WALKTHROUGH.md`. Then commit-push to deploy (`next build`
  runs on the server; NOT run locally — disk 93%).
- **After deploy:** re-drain converting (SQL above) + glance the live calligraphy page.
- Old plates generated before auto-link stay unlinked until their order is SENT (catch-up links then) — cosmetic.
- Digitizer (يوسف ريفو) role is now dormant (drain queue only) — admin may unassign/repurpose later.
- `TESTING-WALKTHROUGH.md` + scratchpad e2e are intentionally untracked; don't commit tokens.

---

## 2026-07-15 — أيادي التصميم desk made REAL (was empty) + committed/pushed the whole workshop/design-team/pricing batch

**Committed + pushed to main → auto-deploys prod.** Migration **064 applied to Neon + verified.** Gates: BE `node --check` 0 · FE `tsc` 0 ·
`eslint` 0 (6 pre-existing warnings). Verified: controller e2e on the shared DB (claim→ready→reject-reopen→approve→converting, self-cleaned)
+ **browser** as محمد هيثم (247 real jobs list, job modal with real spec + upload + الخط العربي, calligraphy tool loads for design_helper,
console clean).

**Why.** The أيادي التصميم `/d/` desk was **structurally empty** — its job board read the dead `designs` table (retail Fabric designer
removed 2026-06-20; 0 rows, nothing writes it). User's model: **محمد هيثم = a mini production-manager over his OWN design sub-team**; his
designers work the real retail orders + calligraphy; محمد هيثم reviews/approves like a manager sees staff; **admin sees the team as ONE unit
via محمد هيثم**, not each sub-designer (design_helper role stays out of the normal staff surface — that isolation was already right).

**What changed.** Re-pointed the desk from `designs` → **real retail orders at `design_complete`** (design_id NULL, has_embroidery, not
returned — 247 jobs: sash/cap/robe/shawl, same set the staff designer sees).
- **Migration 064** (`db/migrations/064_design_team_orders.sql` + schema.sql mirror): re-key `design_team_tasks` PK from `design_id →
  designs(id)` to `order_id → orders(id)` (table was empty → clean drop+recreate).
- **`designTeamController.js`**: `JOB_SELECT` now reads orders + `order_items` typed-spec lines (label/text/photo, allow-listed — no
  price/phone/PII) + `final_design_url`; jobs keyed on order_id; new `lockRetailPendingOrder`; **new `uploadFinalDesign`** (helper/lead
  uploads the artwork onto the order, same storage as staff `/final-design`). **Approve → order advances `design_complete → converting`**
  (into the normal pipeline, exactly like the staff designer). **Reject = reopen the task for the helper with a note; the order is NOT
  touched** (internal rework, not a send-back to the student).
- **`routes/designTeam.js`**: `:designId`→`:orderId`, added `POST /jobs/:orderId/final-design`.
- **Calligraphy for the team was ALREADY wired** (`routes/calligraphy.js allowCalligraphyUser` allows active `design_helper`). Added the
  frontend reach: `app/design-support/calligraphy/page.tsx` + «الخط العربي» links in the desk header and job modal.
- **Frontend** `lib/design-team.ts` (new Job shape: specLines + finalDesignUrl + rich `student` + `uploadDesignTeamFinal`) +
  `app/design-support/page.tsx` (spec + photos + final-design upload/replace + calligraphy link; lead sees «اعتماد وإرسال للتحويل» /
  «إعادته للعضو»). Per user: **student search box** (name / university / انستغرام / phone) + a **«معلومات الطالب» panel** in each job —
  full name, **Instagram (linked, from `students.instagram_username` or the bundle's `checkout_groups`)**, phone (tel:), gender, governorate,
  event date, notes. The desk is now intentionally NOT PII-lean (the team contacts students to confirm designs).

**This push also ships everything previously uncommitted:** the الورشة/Team-B workshop module (060–063), dual admin/selling pricing
(`fullSetOrder.js` + `admin_price_snapshot`), the 2026-07-11 order-actions/rep-pricing/money-reveal/visitors batch, and staff/admin edits.
Reviewed pre-push (critic): no CRITICAL/HIGH; portals fail-closed + timing-safe (`lib/secretCompare.js`), ledgers frozen-rate, SQL
parameterized.

### Open follow-ups
- **⚠️ VPS `.env` (prod) MUST get the portal keys or the secret URLs 404 (fail-closed):** `DESIGN_TEAM_PORTAL_KEY`, `WORKSHOP_PORTAL_KEY`,
  confirm `STAFF_PORTAL_KEY`, `MONEY_GATE_SECRET`, `OPENROUTER_API_KEY` (calligraphy), then `pm2 restart`. Migrations 060–064 are already on
  the shared Neon DB (dev+prod share it).
- **The design desk shows ALL retail `design_complete` has_embroidery orders (sash+cap+robe+shawl, 247)** — same set the staff `designer`
  queue shows. Both systems can see the same order (pre-existing overlap; admin decides who works it). If محمد's desk should be sash-only,
  add `AND p.type='sash'` to `JOB_WHERE`.
- **NOT fixed (flagged, user-scoped out):** workshop `myProduction` self-report has no `qty` upper bound (`validatePiece`) — a worker could
  inflate their own payable. 3-line cap when wanted.
- **Junk left untracked (excluded from the commit):** `voice_01-07-2026_20-02-38`, `design-mockups/`, `STAFF_ADMIN_READINESS.md`.

---

## 2026-07-10 — NEW «الورشة / Team B» module: bulk piecework production + wage ledger (standalone, no Team-A handoff)

**Uncommitted on main. NOT deployed.** Migration **060 applied to Neon + verified** (dev+prod share one DB). Gates green: BE `node --check`
0 (2 files) · FE `tsc` 0 · `eslint` 0. **Verified live end-to-end**: backend controller e2e on Neon **22/22** (self-cleaned) + HTTP smoke
(all workshop routes 200; portal key-gate 200/404; auth 401) + **browser** (worker portal + admin overview + run-detail reconciliation,
console clean). Spec: `docs/superpowers/specs/2026-07-10-workshop-team-b-design.md`. Memory: `project_workshop_team_b`.

**What & why.** LoloShop's garments are physically built by a *second* crew — the **Syrian workshop workers** (حمزة/محمود/بهاء), "Team B" —
who work in **bulk quantities** and are paid **per piece** (cutting → أوفرلوك/خياطة القبعة → خياطة الروب/تسكير الشال). This is separate from
"Team A" (the existing `role='staff'` per-order pipeline: محمد عماد embroiderer, ابو عبدو فصال, pressers). Team B can't be modeled by
`orders.tailor_status` (no quantities/multi-worker/wages). **Scope locked with user: build Team B standalone — it completes its own chain and
STOPS. NO auto-handoff into Team-A/التطريز (deferred). `orders` untouched.** Primary surface = admin view + **Syrian-dialect (اللهجة السورية)**
worker screens. Admin is omnipotent.

**Identity.** Workshop workers reuse `users` with a NEW **`role='worker'`** → same JWT/`authRequired`/session layer + a **secret-URL portal, no
OTP** (mirrors `staffPortalLogin`). ابو عبدو = his existing `staff` user *linked* into the roster (no role change, فصال screen untouched); his
cutting is recorded on his behalf. `workshop_workers.is_lead` (حمزة) may start runs + record cut qty + record on behalf.

**Backend.** Migration `060_workshop.sql` (mirrored in `db/schema.sql`): `worker` enum value + 6 tables `workshop_{workers,piece_rates,runs,
assignments,ledger,payments}` + enums `workshop_run_source`/`workshop_ledger_kind`. NEW `controllers/workshopController.js` + `routes/workshop.js`
mounted at `/api/workshop` in `server.js`. Ledger is **append-only with the rate FROZEN per row** (rate edits never rewrite history);
`completed = SUM(ledger completion)`, `balance = Σamount − Σpayments`. Reconciliation per run/op: assigned/completed/damaged/remaining/unassigned +
warnings (over-assigned, over-completed, cut≠expected). Over-assign is capped server-side. Gating: admin = `requireRole('admin')`; lead-or-admin
for runs/assign/record; worker-self for `/me/*`.

**Frontend.** NEW `lib/workshop.ts` (typed wrappers) · `app/w/[key]/page.tsx` (Syrian portal login) · `app/workshop/page.tsx` (Syrian worker
screen: «شغلك» jobs recorder + «حسابك» ledger) · `app/admin/workshop/page.tsx` (admin: نظرة عامة / الدفعات / العمّال / الأسعار tabs — runs,
per-op reconciliation, assign, record-on-behalf, workers CRUD + link-staff-for-ابو عبدو, rates matrix, payments). Sidebar link «الورشة» added.
`UserRole` gained `'worker'` (+ role-redirect maps → `/workshop`).

**⚠️ Env needed.** `WORKSHOP_PORTAL_KEY` was previously committed here and must be rotated. Generate a new random value, set it only in prod
`.env` on the VPS, then `pm2 restart`; otherwise the portal 404s (fail-closed, like `STAFF_PORTAL_KEY`).

### Open follow-ups
- **Demo data left in the shared DB** (I seeded it for the browser shots, then **did NOT delete it** because live testing was happening):
  workers **«حمزة (تجريبي)» / «محمود (تجريبي)»**, run **«دفعة دابي (تجريبية)»**, and robe rates (cut 500 / overlock 300 / robe_sew 1000).
  Delete the «(تجريبي)» worker + «(تجريبية)» run from the العمّال/الدفعات tabs when done. **Also present (NOT mine):** the real **ابو عبدو**
  staff user is linked as a workshop **lead** (created during live testing via the «ربط موظف» flow — left in place, it's real/intentional).
- **Not committed / not deployed.** Run `next build` before deploy (dev servers left up: BE :4000, FE :3000). Seed not updated for 060.
- **Rates/operations to confirm with user:** real per-piece wages, exact operation→product chains, محمود/بهاء split (all admin-editable now).
- Deferred by design: the Team-B → Team-A (التطريز) handoff. Wire later if wanted (spec §6).


---

*Older entries (2026-06-14 → 2026-07-08, all shipped) are archived in `docs/HANDOFF-archive.md`.*
