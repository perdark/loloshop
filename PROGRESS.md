# Progress

## 2026-08-13 — Track B: the calligraphy plate stops eating the student's photo (bugs 4·5·6)

Branch `fix/calligraphy-photo-loss`, cut from `main` (`871a257` + the spec doc). **Not merged** —
Tracks A and C are separate branches and the deploy rule is one track at a time.

**Bug 4 — the plate destroyed the reference photo.** `order_items.customer_image_url` held two
different things under one name, and `calligraphyEngine.autoLinkPlate` overwrote it
unconditionally, so every generate / reroll / compose deleted the student's upload. Migration
**080** gives the plate its own column (`plate_image_url`), backfills the damaged rows out of the
customer's column, and the link now targets the new one. Proved against a live order line: the
photo survives the write and the plate lands in its own column (probe rolled back, dev DB clean).
Sixteen readers updated across both apps — `retailQueue`, four `productionController` detectors,
the queue's `has_design_images`, `designTeamController` JOB_SELECT, the TV wall spotlight,
`orderZoneClause`, the staff order page, PrepConsole's spec partition, DesignGallery and the
retail review board. `orderEditController` needed no change: its keyed reconciliation already
updates in place, so a plate survives an admin edit.

**Bug 5 — «إعادة التوليد».** Four defects, all fixed: no guard at all (now junk + instruction);
regenerating from `render_text` that is itself the instruction (the designer can now pass the
corrected name, and it is saved onto the plate); a single-name generation whose scale and framing
did not match the 10-name sheet the siblings came from (new `matchPlateGeometry` reframes onto the
exact geometry of the plate being replaced, measured from that file — 5 unit tests); and no cost
ceiling (`reroll_count` + a limit of 10, surfaced in the UI).

**Bug 6 — «يخصّني الآن» showed orders the queue could not.** New `lib/calligraphyText.js`
classifies text students wrote *to the shop* («نفس الصوره») before any money is spent, and
`getQueue` now returns the two populations it used to hide: `held` (refused, with the reason) and
`plated` (already carries a done plate — the 55 invisible orders). Held lines are actionable in
place: retype the name, or press «ولّد كما هو», which sets `reviewed: true`.

⚠️ **The classifier was calibrated against the live table, not invented.** A first draft flagged
**real** back-of-sash text — ﴿مَّن كَانَ يُرِيدُ ثَوَابَ الدُّنْيَا﴾, «الحمدلله هذا ماسعيت له»,
«الى عائلتي انتم حكاية نجاحي» — because «يريد» «هذا» and «الى» (which normalises to «الي») looked
like instruction words. Pointing words, «نفس», «مثل», «فقط» and third-person «يريد» were all
removed; the four instructions measured on prod are caught anyway because **every one of them
names a photo**. Final rate: **91 of 954** distinct strings (9.5%), each one eyeballed. All four
false positives are locked in as regression tests.

**Recovery:** `npm run photo-recovery` (read-only) lists the damaged lines and proposes upload
files by mtime, flagging the ones whose own text names a photo. It writes nothing and deletes
nothing — the timestamps are a hint, not an identification, and the owner confirms each match.

**Verified:** `node --test test/` **197/197** (185 baseline + 12 new), `tsc --noEmit` clean,
`eslint` clean, `next build` completes. Migration 080 applied to the dev DB and re-run to prove
idempotency (61 rows moved, identical on the second pass).

## 2026-08-10 — iOS 1.0.4 uploaded, APNs verified against Apple, both platforms at parity

Prod runs `11a7a43`, confirmed over SSH. CI green, all 3 PM2 processes online, site 200.

**Shipped today:**
- **iOS 1.0.4 (build 1786309948) is on App Store Connect** — «Complete», *Ready to Submit*. Two
  Codemagic bugs fixed, both of which produced successful-looking runs that failed later:
  `d9688a6` — the entitlement assertion used `plutil -extract`, which splits its keypath on `.`
  and cannot represent an array, so it failed on a **correct** file; `PlistBuddy` separates on `:`.
  `b68eb94` — nothing ever set `CFBundleShortVersionString`, so every build shipped as `1.0` while
  `agvtool new-version` only ever set the **build number**. Apple had approved a 1.0, which closes
  that train permanently. `MARKETING_VERSION = 1.0.4` is now written to the pbxproj build setting
  (not the plist — Capacitor's plist carries the literal `$(MARKETING_VERSION)` and would be
  overwritten at build time). Both fixes ship with assertions that fail the build rather than the
  upload. Verified on Linux without a Mac before pushing.
