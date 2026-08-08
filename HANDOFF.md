# HANDOFF

**This file is auto-loaded into every session** via `@HANDOFF.md` in `CLAUDE.md`, so its whole
length is paid for in context on every run. It holds **only what is still actionable**: current
tree state, the ship queue, owner actions, and landmines.

Full session narratives — what changed, why, and the measurements behind each decision — live in
**`docs/HANDOFF-archive.md`** (2026-06-14 → 2026-08-05). Nothing was deleted; follow a line here
back to its dated entry there when you need the reasoning.

**When you finish a session:** add a short dated entry at the top of the *archive*, and only touch
this file if something on the board opened, closed, or changed.

---

## 📍 WHERE THE TREE IS — 2026-08-08

Verified from git this session, not carried over from a previous entry.

| | |
|---|---|
| Checked-out branch | `feat/deeplinks-and-location` — **pushed** |
| `origin/main` | `bc0c6fe` — identical to local `main` and to this branch's base |
| `origin/ios-appstore` | `f1785c0` — **pushed 2026-08-08**, carries the associated-domains entitlement |
| Pending migration | **none** |

The old SSR/prep-console queue is **closed** — that work reached `origin/main` (`577a191` is an
ancestor of `bc0c6fe`). Nothing is waiting to merge except this branch.

⚠️ **What prod is actually *running* was NOT re-verified this session** — the sandbox allows no
outbound network and no prod SSH. Everything above is git ancestry, which is what's provable here.
Confirm on the box before trusting "it's live".

---

## 🚢 SHIP QUEUE — ONE release carrying all three blockers

Owner decision 2026-08-08: **links + staff GPS + push notifications ride the same binary.** One
Android release, one iOS release, one review each. Do not submit until all three are in.

| Blocker | Code | What's left |
|---|---|---|
| **Deep links** (`/join/` rep link · `/s/ /w/ /d/` team portals) | ✅ on this branch | deploy · 2 env vars · binary · console steps · phone test |
| **Staff GPS** (بصمة) | ✅ on this branch (Android) + `ios-appstore` (iOS) | same binary, then coordinates, then flip the mode. The admin screen to type them **already exists**: `/admin/attendance` → خط العرض · خط الطول · نطاق الموقع |
| **Push notifications** | ❌ **not started** | the whole feature — see the cloud board below |

- **Deploy = merge to `main` + push + `bash scripts/deploy.sh` on the VPS.** No migration pending
  *today*; push notifications will add one (device tokens).
- **Nothing about the web half needs a store.** The shells are remote-URL WebViews, so `/join`,
  the rep directory and the `/get-app` copy go live the moment the site deploys. Only
  `AndroidManifest.xml` and the iOS entitlements need a binary.

---

## ☁️ CLOUD BOARD — what a session with no laptop can do

Everything here is repo work. Start from `feat/deeplinks-and-location` (pushed).

**1. Push notifications — the only unbuilt blocker.** Nothing exists today:
`@capacitor/push-notifications` is in `package.json` but is referenced **nowhere** in
`frontend/{app,components,lib}`, there is no `frontend/android/app/google-services.json`, and the
backend has no FCM/APNs sender or device-token table. What ships today as "notifications" is rows
in the `notifications` table rendered in-app only — nothing reaches a phone that is closed.
Needs: token table + migration · backend sender · frontend registration + permission prompt ·
iOS push capability in `codemagic.yaml` (same regeneration trap as the entitlement) · Android
`google-services.json`. **Owner must create the Firebase project and the APNs key first** — a
cloud session cannot do either, but it can build everything around them.

**2. Review findings from 2026-08-08** (all verified, none blocking a build):
- `DeepLinkHandler.tsx:45-48` tests only `window.Capacitor`; `app-gate.ts:110` tests
  `window.Capacitor||window.androidBridge`, and the comment falsely claims parity. On Android
  WebView <105 the bridge is never injected (`Bridge.java:265-270` vs `MessageHandler.java:36-41`),
  so an App Link **opens the app and drops the code** — worse than today's browser behaviour on
  those phones. Matching the signal alone does not fix it (`AppWeb.getLaunchUrl()` returns
  `{url:''}`); decide between accept-and-document or a device test on the oldest supported phone.
- **No test pins the `/representatives`-above-`/:code` route order** — the one thing the code
  shouts about, and the backend count is unchanged at 177.
- **`join:representatives` is never invalidated** — no `memoCache.del('join:')` caller, so an
  admin creating or editing a rep is invisible for 5 minutes. `adminController.js:433` already
  uses the pattern.
