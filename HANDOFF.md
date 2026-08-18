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

## 📍 WHERE THE TREE IS — 2026-08-16

Verified against git and against BOTH boxes over SSH this session. Store/push rows below were
last verified 2026-08-10 and are unchanged.

| | |
|---|---|
| **Server** | 🚚 **MOVED to `169.58.114.255` (8 GB, shared with RevoArt) on 2026-08-16.** Fronted by RevoArt's `supabase-caddy`, not nginx. Old 2 GB box `142.93.110.202` is stopped-API + forwarder = the rollback. Full detail in the 2026-08-16 PROGRESS entry. |
| `origin/main` | `f021152` — pushed 2026-08-16, CI green on all three jobs, **auto-deployed to the NEW box** and verified live (assistant answered end-to-end) |
| Eleven-bug tracks | **ALL ELEVEN CLOSED IN CODE.** Deployed: 2·3 (C) · 9·10·11 (A) · 4·5·6 (B) · **7** · **8 part 1**. On `fix/admin-presence-panel`, **unmerged**: **bug 1** + **bug 8 parts 2·3·4**. *(This row said «1, 7, 8 NOT started» until 2026-08-15; 7 and 8-part-1 shipped on 2026-08-14.)* |
| Migration 077 | ✅ applied to prod AND the dev DB — 3,311 prod rows retired to `skipped` |
| Migration 080 | ✅ **applied to prod 2026-08-14** — 459 plates moved to their own column, **0** left in `customer_image_url`, 1,885 student photos intact |
| Migration 078 | ⚠️ **applied to the DEV DB only** — the AI assistant's `ai_chat_messages`. It is in `db/schema.sql` too, so the next prod `npm run migrate` creates it. **Run it in the same deploy as the code:** until the table exists the cap check throws and both assistant endpoints 500 (the rest of the site is unaffected — nothing else reads that table). |
| Android | **v1.0.4 (versionCode 5) IN PRODUCTION REVIEW** — deep links + GPS + push in one review |
| iOS | **1.0.4 (build 1786309948) SUBMITTED — «Waiting for Review»** (2026-08-10, ≤48h) |
| Android push | ✅ working end to end |
| iOS push | ✅ **APNs key installed and verified against Apple** — `push.configured()` → `{"android":true,"ios":true}` |
| Backend tests | **266/266 on `main`** · **275/275 on `fix/admin-presence-panel`** (9 new). ⚠️ Run from `backend/`, `node --test test/` — from the repo root dotenv misses `.env` and 147 fail for nothing. |
| Prod DB backup | ✅ `~/Desktop/_private/loloshop-db/loloshop-prod-2026-08-14.dump` — restore-tested, row counts match live |

**Both platforms are now on the same version (1.0.4) carrying the same three features.**

⚠️ **Neither store build has been opened on a real phone yet.** Android 1.0.4 is in review;
iOS 1.0.4 is installable from TestFlight *now* (internal group «Testers1», no review needed).
Until someone installs it and grants the notification prompt there are **zero iOS device
tokens**, so iOS push is proven only at the credential layer, not end to end.

**Prod VPS is `169.58.114.255` since 2026-08-16** — the 8 GB box, which LoloShop now SHARES
with **RevoArt**. ⚠️ That means the `revo` host in `~/.ssh/config` is the same machine, not a
different project as this file said for months; RevoArt's Supabase stack and its `supabase-caddy`
(which owns :80/:443 and fronts LoloShop) live there too, so a careless `docker`, `ufw` or
Caddyfile change hits a second production site. **`142.93.110.202` is the OLD box**: its API and
worker are stopped and its nginx now only FORWARDS to the new box for stale DNS. It is the
rollback — leave it alone.
⚠️ The prod frontend has **no `.env`** — it reads **`.env.local`**; server-only vars
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

