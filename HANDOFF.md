# HANDOFF

Rolling session handoff for whoever picks up next (human or Claude). Newest entry
on top. Keep entries short: **what changed · why · how it works · verified · open
follow-ups**. This file is auto-loaded into context via `@HANDOFF.md` in `CLAUDE.md`.

---

## 2026-06-24 (b) — Wholesaler two-stage order approval (rep approves the student's order → it surfaces to staff + dashboard)

Committed to **main** this session. **Migration 044 applied to Neon + verified.** Gates green: FE `tsc` 0 · `eslint` 0 ·
BE `node --check` 0 (9 files). **Verified live end-to-end** (full backend HTTP e2e + rep UI driven in the dev browser).
`next build` NOT run (dev servers up). Plan: `docs/superpowers/plans/2026-06-24-wholesaler-order-approval.md` · spec:
`docs/superpowers/specs/2026-06-24-wholesaler-order-approval-design.md`. **Built via an 8-agent Workflow** (foundation + 3 FE +
3 BE + verify) + orchestrator live e2e.

**Why.** Stage 1 (rep approves each **student**) already existed; their **order** flowed straight to production. Now (user
decision) **every** wholesaler order must be **approved by the rep** before staff/dashboard see it. Rep can **Approve** or
**Reject** (sends back to the student to fix); approved orders **lock** from student edits; **admin** has oversight + override.

**1. Orthogonal approval column (NOT a new status — production state machine untouched, like `tailor_status`).** Migration
**044**: enum `wholesaler_approval_status('pending','approved','rejected')` + `orders.wholesaler_approval` (NULL=retail,
always visible), `wholesaler_approved_at/by`, `wholesaler_reject_reason`, index. **Backfill grandfathered existing wholesaler
orders → 'approved'** (6 rows) so live work didn't vanish; retail stays NULL (10 rows).

**2. Creation sets `pending`.** `lib/fullSetOrder.js persistFullSetOrder` sets `wholesaler_approval='pending'` on all 3 bundle
rows on BOTH create and the idempotent re-save (any edit re-enters approval, clears reject_reason). Single choke point → covers
rep-fill AND student `/my-order`.

**3. Shared helper `lib/orderApproval.js`** — `setBundleApproval({checkoutGroupId, decision, actorUserId, reason, repWholesalerId})`
flips ALL rows of a `checkout_group` (the bundle = unit of approval), scoped `wholesaler_approval IS NOT NULL` (never touches
retail) + optional rep-ownership subquery; writes audit_log; publishes eventBus; returns student/rep user ids. `notifyUser` inserts
a notification. **GOTCHA fixed live:** the enum param needs a cast — `SET wholesaler_approval = $2::wholesaler_approval_status`
(else PG: "inconsistent types deduced for parameter $2" because the same `$2` was compared to text `'approved'` in a CASE). Static
`node --check` couldn't catch this; the orchestrator HTTP e2e did.

**4. API (key = `checkout_group_id`).** Rep (`routes/wholesaler.js` — note `/orders/bulk` declared BEFORE `/orders/:cg/...`):
`GET /wholesaler/orders?approval=pending|approved|rejected` (grouped per bundle), `POST /wholesaler/orders/:cg/approve`,
`.../reject {reason}`, `POST /wholesaler/orders/bulk`. Admin override (`routes/admin.js`): `POST /admin/orders/:cg/approve|reject`
(no ownership; notifies BOTH student + rep), `GET /admin/orders-pending-count`.

**5. Gates (the visibility rule).** `productionController.getQueue` + `staffController.wholesalerOrders` + (NEW this session)
`orderController.listOrders` for **non-admin** callers all filter `(wholesaler_approval IS NULL OR ='approved')`. **Admin
`listOrders` is NOT gated** (oversight) and takes `?approval=` to filter; admin dashboard uses admin-only `/api/admin/orders`.
Student **lock**: `orderController` rep-full-set POST returns **403 `ERR_LOCKED`** if the student already has an `approved` order.

**6. Frontend.** Rep: NEW `app/wholesaler/orders/page.tsx` («الطلبات» nav added) — pending/approved/rejected tabs, per-student
cards (name · products · price · date · reject reason), Approve / Reject(reason modal) + bulk approve. Student:
`app/(student)/my-order/page.tsx` — approval banner (pending amber / approved green+form-locked / rejected red+reason+editable),
handles 403 ERR_LOCKED. Admin: `app/admin/orders/page.tsx` («بانتظار موافقة الممثل» filter + badge + override buttons),
`app/admin/page.tsx` (pending count card), `lib/{wholesaler,admin}.ts` wrappers.

**Verified live (orchestrator e2e + browser).** Pending hidden from getQueue + staff `/api/orders`; rep lists pending → approve
→ surfaces to queue + student notified; reject stores reason + notifies, empty reason→400; student edit of approved→403
ERR_LOCKED; admin pending-count + override approve + both notified; retail unaffected; bulk approve done=1. Rep UI driven in
browser: «دابي» 2 pending bundles → «موافقة» moved one out of pending (2→1). (Ownership-guard e2e skipped: only one wholesaler
in dev DB.)

### Open follow-ups
- **Demo data left for hand-testing:** rep «دابي» (wholesaler `78fea03e…`) has its 2 bundles set to `wholesaler_approval='pending'`
  so the rep «الطلبات» page has orders to approve/reject. Approving them is the natural way to clear it.
- **Decision recorded:** managers (staff_type) are gated like staff in `listOrders` (only admin role sees pending). If managers
  should also see pending for oversight, widen the `req.user.role !== 'admin'` check in `orderController.listOrders`.
- Known edge (spec §14): wholesaler orders are assumed created only via `persistFullSetOrder`; a wholesaler student placing a
  plain retail-cart order would be created NULL and bypass the gate. Out of scope.
- `next build` not run (dev servers up); run before deploy. Seed not updated for 044 (schema.sql mirrored; migration idempotent).

---

## 2026-06-24 — Admin calligraphy batch tool (AI name-plates via OpenRouter → crop → link to order)

Committed to **main** this session. **Migration 043 applied to Neon + verified.** Gates green: FE `tsc` 0 · `eslint` 0 ·
BE `node --check` 0 (all 7 files). **Verified live end-to-end** (real OpenRouter calls + backend HTTP e2e + dev browser).
`next build` NOT run (dev servers up). Plan: `docs/superpowers/plans/2026-06-24-calligraphy-batch-tool.md` · spec:
`docs/superpowers/specs/2026-06-24-calligraphy-batch-tool-design.md`. **Built via a 3-agent Workflow** (backend libs+migration ·
backend API · frontend UI) + interactive money-gated checkpoints.

**What & why.** Admin-only tool: paste/grab/upload a list of student names → AI generates Arabic-calligraphy name-plate PNGs
(10 names per sheet → cropped into 10 individual plates) → proof grid → re-roll bad ones → ZIP download → optionally **link a
plate onto the sash order's «تطريز الوشاح من الأمام» line** (`order_items.customer_image_url`). Replaces hand-doing name calligraphy.

**1. OpenRouter (`backend/lib/openrouter.js`).** `generateImage({model,prompt,resolution,aspectRatio})` → `POST
https://openrouter.ai/api/v1/images`, body `{model,prompt,resolution:'2K',aspect_ratio:'9:16',n:1,output_format:'png'}`,
returns base64 → Buffer + `usage.cost`. **Sole reader of `OPENROUTER_API_KEY`** (server-side, in `backend/.env` — already set,
73 chars). **MODEL LOCKED to `google/gemini-2.5-flash-image`** (both `MODELS.standard` and `.premium`) per user decision
2026-06-24 — chosen for cost (~**$0.039/image** → ~**$3.9 per 1,000 students**). **⚠️ TRADE-OFF the user accepted explicitly:
this model GARBLES Arabic spelling — live test produced 0/10 correct names (pretty Thuluth of *unrelated* words). The accurate
model `gemini-3.1-flash-image` (10/10, $0.067@1K / $0.10@2K) is deliberately NOT used.** Cost is per-image, amortized by the
10-names/sheet batching (`gen.cost / batch.length`); a 1-name re-roll is a full ~$0.039.

**2. Crop (`backend/lib/sheetCrop.js`, `sharp`).** `cropSheet(buffer, expected)` slices a vertical N-up sheet into N plates by
horizontal ink-density valleys (noise filter + smallest-gap merge for diacritics). **Live verified 10/10** on a real sheet,
each plate one clean name top→bottom in input order. If `count !== expected` → batch flagged `failed` + `review:true`, sheet kept
(no mis-slice). Minor cosmetic bleed of neighbouring descenders on tightly-stacked lines (acceptable; see follow-ups).

**3. Data + API.** Migration **043** `calligraphy_plates` (16 cols; grouped by server-generated `job_id`; `order_item_id` =
link target; `cost_usd`, `status pending|done|failed`, `linked_at`). All endpoints `requireRole('admin')` in
`routes/calligraphy.js` (`controllers/calligraphyController.js`): `GET /wholesalers`, `GET /wholesalers/:id/names` (grab list from
the sash front-embroidery line), `POST /jobs` (create pending rows, dedup — wholesaler by `order_item_id`, typed/txt by
`render_text`), `POST /jobs/:id/process` (next ≤10 pending → 1 OpenRouter call → crop → save → done; **client loops this for
progress + resume**), `GET /jobs/:id`, `POST /plates/:id/reroll` (single 1-name, swaps `plate_path`), `POST /plates/:id/link`
(writes `order_items.customer_image_url`, **never touches order status**), `GET /jobs/:id/download` (streams ZIP, names by
`render_text`). `server.js` mounts it + mkdirs `/uploads/calligraphy/{sheets,plates}` at boot. `lib/upload.js` gained
`saveBufferToUploads` + `absFromUrl`.

