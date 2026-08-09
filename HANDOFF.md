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

## 📍 WHERE THE TREE IS — 2026-08-09

Verified against git **and against the running box over SSH** this session.

| | |
|---|---|
| `origin/main` | `2108443` — carries deep links, push code, the rep-directory batch and the join-routing fix |
| **Prod is running** | `2108443` — confirmed by `ssh root@142.93.110.202`, all 3 PM2 processes online, no errors |
| `origin/ios-appstore` | `eb59e21` — merged `main`, lockfile reconciled, **codemagic push patch applied**. Ready to build; nothing left to prepare. |
| Migration 077 | ✅ **applied to prod AND the dev DB** — 3,311 prod rows retired to `skipped` |
| Android | **v1.0.3 (versionCode 4) live on the internal testing track**, tap→app verified on a real phone |
| Backend tests | **185/185 pass** against the dev DB with 077 applied |

**Prod VPS is `142.93.110.202`.** ⚠️ The `revo` host in `~/.ssh/config` is a DIFFERENT project
(RevoArt). ⚠️ The prod frontend has **no `.env`** — it reads **`.env.local`**; server-only vars
there are read at request time, so `pm2 restart loloshop-web --update-env` is enough, **no
rebuild** (unlike `NEXT_PUBLIC_*`, which is inlined at build time).

---

## 🚢 SHIP QUEUE — ONE release carrying all three blockers

Owner decision 2026-08-08: **links + staff GPS + push notifications ride the same binary.** One
Android release, one iOS release, one review each. Do not submit until all three are in.

⚠️ **The 2026-08-08 "one binary carries all three" decision DID NOT SURVIVE 2026-08-09.** Android
1.0.3 shipped to internal testing **without** push, because `google-services.json` still does not
exist and the owner wanted tap→app the same day. Android push therefore needs a **second**
binary. iOS is still unshipped and CAN carry all three.

| Blocker | Android | iOS |
|---|---|---|
| **Deep links** (`/join/` · `/s/ /w/ /d/`) | ✅ **DONE** — manifests live, binary on internal testing, **tap→app verified on a real phone 2026-08-09** | manifest live + entitlement ready; needs the Codemagic build |
| **Staff GPS** (بصمة) | ✅ permission in the 1.0.3 binary | usage string ready; needs the build |
| **Push notifications** | ❌ **NOT in 1.0.3** — no `google-services.json`, so `app/build.gradle:60-65` skipped the google-services plugin. Needs Firebase **then a new binary** | ready — `aps-environment` is in the patched `codemagic.yaml`; needs the APNs `.p8` in the prod `.env` |

**Both `.well-known` manifests are LIVE and verified** on the apex *and* `www`, HTTP 200,
`application/json`, zero redirects — which also **closes the `www` landmine** below.

- **Deploy is AUTOMATIC on merge to `main`.** `.github/workflows/ci.yml:46-58` runs
  `scripts/deploy.sh` over SSH once the backend + frontend jobs pass — no laptop, no manual SSH.
  ⚠️ Both jobs run `npm audit --omit=dev --audit-level=moderate`, so **a new dependency carrying
  an advisory blocks the deploy**, not just the tests. *(This is exactly why push added **zero**
  npm packages — `backend/lib/push.js` speaks FCM HTTP v1 and APNs HTTP/2 on Node's own `crypto`
  and `http2`. Keep it that way; `firebase-admin` would put ~40 transitive packages permanently
  inside the deploy gate.)*
- **Nothing about the web half needs a store.** The shells are remote-URL WebViews, so `/join`,
  the rep directory and the `/get-app` copy reach *already-installed* apps the moment the site
  deploys. A student with the app can join via `/login` → «ادخل مع ممثلك» **today**. Only
  `AndroidManifest.xml` and the iOS entitlements need a binary — the binary just adds "tapping
  the WhatsApp link opens the app" on top of a door that already works.

### Release runbook — the order that works

1. **Owner, first, ~15 min in a browser** (everything downstream blocks on these):
   Associated Domains **and** Push Notifications capability on the `com.loloshop96.app` App ID ·
   Firebase project → `google-services.json` → commit to `frontend/android/app/` ·
   APNs `.p8` key → **download it and put it in the prod backend `.env`**.
   ⚠️ The `.p8` does NOT go to Firebase for this app. iOS talks to Apple directly, because
   routing it through FCM would need the Firebase SDK inside an Xcode project that Codemagic
   regenerates on every run — the same trap the privacy strings already live in. Firebase is
   **Android-only** here. Full reasoning at the top of `backend/lib/push.js`.