- **iOS push credentials are live and proven.** Key `72D98R3MFC`, Sandbox & Production, Team
  Scoped. `push.configured()` → `{"android":true,"ios":true}`. ⚠️ Apple's form defaults Environment
  to **Sandbox alone**, which would deliver nothing to any store build while looking correct.
  Proof beyond parsing: a send to a fake device token returned **`BadDeviceToken`**, which only
  happens *after* Apple authenticates the JWT — a bad key returns `403 InvalidProviderToken`.
- **`ios-appstore` merged into `main`** (`11a7a43`) and fast-forwarded, so the Codemagic pipeline
  is no longer stranded on a branch. The merge adds `@capacitor/ios` as a **dependency**, so all
  four CI gates were run locally first (audit clean, lockfile in sync, 0 lint errors, build
  completes) before the push that triggers the auto-deploy.
- **Credentials filed.** All four LoloShop keys moved from `~/Downloads` to
  `~/Desktop/_private/loloshop-credentials/` with a README naming each. The two `.p8`s were
  indistinguishable by content — `72D98R3MFC` is APNs, `WLABBTJQT2` is the **App Store Connect API
  key** Codemagic uploads with. ⚠️ A `.p8` downloads exactly once; deleting the wrong one would
  have broken uploads entirely.
- **Board correction:** iOS was recorded as "unshipped". ASC shows **iOS 1.0 Ready for
  Distribution** — approved, which is exactly what closed the 1.0 train.

**Not done:** no iOS device token exists until 1.0.4 is installed from TestFlight and the
notification prompt granted, so iOS push is proven only at the credential layer. Android 1.0.4 is
in production review with managed publishing ON — approval will **not** publish it. iOS 1.0.4 still
needs submitting in ASC.

## 2026-08-09 — Android tap→app is LIVE, everything deployed, join routing fixed

Everything from the 2026-08-08 cloud session reached `main` and then production. Prod runs
`2108443`, verified over SSH, not inferred from git.

**Shipped today:**
- **Deep links work on a real phone.** Android **v1.0.3 (versionCode 4)** built on the laptop and
  published to the Play **internal testing** track; the owner tapped a WhatsApp `/join/` link and
  it opened the app. Both `.well-known` manifests serve **200 / `application/json` / 0 redirects**
  on the apex *and* `www` — which also closes the long-standing `www` landmine.
- **The two env vars are set** in prod `frontend/.env.local` (⚠️ not `.env` — that file does not
  exist on the box): the Play **App signing** fingerprint and `IOS_TEAM_ID=9YY4QWVDUW`, read off
  the consoles directly. Read at request time, so a `pm2 restart --update-env` sufficed.
- **Migration 077 applied to prod** while no push credentials existed — the safest possible moment,
  because its backfill retired **3,311** historical notifications to `skipped`. That is 3,311 push
  messages that would otherwise have hit real phones the instant credentials land.
- **CI deploy gate unblocked twice.** `25c3c4c` failed `npm audit` in 32s (nanoid high +
  dompurify moderate via jspdf, both newly published against already-installed packages), so
  `scripts/deploy.sh` never ran. Fixed by bumping our own `overrides` pin to dompurify 3.4.13.
  *(Noted: `jspdf` is a declared dependency with zero imports — dropping it removes this chain.)*
- **`ios-appstore` prepared** (`eb59e21`): merged `main`, reconciled the desynced lockfile, applied
  the codemagic push-capability patch. Owner enabled Associated Domains + Push on the App ID.