**4. Frontend.** `app/admin/calligraphy/page.tsx` — 3 input modes (كتابة/لصق · حسب الممثل · رفع .txt),
generate loop with progress bar, proof grid (image + render_text + status + re-roll/تنزيل/ربط بالطلب), ZIP
buttons. (Per user 2026-06-24: the «جودة التوليد» عادي/فاخر toggle AND the `$` cost display were REMOVED from the UI —
always uses the locked model; cost state dropped.) `lib/calligraphy.ts` wrappers. Nav link «الخط العربي» in `components/AdminSidebar.tsx`. **Live browser verified:**
typed 2 names → 2/2, $0.10, both plates rendered inline as «تم», ZIP downloaded with Arabic filenames; RTL/brand clean; no
h-scroll at mobile; console clean.

**Decisions locked with user:** render text **exactly as stored** (no auto-honorific, though `students.gender` exists if ever
wanted); grab source = the sash order's **«تطريز الوشاح من الأمام»** `customer_text` (the "as embroidered" name) — same record is
the link target; attach is **admin-choice** (view/download/link), never automatic.

**Gotcha fixed live:** `archiver@8` dropped the classic `archiver('zip')` factory (v8 exports classes) → **pinned to
`archiver@^7` (7.0.1)**. Caught only by the live ZIP test (static `node --check` passed because `require` is runtime).

### Open follow-ups
- **⚠️ Set `OPENROUTER_API_KEY` in PROD `.env` on the VPS** (+ `pm2 restart`) — without it generation returns a clean Arabic
  error (`ERR_OPENROUTER_KEY`) and the tool is non-functional in prod.
- **⚠️ Locked model garbles Arabic (0/10).** User accepted this for cost. Cost ~$0.039/image (~$3.9/1,000 students). If the
  garbled names become a problem, switch `CALLIGRAPHY_MODEL` in `lib/openrouter.js` to `google/gemini-3.1-flash-image`
  (correct spelling; ~$0.067/image@1K, ~$0.10@2K) — one-line change. Re-rolls cost a full image each.
- **Crop bleed:** to reduce neighbouring-line descenders on plates, the sheet prompt could ask for more vertical spacing, or
  `sheetCrop` padding/threshold tuned. 10/10 isolation already achieved; this is cosmetic.
- **Minor a11y:** the names `<textarea>` has no `id`/label (2 devtools issues) — add `id` + `<label htmlFor>`.
- Dev servers left up (BE :4000, FE :3000). `next build` not run; run before deploy. Seed not updated for 043 (schema.sql
  mirrored; migration is idempotent). `students.gender` exists → honorific auto-prefix is a future option.

---

## 2026-06-21 (c) — private staff portal: phoneless staff log in by name + password (no OTP), secret URL

Uncommitted on **main**. Gates green: FE `tsc` 0 · `eslint` 0 · BE `node --check` 0. **Migration 042 applied to Neon + verified.**
Verified **end-to-end (backend e2e + live dev browser)** — see below. `next build` NOT run (dev server up). Spec:
`docs/superpowers/specs/2026-06-21-staff-portal-login-design.md`.

**Why.** Staff log in with phone+password→**WhatsApp OTP**. Some staff have **no phone** → can't be created (`users.phone`
was `NOT NULL`) and can't receive the OTP. New **private staff portal**: pick name from a dropdown + password, **no OTP**,
behind a **secret URL**. Existing phone+OTP login is untouched (purely additive).

**1. Secret URL (fail-closed).** Page `frontend/app/s/[key]/page.tsx` — the `[key]` path segment IS the secret. Backend
validates it against env **`STAFF_PORTAL_KEY`**; wrong/missing key → plain **404** (looks like a non-existent page; zero hint
the portal exists). If the env var is unset the portal is fully off. **The live key is `e32ed299a047eec2c7ee`** →
URL `https://<host>/s/e32ed299a047eec2c7ee` (set in `backend/.env`; rotate there + restart). Not linked anywhere.

**2. Backend (`controllers/authController.js`, `routes/auth.js`).** Two key-gated endpoints:
   - `GET /auth/staff-portal/members?key=…` → `[{id,name}]` for `role='staff'` only (no phone/email leak). Rate-limit 30/15m.
   - `POST /auth/staff-portal-login {key, staff_id, password}` → validates key + UUID + `role='staff'` + bcrypt → JWT via
     `signToken`, **no OTP**. Rate-limit 20/15m (shared `loginLimit`). Generic Arabic errors. **Hard-restricted to staff** —
     admin/wholesaler/retail can never be obtained here (verified: retail id → 401), limiting blast radius if the key leaks.

**3. Migration 042** (`042_users_phone_optional.sql`, applied+verified `is_nullable=YES`): `ALTER TABLE users ALTER COLUMN
phone DROP NOT NULL`. The existing `users_phone_key` UNIQUE already allows multiple NULLs (PG treats NULLs as distinct), so
real phones stay unique. `schema.sql` mirrored (`phone TEXT UNIQUE`).

**4. Admin staff create — phone now optional.** `adminController.createStaff`: empty/missing phone → NULL; normalize +
dup-check only when present; password still required. `app/staff/team/page.tsx`: phone field labelled «اختياري» + hint;
roster shows «بدون هاتف · يدخل عبر الرابط الخاص» for phoneless staff. FE `CreateStaffPayload.phone` optional. `lib/api.ts`
interceptor: a 401 from `/auth/staff-portal` no longer triggers the global logout/redirect.

**Verified.** BE e2e (temp staff, cleaned up): members=200 returns only `{id,name}`; login correct→200+token role=staff;
wrong pw→401; wrong key→404; malformed id→401; **retail id→401**; createStaff no-phone→201 stored `phone:null`. Live browser:
`/s/<key>` renders the branded card + name dropdown + password; full login → redirected to `/staff`, token+user(role=staff,
phone=null) stored; `/s/WRONGKEY`→ neutral «404 الصفحة غير موجودة»; console clean (the lone 404 is the intended wrong-key).

### Open follow-ups
- **⚠️ Set `STAFF_PORTAL_KEY` in the PROD `.env` on the VPS** (+ `pm2 restart`) — without it the portal is 404 in prod.
  Pick the same or a fresh key; share `/s/<key>` only with staff.
- **Deliberate trade-offs:** no OTP for portal staff (they have no phone anyway); the staff-name list is visible to anyone
  with the key; the key rides in the URL (can land in logs/Referer) → treat it like a password, rotate via env.
- **Password min stayed 6** (consistent with `updateStaffPassword`); I did NOT bump portal staff to 8 as floated in the
  design — do it in `createStaff`+`resetStaffPassword`+FE messages if you want it.
- Uncommitted on main; `next build` not run; `PROGRESS.md` not updated. The browser test session is still logged in as the
  (now-deleted) temp staff — its token will 401→logout on next call; harmless.

---

## 2026-06-21 (b) — home «نحيكها» gift-bag section · wholesaler-student order = base+surcharge (no package/no لون الوشاح) · OTP delivery fixes

Uncommitted on **main**. Gates green: FE `tsc` 0 · `eslint` 0 · BE `node --check` 0. Migration **041 applied to Neon + verified**.
Verified **live in the running dev browser** (home section mobile+desktop; wholesaler order form as rep «دابي»). `next build` NOT run.

**1. Home «نحيكها بأيدينا، غرزة غرزة» section (`components/shop/BrandStory.tsx`, `AtelierStory`).** Swapped the photo for the
black lolo-shop gift bag (`/home/mint/Downloads/32.png` → trimmed transparent margins via PIL → `public/lookbook/gift-bag.png`,
1138×1200, alpha). Per user: **no background panel** — the bag sits transparent on the page, centred, with heading on the RIGHT and
body on the LEFT (`lg:grid-cols-[1fr_auto_1fr]`, stacks on mobile). Drop-shadow only. Caption «يصلك في تغليف…» was added then **removed** per user.