**Prod VPS is `169.58.114.255` since 2026-08-16** — the 8 GB box, which LoloShop now SHARES
with **RevoArt**. ⚠️ That means the `revo` host in `~/.ssh/config` is the same machine, not a
different project as this file said for months; RevoArt's Supabase stack and its `supabase-caddy`
(which owns :80/:443 and fronts LoloShop) live there too, so a careless `docker`, `ufw` or
Caddyfile change hits a second production site. **`142.93.110.202` is the OLD box**: its API and
worker are stopped and its nginx now only FORWARDS to the new box for stale DNS. It is the
rollback — leave it alone.
⚠️ The prod frontend has **no `.env`** — it reads **`.env.local`**; server-only vars
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
   credentials exist, so the order of these two is safe either way. The same `npm run migrate`
   also creates **078**'s `ai_chat_messages` — the AI assistant's ledger *and* rate limiter, so
   its endpoints 500 until the table exists.
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

✅ **CLOSED 2026-08-18 on `fix/calligraphy-cost` (unmerged) — the reroll geometry ratchet.**
The column this entry asked for exists (**migration 082** — 081 was taken by counter_signup):
`calligraphy_plates.original_plate_path` pins the FIRST generated plate as the permanent
geometry anchor, the engine stamps it on first generation, and `reroll` matches against it
instead of the plate it is overwriting, so ink height no longer shrinks across presses.
Covered behaviourally in `test/calligraphyCost.test.js` (a degraded 20px plate with a 40px
original rerolls back to 40px). The description below stays because it explains the anchor:
the OLD behaviour anchored reroll N+1 on reroll N's output (`fit:'inside'` never recovering
height — 700×140 → 1024×**73** → 365×**73** → **73**), which is why the anchor must be the
original and never the current artwork. The same branch carries the other three cost fixes —
see the 2026-08-18 (b) PROGRESS entry.

✅ **CLOSED — `orderController.configureOrder` / `configureFullSet` no longer share this shape.**
This entry described two stacked defects and both are now fixed:
· The plate-loss half (DELETE + re-INSERT `order_items` never carrying `plate_image_url`) was
  closed 2026-08-14 on commit `465b2ef`, deployed the same day (see the 2026-08-14 (d) PROGRESS
  entry) — `lib/platePreservation.js` (`capturePlates`/`plateFor`) applies the same pattern
  `lib/fullSetOrder.js` uses, and `plateSurvivesReconfigure.test.js` guards it structurally so a
  future rebuild path can't reintroduce it silently. This HANDOFF entry was not updated when that
  commit landed — it stayed stale for a day; if you find this warning quoted anywhere else, it is
  equally stale.