- **Join routing fix.** A rep-linked student now lands on `/my-order` directly instead of bouncing
  off the storefront. ⚠️ **The bounce already worked** — `StudentHome`/`CatalogBrowser` redirect on
  `audience==="wholesaler_student"`, which `priceRoleForUser` derives from `wholesaler_id` alone,
  status included. The real defect was that the check runs client-side after paint, so a waiting
  student saw a flash of a shop they cannot buy from and stayed there if that fetch failed.
  Scoped to `pending_approval` + `rejected` (**29** of 994 rep-linked students); the **965**
  approved keep their existing landing page.

Gates: **185/185** backend tests against the dev DB with 077 applied · `tsc` 0 · `eslint` 0 errors
· `next build` exit 0 · prod backup `loloshop-prod-2026-08-09_2143.dump` (3.1 MB, 63 tables)
verified with `pg_restore -l`.

**Not done:** Android push (no `google-services.json`, so 1.0.3 shipped without it and needs a
**second** binary) · iOS build not started · Android not promoted to production · GPS mode still
`none`.

---

## 2026-08-08 — Push notifications, and the eight open review findings

**Branch `claude/handoff-cloud-board-tasks-v342hb`** (off `feat/deeplinks-and-location`).
**Migration `077_push_notifications.sql` — pending, not yet applied.**
Gates: `tsc` 0 · `eslint` 0 · `next build` exit 0 · backend syntax check clean ·
`node --test test/push.test.js test/joinRouteOrder.test.js test/memoCache.test.js` **13/13**
(the DB-backed suites were not runnable — this sandbox has no PostgreSQL).

Closes both items on the HANDOFF cloud board. The third ship-queue blocker — push — was the only
one with no code at all; it now has everything a cloud session can build, and stops at the two
things that need a browser session in a console (a Firebase project and an APNs key).

### 1 — Push notifications (the last unbuilt blocker)

**What shipped as "notifications" before this:** rows in the `notifications` table, rendered
in-app. A rep whose student joined at 11pm found out the next time they happened to open the
app; a closed phone learned nothing at all.

- **`notifications` IS the queue.** New `push_state` / `pushed_at` columns plus
  `backend/lib/pushOutbox.js`, which claims committed rows and delivers them. Chosen over a send
  call at each site because there are **thirteen** `INSERT INTO notifications` and several run
  inside `tx()` — sending from in there pushes work that may still roll back, and sending after
  means threading a return value through every caller. **No call site changed**, so no future
  insert can forget to push.
- **⚠️ Two independent flood guards, and both are load-bearing.** `push_state` defaults to
  `'pending'`, so the migration retires every pre-existing row to `'skipped'`, **and** the drain
  only ever looks at the last 15 minutes. Either one alone is a single line away from replaying
  the shop's entire notification history onto real phones. The backfill is repeated in
  `db/schema.sql` because that file is what `npm run migrate` applies, to a database that
  already holds every notification ever written.
- **Zero new npm dependencies, and that is a deploy requirement.** `ci.yml:22` runs
  `npm audit --omit=dev --audit-level=moderate` and the deploy job needs it green, so a package
  that picks up a moderate advisory stops the **site** shipping, not just this feature.
  `firebase-admin` would put ~40 transitive packages permanently inside that gate to do two
  things Node already does: sign a JWT and make an HTTP/2 request. `backend/lib/push.js`
  implements FCM HTTP v1 and APNs HTTP/2 on `crypto` + `http2` + `fetch`.
- **iOS talks to Apple directly, not through Firebase.** Routing iOS through FCM needs the
  Firebase iOS SDK *inside the app*, and the iOS project is regenerated from Capacitor's
  template on every Codemagic run — the same trap that already forces the privacy strings and
  the entitlement to be re-injected each build. Straight APNs needs nothing in the app: the
  plugin's stock token IS the APNs token and the `.p8` lives only on the server. So **the
  Firebase project is Android-only**, and the `.p8` goes in the backend `.env`.
- **⚠️ `POST_NOTIFICATIONS` added to `AndroidManifest.xml`.** The plugin does **not** declare it
  — it names it only in a Capacitor `@Permission` annotation, which is a runtime concept; its
  own manifest carries just the messaging service. Verified by reading both files in
  `node_modules`. Android denies a runtime request for an undeclared permission **without
  showing a dialog**, so without this line `requestPermissions()` resolves `'denied'` instantly
  on every modern phone and nothing anywhere says why — the identical silent failure the two
  location permissions were added to fix. It is compiled into the AAB, so missing it costs a
  whole extra store release.