**2. Wholesaler-student full-set order reworked (user pricing model).** The form IS the package — **package picker removed**, and
**«لون الوشاح» (sash color) removed**. Price = the rep's admin-set base (`wholesalers.wholesaler_price`) + type surcharge:
وشاح ملكي (any cap) **+15,000**, وشاح عادي + قبعة ملكية **+3,000**, else +0. The infra already existed (`fullSetOrder.js` base+addons,
admin sets `admin_price`/`wholesaler_price` + `pricing_addons` in `/admin/wholesalers`); only change was **`royal_sash` 10000→15000**.
   - BE `lib/fullSetOrder.js`: `royal_sash`→15000; `package_id` now OPTIONAL (sub-products fall back to first-active-per-type; base from
     `wholesaler_price`, else err «لم يُحدَّد سعر الطقم…»); «لون الوشاح» no longer required (spec line omitted when empty); package-name
     fallback `'طقم التخرج'`; `readFullSetOrder` filter widened (`design_id IS NULL` instead of `package_id IS NOT NULL`).
   - **Migration 041** (`041_royal_sash_15000.sql`, applied+verified): bumps every rep's `pricing_addons.royal_sash` to 15000.
   - FE `components/wholesaler/FullSetOrderForm.tsx`: removed «الطقم» picker + «لون الوشاح» section + their state/validation/payload;
     `basePrice = pricing.base ?? 0`; التسعيرة always shown (warns «لم يُحدَّد سعر…» when base 0); no `package_id`/`sash_color` sent.
     Callers updated: `app/wholesaler/students/[studentId]/order/page.tsx`, `app/(student)/my-order/page.tsx`, `lib/wholesaler.ts`
     (`package_id` optional, `sash_color` dropped). Shared form → applies to BOTH rep-fill and student `/my-order`.
   - Verified live (rep دابي, base 50): ملكي → الإجمالي ١٥٬٠٥٠ ✓; backend e2e gave 15050 / 3050 / 50 for the three type combos.

**3. OTP delivery (`backend/lib/otp.js`, `.env`, auth/admin controllers).**
   - **Root cause of "no OTP":** `backend/.env` had `ZENTRAMSG_API_URL=ZENTRAMSG_API_URL=https://…` (key pasted as value) → `fetch` threw →
     every send silently dropped. Fixed the line; hardened `otp.js` with `resolveZentramsgUrl()` (validates http(s), falls back to default,
     logs loudly). Also `sendViaZentramsg` now **always logs the code in dev** (even with creds) so local testing isn't blind.
   - **Wholesaler-student / forgot-password "no OTP" deeper cause:** legacy un-normalized phone accounts (`771…`) whose normalized form
     collides with another account — incl. **admin/staff** (privilege hazard). User chose **"only add the code guard" (no deletions)**:
     `forgotPasswordPhone` now SKIPS sending for admin/staff (generic 200, no enumeration leak); `resetPasswordPhone` UPDATE scoped
     `AND role NOT IN ('admin','staff')` → 403 otherwise; `adminController.createWholesaler/createStaff` now `normalizeIqPhone` the phone.

### Open follow-ups
- **⚠️ PROD `.env` on the VPS almost certainly has the same `ZENTRAMSG_API_URL=ZENTRAMSG_API_URL=` typo** — fix it there + `pm2 restart`,
  then send a real OTP to confirm (watch `pm2 logs` for `Zentramsg send failed: <status>` = different problem, e.g. bad device/key).
- **Discount popup is committed AND pushed** (commit `8cdfb97`), it just **ships INACTIVE** — `site_settings.discount_popup.active=false`.
  To show it: admin flips it on in `/admin` (PromoControl), or set `active:true`. Nothing is "unpushed" (`git ... ahead=0`).
- **Duplicate/colliding phone accounts NOT cleaned** (user deferred): مصطفى `7723078729` (1 order, ↔ staff), مصطفى `7783571996`
  (0 orders, ↔ admin), فرقان `0` (5 orders), فرقان `00`, Yuosif Revo `077015601996` (12-digit typo → OTP unreachable). A reviewed,
  **un-executed** cleanup SQL exists from this session if you want it later.
- All of the above is **uncommitted on main**; `next build` not run; `PROGRESS.md` not updated.

---

## 2026-06-21 — Fix: notification dropdown clipped off-screen on RTL phones (home/header)

Single-file FE fix, **uncommitted on main**. `tsc` 0 · `eslint` 0 · verified **live in the running dev
browser** at 360px phone + ~1280/1600px wide, zero console errors.

**Bug.** In `components/NotificationBell.tsx` the dropdown was `absolute end-0` anchored to the 44px bell
wrapper. On RTL phones the header controls (bell/cart/logout) sit on the **left** of the screen, so the bell
is left-of-center; a 320px panel growing from `end-0` ran **~112px off the right edge** at 360px and got
clipped (the «تعليم الكل كمقروء» button + item text were cut off). No bell-anchored offset can fit a panel
that's nearly the full screen width — it must be pinned to the **viewport**.

**Fix.** Panel is now `position: fixed` with a measured, viewport-clamped position. On open, `toggle()`
measures the bell rect and sets `{ top: bell.bottom + 8, left: clamp(bell.left, 16, vw - width - 16) }`
(width = `min(320, vw-32)`). Result: drops just under the header at any header height; **aligns under the
bell on wide screens**, **clamps fully on-screen on phones**. Outside-click + Esc still close (panel is still
a DOM child of `rootRef`, so `contains()` holds). Reused by StudentNav + wholesaler layout — both covered.

