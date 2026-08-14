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

## 📍 WHERE THE TREE IS — 2026-08-14

Verified against git, against the running box over SSH, and (for the admin dashboard) in a real
browser this session. Store/push rows below were last verified 2026-08-10 and are unchanged.

| | |
|---|---|
| `origin/main` | `6b62738` — **Tracks A, B and C all merged and DEPLOYED**; prod confirmed at this SHA over SSH |
| Eleven-bug tracks | **C shipped** (2, 3) · **A shipped** (9, 10, 11) · **B shipped** (4, 5, 6) · **bugs 1, 7, 8 NOT started** |
| Migration 077 | ✅ applied to prod AND the dev DB — 3,311 prod rows retired to `skipped` |
| Migration 080 | ✅ **applied to prod 2026-08-14** — 459 plates moved to their own column, **0** left in `customer_image_url`, 1,885 student photos intact |
| Android | **v1.0.4 (versionCode 5) IN PRODUCTION REVIEW** — deep links + GPS + push in one review |
| iOS | **1.0.4 (build 1786309948) SUBMITTED — «Waiting for Review»** (2026-08-10, ≤48h) |
| Android push | ✅ working end to end |
| iOS push | ✅ **APNs key installed and verified against Apple** — `push.configured()` → `{"android":true,"ios":true}` |
| Backend tests | **228/228 pass** on merged `main` (185 baseline + 11 Track C + 15 Track A + 12 Track B + 5 verification) |
| Prod DB backup | ✅ `~/Desktop/_private/loloshop-db/loloshop-prod-2026-08-14.dump` — restore-tested, row counts match live |

**Both platforms are now on the same version (1.0.4) carrying the same three features.**

⚠️ **Neither store build has been opened on a real phone yet.** Android 1.0.4 is in review;
iOS 1.0.4 is installable from TestFlight *now* (internal group «Testers1», no review needed).
Until someone installs it and grants the notification prompt there are **zero iOS device
tokens**, so iOS push is proven only at the credential layer, not end to end.

**Prod VPS is `142.93.110.202`.** ⚠️ The `revo` host in `~/.ssh/config` is a DIFFERENT project
(RevoArt). ⚠️ The prod frontend has **no `.env`** — it reads **`.env.local`**; server-only vars
there are read at request time, so `pm2 restart loloshop-web --update-env` is enough, **no
rebuild** (unlike `NEXT_PUBLIC_*`, which is inlined at build time).

### 🔑 Where the credentials are

Both prod push secrets live in **`/etc/loloshop/`**, deliberately outside the git checkout so a
deploy cannot clobber them and they can never be committed:
`AuthKey_72D98R3MFC.p8` (APNs) and `fcm-service-account.json` (FCM). The laptop's copies — plus
the App Store Connect API key Codemagic uploads with — are in
**`~/Desktop/_private/loloshop-credentials/`**, which has its own `README.md` naming each file.

⚠️ **An Apple `.p8` downloads exactly once. Never delete those files.** The two `.p8`s look
identical (both EC private keys) and are told apart only by which console issued them:
`72D98R3MFC` is **APNs** (developer.apple.com → Keys); `WLABBTJQT2` is the **App Store Connect
API key** (App Store Connect → Users and Access → Integrations) and has nothing to do with push.

**Prod VPS is `142.93.110.202`.** ⚠️ The `revo` host in `~/.ssh/config` is a DIFFERENT project
(RevoArt). ⚠️ The prod frontend has **no `.env`** — it reads **`.env.local`**; server-only vars
there are read at request time, so `pm2 restart loloshop-web --update-env` is enough, **no
rebuild** (unlike `NEXT_PUBLIC_*`, which is inlined at build time).

---

## 🚢 SHIP QUEUE — both binaries built, both awaiting a human

Owner decision 2026-08-08 was that links + staff GPS + push ride one binary per platform. That
held for Android 1.0.4 and for iOS 1.0.4. **All three features are now in both binaries** — the
code side of this queue is closed.

| Blocker | Android 1.0.4 (code 5) | iOS 1.0.4 (build 1786309948) |
|---|---|---|
| **Deep links** (`/join/` · `/s/ /w/ /d/`) | ✅ in the binary; **tap→app verified on a real phone** on 1.0.3 | ✅ `associated-domains` entitlement in the uploaded build |
| **Staff GPS** (بصمة) | ✅ permission in the binary | ✅ usage string in the uploaded build |
| **Push notifications** | ✅ `google-services.json` compiled in; backend sends | ✅ `aps-environment` in the build; APNs key live on prod |

**Both `.well-known` manifests are LIVE and verified** on the apex *and* `www`, HTTP 200,
`application/json`, zero redirects — which also **closes the `www` landmine** below.

**Both platforms are submitted and waiting. What is left is not code:**

1. ⚠️ **PRESS RELEASE ON BOTH — approval does NOT publish either one.** This trap now exists
   twice, for different reasons, and both land on the same person:
   · **Android** — «النشر المُدار» (managed publishing) is ON.
   · **iOS** — the version is set to **«Manually release this version»**.
   Both will sit looking like "still in review" when they are actually approved and waiting.