- **`npx cap update android` run**, so `capacitor.settings.gradle` and `capacitor.build.gradle`
  now include `capacitor-push-notifications`. They are generated files; the plugin was in
  `package.json` but had never been synced, so a build would have shipped without it.
  `app/build.gradle` already applies the google-services plugin only when `google-services.json`
  exists, so the build still succeeds without the owner's file — silently producing an app that
  can never register, which is why that is spelled out in the manifest comment.
- **`POST /api/notifications/devices`** (upsert) and **`/devices/unregister`**. ⚠️ The upsert
  conflicts on **`token`**, not `(user_id, token)`: phones here are shared and resold and the
  provider hands the same token to whoever signs in next, so the device **moves** to its new
  owner instead of leaving the previous account subscribed. `logout()` unregisters **before**
  clearing the JWT, passing the token explicitly — axios' interceptor reads localStorage in a
  microtask, by which time it is gone.
- **Frontend:** `lib/push.ts`, `components/PushRegistrar.tsx` (root layout), both dynamically
  imported so axios stays out of the root chunk. The permission is asked **after login only** —
  iOS shows that sheet once per install, and spending it on a browsing student burns it, since
  a «رفض» can only be undone in system Settings. Foreground arrivals become a sonner toast
  (Android draws no system notification while the app is foregrounded); taps navigate, and the
  `link` is validated as a same-origin path because it round-trips through FCM/APNs.
- **Device rows are deleted on one signal only** — an explicit provider verdict (FCM 404/403,
  APNs 410/BadDeviceToken). Never on a timeout or a 5xx, which would quietly unsubscribe every
  phone in the shop during a provider outage.
- **iOS `aps-environment`** is prepared as `docs/patches/codemagic-ios-push-capability.patch`,
  because `codemagic.yaml` exists **only** on `ios-appstore` and creating it here would be an
  add/add conflict on the day that branch merges. Verified `git apply --check` clean against
  `f1785c0`. See `docs/patches/README.md`.

### 2 — The eight review findings

- **Native detection unified.** New `frontend/lib/native-shell.ts` is the one implementation of
  the two-signal test. `DeepLinkHandler.tsx` tested `window.Capacitor` alone while its comment
  claimed parity with the gate; both now import the same function. **The underlying hole is
  documented, not fixed, and that is a decision:** on Android WebView <105 there is no Capacitor
  runtime at all, so `AppWeb.getLaunchUrl()` returns `''` and an App Link opens the app with the
  code already lost. Nothing in JS recovers it — reading the launch intent needs the very bridge
  that is missing. WebView 105 shipped in Aug 2022 and updates through Play, so the affected
  phones are largely ones that cannot install from Play either. The real fix is a native change
  in `MainActivity` that no cloud session can compile or test.
- **Route order is now pinned** — `backend/test/joinRouteOrder.test.js`, 3 tests, no database
  (`lib/db` and the controller are stubbed in `require.cache`). The third test builds a
  deliberately mis-ordered router and asserts `/representatives` really is swallowed, so the
  other two cannot pass for unrelated reasons.
- **`join:` caches are invalidated** on rep create / update / deadline / delete
  (`adminController.invalidateJoinCaches`). An admin creating a rep in front of the owner used
  to watch it not appear for five minutes. The prefix clears `join:<code>` too, deliberately —
  a deadline edit changes the referral page a student reads.
- **The shared limiter is split.** `directoryLimit` 300/15min and `lookupLimit` 200/15min are
  now separate, and both were raised: Iraqi carriers CGNAT, so one IP is routinely a whole
  cohort. The enumeration defence the old 60 was tuned for is already spent —
  `/representatives` publishes every code in one response. **`joinLimit` (10/hour/IP) was left
  alone**: it is the deliberate bound on approval-queue spam recorded on 2026-08-07, and
  changing it is an owner call. It has the same CGNAT exposure — flagged in HANDOFF.