**Verified live.** 360px: panel left=24/right=344, fits, no h-scroll. Wide: left aligns to bell, fits.
Empty + 2-item states both render in-bounds; badge «2» + mark-all-read button correct; outside-click & Esc
close; console clean. (Earlier 401s while testing were just my hand-signed token using `sub` instead of
`signToken`'s `user.id` — real endpoint returns 200; not a product bug.)

### Open follow-ups
- **Uncommitted on main** — commit when ready. `next build` not run (dev server up). `PROGRESS.md` not updated.
- Latent (not fixed, out of scope): if `getNotifications()` errors, `loaded` stays false → panel spins
  «جارٍ التحميل…» forever (caught silently). Fine for a valid session; consider showing an error/empty state
  on failure if it ever surfaces.

---

## 2026-06-20 — Retail sash designer REMOVED → typed-spec intake (like wholesaler sashes)

Committed + pushed to **main** (`d0c7009`). Migration **040 applied to Neon + verified.** Gates green:
`tsc` 0 source errors · `eslint` 0 · backend `node --check` 0. Verified **live in the running dev browser**
(«وشاح» parent + a child «وشاح منحني») — fields render once, correct required/optional markers, no console
errors. `next build` NOT run (dev server was up — would conflict per prior entries); run before deploy.

**What & why.** User decision: kill the Fabric.js retail sash designer; a retail sash is now ordered like any
product — the student types its spec (color + embroidery per side), and **staff design every order and upload
the final**. Mirrors how wholesaler sashes are captured.

1. **Intake = option groups (reuses the whole cart/checkout/staff/zone pipeline — zero new backend paths).**
   **Migration 040** adds typed-text option groups to sash products: **اللون (REQUIRED)** + **لون التطريز ·
   تطريز يسار · تطريز يمين · تطريز من الخلف (all OPTIONAL)**. اللون + the زون fields carry an **optional photo**;
   لون التطريز is text-only. One auto-select option per group; value rides `order_items.customer_text`
   (+ `customer_image_url`) exactly like migrations 031/037.
   - **INHERITANCE GOTCHA:** sash "types" are sub-products (`parent_id` → top-level «وشاح»), and
     `catalogController.getProductFull` MERGES `[...parentGroups, ...ownGroups]`. So groups live on **top-level
     sashes ONLY** (`parent_id IS NULL`); children inherit. Adding to children too rendered every field TWICE
     (caught live, fixed — deleted child copies; migration scoped to `parent_id IS NULL`).
   - Labels embed يسار/يمين/خلف → staff zone filters (`ORDER_ZONE_MATCH` sash_left/right/back) match for free.
   - **Admin-controlled:** ordinary option groups → editable in `/admin/products` on the **«وشاح» parent**
     (children show them inherited/read-only with a "منتج فرعي لـ… →" link up to the parent).
2. **Backend fix** — `orderController.priceSelections` only persisted `customer_text` when *required* → optional
   typed embroidery was silently dropped. Now persists ANY provided text + counts it toward `hasEmbroidery`
   (embroidered sashes route to `design_complete`). Shared by cart + configure.
3. **Frontend** — `product/[id]`: removed «صمّم وشاحك»→/design; sashes use the normal **أضف إلى السلة** bar.
   `OptionGroupField` (`isTypedField`) + `CustomerImageUpload` (`allowOptionalText`/`allowOptionalImage`) gained
   optional-typed-field support; detection by name (اللون / «لون التطريز» / «تطريز*»), sash-only (robe/cap
   «اللون» keeps real swatches).
4. **Deleted** retail designer: `app/design/*`, `hooks/useDesignDraft.ts`, `DesignerStepper`, `DesignPreview`,
   `FabricPanelPreview`, `SashFlat`. **KEPT** (shared): staff `DesignViewer`, admin `SashSideLockEditor`,
   `TextEditor`, `Whiteboard`, `SashGownPreview`, `GownPanelImage`, `DesignerToolsAside`, `render-sash-panel`,
   `lib/designer*`. (GownPanelImage + DesignerToolsAside were briefly deleted then restored — kept comps import
   them via relative paths the importer-grep missed.)
5. **CTAs** — removed/repointed every «صمّم وشاحك»→/design: StudentNav tab + sitemap removed; ShopCover /
   BrandStory / SpotlightReel → `/#catalog`; VIP `pick` + `package` confirm → `/cart`; VIP `onStandard` → `/`;
   cart post-checkout no longer pushes /design.

### Open follow-ups
- **Seed not updated** for 040 (live Neon migrated; migration is idempotent + `parent_id IS NULL`-scoped).
- **Package / VIP sashes** confirm a package → `/cart`; they do NOT collect per-side embroidery from the student
  (the designer used to). OK under "staff design every order"; wire the new intake into the package flow if
  students should self-spec package sashes.
- `next build` not run (dev server up). `PROGRESS.md` not updated. Pre-existing untracked junk
  (`backend/_seed_mock.js`, `frontend/public/queue-mockups/`) left out of the commit.

---

## 2026-06-19 (b) — 7-part batch: guest cart gate · «لون التطريز» · OTP (kill 111111 + WhatsApp + unified signup design) · admin-controlled discount popup · cinematic splash · context-aware back

Committed to **main** this session. Built mostly via a parallel agent workflow (6 disjoint streams)
+ a 2-agent follow-up for the admin promo control. Migrations **037 + 038 applied to Neon + verified.**
Gates green: `tsc` 0 · `eslint` 0 · backend `node --check` 0. Live spot-checks done (splash/home light,
popup active/inactive, embroidery field, back-scroll); user did their own browser pass. `next build` SKIPPED
(disk/`.next` contention per prior entries) — run before deploy.

1. **Guest cart gate** — `app/(student)/cart/page.tsx`: a logged-out user hitting `/cart` now sees a login
   prompt (`EmptyState` + CTA → `loginHref('/cart')`) instead of the 401→logout→"تعذر تحميل السلة" break.
   Browsing was already open. Fetches are guarded behind `isAuthenticated()`.
2. **«لون التطريز» (embroidery/thread color)** — REQUIRED **typed text, NO photo**. Mirrors the «اللون»
   (sash color, migration 031) plumbing.
   - **Migration 037** (`db/migrations/037_embroidery_color.sql`, +`schema.sql`): new option group «لون التطريز»
     on the «وشاح» product `5bcab8b6…` (the only sash with an «اللون» group), `requires_customer_text=TRUE`,
     `requires_customer_image=FALSE`, one auto-select option. Also `designs.embroidery_color TEXT`.
   - Retail product page: flows through the existing `customerTexts` plumbing (no page edit).
     `CustomerImageUpload.tsx` gained `allowImage = needsImage || nameAr==='اللون'` so «لون التطريز» is
     text-only (photo suppressed); «اللون» keeps its optional photo.
   - **Designer** (`useDesignDraft.ts`): fixed a name-collision — sash color now matches
     `includes('لون') && !includes('تطريز')`, embroidery matches `includes('تطريز')`; derives/persists/restores
     `embroidery_color` parallel to `sash_color` (designs column + `designController.js`).
   - **Wholesaler full-set**: `FullSetOrderForm.tsx` gained a **rep-only** `showEmbroideryColor` «لون التطريز»
     text section (required when shown); passed `true` on `/wholesaler/students/[id]/order`, omitted on the
     student `/my-order` (the rep types it, not the student). `fullSetOrder.js` persists/reads it as the sash
     spec line `لون التطريز` (optional server-side so student self-fill still saves). Types in `lib/wholesaler.ts`.
3. **OTP (items 3+4)** — `lib/otp.js`: **removed the baked-in `111111`** (dev master now `DEV_MASTER_OTP || null`
   — no code accepted unless explicitly set; dev reads the live code from the backend console until Zentramsg is
   wired). **User must add `ZENTRAMSG_API_KEY` + `ZENTRAMSG_DEVICE_UUID` to `backend/.env`** for real WhatsApp
   delivery (both login + signup already call `sendViaZentramsg`). **Signup-OTP design unified**: extracted login's
   polished 6-box step into NEW `components/auth/OtpVerifyForm.tsx`, now used by BOTH `login/page.tsx` and
   `register/page.tsx` (register's old plain single-input step is gone). (NB: a separate pre-existing
   `components/auth/VerifyOtpForm.tsx` still backs `/verify-otp` — left as-is; consider consolidating later.)
4. **Admin-controlled discount popup** — NEW generic `site_settings(key, value jsonb, updated_at)` (migration 038)
   with a `discount_popup` row `{active,title_ar,message_ar,deadline}`. `GET /api/catalog/promo` (public) +
   `PATCH /api/admin/promo` (admin). NEW admin card `components/admin/PromoControl.tsx` (active toggle · title ·
   message · `datetime-local` deadline) mounted on `app/admin/page.tsx`. `DiscountPopup.tsx` now FETCHES the config:
   shows only when `active && now<deadline && !sessionSeen`, renders the admin's title/message + live d/h/m/s
   countdown, scrolls to `#catalog` on CTA. **Ships INACTIVE** (admin flips it on). Verified live: inactive→hidden,
   active→shows with countdown.
5. **Splash redesign** — `SplashIntro.tsx` reworked into a cinematic reveal (logo bloom rings, script wordmark,
   staggered tagline, curtain-wipe exit) on the **warm-cream** brand stage (NOT dark — first agent build was dark,
   corrected). Contract intact (sessionStorage `loloshop_splash_seen`, ~2.2s+fade, click/Esc skip, reduced-motion
   skip). New `animate-splash2-*` keyframes in `globals.css`.
   - **Reverted an out-of-scope font hijack**: the splash agent had swapped the whole site to Tajawal in
     `app/layout.tsx` + `globals.css` (+ a ShopCover weight tweak) — restored the brand fonts (Amiri/Cairo/Playfair/
     Great Vibes) per CLAUDE.md. Only the splash keyframes were kept.
6. **Context-aware back** — NEW `lib/back.ts` `backHrefFromParam(from, fallback)` (`vip`→/vip, `packages`→/full-set,
   `catalog`→/#catalog). `ProductTile` takes a `from` prop; home grid passes `catalog`. `product/[id]` back reads
   `?from` via `useSearchParams`; `full-set/[id]` back → `/full-set`. Home `page.tsx` got `id="catalog"` **plus a
   post-feed-load scroll effect** — the grid renders after the async feed, so the native `#catalog` hash-scroll
   found nothing; we now `scrollIntoView` once the section exists (verified: lands with catalog pinned to top).

### Open follow-ups
- **`ZENTRAMSG_API_KEY` / `ZENTRAMSG_DEVICE_UUID` not set** — login/signup OTP won't deliver over WhatsApp until the
  user pastes them into `backend/.env`. Verify a real send after.
- `next build` not run (disk/`.next`); run before VPS deploy. Seeds not updated for 037/038 (schema mirrored).
- Pre-existing uncommitted FE work (admin/staff/wholesaler `layout.tsx`, `VipHomeBand.tsx`) + screenshots/junk were
  **left out of this commit** (likely Cursor's in-progress work — avoid FE collisions).
- `/verify-otp` still uses the old `VerifyOtpForm`; could share `OtpVerifyForm` too.

### Files (this session)
- backend: `lib/otp.js`, `lib/fullSetOrder.js`, `controllers/{designController,catalogController,adminController}.js`,
  `routes/{catalog,admin}.js`; NEW `db/migrations/037_embroidery_color.sql`, `038_site_settings.sql`; `db/schema.sql`
- frontend NEW: `components/auth/OtpVerifyForm.tsx`, `components/admin/PromoControl.tsx`, `components/DiscountPopup.tsx`,
  `lib/back.ts`
- frontend EDIT: `app/(student)/{cart,layout,page,product/[id],full-set/[id]}`, `app/{login,register}/page.tsx`,
  `app/admin/page.tsx`, `app/wholesaler/students/[studentId]/order/page.tsx`, `app/globals.css`,
  `components/{SplashIntro,catalog/CustomerImageUpload,shop/ProductTile,wholesaler/FullSetOrderForm}.tsx`,
  `hooks/useDesignDraft.ts`, `lib/{types,wholesaler,catalog,admin}.ts`

---

## 2026-06-19 — Storefront package slideshow · «تم التسليم» console column · rep order-working console (zone filter + bulk «إكمال») · product discount · parallel «الفصال» tailor track

Large batch on **main** (uncommitted working tree — NOT committed/pushed/deployed). Migrations
**035 + 036 applied to Neon + verified.** Frontend `next dev` :3000 + backend nodemon :4000 up.
Everything below verified **live in-browser** (injected JWTs for manager/tailor/admin) with **zero
console errors**, plus backend e2e + `tsc` 0 + `eslint` 0. `next build` SKIPPED (disk 93%/4.5G and
dev server shares `.next` → conflict risk); rely on tsc/eslint/live. Run a prod build before deploy.

### A) Storefront package photos auto-rotate + manual slide (committed earlier: `2f2e785`)
`FullSetBand` + VIP already shipped. `AutoRotatingImage` gained `controls` (‹ › arrows + swipe +
dots) — see that commit. (Only this part is committed/pushed.)

### B) Production console «تم التسليم» (delivered) column — `/staff/queue`
- Backend `getQueue`: new `MANAGER_VIEW_STAGES = [...MANAGER_STAGES,'delivered']` (manager view only —
  `monitor()` still uses the 6-stage `MANAGER_STAGES`, WIP math unchanged); `preparer` QUEUE_STAGES
  gained `delivered`. WHERE caps delivered to 90d BUT keeps `delivered_at IS NULL` (legacy rows never
  vanish — critic fix).
- Frontend: `delivered` added to STAGES rail + RAIL_BAR + a «تم التسليم» KPI; "الكل" rail count + list
  EXCLUDE delivered (own chip only); `isOverdue` excludes delivered. Live: chip=3, KPI=3, الكل=189.

### C) Rep → students' **orders** console — `/staff/wholesalers/[id]/students` (rewritten, tabbed)
- «الطلبات» tab (default) + «الطلاب» roster tab. Orders tab = checkbox rows (student→`/staff/orders/[id]`,
  product, status pill) + **7 full-set zone chips** + completion filter (الكل/يخصّني الآن/منجز) + search +
  sticky `lg:ms-64` «إكمال (N)» bulk bar. Mobile-first.
- **Checkbox enabled ONLY when backend says `can_advance`** (no ghost-409s — state-machine memory).
- Backend: NEW `GET /{staff,admin}/wholesalers/:id/orders` (`staffController.wholesalerOrders`) →
  per-order `can_advance`/`next_status` via `nextStageFor`+`canStaffTransition`; zone via `orderZoneClause`;
  unknown zone → 400 (critic fix); `final_design_url` NOT selected (tailor-confinement, critic fix).
  NEW `POST /production/advance-bulk` (`advanceBulk`) — per-order re-guard, skips+reports, cap 200.
  Refactored single `advance` to share `loadAdvanceRow`+`performAdvance`.
- **NEW full-set zone keys** in `orderController.ORDER_ZONE_MATCH`: `sash_front`, `robe_sleeve_right/left`,
  `american_shawl` (the wholesaler طقم label set is front/back + ردن أيمن/أيسر + شال — NOT the retail
  يمين/يسار). Frontend `FULLSET_ZONE_LABELS`/`_ORDER` in `lib/constants.ts`. Live: sash_front=56, cap_side=21.

### D) Product discount / «السعر قبل الخصم» — `/admin/products` + storefront (parallel agent)
- DB col `products.compare_at_price BIGINT NULL` (migration 035). `catalogController` exposes it in the 3
  product SELECTs + accepts/validates it in create/update (rejects negatives). `lib/catalog.ts` maps
  `compareAtPrice` (BIGINT→`Number`); `lib/types.ts` product interfaces; `lib/format.ts`
  `formatDiscountPercent`. `ProductTile` + product detail strike the old price + «خصم N٪» ONLY when
  `compareAtPrice > shownPrice`. Live demo set on «روب فصال بشت» (now 35000 / was 50000 / خصم ٣٠٪).

### E) Parallel «الفصال» (tailor) track for RETAIL orders — ابو عبدو (parallel agent)
- DB (migration 036): `orders.tailor_status tailor_track_status ('pending'|'done') DEFAULT 'pending'` +
  `tailor_done_at`/`tailor_done_by`. **Fully INDEPENDENT of `orders.status`** — tailor endpoints write
  ONLY the tailor cols, pipeline advance never touches them (critic-confirmed).
- Backend (`productionController`): `GET /production/tailor-queue?done=0|1`, `POST .../:id/tailor-complete`,
  `.../tailor-reopen`, `POST /production/tailor-complete-bulk`, `GET /production/tailor-summary`. All
  guarded `canTailor` (tailor staff_type OR manager/admin) + **retail-only** (`wholesaler_id IS NULL`;
  wholesaler order → 403/skip). Bulk mirrors advanceBulk.
- Frontend: NEW `app/staff/tailor/page.tsx` (قيد الفصال/تم الفصال tabs, checkbox rows, sticky «تم الفصال (N)»),
  nav entry in `StaffSidebar` (tailor primary + admin/manager), admin dashboard «الفصال» card
  (pending/done/total) in `app/admin/page.tsx`, wrappers in `lib/staff.ts`. Live: 15 pending / 5 done.

### Demo data I left for live testing (revert if unwanted)
- 7 of ممثل تجريبي's sashes moved to `embroidery` (so the embroiderer's «إكمال» has work). 3 were
  advanced to `preparing` during e2e. ابو عبدو tailor track = 15 pending / 5 done (e2e reverted).
- «روب فصال بشت» has a demo `compare_at_price=50000` — clear it in /admin/products to remove the discount.

### Open follow-ups
- **Uncommitted on main** — decide commit/branch + prod build + VPS deploy. Run `next build` (needs disk;
  currently 93%/4.5G) before shipping.
- Seed not updated for 035/036 (only schema.sql mirrored; fresh installs get the cols, not the demo data).
- Nits deferred (critic): KPI «تم التسليم» label reflects the 90-day window (cosmetic); admin can also open
  the rep orders console (uses `/admin/...` route — works). Tailor queue currently lists ALL retail orders
  regardless of pipeline stage (by design — parallel track).
- `PROGRESS.md` not updated this session (HANDOFF only).

### Files touched (this session, besides the committed slider)
- backend: `controllers/{productionController,staffController,orderController,catalogController}.js`,
  `routes/{production,staff,admin}.js`; NEW `db/migrations/035_*.sql`, `036_*.sql`; `db/schema.sql`
- frontend: `app/staff/queue/page.tsx`, `app/staff/wholesalers/[wholesalerId]/students/page.tsx`,
  NEW `app/staff/tailor/page.tsx`, `app/admin/{page,products/page}.tsx`, `app/(student)/product/[id]/page.tsx`,
  `components/shop/ProductTile.tsx`, `components/staff/StaffSidebar.tsx`,
  `lib/{staff,catalog,types,constants,format}.ts`
- docs: `HANDOFF.md`

---

## 2026-06-18 — Phase-9 of the staff batch (migrations applied + security fixes) · sash color = typed free-text + optional photo · /staff/queue rebuilt as a stage-rail console

Continuation of the `feat/staff-batch-2026-06-17` branch. **Still NOT merged to main, NOT
deployed to prod.** Dev servers are up (frontend `next dev` :3000, backend nodemon :4000).
**Migrations 028 → 031 are ALL APPLIED to the dev Neon DB and verified.**

### A) Phase 9 of the 2026-06-17 batch — migrations applied + bugs found & fixed
- **Applied `028 → 029 → 030` to Neon, in order, verified** (tailor enum present; `users.staff_types`
  backfilled for all staff; color-group image/text flags cleared → retail color bug dead at the
  data layer). `next build` passed.
- A backend e2e + a `critic`-agent **security review** found real bugs (the batch's headline
  tailor-confinement was NOT actually enforced). All fixed + re-verified live:
  - **Multi-role was silently broken**: `pg` returns the custom enum array `staff_types staff_type[]`
    as the raw string `"{designer,embroiderer}"`, so `Array.isArray(...)` was false and `staffTypesOf`
    fell back to the single primary role everywhere (queue merge, requireStaffType, tailor/presser
    detection). **Fix in `lib/db.js`**: at startup, look up the `_staff_type` array OID live (NOT
    hardcoded — OIDs differ per DB) and register a `types.setTypeParser` that splits `{a,b}` → `['a','b']`;
    plus `staffTypesOf` now also tolerates the string form defensively.
  - **C1 (CRITICAL)**: `GET /api/orders/` (`listOrders`) is `requireRole('admin','staff')` and returned
    `price/cost/profit` + intake PII to ANY staff incl. tailor — a side door around all per-field strips.
    **Fix**: `listOrders` strips money/intake by role — only manager/admin see cost/profit + bundle
    intake; price additionally to embroiderer (mirrors `getOrder`). Both flat + bundle modes.
  - **H1/H2**: tailor `getOrder` still leaked `final_design_url` + demographics + non-sash items.
    **Fix**: rebuild the tailor `order` from an **allow-list** (`id,status,created_at,student_name,
    product_name,product_type` only) and filter `items` to content lines + null `price_snapshot`.
  - **M1**: the read-only tailor could `POST /production/orders/:id/final-design`. **Fix**: route now
    `requireStaffType('designer','digitizer','embroiderer')` (manager/admin auto-pass).
- **Verified live** (signed JWTs vs :4000): multi-role queue now merges stages; tailor `getOrder`
  leaks NOTHING (keys = the 6 allow-listed); `/api/orders` money stripped (flat + 69 bundles);
  tailor final-design POST → 403.

### B) Sash color → TYPED free-text color (required) + OPTIONAL photo — swatches removed
User decision: replace the sash color swatch picker with a typed color + optional reference photo,
on the **single sash product, `/design`, AND the full-set form**.
- **Migration `031`** (applied + verified): sash «اللون» group → `requires_customer_text=TRUE`,
  `requires_customer_image=FALSE` (scoped to `type='sash'` ONLY — robe/cap keep their real swatches).
  The group already had a single option + prompt/placeholder, so this reuses the existing
  customer_text/customer_image_url plumbing (same mechanism as embroidery).
- **How it works**: `OptionGroupField` treats a color group with `requiresCustomerText` as "typed
  color" → auto-selects the sole option + renders `null` (suppresses the swatch); the sibling
  `CustomerImageUpload` (shown because text is required) becomes the whole color UI = required text +
  optional photo. This covers product/[id] + /design + the full-set wizard at once. `useDesignDraft`
  now derives `sashColor` from the typed `customerTexts` (not the option label) and restores it from
  the saved design on reload. The **full-set form** (`FullSetOrderForm`) is NOT option-group-driven →
  it got its own «لون الوشاح» section (required text + optional photo), persisted/read as a sash
  spec line in `backend/lib/fullSetOrder.js` (label `لون الوشاح`).
- **Gotcha**: requiring text on the sash color flips `hasEmbroidery=true` for that selection → the
  sash routes to `design_complete`. That's correct (sashes are always designed), but be aware.
- **Verified live**: option-group path (`priceSelections`): no text → 400 «يرجى كتابة التفاصيل
  المطلوبة لـ اللون»; with text → stored; + optional photo stored. Full-set path: no color → 400
  «لون الوشاح مطلوب»; with color → 201; read-back reconstructs `sash_color {text,image_url}`.

### C) `/staff/queue` rebuilt as the «منصّة الإنتاج» stage-rail console
Old card/board/feed designs didn't scale to 150+ orders; user picked the stage-rail console (one of
3 scalable directions modeled on `/admin/orders`). It is the screen the admin opens 24/7 AND that
staff use (role-scoped) — ONE route serves both.
- **Backend**: added `o.final_design_url, o.has_embroidery` to the `getQueue` SELECT (drives the
  missing-design alert). `ProductionQueueItem` type extended to match.
- **Frontend**: full rewrite of `app/staff/queue/page.tsx`:
  - **Stage rail** (sticky carded sidebar desktop / horizontal chip strip mobile) with per-stage
    counts + load bars + overdue/missing dots → **tap = instant CLIENT-side filter**.
  - **One fetch** `getQueue(undefined, undefined, zone)` returns all the user's allowed orders (backend
    auto-scopes non-managers to their stages); stage/source/rep/batch/search/pagination are all
    client-side. **Zone is the ONLY server-side filter** (label heuristic) → refetches on change.
  - KPI strip · source tabs (الكل/تجزئة/ممثلين) · rep drill-down (derived from queue data, NO admin
    endpoint — staff-safe) + دفعة chips · 30/page · 15s silent polling (`usePolling`).
  - **Real-data semantics** (the mockup faked these): «متأخر» = past batch `deadline`; «تصميم مفقود»
    = post-design stage AND (`has_embroidery`||`design_id`) AND no `final_design_url`; who's-working =
    `working_staff_name`.
  - **Integration fixes** I applied over the agent's first port: removed a DUPLICATE shell/header (it
    built its own `min-h-screen`+brand bar inside the staff layout) → now uses `PageHeader` and fits
    the layout's sidebar + padded `<main>`; recolored stage/product pills blue/purple → **warm brand**.