2. Install from a **store track** on a real phone and confirm links + push actually fire.

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

## 🧵 TRACK B (calligraphy) — MERGED AND DEPLOYED 2026-08-14

`fix/calligraphy-photo-loss` closed bugs 4·5·6. Migration 080 rode the same deploy: `schema.sql`
carries the column, the backfill **and** `reroll_count`, and `scripts/deploy.sh:17` runs
`npm run migrate` *before* the frontend build, so the column existed before the new code served.

**Owner action this unlocks:** `npm run photo-recovery` on the prod box (read-only, deletes
nothing) proposes which upload file was each deleted reference photo, by mtime. Run it **there** —
mtimes on a copied tree are the copy date and match nothing. It cannot prove a match; the owner
confirms each one, and lines whose own text names a photo (★) are the ones worth the time.

⚠️ **STILL OPEN on the merged code — the reroll geometry ratchet.**
`calligraphyController.js:472` hands `matchPlateGeometry` the plate it is about to overwrite
(`:481`), so reroll N+1 anchors on reroll N's output; `imageFx.js:71-77` resizes with
`fit:'inside'`, which never upscales. Ink height is therefore **monotone non-increasing and cannot
recover**: reproduced with sharp at 700×140 → 1024×**73** → 365×**73** → **73**. The plate ends up
pinned at the scale demanded by the widest generation it ever had — the exact sibling-scale
mismatch `matchPlateGeometry` exists to close — and `REROLL_LIMIT=10` exists because designers
press the button repeatedly. It costs letter height, not data, and converges rather than running
away. **Not fixable without a new column**: `plate_path` is overwritten and `sheet_path` is the
whole 10-name sheet, whose geometry is not the band's. Needs migration 081.

⚠️ **Same shape, unclosed:** `orderController.configureOrder` (`:630`) and `configureFullSet`
(`:1140`) DELETE and re-INSERT `order_items` with no status guard and never carry
`plate_image_url` — the identical defect that was destroying plates via `persistFullSetOrder`. A
review panel refuted these on *reachability* (`orderController.js:727` 403s rep-linked students,
and plates live overwhelmingly on rep orders), which is an argument about who can reach the path,
not about the path being safe. Close them the way `lib/fullSetOrder.js` was closed.

---

## ☁️ CLOUD BOARD — what a session with no laptop can do

Everything here is repo work. Start from `main` (`11a7a43`).

**Push is fully credentialed on both platforms now.** Both binaries are built. What is left below
is what a session can still pick up without a phone or a store console.

**1. What a cloud session can still do:**
- **Drive `pushOutbox.drainOnce()` against a real row.** No longer blocked on credentials — both
  are live. Still unproven: the claim query and the flood guard under an actual row. There are
  zero device tokens, so a real send needs a seeded token or a stub.
- **The remaining `next/image unoptimized` props** — grep finds **12 source files**, two of which
  are missing from the landmine list below (`components/catalog/ProductMediaGallery.tsx`,
  `components/staff/ZoneThumb.tsx`). Each needs a `blob:`/`data:` check first, since upload
  previews genuinely need it.
- **Drop `jspdf`** — a declared dependency with zero imports anywhere. Removing it takes the whole
  dompurify chain out of the `npm audit` deploy gate.
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

**✅ DONE 2026-08-10 — do not redo these:** the **APNs key is created and live** (`72D98R3MFC`,
Sandbox & Production, Team Scoped) — `.p8` at `/etc/loloshop/`, `APNS_KEY_FILE`/`APNS_KEY_ID`/
`APNS_TEAM_ID` in the prod backend `.env`, API restarted, and **verified against Apple's
production endpoint**, not just parsed · the **iOS 1.0.4 binary is built and uploaded** ·
`ios-appstore` is merged into `main` and fast-forwarded to it, so the Codemagic pipeline is no
longer stranded on a branch · the laptop's loose credentials are filed in
`~/Desktop/_private/loloshop-credentials/`.

**Still outstanding:**

1. **⏳ Android 1.0.4 (versionCode 5) is IN PRODUCTION REVIEW** — submitted 2026-08-09 with
   deep links + GPS + push together, full rollout, exactly one queued change (the withdrawn
   versionCode 4 draft did NOT linger; verified before submitting).
   ⚠️ **«النشر المُدار» (managed publishing) is ON, so approval does NOT publish it.** Someone
   must return to the publishing overview and press publish. It will look like "still in review"
   when it is actually approved and waiting. Check in a day or two.
2. **⏳ iOS 1.0.4 is IN REVIEW** — submitted 2026-08-10, ≤48h, and set to **manual release**, so
   approval will not publish it either. Done in the same sitting: version 1.0.4 created, build
   attached, 6.9" screenshots uploaded (the page now reads *«Using 6.9" Display»*), Arabic
   *What's New* written by the owner, App Privacy published.
   ⚠️ **«What's New in This Version» is REQUIRED for every update** and blocks *Add for Review*
   with a misleading generic "unexpected error" alongside the real message. It was not required
   for the initial 1.0 release, so it is easy to hit once and never again.
   ⚠️ **In this ASC flow «Add for Review» submits immediately** — it is not a staging step and
   there is no second confirm.