- **`/join` tells a network failure apart from an empty directory.** `getJoinRepresentatives`
  now throws instead of resolving `[]`, and the page has a real error state with a retry button.
  The old behaviour told a student on a flaky connection «لا توجد قائمة ممثلين» — read as "your
  rep is not registered" — on the exact screen that exists because they already lost their link.
- **Dead code removed** — the `?referrer=join_<code>` branch in `app-gate.ts`, unreachable since
  `/join` was allowlisted. What it was for, and when to restore it, is recorded in its place.
- **Stale comments corrected** — `app-gate.ts` no longer says `/s /w /d` must open in a browser
  (the manifest now claims them), and the spec's «two dropdowns» acceptance line now matches the
  shipped grouped `<select>`.
- **The codemagic sharp edge is fixed** in the patch above: the injection is idempotent and
  ignores foreign targets instead of bailing out with a mystery failure.

**Open — owner actions, unchanged in order:**
1. Firebase project → `google-services.json` → commit to `frontend/android/app/`.
2. APNs `.p8` → `APNS_KEY_FILE` + `APNS_KEY_ID` + `APNS_TEAM_ID` in the prod `.env`.
3. Enable **Push Notifications** on the App ID (alongside Associated Domains).
4. Apply the patch to `ios-appstore` before the next Codemagic run.
5. Run `npm run migrate` (or `npm run migrate:file db/migrations/077_push_notifications.sql`).
6. Declare notifications on the Play Data Safety form and the Apple privacy label.

---

## 2026-08-07 — «ادخل مع ممثلك», team portals as deep links, and the iOS pipeline

**Branch `feat/deeplinks-and-location`** (+ `codemagic.yaml` on `ios-appstore`). No migration.
Spec: `docs/superpowers/specs/2026-08-07-app-entry-deeplinks-gps.md`.
Gates: backend **177/177** · `tsc` 0 · `eslint` 0 errors · `next build` exit 0 · endpoint and
both well-known routes curl-verified against real servers.

**The question this answers:** «can a rep's students and the team get into the app without the
website?» — with the website reduced to admin + a download landing page.

- **Split by what needs a store review.** The binaries are WebView shells on the live site, so
  HTML/JS/API changes reach installed apps on deploy; only `AndroidManifest.xml` and the iOS
  entitlements need a new binary. Everything below is sorted by that line.

**Ships on deploy — no store, no review:**
- **`GET /api/join/representatives`** — public directory of approved reps (جامعة · قسم · code),
  5-min cached. ⚠️ Registered **above** `/:code`; Express 5 matches in order and the param route
  would swallow it.
- **`/join` — «ادخل مع ممثلك»**, linked from `/login`. Recovery for a student whose rep link is
  buried in WhatsApp. `referral_code` is an admin-typed Latin slug, so typing it is not an
  option, and iOS has no deferred deep linking, so "install and it remembers" is not either.
- **⚠️ Built as جامعة→قسم first; the live data killed it.** `university_name` is admin free text
  and the 12 real rows spell one university three ways («بلاد الرافدين» · «بلاد الرفدين» ·
  «كلية بلاد الرافدين»; same for «جامعة ديالى» · «ديالى» · «جامعة ديالى كلية العلوم»). Two
  dependent dropdowns dead-end anyone picking the wrong spelling — empty قسم list, no error,
  student concludes their rep isn't registered. Now **one `<select>` grouped by `<optgroup>`**,
  so a mis-spelled twin is visible instead of hidden. **The 12 rows still want cleaning.**
- **`/join` allowlisted in `BROWSER_ALLOWED_PREFIXES`** — a correctness fix, not a nicety.
  Without it, flipping `NEXT_PUBLIC_APP_ONLY=1` replaces every referral tap with the store and
  **nothing carries the code through the install**: Play's `?referrer=` has no reader on our
  side and iOS has no equivalent. Costs nothing — once App Links verify, Android intercepts
  `/join/*` before the browser loads it.
- **`/get-app`** now states the only instruction that works on both platforms: tap the link
  again after installing.