- `lookupLimit` (60/15 min/IP) is now **shared** between the rep directory and referral-code
  lookups; Iraqi carriers CGNAT, so a cohort shares one egress IP.
- `/join` shows «لا توجد قائمة ممثلين» for a network failure too (`auth-api.ts:212` swallows the
  error) — no retry, wrong message.
- Dead code: the `?referrer=join_<code>` branch at `app-gate.ts:118-123` is now unreachable for
  `/join/*` because the allowlist returns first.
- Stale comments: `app-gate.ts:22-27` still says /s /w /d must open in a **browser**; the manifest
  now claims them for the app. And the spec's acceptance still says «two dropdowns» while the
  shipped picker is deliberately one grouped `<select>`.
- Sharp edge in the new codemagic step: `if "CODE_SIGN_ENTITLEMENTS" not in src` skips injection
  if a *future* Capacitor template ships that key for any target — it then exits 1 rather than
  shipping unsigned-for-links, which is the right failure, but it will look like a mystery.

**3. Then: make the app phone-test-ready.** Once 1 and 2 land, the remaining gates are a real
device and the store consoles — neither can be done from a cloud sandbox.

---

## 👤 OWNER ACTIONS — outside the code

**For the one release (all doable from a phone or any browser — no laptop needed):**

1. **⚠️ Enable "Associated Domains" on the `com.loloshop96.app` App ID** at developer.apple.com →
   Certificates, Identifiers & Profiles — **before** the next Codemagic run. Without it
   `fetch-signing-files --create` builds a profile lacking the entitlement and the archive dies
   at signing.
2. **`ANDROID_SHA256_CERT_FINGERPRINTS` on the VPS** — Play Console → Test and release → Setup →
   App integrity → **App signing key** certificate. ⚠️ NOT the upload keystore: Play re-signs the
   AAB, so the upload key never matches and `/join/` links keep opening in the browser — silently,
   because App Links fail soft.
3. **`IOS_TEAM_ID` on the VPS** (10 chars, Apple Developer → Membership). Unset = that route 404s
   and iOS deep links stay off.
4. **Create the Firebase project + download `google-services.json`, and generate an APNs auth key**
   — the cloud session cannot build push notifications past a certain point without these.
5. **⚠️ Enter the shop coordinates** at `/admin/attendance` (خط العرض · خط الطول · نطاق الموقع)
   **before** moving `verification_mode` off `'none'`. Wrong order 403s every بصمة for every
   worker on every platform.
6. **Play Data Safety form + Apple privacy label:** declare location, and notifications when they land.
7. **Clean the 12 wholesaler `university_name` rows** — one university is spelled three ways
   («بلاد الرافدين» · «بلاد الرفدين» · «كلية بلاد الرافدين»), same for ديالى. The picker was built
   to survive this, but the list reads badly.
8. **Verify on a real phone before flipping either flag** — `adb shell pm get-app-links com.loloshop96.app`.

**Standing:**

- **⚠️ The App Review demo-login bypass DIES 2026-08-21.** `DEMO_LOGIN_EXPIRES_AT` in the prod
  `.env`; past that date `07700000000` hits the WhatsApp OTP wall and the submission fails. Push
  the date forward + `pm2 restart loloshop-api --update-env`. Setting only `DEMO_LOGIN_PHONES`
  looks configured and is **silently inert**.
- **iOS — nothing left to code:** start the Codemagic build by hand on `ios-appstore` (there is no
  `triggering:` block, so pushing started nothing) → select the new binary in ASC → reply to Apple
  with a physical-device screen recording of the deletion flow → tap the camera once on TestFlight.
  **After a reviewer walks deletion the demo account is really gone — run `npm run demo-account` on
  prod before the next submission.**
- **Enter the real تجزئة piece rates** at `/admin/workshop → أسعار القطع`. Migration 072 seeded them
  equal to the ممثلين rates, so retail work still pays the wholesale wage.
- **The app-only gate is deployed with the flag OFF.** Turning it on is an env edit **plus a
  rebuild** (~2–3 min), not a runtime toggle — `NEXT_PUBLIC_*` is inlined at build time. Runbook +
  the 4 real-phone checks are in the 2026-07-31 (b) archive entry.
- **⚠️ Rotate `STAFF_PORTAL_KEY` if the laptop `.env` value matches prod.** Portal keys travel as
  URL query params, so testing put one in a browser network log.