2. Merge to `main` → CI auto-deploys → **students unblocked, no store involved**.
   ⚠️ **Run the migration after that deploy** — `npm run migrate` applies `db/schema.sql`, which
   carries 077's columns *and* its flood-guard backfill. Or
   `npm run migrate:file db/migrations/077_push_notifications.sql`. Nothing pushes until FCM/APNs
   credentials exist, so the order of these two is safe either way.
   ⚠️ **Apply `docs/patches/codemagic-ios-push-capability.patch` to `ios-appstore`** before
   step 4 — without `aps-environment` in the entitlements, iOS registration fails on device from
   a build that succeeded. See `docs/patches/README.md`.
3. **Android binary — owner decision 2026-08-08: built by hand on the laptop, ~20 min.** No
   Android CI exists and none is wanted. Bump `versionCode 3 → 4` and `versionName` in
   `frontend/android/app/build.gradle:10-11`, `npx cap sync android`, gradle bundle release
   (keystore is local, read from `frontend/android/gradle.properties`), upload.
4. **iOS binary — start Codemagic by hand on `ios-appstore`**; there is no `triggering:` block,
   so pushing starts nothing. ⚠️ `ios-appstore` is behind `main` and its lockfile is desynced —
   `npm install` in `frontend/` before merging.
5. **Verify on a real phone from a store track, not a local build.** App Links verify against the
   **Play App Signing** key, so a locally-signed APK proves nothing. Play internal testing +
   TestFlight are fast (no full review) and are the only honest check:
   `adb shell pm get-app-links com.loloshop96.app`.
6. Only then submit for review. Apple ~24h–2 days, Google hours–days, a rejection costs days.

---

## ☁️ CLOUD BOARD — what a session with no laptop can do

Everything here is repo work. Start from `main` (`2108443`).

**Push is built, migrated and deployed; the tests have now been run (185/185 against 077).** What
is left below is what a session can still pick up.

**1. What a cloud session can still do:**
- **Nothing on push until the owner acts.** The code is deployed and *deliberately inert*:
  `pushOutbox.drainOnce()` returns before touching the DB when no FCM/APNs credentials exist
  (`lib/pushOutbox.js:83-93`), so prod logs one line and never errors. Still unproven: driving
  the drain against a real row to exercise the claim query and flood guard.
- **The 14 remaining `next/image unoptimized` props** (list in the landmines below) — each needs
  a `blob:`/`data:` check first, since upload previews genuinely need it.
- **Wire gender to the DB** — `students.gender` exists, onboarding only writes localStorage.
  Wiring, not a migration.
- **Unit vocabulary pass 2** — rep + staff screens still say «طلب» for pieces.
- **The «لبسوا تصاميمنا» caption** — a one-string change in `CohortProof.tsx`.

**2. Then: make the app phone-test-ready.** The remaining gates are a real device and the store
consoles — neither can be done from a cloud sandbox.

**Explicitly NOT cloud work:** do **not** add an Android CI workflow. Owner decided 2026-08-08 to
keep building the AAB by hand on the laptop; the keystore stays local and off GitHub.

---

## 👤 OWNER ACTIONS — outside the code

**✅ DONE 2026-08-09 — do not redo these:** Associated Domains **and** Push Notifications are both
enabled on the `com.loloshop96.app` App ID · `ANDROID_SHA256_CERT_FINGERPRINTS` (the **App
signing** key, `FC:4E:98:…`) and `IOS_TEAM_ID` (`9YY4QWVDUW`) are set in the prod
`frontend/.env.local` and both manifests serve 200 · the codemagic push patch is applied to
`ios-appstore` · migration 077 is applied to prod.

**Still outstanding:**

1. **Promote Android 1.0.3 from internal testing to production** — internal reaches ~23 testers;
   the real users are on the production track. «ترقية الإصدار» on the internal-testing page
   promotes the *same* artifact, no rebuild. ⚠️ This binary has **no push** (see below), so
   promoting it means Android push needs a second release later.
2. **Start the Codemagic build by hand on `ios-appstore`** — there is still no `triggering:`
   block, so pushing that branch starts nothing. The branch is fully prepared as of `eb59e21`.