**Needs one new binary per store (batched with the location permission):**
- **Deep links extended to `/s/`, `/w/`, `/d/`** — manifest, AASA and `DeepLinkHandler` all
  claim the same four prefixes. These portals are the **only** way in for staff, workshop and
  design-team members with no phone for the WhatsApp OTP, and they went browser-only when
  `TeamKeyEntry` was deleted on 2026-08-06. This puts that entrance back inside the app.
- **`codemagic.yaml` (`ios-appstore`)** — `NSLocationWhenInUseUsageDescription` added to the
  existing `plutil` step and its fail-loud check, plus a new step that writes
  `App.entitlements` (`com.apple.developer.associated-domains`) and wires
  `CODE_SIGN_ENTITLEMENTS` into `project.pbxproj`. Both re-injected **after `cap sync`**,
  because `npx cap add ios` regenerates `ios/` every run and wipes committed edits — the same
  trap the camera-crash fix already documents. Dry-run against a fake project: wired into
  exactly the 2 App-target configs, left a plugin target with a different bundle id untouched,
  and exits 1 when the template shape changes.

**Open — owner actions, in this order:**
1. **⚠️ Enter the shop coordinates.** `staff_attendance_settings.shop_latitude/longitude` are
   NULL; setting `verification_mode` to `location`/`both` first **403s every بصمة for every
   worker on every platform**.
2. **⚠️ Enable "Associated Domains" on the App ID** before the next Codemagic run, or
   `fetch-signing-files` builds a profile without it and the build dies at signing.
3. `ANDROID_SHA256_CERT_FINGERPRINTS` (Play **App signing** key, not the upload keystore) and
   `IOS_TEAM_ID` on the VPS.
4. Play Data Safety + Apple privacy label: declare location.
5. Clean the 12 wholesaler `university_name` rows.
6. Verify on a real phone before flipping either flag — App Links fail **soft**, so a wrong
   fingerprint is invisible: `adb shell pm get-app-links com.loloshop96.app`.

**Accepted tradeoff:** the rep directory is public and unauthenticated, so the university list
is disclosed and a rep's approval queue can be spammed without the link leaking. Bounded by
`joinLimit` (10/h/IP) and the unique-phone check, and joining still grants nothing until the rep
approves. Note the codes are already 1–3 characters (`g`, `tr`, `ml`), so they were trivially
enumerable long before this endpoint existed.

---

## 2026-08-06 — Deep links for `/join/*`, and the location permission the app never had

**Branch `feat/deeplinks-and-location`. No migration.**
Gates: `tsc` 0 · `eslint` 0 · `next build` exit 0 · both well-known routes curl-verified against
a real `next start`.

- **The problem, stated properly.** The shells are remote-URL WebViews (`capacitor.config.ts`
  → `server.url`) with **no address bar**, and nothing in the app links to `/join/*`. So a
  wholesaler's referral link was **browser-only**: `AndroidManifest.xml` had only
  `MAIN`/`LAUNCHER` — no `VIEW`/`BROWSABLE` — and no `.well-known` file existed for iOS.
  An installed student had no path to their code at all.
- **Android:** added an `autoVerify` App Links intent-filter claiming `https://lolo-shop96.com`
  and `www.` at **`pathPrefix="/join/"` only** (per the 2026-07-31 spec — a wildcard would make
  the app hijack every shared product link).
- **iOS:** added `app/.well-known/apple-app-site-association/route.ts`, extensionless and
  `application/json`, emitting both the iOS 13+ `appIDs`/`components` form and the legacy
  `appID`/`paths` form. Driven by a new `IOS_TEAM_ID` env var.
- **`DeepLinkHandler.tsx`** handles **both** arrival paths — `appUrlOpen` (warm) *and*
  `App.getLaunchUrl()` (cold start, where no event ever fires). Handling only the listener is
  the classic half-working deep link: fine while you test with the app open, broken for every
  student tapping from WhatsApp. Host + path allowlisted again in JS, independently of the
  manifest. Dynamic-imports `@capacitor/app` so browsers never fetch it.
- **Hardened the pre-existing `assetlinks.json` route**, which accepted any non-empty string.
  It now normalises case/colons and **drops anything that is not 64 hex chars**, so a pasted
  SHA-1 or a truncated copy fails loudly instead of serving a document that looks right and
  never verifies. Verified: a junk `DE:AD:BE:EF` entry is dropped, a lowercase unseparated
  fingerprint is normalised to `AA:BB:…`.