- **Delete the stray `/home/mint/package-lock.json`** (outside this repo, machine owner's to
  remove) — see the turbopack landmine below.
- **Copy a DB dump off-site.** Backups live on the laptop + droplet only, which is not DR.

---

## 💣 LANDMINES

- **⚠️ Do NOT set `staff_attendance_settings.verification_mode` to `location`/`both`** —
  `shop_latitude`/`shop_longitude` are NULL, so every بصمة would 403 for every user on every
  platform. The Android permission and the iOS usage string now exist, so the *only* thing left
  is the order: binary → phones updated → coordinates at `/admin/attendance` → mode last.
- **⚠️ `www.lolo-shop96.com` is claimed by both deep-link manifests but its verification path is
  unproven.** Digital Asset Links does **not** follow redirects, and on **Android 11 and below
  verification is all-or-nothing across every host in the filter** — a failing `www` breaks
  `/join/` for the apex too. `nginx-ssl.conf:30` does serve both names on 443 straight to Next
  (good), but the cert is `live/lolo-shop96.com/` and nobody has confirmed a `www` SAN or DNS
  record. Check before shipping the binary:
  `curl -sI https://www.lolo-shop96.com/.well-known/assetlinks.json` → want 200, `application/json`,
  **no 301**. If it doesn't serve cleanly, drop the four `www` `<data>` lines and the
  `applinks:www…` string rather than leave a half-verifying claim.
- **⚠️ Do NOT add `turbopack: { root }` to `frontend/next.config.ts`.** Tried and reverted
  2026-08-04 — it silences the workspace-root warning and builds fine, but **breaks `next dev`**
  (`/` 500s with «Could not find the module … app/error.tsx in the React Client Manifest»). The
  warning is cosmetic; the real fix is deleting the stray lockfile above. Full reasoning is in the
  file's own header comment, `frontend/next.config.ts:2-17`. *(This closes the "worth a look"
  follow-up left open on 2026-08-05 — the answer was already in the code.)*
- **`next/image` `unoptimized` overrides `next.config.ts` — in production too.** The staff order
  page was fixed 2026-08-05 (724 KB raw + `no-store` → 12 KB WebP + a week of caching, 60×).
  **14 prop usages remain**, verified by grep today: `admin/packages` ×3 · `admin/products` ·
  `AdminProductMedia` ×2 · `design-support` ×2 · `(student)/package` · `(student)/cart` ·
  `VipHero` · `VipStoryStrip` · `StaffOrderBreakdown` · `OrderBreakdownCard`. **Each needs a
  blob:/data: check first** — upload previews genuinely need `unoptimized`.
- **`ios-appstore` is behind `main` and its lockfile is desynced** (`@capacitor/ios` in
  package.json, absent from package-lock). Run `npm install` in `frontend/` before merging.
- **Gate holes — owner decisions, not bugs:** `/admin` is allowlisted, so its client-side redirect
  to `/login` lets anyone browse the site from there; `NEXT_PUBLIC_GATE_BYPASS` ships in the page
  source in plaintext.
- **Gender never reaches the DB.** `students.gender` **does** exist (`db/schema.sql:216`), but
  onboarding writes only to `localStorage` via `frontend/lib/profile.ts` — and `users` has no
  gender column at all. So a signed-in student gets the neutral register until they set it in
  «تفضيلاتي». The fix is **wiring, not a migration**.
- **Unit vocabulary pass 2 is not done** — rep + staff screens still say «طلب» for pieces, so
  `/admin` and `/staff/queue` disagree about the same rep (40 vs 118).
- **`backend/` has no `npm test`** — verified in `backend/package.json`. The real command is
  **`node --test test/`** (167 tests).
- **The Next 16 dev server OOMs on this laptop** (V8 heap ~3.5 GB with system RAM still free); it
  died 3× on 2026-08-05, first time *before any code changed*. `--max-old-space-size` did not save
  it. `next build` is unaffected.
- **`pkill -f "next dev"` kills its own launcher** — `pkill -f` matches the pattern text inside the
  invoking shell's own command line. Kill the port owner instead (`ss -ltnp | grep :3000`).