- **Verified**: tsc 0 · `next build` 0 · **live desktop + mobile with REAL data** (190 orders, via a
  temporary admin JWT injected into a headless browser) · no console errors. The screenshots showed
  warm pills, sticky rail, KPI, source tabs, rep drill-down, «تصميم مفقود» badge all working.

### Open follow-ups
- **Not merged / not deployed.** Decide merge to main + VPS deploy (PM2). Nothing is live in prod.
- **Formal `security-review` skill NOT run** this session — a critic-agent review was, and its
  findings were fixed + re-verified, but run the real phase-10 skill before shipping.
- **Live in-browser click-through by the USER still pending** for: the typed-color forms (product
  page / `/design` / full-set rep+student), the tailor read-only view, and `/staff/queue` driven as a
  real (non-admin) staff login. I verified backend e2e + a headless admin render only.
- **Seed not updated** for the sash color change — only the live dev DB was migrated (031). Fresh
  installs via the seed still create the old swatches; update `seed*.js` (or fold 031 into schema/seed).
- **`public/queue-mockups/`** (index/table/grouped/console + data.js + tokens.css) left as reference —
  delete the folder before shipping if not wanted (it would deploy under /queue-mockups).
- Carried over from the 2026-06-17 entry and still open: tailor production queue shows all in-prod
  orders (scope to `product_type='sash'`?); monitor throughput groups by primary `staff_type` only;
  the «صمم وشاحك» overlay overlap bug (DEFERRED, needs browser QA); `PROGRESS.md` still not updated.