- **`ACCESS_FINE_LOCATION` + `ACCESS_COARSE_LOCATION` added to the manifest.** Staff بصمة calls
  the *web* `navigator.geolocation` (`lib/staff.ts:1377`); Capacitor's bridge already prompts
  for these two (`BridgeWebChromeClient:246`), but **Android denies a runtime request for an
  undeclared permission without showing a dialog** — so `getCurrentPosition` always hit its
  error path and check-in posted `location: null`. Silent, because `verification_mode` is
  `'none'` and the backend then marks it verified anyway. This is why a **new binary** was
  unavoidable: `<uses-permission>` compiles into the AAB and the remote-URL trick cannot ship it.

⚠️ **Order of operations for GPS — getting it wrong locks every staff member out.** Ship the
binary → wait for phones to update → set `shop_latitude`/`shop_longitude` in `/admin` → *only
then* move `verification_mode` off `'none'`. Flipping it first makes `locationOk` false for
everyone, and `attendanceController.js:532` + `:619` answer that with a hard
**403 `ERR_ATTENDANCE_LOCATION`**.

Open / owner actions:
- `ANDROID_SHA256_CERT_FINGERPRINTS` on the VPS — from Play Console → **App integrity → App
  signing key certificate**, *not* the upload keystore. Unset today, so the route 404s.
- `IOS_TEAM_ID` on the VPS. Unset = that route 404s and iOS deep links stay off.
- **Enable "Associated Domains" on the App ID** in the Apple Developer portal *before* the next
  Codemagic run, or signing fails with a missing-entitlement error.
- Update the Play **Data Safety** form (location is now collected).
- `codemagic.yaml` on `ios-appstore` still needs the entitlement +
  `NSLocationWhenInUseUsageDescription` injection step.
- Neither half is smoke-tested on a real device yet — App Links fail *soft* (the link just opens
  in the browser), so a wrong fingerprint is invisible. Check with
  `adb shell pm get-app-links com.loloshop96.app`.

## 2026-08-05 (e) — التجهيز cards show the garment, not just the stitching

**Committed to `feat/ssr-storefront-native-auth`. No migration.**
Gates: **backend 177/177** (+10) · `tsc` 0 · `eslint` 0 errors · `next build` exit 0.

- **Closed the prep-queue data gap.** The زone detector was NOT touched — 325 of 326 cards said
  «لا تطريز على هذه القطعة» *correctly*, because the queue is robes and zones are a sash/cap thing.
  The console now also answers the preparer's real question: **لون/قماش/فصال الروب · الشكل · لون
  القبعة**, the student's free-text lines («كسرة الكتف» — the single most common line in the whole
  queue at 225) and **قياسات الروب** with ملاحظات الفصال and صورة الوصل.
- **Why the data was invisible:** a spec line carries no `customer_text` and no `customer_image_url`
  — it is a *choice*, not content — and every existing code path filtered on content. Same table,
  opposite filter. `buildPieceSpec` partitions the lines and is pure, so the rules are unit-tested
  against labels measured off the live queue.
- **Measured by driving the real `getQueue` with a real preparer over the real 435-row queue:**
  rows with something to show **3 → 416 (95.6%)**, measurements **0 → 281**, empty cards **432 → 19**.
  All 19 remaining empties are correct — American shawls whose only line is «السعر الأساسي», because
  the product name (*شال امريكي 10*) already is the spec.
- `measurements` is gated in SQL, not JS, so it never rides on the other stations' ~480-row payloads.
  `chest_cm` is 0 on every live order, so 0 renders as absent. `RobeMeasurements` was extracted from
  an inline type so the order detail and the queue row cannot drift.
- `PieceSpec` uses flex rows, not `grid-cols-subgrid` — old Android WebViews in the workshop.

Open:
- Browser smoke test of the prep console — the payload is verified end to end, the UI is not clicked.
- ⚠️ The `postgres` MCP server points at a DIFFERENT project's DB (a digital-goods store). All
  measurements above came from LoloShop's own DB via `backend/lib/db.js`.