· The status-guard half was real and separate: `configurePackage`/`configureFullSet` already
  filtered their "find the existing order" query with `AND status <> 'cancelled'` (matching
  `uq_orders_student_product_nodesign`'s own partial-index definition), but `configureOrder`'s
  equivalent query had no such filter and no `ORDER BY`/`LIMIT` — a cancelled order for the same
  product could be the only match and get silently revived instead of a fresh order being created.
  Fixed on `fix/plate-loss-guard` (branched 2026-08-15): added the identical `status <>
  'cancelled'` guard to both branches of `configureOrder`'s existing-order lookup. Covered by
  `test/orderControllerPlateAndStatusGuard.test.js`, which drives the real `configureOrder` /
  `configureFullSet` functions against the DB (plate + customer-photo survival, plus a red/green
  check that reverting the guard resurrects a cancelled order).

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
- **The «لبسوا تصاميمنا» caption** — a one-string change in `CohortProof.tsx`.
  *(Dropped 2026-08-15: «Unit vocabulary pass 2» — bug 7 closed it on 2026-08-14.)*

**2. Then: make the app phone-test-ready.** The remaining gates are a real device and the store
consoles — neither can be done from a cloud sandbox.

**Explicitly NOT cloud work:** do **not** add an Android CI workflow. Owner decided 2026-08-08 to
keep building the AAB by hand on the laptop; the keystore stays local and off GitHub.

---

## 🤖 THE ASSISTANT — 2026-08-12 (b), on branch `ai-assistant`

**Owner reframe: «لولو» is the shop's MAIN MARKETING CONTENT, not a support widget.** Everything
below follows from that, plus the owner's instruction to stop limiting individual users and
protect against attackers instead.

**The per-person daily quota is GONE.** It was keyed on an identity the CLIENT chose, so
rotating it cost nothing — measured, 25 requests with 25 fresh keys were all granted. It bounded
honest students and nobody else, and «وصلت للحد اليومي» is the worst sentence a marketing
surface can say. Five layers replace it, outermost first:

1. **Per-IP volume** (`routes/assistant.js`, 100 asks / 15 min) — unchanged.
2. **A server-SIGNED identity** (`lib/anonSession.js`, HMAC on `JWT_SECRET`, zero new deps).
   This also closed a real hole: `recentTurns` keys anonymous history on that id, so a
   client-chosen one meant supplying somebody else's id loaded THEIR last two hours into your
   prompt. Minting is limited to **300/hour/IP** — deliberately generous, see the landmine below.
3. **A burst throttle** (10/min, 40/5min) instead of a quota — "are you a person", not "how much
   have you had today". Fires at the 11th message; verified live.
4. **The daily USD ceiling**, $1 → **$3**, with a **new warning at $1** that writes an admin
   `notifications` row — which the push outbox turns into a phone push for free. Anonymous
   traffic keeps its own slice ($1.2) so strangers cannot switch the assistant off for students.
5. **`lib/answerGuard.js` — nothing wrong leaves, whatever the model was talked into.**

**The guard is the real answer to prompt injection.** It does not screen the question (whack-a-
mole); it asserts properties every legitimate answer has: no IQD figure absent from the price
book we handed the model, no delivery promise, no English. Four live injection attempts held.
**It immediately found a real defect the 44-scenario harness was scoring as PASSING** — the model
answering «آخر موعد لتقديم الطلبات هو 2026-05-26، **وهذا موعد تسليم الطلب**», stating flatly that
the order cutoff IS the delivery date. Every pattern in the guard *and* in the harness expected a
future-tense promise («راح يوصل»); this is a present-tense equation. Now caught as
`DEADLINE_AS_DELIVERY`, negation-aware so the correct denial still passes, and **the harness now
calls the runtime guard** so the two can never disagree again.

**Never dark** (`lib/supportFallback.js`): the shop's most common questions — prices, delivery,
payment, location, how to order — are answered from the price book with **no model at all** when
the model is unreachable or the budget is spent. Verified by pointing `AI_CHAT_MODEL` at a bogus
model: four of five questions still answered, the fifth got a WhatsApp escalation.

**UX:** the mascot's 7 expressions cut from the owner's brand sheet, registered so the head does
not jump between them, driven by a server-chosen emotion · answers end in server-chosen action
chips from a closed list (the model never emits a URL) · word-by-word reveal (NOT streaming —
streaming would publish text before the guard sees it) · thread persists 2h, matching the
server's own window · **the dead retry button is fixed** — a throttle now counts down instead of
offering a retry that cannot work · the input no longer disables while busy, which was dismissing
the Android keyboard mid-conversation.

**Verified:** 243/243 unit tests (was 215) · 44/44 scenarios · tsc + lint + `next build` clean ·
driven in a real browser end to end.

⚠️ **Not verified: a real phone viewport.** Chrome refused to resize the maximized ultrawide
window, so every browser check ran at 3440px. The phone-only audience means this still needs one
pass at ~390px — the panel sheet, the chip rows and the 132px mascot are what to look at.

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

0. **🛡️ PUT CLOUDFLARE IN FRONT OF THE VPS — ~20 min in a browser, free tier.** Decided
   2026-08-12. Nothing in the app is DDoS protection: `express-rate-limit` runs *after* traffic
   has already reached the origin and consumed its bandwidth and event loop. ⚠️ Re-scope this:
   the origin is now `169.58.114.255`, which also serves RevoArt — an unmitigated flood there
   takes down two products, not one. The assistant
   raised the stakes because it is now the home page's headline feature. Proxy `lolo-shop96.com`
   and `www` through Cloudflare (orange cloud), keep the origin cert, and leave the app limits
   exactly as they are — they bound COST, Cloudflare bounds VOLUME. ⚠️ Check
   `/.well-known/assetlinks.json` still serves **200, `application/json`, zero redirects** on
   both hosts afterwards, or Android deep links break silently (see the cleared landmine below).
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

- **🔓 THE OTP BYPASS IS ON INDEFINITELY — `OTP_DEGRADED_UNTIL=always` (set 2026-08-17).**
  Owner asked for a bypass with no clock. Retail + wholesaler now log in on **password alone**;
  bcrypt still runs, no trusted-device token is issued, `phone_verified` stays false, and
  **password reset is unaffected** (it never used this flag). Nothing expires it — turning it
  back on is editing that one line in the prod backend `.env` + `pm2 restart loloshop-api
  --update-env`. **Two things to fix so it can be turned off:**
  1. **Reconnect the Zentramsg device** — the live error is `201 Device is not connected. Please
     scan QR code first`, i.e. the WhatsApp Web session dropped, *not* a Meta ban. It needs a QR
     rescan in the Zentramsg dashboard. It flaps: delivery was 43% (9/21) on 2026-08-17 vs 90%+
     earlier in the month.
  2. **Configure the official WhatsApp Cloud API** — `lib/whatsappCloud.js` is deployed and
     **dormant on prod**, because `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` /
     `WHATSAPP_OTP_TEMPLATE` are all unset there. Setting them makes Meta's first-party sender
     primary and drops the flapping device to a fallback — it is the actual end of this whole
     class of incident. Needs Meta business verification + an approved auth template.
  · Cheap interim: only `ZENTRAMSG_DEVICE_UUID` is set, so the 4-device failover fleet has
  nothing to fail over to. Adding `ZENTRAMSG_DEVICE_UUID_2` would give it a spare.
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
- **Finish the تجزئة piece rates** at `/admin/workshop → أسعار القطع`. Migration 072 seeded them
  equal to the ممثلين rates. Measured on prod 2026-08-14: **2 of 10 have been entered**
  (`robe_sew/robe` 2000 vs 1000, `shawl_close/sash` 1000 vs 800) — the other **8 still pay the
  wholesale wage**. (`cut/cap` and `cut/shawl` are 0 on both sides; confirm that is deliberate
  rather than unset.)
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

- **⛔ «بانتظار موافقة الممثل» IS NOT A QUEUE TO DRAIN — DO NOT TOUCH IT. Owner ruling 2026-08-14.**
  The ~471 rep orders parked in this state are sitting on **unresolved disputes between students and
  their ممثل**. The pending state is deliberate: it keeps the shop out of an argument it is not
  party to. **Never bulk-approve, auto-approve, expire, or "tidy" these rows**, and never pitch it
  as a quick win because ~11.7M IQD looks stranded — that money is *withheld*, not stuck. An admin
  bulk-approve would take a side in every dispute at once and erase the record that one existed.
  The damage is social, so **no test, migration or revert will catch or undo it**. Approvals belong
  to the ممثل, individually, after they settle with their student. Counting and *displaying* the
  backlog is fine and is exactly what bug 9's «قابل للعمل» / «بانتظار موافقة الممثل» split does.
  ⚠️ An earlier version of `docs/superpowers/specs/2026-08-13-eleven-bugs-parallel-tracks.md` called
  this "the highest-value action available" and named the approve endpoint. That was wrong and has
  been rewritten. If you find that advice anywhere else, it is stale — delete it, do not follow it.

- ✅ **DONE 2026-08-14 (c) on `fix/ai-assistant-money` — this landmine is defused, not deleted.**
  `main` is merged into the branch, `revenue_summary`/`top_reps` are rewritten onto `settledMoney`,
  and `test/assistantMoneyAgreement.test.js` reads the assistant AND the dashboard and compares
  them, so they cannot drift apart again. Merge **that** branch, not raw `ai-assistant` — raw
  `ai-assistant` still carries the defect described below. The description stays because it is the
  reason the fix exists:
  **⚠️ MERGING `ai-assistant` MUST UPDATE «لولو»'s MONEY DEFINITION — or it will quote a
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
- ✅ **FIXED 2026-08-14 (c) on `fix/schema-money-drift` (unmerged) — the FILE was corrected to
  describe production, never the reverse.** Verified by building the corrected DDL as a throwaway
  table inside a rolled-back transaction: the fresh shape matches prod column for column. The
  warning below stays because it is still true of `main`:
  **⚠️ `db/schema.sql` DISAGREES WITH THE LIVE `orders` TABLE about money columns.** The file says
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
- **⚠️ `AI_CHAT_SESSION_MINTS_PER_HOUR` IS THE ONE ASSISTANT LIMIT CGNAT CAN BREAK — do not
  "tighten" it.** It bounds identity *harvesting* only; the per-IP ask limiter already caps one
  address at 100 requests/15min however many identities it holds, so rotation buys an attacker
  nothing. But a rep dropping a WhatsApp link means ~100 students opening the site within an hour
  behind one carrier NAT, each browser minting exactly once. It was set to 30/hour and **the
  project's own harness tripped it immediately**; it is 300/hour now. Same trap as `joinLimit`.
- **⚠️ Migration 079 must be applied with the assistant code.** It adds `ai_chat_messages.ip_hash`
  and `reserve()`/`logCached()` write it, so on a database without the column **every assistant
  message 500s**. It is in `db/schema.sql` too, so the deploy's `npm run migrate` covers it —
  the ordering rule is the same one 078 already has.
- **The assistant's `.env` needs three new values in prod:** `AI_CHAT_DAILY_USD_MAX=3.0`,
  `AI_CHAT_DAILY_USD_WARN=1.0`, `AI_CHAT_ANON_DAILY_USD_MAX=1.2`, plus `SHOP_WHATSAPP` (digits
  only, `9647723078729`). Without `SHOP_WHATSAPP` the escalation silently falls back to
  Instagram — correct, but not what the owner asked for. Defaults in code already match, so a
  missing var degrades safely rather than breaking.

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
- ~~**Unit vocabulary pass 2 is not done**~~ — **CLOSED 2026-08-14 (d) by bug 7**, both halves:
  seven staff/rep labels stopped printing a PIECE count under «طلب», and `/admin/orders` now
  flips the noun with the view mode. Two labels were deliberately left as «طلب» because they
  really are bundles. The «40 vs 118» disagreement this line described is gone.
- **`backend/` has no `npm test`** — verified in `backend/package.json`. The real command is
  **`node --test test/`**, and it **must be run from `backend/`** (246 tests on `main`).
  ⚠️ Run it from the repo root as `node --test backend/test/` and dotenv cannot find `.env`, so
  `DATABASE_URL` is undefined and **147 tests fail** for a reason that has nothing to do with the
  code under test. Cost real time on 2026-08-14 (c) — the failure looks like a broken change.
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
- ~~**`/admin/orders` still shows the bug Track A fixed on `/admin`**~~ — **FIXED 2026-08-14 (c)
  on `fix/admin-orders-profit`, NOT MERGED.** Measured on prod first: the rep tab was showing
  ربح الممثلين 6,235,000 as «الربح» and never showing دخل المحل 35,160,000 at all.
- ~~**Payout cards are shipped but their numbers are still wrong**~~ — **ALL FOUR FIXED
  2026-08-14 (c) on `fix/payout-money`, NOT MERGED.** ⚠️ Two of the four claims were **dev-DB
  artifacts**: مضر محمد's −775,000 needs deduction rows prod does not have, and ابو عبدو is
  `active = FALSE` on the prod workshop roster so he was never actually listed twice there. The
  code defects were real; the urgency was not. The one that mattered is the accrual — it re-offers
  the full salary on every press and had not fired only because `manual_payouts` has 0 rows.

- **⚠️ `fix/calligraphy-cost` IS READY AND UNMERGED — 2026-08-18.** The four calligraphy cost
  fixes (audit: **92.5% of the whole OpenRouter bill was the calligraphy generator**, $40.53 in
  August's first 17 days): rerolls at 1K 1:1 · the geometry ratchet closed (migration **082**,
  `original_plate_path`) · sheets top up with pending plates from other jobs before buying a
  near-empty image · a daily USD ceiling + admin push warning (`lib/calligraphySpend.js`,
  `calligraphy_spend_log`, `CALLIG_DAILY_USD_MAX`/`_WARN`, defaults $10/$5 in code). 407/407
  backend tests, no new dependency, no frontend change. Migration 082 is in `db/schema.sql`, so
  the auto-deploy's `npm run migrate` covers it — same ordering rule as 078/079. Expected:
  **~$53 → ~$25-30/month at August volume, same quality.** Full detail in the 2026-08-18 (b)
  PROGRESS entry.
- **⚠️ `fix/admin-presence-panel` IS READY AND UNMERGED — 2026-08-15.** Closes the last two
  open bugs (**1**, and **8 parts 2·3·4**), so the eleven-bug board is finished in code.
  Off `main`, no migration, no new dependency, 275/275 backend tests, `next build` clean.
  ⚠️ **Every push to `main` auto-deploys, and this has NOT been opened in a browser** —
  Chrome was not running on the laptop when it was written. Three UI surfaces need one pass
  before merging: the «يعمل الآن» panel on `/admin`, «السابق»/«التالي» at the ENDS of a queue
  list, and المجهز's set panel at phone width. Everything else is verified live against the
  dev DB — see the 2026-08-15 PROGRESS entry for the evidence and the measurements.
  · New endpoint `GET /production/presence` (same `requireStaffType()` guard as `/monitor`).
  · New row fields `search_text` (+8.8% payload) and `set_pieces` (+8.9%, station mode only).
- ✅ **ALL FOUR MONEY BRANCHES ARE MERGED AND DEPLOYED — 2026-08-14 (d), prod at `fde0cce`.**
  Three deploys, DB backed up first. Bug 7 is closed on both halves. Bug 8 shipped **part 1
  only** (garment-level chips for المجهز); parts 2-4 were never written — see the PROGRESS
  entry for how to resume the stopped workflow. `fix/ai-assistant-money` stays UNMERGED on
  purpose: it is correct, but merging it ships the whole assistant.
  The superseded note below is kept for its reasoning:
- **⚠️ FOUR MONEY BRANCHES ARE READY AND UNMERGED — 2026-08-14 (c).** Every push to `main`
  auto-deploys, so merge **one at a time** and open the screen before the next:
  `fix/payout-money` (payout accrual · duplicate recipient · negative suggestion · audit trail) ·
  `fix/admin-orders-profit` (bug 11's second home) · `fix/schema-money-drift` (`db/schema.sql`
  told a fresh database that `cost` is `NOT NULL DEFAULT 0`, which silently changes what money
  means) · `fix/ai-assistant-money` (merges `main` into `ai-assistant` and puts «لولو» on
  `settledMoney`). Full reasoning in the PROGRESS entry.
  ⚠️ The `ai-assistant` merge is **still not deployable** for the reasons the owner gave on
  2026-08-13; the branch is now *correct*, not *cleared*.
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