### Files touched this session
- backend: `lib/db.js`, `middleware/auth.js`, `controllers/{orderController,productionController}.js`,
  `routes/production.js`, `lib/fullSetOrder.js`; NEW `db/migrations/031_sash_color_typed_text.sql`
- frontend: `app/staff/queue/page.tsx` (full rewrite), `components/catalog/OptionGroupField.tsx`,
  `hooks/useDesignDraft.ts`, `components/wholesaler/FullSetOrderForm.tsx`,
  `lib/{wholesaler,staff-types}.ts`; NEW `public/queue-mockups/*` (design mockups — reference only)
- docs: `HANDOFF.md`

---

## 2026-06-17 — Staff/admin batch: multi-role staff · مفصل (tailor) role · orders filter + reps drill-down · inline images + missing-design alert + "who's working" · embroidery-zone filter · retail color-bug fix

Large user-requested batch. On branch **`feat/staff-batch-2026-06-17`** (NOT on main, NOT
deployed). **Migrations 028–030 are written but NOT YET APPLIED to Neon.** 6 of 9 items done;
one deferred, phase-9 (apply/build/deploy) outstanding — see follow-ups.

**What changed**
1. **Multi-role staff** (one employee can hold several production roles, e.g. تصميم + تطريز
   + مفصل). NEW `users.staff_types staff_type[]` is the authoritative set; the existing
   `users.staff_type` is kept in sync as the PRIMARY role (= `staff_types[1]`) so every legacy
   single-role read keeps working. Admin staff/team UI now assigns roles via **toggle chips**
   (multi-select). Also fixed a latent bug: `digitizer` was missing from `adminController`'s
   `STAFF_TYPES` (couldn't assign محوّل التطريز).
2. **«مفصل» (tailor) role** — NEW `staff_type` value `tailor`. READ-ONLY view: opening any order
   shows ONLY **student name + sash spec lines + American-shawl info** — contact/intake/price/
   design-canvas are stripped **server-side** (defence in depth) and the UI renders a dedicated
   compact page. No new pipeline stage (per the locked decision).
3. **Orders filter → تجزئة/ممثلين** (dropped «الكل» on the staff queue). **Reps drill-down**:
   the admin «ممثلين» tab now lands on **rep cards** (name + their دفعات + order count) → click a
   rep → their students' orders, with **batch (دفعة) chips** + "كل الممثلين" back.
4. **Inline images** (no download step) for customer reference photos on staff/tailor order
   detail. **Missing-design alert**: red banner when an order reached embroidery/pressing/…/
   delivered but `final_design_url` IS NULL. **"الموظف فلان يعمل عليه الآن"** surfaced for admin in
   the orders list (table + mobile cards) and reworded on the detail presence banner.
5. **Embroidery-zone filter** (وشاح يمين/يسار/خلف · قبعة جانب/أعلى · روب بكسرات/بدون) — filter
   chips on BOTH the staff queue and admin orders.
6. **Retail full-package color bug fixed** — selecting a color falsely demanded an image upload
   the form has no field for.

**Why / root causes**
- Color bug was **DATA, not logic**: the sash color group «اللون» (`387d6948…`) had group-level
  `requires_customer_image = TRUE` (+ a stray option-level `requires_customer_text`). A color
  swatch picker must not require an upload → `030_fix_color_group_flags.sql` clears the flags on
  all color-picker groups. The frontend mirrors the same rule, so the data fix covers both sides.
  (Confirmed by querying the live Neon DB via `node -e` with `backend/lib/db`.)

**How it works (gotchas for future edits)**
- **`staffTypesOf(user)`** (in `middleware/auth.js`, exported) is the single source of truth for
  "which roles does this user have" — use it everywhere instead of reading `user.staff_type`.
  `authRequired`/`authQuery`/`optionalAuth` now also SELECT `staff_types`.
- Multi-role behaviour: `requireStaffType` passes if ANY role matches; the production **queue
  merges the stages of all roles**; `canStaffTransition` allows an edge if any role may do it;
  the designer "pending-only" filter is scoped to **`design_complete` only** so a designer+
  embroiderer still sees their embroidery queue; the presser canvas-block applies only when
  presser is the **sole** role.
- **Migration ordering matters**: `028` (adds the `tailor` enum value) MUST run before `029`
  (uses the enum / multi-role column) — `migrate.js` sends each file as one implicit transaction,
  and Postgres forbids adding-and-using an enum value in the same transaction. `schema.sql` was
  also updated (idempotent) for fresh installs.
- **Zone filter** = `orderZoneClause(zone, alias)` in `orderController` (exported, reused by the
  staff queue) → an `EXISTS` over `order_items.label_snapshot` with **ILIKE heuristics** (يمين/
  يسار/خلف/جانب/أعلى/كسرة). Embroidery zones additionally require real content (text/image) so a
  plain (سادة) zone is excluded; pleats encode نعم/لا in `customer_text`. The predicate is
  constant text (zone is a validated key) → injection-safe.
- **Reps drill-down**: NEW `GET /admin/reps-overview` (rep + batches + order_count) and a new
  `batch_id` filter on `GET /admin/orders` (`listOrders`). `listOrders` also now returns fresh
  `working_staff_name` (90s TTL, same as the queue).
- **Tailor queue**: a tailor currently sees ALL in-production orders (read-only; recognises
  sashes by name) because tailor isn't a real stage — see follow-up to scope it to sash.

**Verified**
- **Backend**: `node --check` clean on every edited file (auth, adminController, orderController,
  productionController, routes/admin). No test suite exists.
- **Frontend**: `tsc --noEmit` → **0 errors** after all edits.
- **NOT verified**: migrations NOT applied to Neon; **no `next build` run**; no backend e2e; no
  live in-browser click-through.

**Open follow-ups (what's left)**
- **Phase 9 not done** — apply `028 → 029 → 030` on Neon (in order), run `next build`, backend
  e2e on live DB, `security-review`, then deploy. Nothing is live.
- **Bug «صمم وشاحك» overlap — DEFERRED** (user's choice) to its own visual-QA pass: needs the dev
  server + a real browser. Root cause is layout, not data: `Whiteboard.tsx` renders `fixed
  inset-0 z-[60]` INSIDE `TextEditor`'s `fixed inset-0 z-[200]` overlay, with a `flex min-h-0
  flex-1 overflow-y-auto` that can collapse on mobile RTL (`design/page.tsx:454`, `Whiteboard.tsx:357/379`).
- Tailor queue shows all in-production orders — consider scoping to `product_type = 'sash'`.
- Monitor throughput still groups by the single primary `staff_type` (display only).
- Zone-filter ILIKE labels are heuristic — verify coverage across the retail full-set vs
  wholesaler طقم label sets against live data when applying migrations.
- The admin «ممثلين» tab still also has the old الممثل `<Select>` (now redundant with the rep
  grid) — harmless; remove if it clutters.
- `PROGRESS.md` not updated this session (only `HANDOFF.md`).

**Files touched**
- backend: `middleware/auth.js`, `controllers/{adminController,orderController,productionController}.js`,
  `routes/admin.js`
- db: NEW `migrations/028_staff_tailor_type.sql`, `029_staff_multi_role.sql`,
  `030_fix_color_group_flags.sql`; `schema.sql` (staff_type enum + `users.staff_types`)
- frontend: `lib/{types,constants,admin,staff}.ts`, `app/staff/team/page.tsx`, `app/staff/page.tsx`,
  `app/staff/orders/[orderId]/page.tsx`, `app/admin/orders/page.tsx`
- docs: `HANDOFF.md`

---

## 2026-06-16 (c) — طقم add-ons (شال امريكي + كسرة الكتف) · student inherits rep جامعة/قسم · clickable staff bundle rows

Four user-requested changes. Committed to **main** this session.

**What changed**
1. **شال امريكي (نعم/لا + mandatory photo)** — new toggle in the shared
   `frontend/components/wholesaler/FullSetOrderForm.tsx` → appears on BOTH the rep
   form (`/wholesaler/students/[id]/order`) and the student form (`/my-order`). When
   نعم, a photo is required (client + backend). Stored as a `شال امريكي` spec line on
   the **sash** order (`customer_text='نعم'`, `customer_image_url`).
2. **كسرة الكتف (نعم/لا)** — new toggle inside فصال الروب; stored as a `كسرة الكتف`
   spec line on the **robe** order (`نعم`/`لا`).
3. **Student inherits the rep's جامعة/قسم** — join form no longer asks for them.
   Migration **027** adds `wholesalers.university_name` + `department`; admin create
   requires them; NEW `PATCH /admin/wholesalers/:id` (`updateWholesaler`) + a "تعديل"
   modal lets admins set/fix existing reps; `joinController` resolves them from the rep.
4. **Staff bundle rows fully clickable** — `app/staff/orders/[orderId]/page.tsx`
   "الباقة الكاملة" sibling rows (وشاح/روب/قبعة) are now whole-row `Link`s.

**How it works (gotchas)**
- Single source of truth held: all order writes/reads still go through
  `backend/lib/fullSetOrder.js` (`persistFullSetOrder`/`readFullSetOrder`), so rep +
  student paths stay byte-identical. The two new fields are in the payload as
  `shoulder_pleat: boolean` and `american_shawl: { enabled, image_url }`.
- A shawl photo routes the **sash** to `design_complete` even with no front/back
  embroidery (new `sashHasDesign = sashHasEmb || shawlEnabled`); `has_embroidery`
  stays accurate (only true for real embroidery). Status logic stays backend-only.
- New spec lines render to staff automatically — the "خيارات الطلب" block is generic
  (label_snapshot + customer_text + "صورة العميل" link). كسرة الكتف shows on the robe
  order, شال امريكي (+photo) on the sash order.
- Join page now calls `GET /join/:code` (extended with university/department) to show
  the rep + cohort as read-only context and to detect an invalid code up front.
- `JoinPayload.university_name`/`department` made optional (legacy fallback only —
  the page no longer sends them; the rep's value always wins in `joinController`).

**Verified** (project norm: backend e2e + types/lint/build; live click-through = user)
- Backend **end-to-end on the live Neon DB**: shawl-without-image→400
  (`صورة الشال الأمريكي مطلوبة`), valid→201, `readFullSetOrder` reconstructs
  `shoulder_pleat` + `american_shawl`, sash status flips `design_complete`↔`preparing`
  with the shawl, toggle-off is idempotent. Admin: create-without-university→400,
  `updateWholesaler`→200. Join inheritance proven by replaying the controller's exact
  INSERT in a **rolled-back tx** (student row got the rep's جامعة/قسم; no junk left).
- `tsc --noEmit` 0 errors · `eslint` 0 errors (1 pre-existing unused-directive
  warning in the admin page's `load` effect, untouched) · **`next build` succeeds**.
- Test fixture updated: rep `TESTREP` now has جامعة بغداد / هندسة الحاسوب (was NULL),
  so the join-inherit demo works. Rep login still phone `07700000001` / `test1234` /
  OTP `111111`, approved student "احمد سمير".

**Open follow-ups**
- Live in-browser click-through not done by me (verified by backend e2e + types/lint +
  build). Redeploy then drive: rep/student طقم form (toggle شال + كسرة, save, re-open
  to confirm pre-fill), a fresh join via `/join/TESTREP` (no university field; cohort
  shown), admin create/تعديل rep, staff order detail row clicks.
- Existing reps created before this have NULL جامعة/قسم → set via the new "تعديل"
  modal, else their students inherit NULL. New reps require them at creation.
- نوع عادي/ملكي + شال/كسرة are still captured as manufacturing spec labels, not
  priced options / sub-products (same as the prior طقم entry).

**Files touched**
- backend: `lib/fullSetOrder.js`, `controllers/{joinController,adminController}.js`,
  `routes/admin.js`, NEW `db/migrations/027_wholesaler_university_department.sql`,
  `db/schema.sql`
- frontend: `components/wholesaler/FullSetOrderForm.tsx`, `app/join/[code]/page.tsx`,
  `app/admin/wholesalers/page.tsx`, `app/staff/orders/[orderId]/page.tsx`,
  `lib/{wholesaler,admin,types}.ts`
- docs: `PROGRESS.md`, `HANDOFF.md`

---

## 2026-06-16 (b) — Student-facing طقم form + edit pre-fill + dashboard cleanup + image lightbox

Follow-up to entry (a) below, after live testing on lolo-shop96.com. Commit `2154638`
on branch `feat/wholesaler-fullset-order` (NOT yet on main — user merges/deploys).

**What changed**
1. **Student fills the form too** (user decision: "both student + wholesaler"). A
   wholesaler-linked **approved** student logs in → the home redirect for
   `wholesaler_student` audience now sends them to **`/my-order`** (was `/package`) →
   they fill the same طقم form and confirm themselves. NEW
   `frontend/app/(student)/my-order/page.tsx`. Backend: `GET/POST /orders/rep-full-set`
   (context+create) in `orderController` (retail-role, self).
2. **Single source of truth**: extracted the order logic to NEW
   `backend/lib/fullSetOrder.js` — `persistFullSetOrder({student, body, actorUserId})`
   + `readFullSetOrder(studentId)`. BOTH the rep "fill on behalf"
   (`wholesalerController`) and the student "fill my own" (`orderController`) paths are
   now thin auth wrappers over it, so they write byte-identical orders.
3. **Bug fix — edit saved nothing**: the form opened **blank** on edit (required
   fields empty → `حفظ الطلب` blocked by validation, looked dead). Added read-back
   (`GET /wholesaler/students/:id/full-set-order` + the student context) that
   reconstructs the saved order, so the form now **pre-fills** on edit. Shared form UI
   pulled into NEW `frontend/components/wholesaler/FullSetOrderForm.tsx` (used by both
   the rep page and the student page).
4. **Wholesaler dashboard** (`app/wholesaler/page.tsx`): added a **QR code** for the
   referral link (`qrcode.react`); **removed** the "تصميم الوشاح للطلاب" (sash-side
   lock) section + its modal + dead handlers/imports; **removed الدفعة + الباقات** from
   the bottom nav (`app/wholesaler/layout.tsx`) — now just الرئيسية + الطلاب.
5. **Product photo lightbox** (`components/catalog/ProductMediaGallery.tsx`): the detail
   hero was only ever **cropped** (`object-cover`) with no enlarge. Added a
   click-to-zoom **fullscreen lightbox** showing the FULL image (`object-contain`) +
   prev/next + Esc/backdrop close. The admin's per-product `image_fit` grid choice is
   untouched.

**How it works (gotchas)**
- The home→`/my-order` redirect relies on `getShop` returning `audience ===
  'wholesaler_student'` for rep-linked students (pre-existing mechanism, confirmed live).
- `/my-order` self-guards: non-rep student → redirect to `/`; rep but not approved →
  "بانتظار موافقة الممثل"; approved → the form (pre-filled if an order exists).
- Student photo upload reuses `/designs/uploads/image` (retail role); rep uses
  `/wholesaler/uploads/image`. The shared form takes `onUploadImage` as a prop.
- Type عادي/ملكي + embroidery are still captured as `order_items` spec lines (not
  priced options); production routing + statuses are unchanged from entry (a).

**Verified**
- Backend **end-to-end on the live Neon DB**: rep create→201, rep read-back
  reconstructs measurements/type/embroidery, student context returns
  is_rep_student/approved/packages/existing, student self-create→201. All idempotent.
- `tsc` 0 errors; `eslint` clean on new files (one pre-existing warning in Cursor's
  `wholesaler/page.tsx` effect, untouched).

**Open follow-ups**
- **Live browser click-through still not done by me** — verified by backend e2e +
  types/lint. User tests on prod; needs a redeploy of this commit.
- The `(student)` layout's `StudentNav` still shows shop/cart chrome to a
  wholesaler-student on `/my-order` (the home link just bounces them back via the
  redirect). Hide nav for rep-students if it bothers them.
- `/package` is unchanged and still used by retail-from-cart; only the rep-student
  redirect target moved off it.

**Files touched**
- NEW: `backend/lib/fullSetOrder.js`, `frontend/app/(student)/my-order/page.tsx`,
  `frontend/components/wholesaler/FullSetOrderForm.tsx`
- `backend/controllers/{wholesalerController,orderController}.js`,
  `backend/routes/{wholesaler,orders}.js`
- `frontend/app/(student)/page.tsx`, `frontend/app/wholesaler/{layout,page}.tsx`,
  `frontend/app/wholesaler/students/[studentId]/order/page.tsx`,
  `frontend/components/catalog/ProductMediaGallery.tsx`, `frontend/lib/wholesaler.ts`,
  `frontend/package.json` (+ qrcode.react)

---

## 2026-06-16 (a) — Wholesaler full-set order entry (WhatsApp intake form digitized)

**What changed**
- Reps can now enter a student's full طقم order **in-app** instead of over WhatsApp.
- Backend (additive — the retail `configureFullSet` path is untouched):
  `backend/controllers/wholesalerController.js` gains `fullSetPackages`,
  `getStudent`, `createFullSetOrder`, `uploadImage`; wired in
  `backend/routes/wholesaler.js`:
  - `GET  /api/wholesaler/full-set-packages`
  - `GET  /api/wholesaler/students/:studentId`
  - `POST /api/wholesaler/students/:studentId/full-set-order`
  - `POST /api/wholesaler/uploads/image`
- Frontend: NEW `frontend/app/wholesaler/students/[studentId]/order/page.tsx`
  (the form), `lib/wholesaler.ts` wrappers, and an "إضافة طلب / تعديل الطلب"
  button on each **approved** student in `app/wholesaler/students`.

**Why**
- Decided with the user this session: reps' students never browse the shop/cart;
  the rep follows the WhatsApp form and orders the **package**. Sash & cap type are
  only عادي/ملكي. Embroidery is free text (the name) + an optional photo, plus a note.
  Account model = **registered students only** (rep fills the order for a student
  who already joined via the referral link & was approved).

**How it works (important for future edits)**
- The WhatsApp form ≈ the retail full-set order, so `createFullSetOrder` **mirrors
  `configureFullSet`'s pipeline**: 3 linked orders (sash/robe/cap) under one
  `checkout_group`, package price on the sash (robe/cap = 0), auto-attach to the
  rep's latest batch, **idempotent upsert** (one active order per student+product —
  respects `uq_orders_student_product_nodesign`; re-submit UPDATEs, never duplicates).
- **No schema migration.** Measurements → `orders.measurements` JSON
  (`{shoulder_cm, robe_length_cm, sleeve_length_cm}`). Types (نوع الوشاح/القبعة =
  عادي/ملكي) and the 4 embroidery zones → `order_items` **spec lines**
  (`label_snapshot` + `customer_text` + optional `customer_image_url`), NOT priced
  options — the cap has no عادي/ملكي option group, so type is captured as a
  manufacturing label staff read. Note → `checkout_groups.notes` + each `orders.notes`.
- Production routing = same rules as the retail full set: an embroidered piece
  enters at `design_complete`, a plain piece at `preparing`. **Order-status logic
  stays backend-only** (see state-machine memory) — the new path invents no statuses.
- Photo upload is wholesaler-scoped (`/wholesaler/uploads/image`, `imageUpload`
  multer) because `/designs/uploads/image` is `requireRole('retail')`.

**Verified**
- Backend **end-to-end against the live Neon DB**: ran the real controller AND real
  HTTP (signed rep JWT) — `GET` endpoints 200, `POST` 201 returning the same
  order/checkout-group IDs on re-submit (idempotency proven), bad measurement &
  missing type → 400 with the right Arabic errors. Confirmed the 3 orders carry
  correct price/status/measurements and the spec lines (نوع الوشاح=ملكي, تطريز
  الوشاح من الأمام="المحلل احمد سمير", تطريز القبعة من الجانب="احمد").
- `tsc --noEmit` 0 errors · `eslint` 0 errors/warnings on the new files.

**Test fixture (for live browser testing)**
- A test rep + approved student were created in dev (none existed before — the DB had
  **zero wholesalers**). Rep login: phone **`07700000001`**, password **`test1234`**,
  OTP **`111111`** (dev master code). Approved student: **"احمد سمير"**
  (referral code `TESTREP`). Open الطلاب → احمد سمير → "تعديل الطلب".

**Open follow-ups**
- **Live in-browser click-through not yet done** — servers were down and disk is at
  92%; verified by real backend e2e + types/lint only. Run `showme` or just log in as
  the test rep to drive it.
- Type عادي/ملكي is captured as a spec label only — it does NOT swap the sash/cap
  sub-product or change price. If reps later need ملكي to pick a different product or
  price, wire `sash_type`/`cap_type` → product/option selection in `createFullSetOrder`.
- Robe `فصال` is measurements-only (no قماش/ردن/لون choices like the retail form). Add
  fields to the form + payload if reps need them.

**Files touched**
- `backend/controllers/wholesalerController.js`, `backend/routes/wholesaler.js`
- `frontend/app/wholesaler/students/[studentId]/order/page.tsx` (new)
- `frontend/app/wholesaler/students/page.tsx`, `frontend/lib/wholesaler.ts`
- `PROGRESS.md`

---

## 2026-06-14 — Sash designer: زخارف vector ornament library (42 ornaments)

**What changed**
- NEW `frontend/lib/ornaments.ts` — a library of **42 vector ornaments** in 7
  Arabic categories (محترف-الخط style): نجوم · شمسيات · فواصل · زوايا · إطارات · ورود · رموز.
- Wired a **categorized ornament picker** (category chips + 4-col thumbnail grid)
  into the shared `frontend/components/designer/Whiteboard.tsx`.
- Renamed the old quick-glyph row label from "زخرفة" → "رموز" (the 10 Unicode
  glyphs are kept as a quick-symbols row; the rich library is the new section).
- Logged in `PROGRESS.md`.

**Why**
- "زخارف" used to be a single line of 10 Unicode glyphs added as `IText`. User
  asked for "a lot of زخارف like محترف الخط app".

**How it works (important for future edits)**
- Each ornament is a self-contained SVG string using the color token `__C__`.
  `ornamentDataUrl(svg, color)` substitutes the chosen thread color and returns a
  `data:image/svg+xml,…` URL.
- `Whiteboard.addOrnament(svg)` adds it as a normal **`FabricImage`** from that
  data URL — freely movable/scalable/rotatable, colored to the current text color
  **at insert time**.
- Because it serializes as a standard image with an inline `src`, it round-trips
  through **both order paths** and every renderer with **zero pipeline changes**
  (same mechanism as the existing logo/photo upload):
  - `/design` page → `TextEditor` → `Whiteboard`
  - product page → `SashSideLockEditor` → `TextEditor` → `Whiteboard`
  - customer preview, staff viewer, print export all go through
    `lib/render-sash-panel.ts` `loadFromJSON`, which reconstructs the image.
- Geometric ornaments (stars/medallions) are generated procedurally for perfect
  symmetry; flourishes/florals are hand-authored and mirrored.
- Removed the 6-point hexagram (reads as a Star of David — wrong audience),
  replaced with a 6-point sparkle star.

**Verified**
- `tsc --noEmit`: 0 errors · `eslint` on changed files: 0 warnings.
- Headless-Chrome contact sheet of all 42 data-URL thumbnails — every ornament
  renders, no tofu, no broken images.

**Open follow-ups**
- Live end-to-end click-through in the running app (add → save → see in
  preview/staff) **not yet done** — verified by render + types/lint only.
- Color is **insert-time only** (embroidery = one thread). To change an ornament's
  color you re-add it with a different color selected. Live recolor of an existing
  ornament image would need either (a) storing the SVG template on the object and
  regenerating `src` on color change, or (b) switching ornaments to Fabric vector
  groups (recolorable via group fill, but heavier JSON / more enliven edge cases).
- Want more ornaments? Add entries to the category arrays in `lib/ornaments.ts`;
  the picker and all renderers pick them up automatically.

**Files touched**
- `frontend/lib/ornaments.ts` (new)
- `frontend/components/designer/Whiteboard.tsx`
- `PROGRESS.md`