## 2026-08-05 — التجهيز prep console · scroll restore · touch-first buttons · account screen

**Committed to `feat/ssr-storefront-native-auth`. No migration.**
Gates: **backend 167/167** · `tsc` 0 · `eslint` 0 errors · `next build` exit 0.

- **قائمة التجهيز is now its own console** (`components/staff/prep/PrepConsole.tsx`), reusing the
  embroiderer's `StudentSheet` verbatim per the owner's «مثله مثل واجهة عامل التطريز». The preparer
  was packing **blind** — their old queue was a flat `OrderCard` grid with no artwork, and رف التجهيز
  has no `<img>` either, so verifying a set meant opening every piece's detail page.
- **Zones are read-only at التجهيز.** The stitching is finished by the time a piece arrives, and the
  backend exposes no zone-tick endpoint for `preparing`, so the preparer reads the artwork to verify
  and never ticks it. One detector (`detectZonesForOrders`) still serves both stations.
- **Two defects found reviewing the batch before commit, both fixed here:**
  - The **«جاهزة للتسليم» tab claimed «لا تطريز على هذه القطعة» on every packed piece.** The backend
    attached zones only for `embroidery`/`preparing`, and the sheet cannot tell *"no artwork"* from
    *"artwork never fetched"* — so an absent list rendered as a statement of fact on pieces that are
    demonstrably embroidered. `ready` joined `ZONE_STAGES` (no extra round-trip — the detector is one
    `order_id = ANY($1)` query), and `PrepConsole`/`StudentSheet` stopped collapsing `null` into `[]`
    so the distinction survives the mapper.
  - That same tab then read **«لا يمكن إكمال هذه القطعة من هنا حالياً»** on every row — true (تأكيد
    التسليم needs a delivery method, so it lives on the detail page) but a dead end. Now points at
    «التفاصيل», via a `noActionHint` prop supplied by the only caller that can tell the tabs apart.
- **Scroll position survives back-navigation** (`hooks/useScrollRestore.ts`) on staff home, queue,
  shelf, station and prep. Next's built-in restoration does not cover this: the staff screens navigate
  in and out with `<Link>` pushes, and a push always lands at the top. The save is frozen on click —
  without that, leaving the page scrolls to 0, that fires a `scroll` event, and the good offset is
  overwritten with 0 (measured; the first version of the hook was broken exactly this way).
- **Buttons work on touch.** Every bit of the CTA's character lived behind `:hover` — invisible on the
  phones students and reps actually use. `.btn-press` scales under the thumb, `.btn-shine` fires its
  sheen on `:active`, all transform/shadow only, all collapsing under `prefers-reduced-motion`.
- **Zone thumbnails go through the optimizer** (`ZoneThumb`): a raw `<img>` was pulling the full 4–6 MB
  upload for a 44 px box, ~25 MB per student with five zones, uncacheable (`no-store`) over workshop
  wifi. A broken URL now renders an explicit «؟» marker — never as "this zone has no artwork".
- **`unoptimized` removed from the 8 staff order-detail images**; the lightbox moved to `next/image`.
- **حسابي rebuilt**: graduate-figure avatar tied to the onboarding gender answer, destination rows
  instead of two ghost pills, and a real signed-out screen instead of a login wall. «تفضيلاتي» now
  *shows* an answered gender as a settled summary with «تغيير» rather than re-asking the question.
- **`turbopack.root` removed from `next.config.ts`** — it silences a cosmetic warning and breaks
  `next dev` (`/` 500s on the React Client Manifest). The header comment now says so at length.
- **Docs:** `HANDOFF.md` 665 → ~180 lines, `PLAN.md` 337 → ~80; history moved verbatim into
  `docs/HANDOFF-archive.md` and the new `docs/PLAN-archive.md`.

Open:
- Browser smoke test of the prep console against the real queue (326 students / 429 pieces) —
  not run this session.
- The prep-queue **data** gap is untouched: robe colour/fabric/cut, shape, cap colour and
  `measurements` are in the DB and still unrendered. See `HANDOFF.md`.

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
