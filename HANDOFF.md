# HANDOFF

Rolling session handoff for whoever picks up next (human or Claude). Newest entry
on top. Keep entries short: **what changed · why · how it works · verified · open
follow-ups**. This file is auto-loaded into context via `@HANDOFF.md` in `CLAUDE.md`.

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