- **`frontend/public/dev-login.html` and `frontend/public/dev-token-tmp.json` must never be
  committed** — the latter holds a live JWT (a preparer's, as of 2026-08-05). Both are already
  covered by `.gitignore:63-66`.
- Smaller, still true, each with its reasoning in the archive: `otp_codes` has no retention policy ·
  workshop `myProduction` has no `qty` upper bound · the duplicate self-heal is same-checkout-group
  only · governorate is free text · dev/demo rows left in the laptop dev DB (incl. an open
  attendance record + 2 closed breaks for ابو عبدو).
  *(Dropped 2026-08-08: "`configurePackage` for a rep-linked student bypasses approval and books
  cost=0" — no longer true, `orderController.js:727` now 403s any rep-linked student with
  `ERR_REP_ORDER_FLOW`. This matters because the new public rep directory leans on exactly that
  guarantee.)*

---

## 🤔 OPEN DECISIONS + NEXT MOVES

- ~~The prep-queue data gap~~ — **CLOSED 2026-08-05 (e).** The spec (`لون/قماش/فصال الروب` · `الشكل`
  · `لون القبعة`), the free-text lines («كسرة الكتف» · «نوع القبعة») and `measurements` now render on
  the التجهيز card. Verified by driving the real `getQueue` with a real preparer: **416 of 435 prep
  rows (95.6%) carry a spec**, 281 carry measurements, **19 cards remain empty and all 19 are
  correct** — they are American shawls whose only order line is «السعر الأساسي», because the product
  name (*شال امريكي 10*) already IS the spec. The detector was not touched, as the board insisted.
- **Payout cards are shipped but their numbers are still wrong:** `suggested_amount` is a lifetime
  accrual that manual payouts never reduce · ابو عبدو is listed twice · مضر محمد renders −775,000 ·
  no `audit_log` row is written on card changes. *(The feature itself is committed and on
  `origin/main` — only the data behaviour is open.)*
- **Should lateness deductions reach the salary?** Today «مبلغ التأخير» is display-only, while break
  deductions do hit it.
- **Backfill the 54 existing 4–6 MB catalog photos?** Not a pure file job: re-encoding changes
  `.png` → `.jpg`, so it needs a matching `products.image_url` / `product_images.url` update in the
  same transaction. Delivery is already fixed for them by the optimizer.
- **The «لبسوا تصاميمنا» caption overstates the number** — it counts 1,141 *registrations* while
  only ~554 have an order. «طالب وطالبة سجّلوا معنا» is a one-string change in `CohortProof.tsx`.
- **`/product/[id]` was deliberately not converted to SSR** — 629 lines of client state. It still
  pays the full client waterfall.
- **CLS 0.49 on the home page** should be resolved by the SSR batch (the skeleton→content swap that
  caused most of it no longer happens), but that batch is not on `main`, so it is **unverified on
  prod**. Re-measure after deploy.
- **Deferred, unchanged:** move the JWT to an httpOnly cookie (would let `/wholesaler` SSR too;
  touches every login path for 1,141 live accounts) · Track B deep links (both manifests 404 today;
  needs new binaries + one review; claim `/join/*` ONLY) · `server-only` is not a dependency, so
  `lib/catalog-server.ts` uses a `typeof window` guard instead.

---

## ⚠️ THE INVARIANT THE SSR STOREFRONT DEPENDS ON

`lib/catalog-server.ts` fetches the shop feed **unauthenticated** and that is safe only because
`buildShopFeed` applies the **same** visibility filter (`AND p.wholesaler_only = FALSE`) to both
`guest` and `retail`, and `priceRoleForUser(null)` returns `'retail'`. **If anyone makes those two
audiences diverge, the home page must go back to fetching per-user.** Written at the top of that
file too.

---

## 2026-08-05 (c) — 🧹 HANDOFF.md + PLAN.md trimmed to what is still true

Docs only — no code touched, no migration. `HANDOFF.md` went **665 → ~180 lines** and `PLAN.md`
**337 → ~80**; the five newest session narratives and PLAN's eleven shipped phases moved verbatim
into `docs/HANDOFF-archive.md` and `docs/PLAN-archive.md`. Six board claims were **stale and were
corrected against git/grep, not just moved**: the payout cards and Android 1.0.2 assets were called
"uncommitted" but are on `origin/main`; the app-shell "commit as one unit" warning had already been
done (it now points at the *prep* batch, re-verified); the 2026-08-01 image work was called
undeployed but is on `origin/main`; "~8 components still pass the dead `priority` prop" is fixed
(grep: every remaining hit is a comment saying it's dead); "SSR the home feed" was listed as blocked
and open but shipped 2026-08-04; and the turbopack follow-up is answered by `next.config.ts:2-17`
(pinning `turbopack.root` breaks `next dev` — don't). Full detail in the archive.

---

*Full session history → `docs/HANDOFF-archive.md`. Shipped build phases → `docs/PLAN-archive.md`.*