3. **Push notifications — the code is deployed and completely inert until these exist:**
   a. Firebase project → `google-services.json` → **commit it to `frontend/android/app/`**.
      ⚠️ `app/build.gradle` applies the google-services plugin only `if (servicesJSON.text)`, so
      a build without this file **succeeds** and silently produces an app that can never
      register. Nothing fails; nothing arrives.
   b. APNs `.p8` key (developer.apple.com → Keys, **downloadable once**) → `APNS_KEY_FILE` +
      `APNS_KEY_ID` + `APNS_TEAM_ID` in the prod `.env`, then
      `pm2 restart loloshop-api --update-env`. Not Firebase — see the runbook note.
   c. ~~Push Notifications capability on the App ID~~ — ✅ done 2026-08-09.
   d. ~~Apply the codemagic patch~~ — ✅ applied, on `ios-appstore` at `eb59e21`.
   Each half works alone: set only (a) and Android starts receiving, iOS stays quiet.
   ⚠️ **(a) also requires a NEW Android binary** — `google-services.json` is compiled in, so
   dropping the file on the server does nothing for the 1.0.3 already on the store.
5. **⚠️ Enter the shop coordinates** at `/admin/attendance` (خط العرض · خط الطول · نطاق الموقع)
   **before** moving `verification_mode` off `'none'`. Wrong order 403s every بصمة for every
   worker on every platform.
6. **Play Data Safety form + Apple privacy label:** declare location **and notifications** —
   both are in the binary now.
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

- **⚠️ `notifications.push_state` DEFAULTS TO `'pending'` — the backfill is not optional.**
  Migration 077 retires every pre-existing row to `'skipped'`, and the same `UPDATE` is repeated
  in `db/schema.sql` **on purpose**, because that is the file `npm run migrate` applies to a
  production database that already holds every notification the shop has ever written. Delete
  either one and the next drain pushes years of history to every phone at once. The drain's
  15-minute freshness window is the second guard; neither is redundant. Do not "tidy" that
  `UPDATE` out of `schema.sql`.
- **⚠️ `POST_NOTIFICATIONS` and `google-services.json` are BOTH compiled into the AAB.** The
  plugin does not declare the permission (it is only a Capacitor `@Permission` alias — its own
  manifest has just the messaging service), and Android denies an undeclared runtime permission
  **without a dialog**. `npx cap sync android` before every build, or the push plugin is absent
  from the generated gradle files entirely. Getting any of the three wrong costs a whole extra
  store release, and all three fail silently.
- **`joinLimit` is 10 signups/hour/IP and Iraqi carriers CGNAT.** A cohort of 100+ shares one
  egress address, so a referral wave can hit it and every student after the tenth sees an error
  with no way to tell it apart from a broken link. Deliberately **not** changed 2026-08-08: it is
  the accepted bound on approval-queue spam recorded 2026-08-07, and loosening it is an owner
  call. The two read limiters on the same router were split and raised (`directoryLimit` 300,
  `lookupLimit` 200 per 15 min) because their enumeration rationale was already spent.
- **⚠️ Do NOT set `staff_attendance_settings.verification_mode` to `location`/`both`** —
  `shop_latitude`/`shop_longitude` are NULL, so every بصمة would 403 for every user on every
  platform. The Android permission and the iOS usage string now exist, so the *only* thing left
  is the order: binary → phones updated → coordinates at `/admin/attendance` → mode last.
- ~~**`www.lolo-shop96.com` verification path is unproven**~~ — **CLEARED 2026-08-09.** Measured
  from outside: **both** `lolo-shop96.com` and `www.lolo-shop96.com` serve
  `/.well-known/assetlinks.json` at **HTTP 200, `application/json`, `num_redirects=0`**, so the
  all-or-nothing rule on Android ≤11 is satisfied and the four `www` `<data>` lines can stay.
  Re-check with `curl -sI` if DNS or the cert ever changes — Digital Asset Links does not follow
  redirects, so a future 301 on `www` would silently break `/join/` for the apex too.
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
  touches every login path for 1,141 live accounts) · `server-only` is not a dependency, so
  `lib/catalog-server.ts` uses a `typeof window` guard instead.
  *(Dropped 2026-08-08 (b): "Track B deep links — both manifests 404 today". That work shipped in
  `57f272f`; the manifests and `DeepLinkHandler` all claim the same four prefixes and the line
  contradicted the ship queue at the top of this file. What is still true is that it needs new
  binaries and one review each, which the ship queue already says.)*

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
