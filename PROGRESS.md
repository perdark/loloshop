# Progress

## 2026-08-01 — Image weight: product photos were 4–6 MB served raw and uncacheable

**Uncommitted on main. No migration.** Gates: **backend 167/167** (+6) · `tsc` 0 · `eslint` 0 errors.
Full detail in `HANDOFF.md`.

- **Measured, not guessed:** prod product photos are **4.3–6.1 MB PNGs** (hero: 6,003,607 bytes at
  1856×2304, on a 390 px phone). Nothing resized them on upload, `/uploads` is `no-store` so they
  re-downloaded every visit, and the product page used a raw `<img>` that skipped Next's optimizer.
  The home grid already used the optimizer — that's why only the product page felt broken.
- **Answer to "client-side or SSR?": 47 of 54 pages are `"use client"`.** The storefront is entirely
  client-rendered — LCP 3.68 s with **2.79 s of render delay** on Slow-4G + 4× CPU, CLS 1.10.
- **Fixed at delivery:** hero + thumbnails routed through `/_next/image` inside a fixed `aspect-[4/5]`
  `object-contain` box (no crop, no distortion, and it reserves space so the CLS goes away).
- **Fixed at the source:** uploads over 500 KB are auto-oriented, capped at 2000 px and re-encoded
  (alpha → PNG, else JPEG q85 — no WebP on disk, so no downstream tool can be handed a format it
  can't open). Embroidery artwork is exempt on both client and server.
- **Fixed the upload leg:** browser-side downscale wired into `apiUploadFile`, the one choke point all
  11 upload callers share.
- **Verified end to end:** same 6 MB photo over real HTTP → **6,003,607 → 208,010 bytes (3.5%)**; a
  15.53 MB pick left the browser as **385,548 bytes (2.4%)** — a file multer would previously have
  rejected at its 10 MB cap.
- **⚠️ `priority` is deprecated in Next 16 and silently does nothing** — caught in the browser (no
  `fetchpriority` attribute emitted). Now `loading="eager" fetchPriority="high"`. **~8 other
  components still pass the dead prop** and lazy-load their above-the-fold images; not touched.
- **Second pass — the home page is a separate bug.** CrUX field data (real users, p75):
  **LCP 3905 ms, load delay 2113 ms, load duration only 289 ms** — so image bytes are NOT the home
  page's problem; discovering them late is. Fixed one concrete cause: `app/(student)/page.tsx`
  chained the shop feed *inside* `getMaintenance().then()`, making two API round trips **strictly
  serial**. Now concurrent (verified: start 3 ms apart and overlap). The rest is the client-render
  waterfall — the SSR fix is **blocked on an owner decision** because the JWT lives in `localStorage`,
  so a Server Component can't know the viewer's price role.
- **⚠️ None of this is deployed** — still uncommitted, which is why the live site was unchanged.

## 2026-07-31 (b) — App-only gate verified + shipped with the flag OFF · dead-app bug caught · attendance breaks were broken on prod

**Deployed with `NEXT_PUBLIC_APP_ONLY` unset, so prod behaviour is unchanged.** Turning it on is a
VPS env edit + rebuild — the exact commands are in `HANDOFF.md`. Gates: `eslint` 0 errors ·
`next build` 0 (run twice, flag OFF and flag ON) · `tsc` 0 · **backend 161/161**.

- **Phase 9 done in a real browser against a production build**, not dev: flag OFF is byte-identical
  to today (gate string absent from the HTML); flag ON bounces `/` to `/get-app` while `/admin`,
  `/workshop`, `/tv/<key>`, `/privacy`, `/terms`, `/delete-account` all still open; an Android UA on
  `/join/ABC123` lands on the real Play listing with `&referrer=join_ABC123`.
- **Caught a bug that would have bricked the app.** The gate keyed off `window.Capacitor` alone, but
  `Bridge.java:266` only injects it when `DOCUMENT_START_SCRIPT` is supported — **Android WebView
  105+**. Below that the app would have redirected *itself* to the Play Store forever. Now accepts
  `window.Capacitor || window.androidBridge`; proved with a controlled comparison where only the
  injected global changes (Capacitor → holds · androidBridge only → holds · neither → bounces).
- `TeamKeyEntry` verified with the real staff and workshop keys, a pasted `/s/<key>` link, and a
  wrong key.
- **Owner decisions:** PWA users get bounced too; App Store id `6793976053`.
- **Known and deliberately not fixed:** the gate only runs on full page loads, so `/admin` →
  (client-side) `/login` escapes it; and the bypass token ships in the page source. Both are
  properties of a client-side gate, both recorded in `HANDOFF.md` for an owner call.

**Separately — attendance breaks were live-broken on prod since 2026-07-30.** Shipped with 161/161
tests but never clicked; the first click threw `Cannot read properties of undefined (reading
'start_time')` at an Arabic-only worker. `staffPayload` returned half a payload while the frontend
maps every break action through one `mapAttendancePayload`. The write always succeeded (201) — only
the render died, so workers retried into «لديك خروج مؤقت مفتوح». Fixed by making
`attendanceController.todayPayload()` the single source of the payload shape. Then walked end to end:
request → approve → «طلعت» → «رجعت» → balance 10 س → 9 س 59 د, and the money path «خرجت بدون موافقة»
→ خصم ١٬٠٠٠ د.ع → «أوافق وألغي الخصم» → deduction cleared while the allowance stays spent.

## 2026-07-30 (b) — Apple rejection fixed: camera crash (2.1a) + in-app account deletion (5.1.1v)

**Uncommitted. Migration 076 applied to the laptop dev DB + mirrored into `db/schema.sql`. The
codemagic.yaml fix is on the `ios-appstore` branch (worktree), NOT main.** Gates: backend
**161/161** (+8 new) · live HTTP e2e **15/15** · `tsc` 0 · `eslint` 0 · **browser-verified on a
390px phone viewport, console clean**.

- **Camera crash** — the repo has no `Info.plist` at all; `npx cap add ios` regenerates it every
  build, so the app shipped without `NSCameraUsageDescription`. iOS kills any app that opens the
  camera without it, which is exactly what "tapped Take Photo → crash" is. New codemagic step
  injects the camera + photo-library strings after `cap sync` and **fails the build** if they are
  missing, so this cannot silently regress. Also sets `ITSAppUsesNonExemptEncryption=false`.
- **Account deletion** — new `POST /auth/account/delete` + `GET /auth/account/deletion-preview`
  (`accountController.js`), new `/account` screen linked from the student nav, and `/delete-account`
  rewritten to point at the real flow instead of "message us on Instagram".
- Deletion **anonymises** rather than row-deletes: `orders.student_id` is `ON DELETE RESTRICT`, so a
  real delete is refused the moment a student has an order and would destroy the shop's sales
  records. The account dies (phone/email NULLed, password replaced, `token_version` bumped so every
  JWT dies at once, cart/notifications/trusted devices cleared); the order survives on its
  `checkout_groups` delivery snapshot so an in-flight sash still ships.
- Retail only (`SELF_DELETE_ROLES`) — reps and staff/workshop keep admin-managed deletion.
- New `npm run demo-account` recreates the App Review demo login, because the reviewer walking this
  very flow would otherwise destroy it and fail the next submission.

Open: enter the real Apple reply (screen recording), push, rebuild on Codemagic, resubmit.

## 2026-07-30 — الخروج المؤقت: temporary-leave button beside بصمة + 10h monthly allowance

**Uncommitted on main. Migration 075 applied to the laptop dev DB + mirrored into `db/schema.sql`.**
Gates: backend **153/153** (+26 new) · `tsc` 0 · `eslint` 0 errors. **Browser walkthrough NOT done**
(stopped at the owner's request). Spec:
`docs/superpowers/specs/2026-07-30-attendance-temporary-leave-design.md`.

- New `staff_attendance_breaks` table + `break_monthly_minutes` on both settings layers (global
  default 600 = 10 hours, nullable per-staff override).
- New `backend/lib/attendanceBreak.js` owns the whole money rule: free only if approved AND inside
  the allowance; anything else deducted at the existing per-minute rate, frozen per row. Every
  change re-runs the worker's whole month so the parts always sum to the balance.
- New `backend/controllers/attendanceBreakController.js`: staff request → leave → return → cancel,
  admin list/balances/approve/reject/correct-duration. Wired into `routes/staff.js` + `routes/admin.js`.
- `worked_minutes` now excludes break time (new `present_minutes`/`break_minutes` on records);
  بصمة الخروج auto-closes a break the worker forgot to end.
- New `components/staff/StaffBreakControl.tsx` on both attendance surfaces (full card + compact
  `/staff` row) with the allowance bar, live timer, and the «خرجت بدون موافقة» escape hatch;
  new «الخروج المؤقت» section on `/admin/attendance`.

Open:
- Browser walkthrough (staff request → admin approve → طلعت → رجعت → over-quota deduction).
- Owner decision: should lateness deductions also reach the salary balance? (see spec, last section)

## 2026-07-29 — الورشة: piece rates split by customer type (ممثلين / تجزئة) — SHIPPED

**Pushed to main `8832922`, CI green, deployed. Migration 072 applied to prod by the deploy.**
Gates: backend **123/123** (+5 new) · `tsc` 0 · `eslint` 0 · live e2e on the dev DB · browser-verified
as a workshop worker and as staff.

**Done**
- Migration 072: `audience` (`wholesale`/`retail`) on `workshop_piece_rates` + `workshop_production_entries`;
  unique key is now `(operation, product, audience)`. `DEFAULT 'wholesale'` backfills all existing rows.
  Retail rates seeded equal to wholesale so no job is ever worth 0 on day one.
- `insertProduction`, `upsertRate`, `ratesMatrix` all resolve by audience — they had to change together,
  because the migration invalidates the 2-column conflict target and makes the un-filtered rate lookup
  match two rows.
- Audience is **required** on every production entry — no default, validated server-side.
- `ledgerFor` + `dashboard` return `production_wholesale` / `production_retail` (+ `pieces_*`).
- Worker screen: «لمين هالشغل؟» toggle (unselected by default, submit disabled until tapped), live price
  follows the choice, حسابك shows the two totals, each ledger line names its audience.
- Admin: two price inputs per job in أسعار القطع, the same required choice on تسجيل القطع, and a
  الكل/ممثلين/تجزئة filter on نظرة عامة (المستحق under الكل only — حوافز/خصومات belong to no audience).
- Payout card panel removed from the workshop crew's screen + its two backend routes deleted.

**Next**
- **Enter the real تجزئة wages in `/admin/workshop` → أسعار القطع.** Every retail rate currently equals its
  wholesale twin, so the split is structurally correct but changes no numbers until this is done.
- The payout-card feature remains uncommitted and undeployed — see HANDOFF for the blocking accrual issue.

---

## 2026-07-20 — Order editing repaired: priced spec lines were uneditable · student academic info had no edit path

**Branch `security-fixes`, committed, NOT pushed. No migration for this fix.** Reported by the owner as "editing on order for
retail has issues, and the student info on the order can't be edited". Both were confirmed against live Neon data before any
code changed. **Separately, migrations 067 (`users.token_version`) + 068 (`otp_send_events`) WERE applied to Neon this session**
— not for this fix, but because `middleware/auth.js` on this branch selects `token_version` on every authenticated request, so
the backend 500s on the old schema. That was already on the deploy checklist; it is now done rather than pending.

**① Priced spec lines were silently hidden from the editor.** `editContext` + `patchOrderDetails` filtered editable lines with
`COALESCE(price_snapshot,0) = 0`, intended as "never touch price rows". That conflated a line *carrying* a price with an edit
*changing* one — the UPDATE only ever writes `customer_text`, so the price was never reachable either way. Live impact:
**208 typed lines across 166 retail orders were uneditable**, exactly the embroidery texts staff need to fix — «القبعة من
الجانب» ٩٧، «القبعة من الأعلى» ٤٤، «تطريز ردن الروب» ٥٩، «ردن الروب» ٨. Verified on a real order (نبأ علي عبود): the old query
returned `[]` (the UI showed «لا توجد بنود نصية قابلة للتعديل»), the new one returns both ردن الروب lines. **Fix:** drop the
price condition, keep `customer_text IS NOT NULL`. Money safety is unchanged — the UPDATE sets only `customer_text` and is
scoped by `order_id`.

**② الجامعة / القسم / نوع الدراسة / الاسم had no edit path anywhere in the app** — the order page rendered them read-only and
`/edit` didn't offer them; only انستغرام had a ✎. **Fix:** new `university_name` / `department` / `study_type` branches in
`applyStudentInfo` (students-table only — no checkout_groups mirror), inline ✎ on all four rows of «بيانات الطالب», and the
same fields on the `/edit` page. `study_type` is a Postgres enum, so it gets a `<Select>` (صباحي/مسائي/غير محدد).

**③ Hardening found by the critic pass.** (a) A refactor to a computed payload key had broken the *existing* انستغرام edit —
`kind: "instagram"` serialised to a key the backend ignores, so it returned a success toast on a write that never happened.
The quick-edit `kind` is now typed as `keyof QuickEditPayload["student"]`, so a key that the backend doesn't accept **fails to
compile** (proven: reintroducing the old value produces TS2345). (b) `applyStudentInfo` validated *inline*, so a bad
`study_type` returned 400 **after** name/university/department were already committed → validation is now a separate
`validateStudentInfo()` pass that runs before any write. (c) `patchOrderDetails` committed item texts, then wrote student info
outside that transaction → item texts, student info, notes and the audit row now all land in **one** transaction.
(d) `saveFullSetOrder` could 400 after the طقم was already persisted, skipping the audit row → it validates before persisting.
(e) name `maxLength` was 160 client-side vs `clean(…,120)` server-side (silent truncation) → both 120 now.

**Gates:** BE `node --check` 0 · **NEW `backend/test/orderEditStudentInfo.test.js` 14/14** (offline — points DATABASE_URL at
localhost so the Neon guard stays intact; includes a spy proving **zero** UPDATEs run when validation fails) · FE `tsc` 0 ·
`eslint` 0 · live-data verification read-only inside a `SET TRANSACTION READ ONLY` block. The 2 pre-existing failures in
`test/authOtpChallenge.test.js` + `test/batchASecurity.test.js` are unrelated — they're DB-backed and die at `lib/db.js:10` on
require (the shared-Neon guard).

**Verified end-to-end over real HTTP against Neon** (admin JWT, order احلام صبحي `82c8946f`): `edit-context` returns both
previously-hidden 3000-price cap lines; `PATCH .../details` on one of them returns `items_changed: 1` — the identical call
returned 400 «عنصر غير قابل للتعديل» before the fix — with `price_snapshot` still **3000** afterwards, confirming money is
untouched. A student-info PATCH returns `student_info_fields: ["instagram_username"]`, i.e. the key is actually applied (it was
`[]` under the computed-key regression). Both write tests used the row's OWN current value, so no live data changed. Browser
renders all five ✎ affordances as admin. **Owner's own click-through still pending.**

## 2026-07-19 — Security fix LS-01: OTP is no longer a login on its own (branch `security-fixes`)

First item of the `SECURITY_AUDIT_REPORT_2026-07-16.md` plan. **The hole:** `POST /auth/resend-otp` was unauthenticated and let
the caller pick `{phone, purpose}`, and `login-verify`/`verify-otp` minted a JWT from `{phone, code}` with **no password check
and no role restriction** — so anyone who could read a victim's WhatsApp OTP logged in as them, admin included. Password+OTP
collapsed to OTP-only. **The fix:** the OTP row now carries a secret `challenge_id` + `user_id` (migration **066**, applied to
Neon, additive and backward compatible with the deployed old code). A challenge is issued only by a flow that already proved
something (correct bcrypt password for login; a just-created account for registration), and verification is addressed **by
challenge, never by phone** — the caller can't name the account it wants a token for. The phone-addressed
`verifyOtp(phone,code,purpose)` was deleted outright so no legacy path remains. Registration-verify additionally hard-refuses
any non-`retail` role. Resend now takes only a challenge and refreshes that row **in place** (same id — rotating it stranded
clients whose response was lost on a flaky network), metered by a new `sends` counter so it can't pump WhatsApp messages.
**Also closed** (found by the critic pass, same threat model): phone-OTP password reset used a stale deny-list, so `worker` and
`design_helper` — added by migrations 060/062 — could be taken over with one intercepted OTP; it's now an allow-list
(`retail`, `wholesaler` only). Side benefit: the unauthenticated "send a WhatsApp to any number" primitive is gone, which was a
Zentramsg sender-ban vector.

**Same session — batch 2.** **LS-04** the `?role=` catalog override was honoured for anyone, leaking the rep price book to
anonymous callers and (via `getShop`'s `audience`) wholesaler-only products to retail accounts → now admin + production
**managers** only, deliberately not every `role='staff'` since presser/tailor/embroiderer are denied money everywhere else.
**LS-10** NEW `backend/lib/password.js` applied at every `bcrypt.hash` site: **8-character minimum for everyone** (owner
decision — the audit's 12 for privileged accounts was rejected as too much friction) and banned shipped defaults.
**Enforced only when a password is SET — existing short passwords still log in** (test covers it).
`admin123`/`staff123`/`cust123`/`test1234` removed from all seed files; live DB scanned → **0 weak passwords across all 7
privileged accounts**. **LS-14** `getDesignByStudent` now enforces `staffScopeAllows` + strips the student phone for
non-designers (NB the endpoint has no frontend caller — the `designs` table is dead). **LS-15** health no longer returns raw
driver errors. **LS-16** `poweredByHeader: false` + anti-framing/nosniff/referrer/permissions headers; **CSP + HSTS left for
nginx** with the server move.

**Email removed entirely** (owner): SMTP was never configured in prod so the flow was already dead, and it carried a
reset-token endpoint + nodemailer (3 of the audit's high-severity advisories) for nothing. Registration and referral join no
longer take an email; `/auth/forgot-password`, `/auth/reset-password`, `lib/email.js` and `/reset-password/[token]` are gone.
Privileged accounts are reset by an admin or with the NEW `npm run set-password` — that script is why removing email doesn't
strand the admin account. **Registration errors now name the failing field** (`{error, code, field}` → the form pins the
message under the right input) instead of a blanket «تعذّر إنشاء الحساب».

Gates: `node --check` 0 · **backend tests 38/38** (23 new, six-role matrix + legacy-password login) · **live HTTP e2e 14/14 on
Neon, self-cleaned** · anonymous catalog payloads byte-identical · health verified against a dead DB · tsc 0 · eslint 0.
Committed to branch `security-fixes` (`7571497`). **NOT pushed — prod is still fully vulnerable until it is.** Browser
walkthrough pending. See HANDOFF.

**Sequencing note:** LS-03 (DB TLS) and the nginx half of LS-06 are deliberately deferred to the server migration (~2026-07-21,
DB moves to the new box — the Neon-CA fix would be wrong there), and **LS-02 secrets rotation should ride with it** since env
vars are being re-created anyway. That move is also the chance to finally split dev from prod (they share one Neon DB today).

## 2026-07-18 — Season scaling prep: caching · polling calm-down · pg-boss calligraphy worker · infra dials

Prep for the months 8–10 joining season (referral spikes of +1000 students in minutes). ① **In-process TTL cache**
(`backend/lib/memoCache.js`): join-code lookup 60s, full-set packages + rep pricing 60s (approval/existing-order reads stay
live), storefront shop/product feeds 120s keyed per audience+role, promo setting 60s — with immediate invalidation on admin
edits (التسعيرة del, promo del, and a route-level hook that clears catalog cache on ANY successful admin catalog mutation).
Money/settlement is never cached. ② **Polling**: waiting-screen approval poll 12s→45s±10s jitter, bell 30s→60s±15s (hidden
tabs already skip). ③ **Calligraphy generates server-side**: pg-boss queue on the existing Neon DB + new PM2 `loloshop-worker`;
the browser only watches progress (close the tab, plates keep generating); 2-min-stall watchdog falls back to the old client
loop. `processNext` logic extracted verbatim to `lib/calligraphyEngine.js` (shared, behavior unchanged). ④ **Dials**: DB pool
10→25, SLOW QUERY log >500ms, PM2 memory caps 800M/1G/500M. **Owner decisions:** rate limits UNCHANGED (accepted CGNAT risk +
documented emergency valve), no «تحقق الآن» button, monitoring developer-only, dev-DB split + CI builds deferred. Gates:
node --check 0 · unit 5/5 · tsc 0 · eslint 0 · live e2e on Neon 40/41 (1 = wrong test expectation, documented), self-cleaned.
Runbook: `docs/ops/2026-07-18-season-rollout.md`. NOT pushed. See HANDOFF.

## 2026-07-17 (d) — حذف = piece-only · admin/مدير الإنتاج order edit (full طقم + quick ✎) · custom order to existing student

① **Delete now removes ONE piece**, not the whole bundle: both `DELETE /production/orders/:id` and `/admin/orders/:id` delete the
single order row (items cascade), keep siblings, and drop the checkout_group only when the last piece goes. UI copy updated
(«حذف القطعة»). ② **Order editing for admin + manager** (new `orderEditController`, mounted under /api/production behind
`requireStaffType()`): «تعديل الطلب» button on the order page opens `/staff/orders/[id]/edit` — the rep's FullSetOrderForm
pre-filled + student info (name/IG/phones); the save goes through `persistFullSetOrder` then **restores the bundle's rep-approval
state exactly** (approved stays approved, NULL stays NULL — an admin edit can never hide an order in pending). Quick ✎ edits on
spec-line texts + instagram on ANY order via `PATCH /production/orders/:id/details`. ③ **Custom order → existing student**: both
`/admin/custom-order` and NEW `/staff/custom-order` (manager, «طلب مخصص» sidebar link) share `components/staff/CustomOrderForm`
with a طالب جديد/طالب موجود toggle; picking a student pre-fills their طقم (upsert = edit, never duplicate). Retail self-registered
students are excluded from search AND rejected server-side (their cart bundles must never be re-priced by the طقم form). Gates:
`node --check` 0 · `tsc` 0 (source) · `eslint` 0 · **live e2e on Neon 38/38, self-cleaned**. Browser walkthrough = user
(TESTING-WALKTHROUGH.md §2026-07-17). See HANDOFF.

## 2026-07-17 (c) — Navigation batch: state-restore on 5 screens · multi-role sidebar · orphan pages deleted

Full-app navigation audit + fixes. ① **State restoration** (the «forgets your place on back» bug, same class fixed for the
stations on 07-16) ported to 5 more screens via the same sessionStorage mirror pattern: `/staff/queue` (rail/source/rep/batch/
zone/search/page — the URL-driven dims restore via router.replace), `/admin/orders` (all ~12 filters + sort; `?wholesaler=` URL
still wins + the click-a-rep approval default preserved), rep bulk console (tab/zone/view/search + **checkbox selection**, pruned
after first fetch), `QueueView` on `/staff`, and `CalligraphyTool` (chips/رep filters/search/sticky-bar). ② **Sidebar multi-role
fix**: nav links now merge across `staff_types[]` (tailor+embroiderer sees both قائمة التطريز AND الفصال); role label shows all
roles joined. ③ **Orphans deleted**: `/verify-otp` (+`VerifyOtpForm`), `/wholesaler/batch`, `/wholesaler/package`,
`/admin/wholesalers/[id]/students` (dead duplicate — admin uses the staff console route); robots.ts + sitemap cleaned (sitemap
advertised nonexistent `/showcase`). Gates: `tsc` 0 · `eslint` 0. Browser walkthrough = user. See HANDOFF 2026-07-17 (c).

## 2026-07-17 (b) — Designer sees full student info (phone + instagram + intake) on the order page

Per user: designers contact students to confirm designs, so the PII-lean strip no longer applies to them. In
`productionController.getOrder`: `canSeeContact` now includes any staff with the `designer` type (sole or multi-role), and the
lean intake-null skips designers — they get the full intake card (customer name, phones, instagram, governorate, event date,
notes). Money stays hidden (price + intake.deposit still stripped by canSeeMoney). No FE change needed — the «بيانات الطالب» card
already renders contact rows when the backend supplies them. Verified over real HTTP with a real designer JWT (مضر محمد): phone +
instagram + intake present, price/deposit absent. Note: designers do NOT have the StationConsole — they still use the flat
QueueView on `/staff` (console is التطريز/الفصال/الكوي only).

## 2026-07-17 — Owner money rules locked + repairs: شال=20k admin · cost backfill +682k · retail duplicate-proofing

Owner locked the settlement rule (admin gets all except package margin + شال margin; شال admin = 20,000 for every rep). Applied:
config repair (باقر/أنس flat شال → pairs), cost backfill on 47 orders (+682k admin due, 0 rule violations / 0 cost>price after),
pin+self-heal ported to retail `configureFullSet`/`configurePackage` (scoped `package_id IS NOT NULL`, cart never touched),
rep-card counts stopped counting cancelled. 141 vs 148 explained (141 approved + 3 pending + 4 rejected). See HANDOFF 2026-07-17.

## 2026-07-16 (c) — Money audit: cancelled rows no longer counted in rep/admin/batch totals · cost drift quantified

Post-repair audit (invariant scans + critic). Fixed 3 «cancelled orders summed into money» bugs: rep approval list
(`listOrdersForApproval` — the repaired students showed 180k until this), admin bundle totals (`listOrders` group=bundle, cancelled
pieces stay visible but uncounted), batch student totals (`getBatch`, consistency — 0 batches in DB). Verified over real HTTP.
NOT fixed (reported, pending user): 42 pre-Jul-15 orders understate admin cost by 722k IQD (old code dropped addon-admin) + 3 with
cost>price; retail `configureFullSet`/`configurePackage` still carry the featured-drift duplicate class; محمد باقر legacy flat
التسعيرة (shawl admin=selling=30k). See HANDOFF 2026-07-16 (c).

## 2026-07-16 (b) — FIX: wholesaler edit duplicated the sash order (38 bundles, +2.6M IQD phantom)

Root cause: the طقم form stopped sending `package_id`, so `fullSetOrder.js` resolved each piece to the *first active product per
type* (`featured DESC`). When «وشاح الفراشة» went featured on 2026-07-06 the sash re-resolved to a different product id on every
EDIT of an older order → the (student, product) upsert missed → a **second live sash order** was inserted (65+65=130k, 90+90=180k…).
Fix in `backend/lib/fullSetOrder.js`: existing live order now **pins the product per piece type** on edit; deselect-cancel is
type-based within the bundle; post-upsert **self-heal** cancels any second live same-type order in the checkout group. Data repair
on Neon: 38 stale sash orders cancelled (audit_log `repair_duplicate_sash`), 1 lost شال photo restored, 0 duplicate bundles remain.
Verified: repro script FAIL→PASS + self-heal PASS (self-cleaning, live DB) · `node --check` 0. **Uncommitted; prod still has the
buggy code until next push — re-run the duplicate scan after deploy.**

## 2026-07-16 — Station console: «عرض بالطلب» / «عرض بالقطع» for التطريز · الفصال · الكوي

One shared `StationConsole` (spec `docs/superpowers/specs/2026-07-16-station-console-two-view-modes-design.md`) replacing the flat
per-order lists on the three stations, supporting both real work modes:
1. **«عرض بالطلب»** (default) — students-only list (name + N قطعة + X/Y مناطق + متأخر) → tap → full-screen sheet with the student's
   pieces: inline **zone checkboxes with the stitch text + plate thumbnail** (التطريز), or one «تم الفصال»/«إنهاء الكوي» button per
   piece. All zones done → the piece auto-advances (existing engine) and stays visible as a green ✓ row.
2. **«عرض بالقطع»** — flat work items: **zone chips with pending counts** (التطريز: كل يمين، ثم كل يسار…) or **piece-type chips**
   (الفصال/الكوي: وشاح/روب/شال), tap-to-select rows + sticky bulk bar. NEW `POST /production/embroidery-zone-bulk` (same guards as
   the single tick, per-item skip-and-report, auto-advance). الفصال gets a third «المنجزة» view (search + إرجاع).
3. Backend: `getQueue?station=1` enrichment — per-order `zones` (batched `detectZonesForOrders`, one order_items query, text+image
   content, شال امريكي still excluded) + backend-granted `can_advance`/`advance_label` on الكوي rows + `student_id` everywhere
   (also on tailor-queue). State machine untouched; الفصال stays parallel + retail-only; manager `/staff/queue` untouched.
Verified: BE `node --check` 0 · FE `tsc` 0 · `eslint` 0 · live API smoke (30 embroidery rows all carrying zones w/ plate URLs,
15/15 pressing rows granted, bulk validation 400, no raw jsonb leak). **Browser testing = user** (tokens + steps appended to
`TESTING-WALKTHROUGH.md`, untracked). Uncommitted→committed locally, NOT pushed.

## 2026-07-15 — Pipeline rework: stage-2 deleted · «بانتظار التصميم» · calligraphy workbench · كوي station + routing

Whole staff pipeline reshaped (committed locally, **NOT pushed/deployed**; spec `docs/superpowers/specs/2026-07-15-staff-pipeline-labels-calligraphy-stations-design.md`):
1. **Label**: `design_complete` now renders **«بانتظار التصميم»** everywhere (was the lying «اكتمل التصميم»).
2. **Stage-2 «تحويل التصميم لتطريز» DELETED** from the live pipeline — design goes straight to التطريز (advance + both approve flows + design-team desk). `converting` kept drain-only (0 rows at cutover; re-drain after deploy).
3. **Calligraphy workbench**: plates **auto-attach** to their order line on generation («ربط بالطلب» removed); grid **grouped by student/order** with zone ✓/✗ chips, clickable student → the order (`?from=` back), order-level **«تحويل للتطريز»** button (admin/designer/manager only — the real state machine), sticky filter bar (status/ممثل/بحث), **«تنزيل إلى مجلد…»** (folder picker, ZIP fallback), ممثل filter on the auto queue, **cap-side** 4th zone (migration 065, applied).
4. **الكوي**: gets **every order except caps** — plain sash/robe/shawl now START at pressing (all 5 creation paths); dedicated minimal station (name + product photo + design gallery + sizes/قياسات + advance), design images unblocked server-side, contact/money still stripped.
5. **Orders page**: final-design upload + preview + red nag **removed**; new shared `DesignGallery` (zone images + legacy final design, fullscreen + تنزيل) on the full view + كوي station. Queue «تصميم مفقود» now counts plate images (`has_design_images`).

Verified: BE `node --check` all · FE `tsc` 0 / `eslint` 0 · self-cleaning e2e **25/25** on Neon (send happy/409/403-gate, auto-link catch-up, presser visibility, state-machine edges) · live HTTP smoke (queue 4 zones incl cap_side=175 real pending; plates carry order context). Browser testing deferred to user (tokens + walkthrough in `TESTING-WALKTHROUGH.md`, untracked).

New standalone module tracking garment **quantities** through the Syrian workshop (قص → أوفرلوك/قبعة → خياطة/تسكير) and paying workers **per piece** — separate from the Team-A order pipeline; **no auto-handoff to Team A** (deferred), `orders` untouched. Migration **060** (applied to Neon): `worker` role + 6 `workshop_*` tables. Backend `workshopController.js` + `/api/workshop` (secret-URL portal no-OTP, runs/assignments, **append-only ledger with frozen rate**, reconciliation warnings, payments/balance). Frontend: Syrian-dialect worker portal (`/w/[key]`) + worker screen (`/workshop`), admin dashboard (`/admin/workshop`: overview/runs/workers/rates) + sidebar link. Identity: workers are `users role='worker'`; ابو عبدو linked from his existing staff user (فصال screen untouched). Verified: BE e2e **22/22** on Neon + HTTP smoke (200s / key-gate) + browser (portal + admin overview + run-detail reconciliation, console clean); FE `tsc`/`eslint` 0. **Uncommitted, not deployed.** ⚠️ Set `WORKSHOP_PORTAL_KEY` in prod `.env`. Demo «(تجريبي)» data left in DB (see HANDOFF). Spec: `docs/superpowers/specs/2026-07-10-workshop-team-b-design.md`.

## 2026-07-07 — Back-nav fix · calligraphy preview+designer · money-gate · freestyle TV

Four items (uncommitted on main, not deployed — see HANDOFF for detail):
1. **Order back button** returns to origin (`?from=` + same-origin referrer fallback; open-redirect hardened) instead of always the dashboard. 6 entry points + order page.
2. **Calligraphy AI preview** now closable (overlay portaled to `document.body`); tool extracted to shared `CalligraphyTool`.
3. **Calligraphy AI opened to designers** (`/staff/calligraphy` + sidebar link; backend `requireStaffType('designer')`).
4. **Money-gate**: revenue/profit hidden by default on `/admin` + `/tv`, revealed by a disguised 🎓 + secret passphrase (stripped server-side on TV via `x-tv-reveal` header; hashed in `site_settings.money_gate`, min 8, rate-limited). **TV freestyle-redesigned** into a full-screen scene cinema (6 rotating money-free scenes + old Iraq map kept + money scene only while revealed, auto-hides 90s). Dashboard money masked + new non-money charts (orders-trend, pipeline).

Verified: FE `tsc` 0 · `eslint` 0 · BE `node --check` OK; TV + dashboard driven live in-browser; money-gate server-side confirmed (no-reveal/wrong→null, correct→figures). Passphrase `lolo2026` (change before deploy — dev+prod share the DB). Critic-reviewed; hardening fixes applied.

## 2026-07-07 — Homepage trust-first feed (above طقم التخرج الكامل)

Replaced the five stacked marketing bands (`ShopCover`, `AtelierStory`, `MilestoneStory`, `DesignProcess`) with a single Instagram-native trust scroll (`HomeTrustStory.tsx`): full-bleed opening grad photo, vertical photo feed with captions, short craft copy, soft CTA link to `#catalog`. `VipHomeBand` restyled as a feed post (square photo, caption below, no heavy card). `FullSetBand` + catalog + store location unchanged. Approval mockup: `design-mockups/trust-feed/index.html`.


- Retail robe + full-set wizard: sleeve embroidery toggles grouped under a visible **«ردن الروب»** card with larger checkboxes (الردن الأيمن / الأيسر) instead of buried per-group fieldsets.

## 2026-07-02 — Wholesaler custom order + shawl notes

- **Edit fix:** `persistFullSetOrder` now normalizes `student.phone ?? ''` so editing name-only custom orders no longer 500s on `checkout_groups.phone_primary NOT NULL`.
- **Custom order confirmation:** removed auto-approve from `quickFullSetOrder` — custom orders stay `pending` until the rep confirms from «طلبات الطلاب». FE: updated copy, redirect to pending orders, «تعديل» link + «تأكيد وإرسال للإنتاج» on pending rows.
- **Shawl notes:** migration `058_retail_shawl_notes.sql` adds optional «ملاحظات» prompts to top-level shawl products; retail product page renders notes textarea alongside optional photo for `type=shawl`; `seed-v2.js` updated for fresh installs.

Verified:
- Backend `node --check` on `fullSetOrder.js`, `wholesalerController.js`.
- Migration 058 applied to Neon.
- Frontend `npx tsc --noEmit` 0.

## 2026-07-02 — Retail cap/robe form improvements

- Removed generic retail cap photo group «صورة القبعة» (migration 050 superseded).
- Cap «القبعة من الجانب» / «القبعة من الأعلى»: when student picks «بكتابة», text is required and reference photo is optional.
- Robe «ردن الروب» single-select replaced with optional left/right sleeve toggles (+5,000 د.ع each) with required text + optional photo per checked sleeve.
- محيط الصدر is now optional on retail product page and retail full-set wizard (range-checked when provided).
- Migration `057_retail_cap_robe_form.sql` + `seed-full-set.js` updated for fresh installs.

Verified:
- Backend `node --check` on `orderController.js`, `seed-full-set.js`.
- Frontend `npx tsc --noEmit` 0.

## 2026-06-29 — Staff attendance separated from salary

- Separated «بصمة الموظف» from salary: staff now have an independent `/staff/attendance` page/link, while `/staff/me` is salary/activity only.
- `/staff` now shows only the compact attendance button for all staff role dashboards; the full attendance card stays on `/staff/attendance`.
- Attendance check-in no longer creates salary deduction transactions, and salary summaries ignore older attendance-sourced transactions.
- Added admin-controlled per-staff exemption via `/admin/attendance`: each employee can be marked «مطلوبة» or «معفى» from attendance.
- Applied migration `054_attendance_exemptions.sql` to the configured database.

Verified:
- Backend syntax checks for touched controllers/routes.
- Frontend `npm run lint`.
- Frontend `npx tsc --noEmit`.
- Verified `staff_attendance_user_settings.attendance_required` exists in DB.
- Browser-smoked `/staff` after clearing the PWA service worker cache: only the compact attendance button appears before «مراجعة التصاميم».

## 2026-06-29 — Google Play readiness pages + PWA shell

- Added public Arabic policy pages for Google Play review: `/privacy`, `/terms`, and `/delete-account`.
- Linked `/privacy` and `/terms` from the shared public/student footer, with `/delete-account` linked from the privacy policy page for Google Play account-deletion access.
- Added a reusable legal page layout and included the policy routes in the public sitemap.
- Added PWA registration, `public/sw.js`, and `public/offline.html` so the app has an install/offline fallback shell.
- Expanded `manifest.json` with `scope`, portrait orientation, and store categories.
- Added `/.well-known/assetlinks.json` as an env-driven Next route for Trusted Web Activity verification.
- Added `frontend/.env.example` entries for `NEXT_PUBLIC_API_URL`, `ANDROID_PACKAGE_NAME`, and `ANDROID_SHA256_CERT_FINGERPRINTS`; updated frontend `.gitignore` so the example file can be committed.

Verified:
- Frontend `npm run lint`.
- Frontend `npm run build`.

Open:
- After creating/uploading the Android App Bundle in Play Console, copy the Play App Signing SHA-256 into `ANDROID_SHA256_CERT_FINGERPRINTS` and redeploy so `https://lolo-shop96.com/.well-known/assetlinks.json` returns the real Digital Asset Links JSON instead of 404.
- Still need Android/TWA wrapper generation with Bubblewrap, Play Console store listing assets, Data safety form, reviewer test access, and closed testing if the account requires it.

## 2026-06-29 — Staff attendance, payroll removal, admin custom orders

- Added staff attendance / «بصمة الموظفين» model and APIs: admin-controlled shift times, grace minutes, per-minute late deduction, network/location verification settings, staff check-in/check-out, attendance records, and override support.
- Added per-staff attendance overrides so each employee can have a custom arrival/departure time, grace window, and per-minute deduction while others keep the default schedule.
- Initially connected late attendance markers to payroll ledger entries; superseded above by the attendance/salary separation.
- Added admin removal for manual «حافز» and «خصم» transactions.
- Added admin custom order creation using the existing full-set order form/persistence, with optional wholesaler attachment.
- Added frontend pages/entry points for `/admin/attendance`, `/admin/custom-order`, and staff self-service attendance on `/staff/me`.

Verified:
- Applied migration `052_staff_attendance.sql` to the configured database.
- Applied migration `053_staff_attendance_user_settings.sql` to the configured database.
- Backend smoke script passed for attendance check-in, manual salary transaction removal, and admin custom order creation (temporary data cleaned up).
- Backend smoke script passed for per-staff attendance override: default 9:00, staff override 10:00, check-in record used 10:00.
- Backend syntax checks for touched controllers/routes.
- Frontend `npm run lint`.
- Frontend `npx tsc --noEmit`.

Open:
- Browser smoke test still needed for staff check-in/out, admin attendance settings, payroll transaction removal, and admin custom order creation.