3. **📱 Install iOS 1.0.4 from TestFlight and grant the notification prompt.** Internal group
   «Testers1», no review wait. This is the ONLY way a first iOS device token exists — until then
   iOS push is proven at the credential layer and nowhere else. While you are in there, tap a
   `/join/` WhatsApp link and confirm it opens the app rather than Safari. **The owner has no
   iPhone** — a TestFlight invite to anyone with one closes this.
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
- **iOS — the binary exists; what is left is the submission paperwork:** select build `1786309948`
  in ASC → reply to Apple with a physical-device screen recording of the deletion flow → tap the
  camera once on TestFlight. **After a reviewer walks deletion the demo account is really gone —
  run `npm run demo-account` on prod before the next submission.**
- **⚠️ RAISE `MARKETING="1.0.4"` in `codemagic.yaml` before every future iOS submission.** Apple
  closes a version train permanently once it approves it, and a build number bump does **not**
  reopen one. Re-uploading the same marketing version fails at publish with `90186` + `90062`
  *after* a full successful build and sign — the most expensive place to discover it. The line is
  in the «Set the marketing version…» step and carries this warning inline.
- **Codemagic has no `triggering:` block** — pushing any branch starts nothing, by design. Every
  iOS build is started by hand from the Codemagic UI.
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

- **⚠️ MERGING `ai-assistant` MUST UPDATE «لولو»'s MONEY DEFINITION — or it will quote a
  different profit than the dashboard.** Track A (`fix/admin-numbers`, 2026-08-13) changed what
  «الربح» *means*: the admin dashboard no longer reports `SUM(orders.profit)`, because on a rep's
  order that is **the rep's margin**, not the shop's. It now reports **دخل المحل** = حصة الإدارة
  (rep rows) + price (retail rows), with the reps' margin shown separately as theirs. The whole
  vocabulary lives in `backend/lib/counts.js` (`shopIncomeExpr` · `repMarginExpr` · `settledMoney`).
  `ai-assistant`'s `lib/adminMetrics.js` still answers `revenue_summary` / `top_reps` with the OLD
  `SUM(o.price)/SUM(o.cost)/SUM(o.profit)` triple under the words مبيعات/تكاليف/أرباح — which is
  exactly the failure `lib/counts.js` warns about in its own header. **Rewrite those metrics onto
  `settledMoney` in the same commit that merges the branch.**
  · Mechanical part of that merge is already handled: Track A moved `billableOrderSql` from
  `adminController` into `lib/counts.js` **byte-identically** to the way `ai-assistant` moved it,
  so that hunk auto-resolves. The conflict left is `adminController.analytics`/`accounting`, and
  it is a real one — resolve toward Track A's shape (`money`, not `totals`).
- **⚠️ `db/schema.sql` DISAGREES WITH THE LIVE `orders` TABLE about money columns.** The file says
  `cost BIGINT NOT NULL DEFAULT 0` and `profit GENERATED ALWAYS AS (price - cost)`; the real table
  (measured 2026-08-13) has `cost` **nullable, no default** and `profit GENERATED ALWAYS AS
  (price - COALESCE(cost, 0))`. Under the file's version every retail row — all of which have a
  NULL cost, because no production cost has ever been entered — would compute `profit = NULL` and
  drop out of every SUM. `npm run migrate` applies `schema.sql` with `CREATE TABLE IF NOT EXISTS`,
  so it does not currently rewrite the column; **do not "fix" the drift by making the live table
  match the file.** Owned by Track B (`db/schema.sql`), so Track A left it alone.
- **⚠️ The calligraphy plate writes `order_items.plate_image_url`, NEVER `customer_image_url`**
  (migration 080, on `fix/calligraphy-photo-loss`). The two columns are the generator's output and
  the student's own upload, and they shared one name until 2026-08-13 — so every generate / reroll
  / compose deleted the photo, 459 prod lines across 628 link events, 27 of them carrying text
  that pointed AT the image being deleted. Anything that attaches student media belongs in
  `customer_image_url`; anything the generator produces belongs in `plate_image_url`. A reader
  that wants «the artwork to stitch» takes `COALESCE(plate_image_url, customer_image_url)`.
  ⚠️ **080's backfill is repeated in `db/schema.sql` on purpose**, exactly like 077's — that is
  the file `npm run migrate` applies to a database that already holds the damaged rows. Do not
  tidy it out.
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
- **`/admin/orders` still shows the bug Track A fixed on `/admin`.** `app/admin/orders/page.tsx`
  sums each row's `o.profit` into a «الربح» column — on a rep's order that is the *rep's* margin.
  Track A does not own that file, so it was left alone deliberately; the fix is the same one, and
  `AdminOrder.profit` should be presented as «ربح الممثل» there or replaced with the shop's share.
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
