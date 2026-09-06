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
| **Server** | 🚚 **MOVED to `169.58.114.255` (8 GB, shared with RevoArt) on 2026-08-16.** Fronted by RevoArt's `supabase-caddy`, not nginx. Full detail in the 2026-08-16 PROGRESS entry. ⚠️ **The old 2 GB box `142.93.110.202` is GONE as of 2026-08-27** — it still answers ICMP (provider edge) but 22/80/443 are all filtered: powered off or destroyed. **There is NO rollback box anymore.** Anything that box still served (the stale-DNS forwarder, ForMe on :3100) is down with it. Verified 2026-08-27: `lolo-shop96.com` site 200 + `/api/health` 200 on the new box, so production is unaffected. |
| `origin/main` | `6d97196` — pushed 2026-08-25, CI green on all three jobs, **auto-deployed** and verified live (migrations 086·087·088·089 applied, site + API 200, 0 marketing opt-ins as expected). Carries: «ابدأ الخصومات», `/admin/app` (app stats + push composer), the admin notification bell, and the student notification opt-in. |
| Eleven-bug tracks | **ALL ELEVEN CLOSED IN CODE.** Deployed: 2·3 (C) · 9·10·11 (A) · 4·5·6 (B) · **7** · **8 part 1**. On `fix/admin-presence-panel`, **unmerged**: **bug 1** + **bug 8 parts 2·3·4**. *(This row said «1, 7, 8 NOT started» until 2026-08-15; 7 and 8-part-1 shipped on 2026-08-14.)* |
| Migration 077 | ✅ applied to prod AND the dev DB — 3,311 prod rows retired to `skipped` |
| Migration 080 | ✅ **applied to prod 2026-08-14** — 459 plates moved to their own column, **0** left in `customer_image_url`, 1,885 student photos intact |
| Migration 078 | ⚠️ **applied to the DEV DB only** — the AI assistant's `ai_chat_messages`. It is in `db/schema.sql` too, so the next prod `npm run migrate` creates it. **Run it in the same deploy as the code:** until the table exists the cap check throws and both assistant endpoints 500 (the rest of the site is unaffected — nothing else reads that table). |
| Android | **v1.0.4 (versionCode 5) IN PRODUCTION REVIEW** — deep links + GPS + push in one review |
| iOS | **1.0.4 (build 1786309948) SUBMITTED — «Waiting for Review»** (2026-08-10, ≤48h) |
| Android push | ✅ working end to end — **160 device tokens on prod** |
| K40 / ADMS | ⚠️ **ALREADY ON `main` AND DEPLOYED** since 2026-08-29 16:58 UTC (`4f8bb3f`), migration 094 applied, all five tables live and EMPTY. ✅ **The proxy now routes `/iclock/*` to the API (2026-08-30) — until that day it 404'd into Next.js and five workers fingerprinted into nothing.** Still inert because **no serial is registered**, which is now the only remaining blocker on the code side. `PROGRESS.md`'s older entry still says "deliberately not deployed" — it is stale. Proven against the real K40 on 2026-08-29 over a temporary tunnel; what is NOT deployed is `ffcb0ce` (status keys + the break-policy change). |
| iOS push | ✅ **WORKS END TO END — proven on a real iPhone 2026-08-29 21:57.** The cause was never the entitlement, the APNs key or the provisioning profile: Capacitor's iOS template ships no `didRegisterForRemoteNotificationsWithDeviceToken`, so AppDelegate took the APNs token and dropped it — `register()` succeeded and the plugin fired NEITHER `registration` NOR `registrationError`, which is why `push_register_errors` was empty. Fixed by `cb91f8d`, shipped as **1.0.5**. Tokens went **0 → 5 in half an hour**, including two real students who updated on their own. ⚠️ What limits push now is REACH, not delivery: 165 tokens against 2,249 retail accounts, so a broadcast physically reaches ~7%. |
| Backend tests | **508/508 on `main`** (2026-08-25, after the discount-round + app-console merge; 479 before it). The `app-open` failure the row below described now PASSES; it was flaky, not broken. Kept because it will likely flap again:  `app-open: a ping inside the session window does NOT count a second open`, `test/adminConsole.test.js:371`, failed on 2026-08-21 and **reproduced on clean `main`** — so if you see it fail, it is not your change. Older rows said 266/275 and 467/467; the suite keeps growing. ⚠️ Run from `backend/` as `node --test test/*.test.js` — see the landmine below; the old `test/` and bare forms both misbehave on Node 26. |
| Prod DB backup | ✅ `~/Desktop/_private/loloshop-db/loloshop-prod-2026-08-25.dump` — 5.2 MB, taken before the 086-089 deploy, contents verified on the box. ⚠️ **Restore it ON THE SERVER**: it is pg_dump format v1.16 and the laptop's `pg_restore` refuses it («unsupported version (1.16) in file header»). The 08-14 and 08-24 dumps are still there. |

**Both platforms are now on the same version (1.0.4) carrying the same three features.**

✅ **Both are live on the store, and iOS push is proven on a real phone (2026-08-29).** iOS
**1.0.5** is the build that matters — 1.0.4 carried the entitlement and still could not register.
This paragraph previously said no store build had been opened on a phone; that is finished.

**Prod VPS is `169.58.114.255` since 2026-08-16** — the 8 GB box, which LoloShop now SHARES
with **RevoArt**. ⚠️ That means the `revo` host in `~/.ssh/config` is the same machine, not a
different project as this file said for months; RevoArt's Supabase stack and its `supabase-caddy`
(which owns :80/:443 and fronts LoloShop) live there too, so a careless `docker`, `ufw` or
Caddyfile change hits a second production site. ⚠️ **`142.93.110.202` IS GONE (verified 2026-08-27)** — powered off or
destroyed. It pings but 22/80/443 are filtered. It is **no longer a rollback**, and the
stale-DNS forwarder it ran is dead. Do not plan around it.
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
Caddyfile change hits a second production site. ⚠️ **`142.93.110.202` IS GONE (verified 2026-08-27)** — powered off or
destroyed. It pings but 22/80/443 are filtered. It is **no longer a rollback**, and the
stale-DNS forwarder it ran is dead. Do not plan around it.
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
- **Nothing about the web half needs a store**, and that now covers the notification opt-in
  too: «الإشعارات» on `/account` is web code inside the WebView shells, so it reached every
  already-installed app the moment `6d97196` deployed. **No new binary was needed and none is
  needed** — nothing in `AndroidManifest.xml` or the iOS entitlements changed.
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

00. ✅ **DONE 2026-08-22 17:46 UTC — the discount round is ENDED on prod.** Batch
   `12198690-d531-4683-b52a-9f69910f73c4`: **51 retail prices restored (+5,000 each)**, all 51
   «السعر قبل الخصم» cleared, promo banner OFF, re-read confirms 0 products still discounted.
   ⚠️ **FIVE cells were deliberately NOT restored and are the one thing still open** — four
   product-level `base_price` cells sitting below their old price by amounts that were never the
   discount (**وشاح** 30,000 vs 50,000 · **روب فصال بشت** 35,000 vs 50,000 · **وشاح عدل** 10,000
   vs 20,000 · **وشاح منحني** 25,000 vs 30,000), plus وشاح عدل's سعر الجملة (15,000 vs 20,000).
   `products.base_price` is what a REP-LINKED student pays when a product has no wholesaler row,
   so restoring them would have raised real order prices by up to 20,000. **Owner question: are
   any of those four meant to be higher?** Set them by hand on `/admin/products` — the run log is
   now the only human-readable copy of those old prices, since the run cleared `compare_at_price`.
   · ✅ **2026-08-25: the owner can now set these themselves.** «ابدأ الخصومات» is live on
     `/admin` (deployed in `6d97196`), so running or fixing a round is a screen, not a developer
     task. The four prices still need a human decision — the run log remains the only readable
     copy of the old values — but nothing is blocked on a session any more.
   · **Undo** (all three statements are printed in the run log): `discount_restore_log` keyed by
   that `batch_id` holds every old value, including `old_compare_at_price` to bring the badges
   back. The rollback was rehearsed on a seeded copy before the live run.
   · Two ways to do this again: `/admin` → الإعلانات والعروض → «إنهاء الخصومات» (needs an admin
   session), or the **End discounts (manual)** workflow in the Actions tab — `mode: report`
   writes nothing and prints the whole picture. ⚠️ **Never add a `push:` trigger to that workflow.**

0X. **💸 (superseded, kept for the how-to) END THE DISCOUNT ROUND — one screen, one press.**
   `/admin` → **الإعلانات والعروض** → **«إنهاء الخصومات»**. It lists every product carrying a
   «السعر قبل الخصم», what its price is now, what the old price was, and the gap — read that
   first, it answers «كم كان الفرق؟» from the data. Then pick ONE of the two radios:
   · **«رجّع الأسعار للسعر القديم»** — if the real prices were lowered when the round started.
   · **«الأسعار صحيحة — امسح السعر القديم بس»** — if they never moved and it was a strike-through.
   ⚠️ **The wholesaler row is unticked on purpose and should usually stay that way** — سعر الجملة
   sits below the retail old price by the normal margin whether or not any discount ran, so
   ticking it raises what every ممثل pays. Old prices are kept in `discount_restore_log`
   (migration 085, `batch_id`) so any press is reversible with one UPDATE — which matters
   because there is **no DB backup right now**. Existing orders are snapshots and never change.
   · Turning the promo banner off alone (the toggle right above it) hides every badge instantly
   but leaves the real prices where they are — that is the fast half, not the whole job.

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
0Y. ✅ **BOTH STORE VERSIONS ARE ALREADY PUBLISHED — verified in both consoles 2026-08-26.**
   Android 1.0.4 went live **2026-08-11**, iOS 1.0.4 **2026-08-13**. Items 1 and 2 below said
   for two weeks that each was waiting on a human press; **both were already pressed**, and that
   stale pair is what made «why does the admin get no notifications» look like a release problem
   for a whole session. They are kept below only for the traps they document, which are real and
   will apply to the NEXT release. **Nothing is waiting on a press, and no new binary is needed
   for anything currently on this board.**

1. **⏳ Android 1.0.4 (versionCode 5) is IN PRODUCTION REVIEW** — submitted 2026-08-09 with
   deep links + GPS + push together, full rollout, exactly one queued change (the withdrawn
   versionCode 4 draft did NOT linger; verified before submitting).
   ⚠️ **«النشر المُدار» (managed publishing) is ON, so approval does NOT publish it.** Someone
   must return to the publishing overview and press publish. It will look like "still in review"
   when it is actually approved and waiting. Check in a day or two.
   ⚠️ **2026-08-25: this is now the top of the queue, not a formality.** The push composer is
   live on `/admin/app`, so every day these two versions sit unpublished is a day the shop can
   compose a notification that reaches nobody new.
2. **⏳ iOS 1.0.4 is IN REVIEW** — submitted 2026-08-10, ≤48h, and set to **manual release**, so
   approval will not publish it either. Done in the same sitting: version 1.0.4 created, build
   attached, 6.9" screenshots uploaded (the page now reads *«Using 6.9" Display»*), Arabic
   *What's New* written by the owner, App Privacy published.
   ⚠️ **«What's New in This Version» is REQUIRED for every update** and blocks *Add for Review*
   with a misleading generic "unexpected error" alongside the real message. It was not required
   for the initial 1.0 release, so it is easy to hit once and never again.
   ⚠️ **In this ASC flow «Add for Review» submits immediately** — it is not a staging step and
   there is no second confirm.
   ⚠️ **2026-08-25 — THIS IS WHY «THE ADMIN GETS NO NOTIFICATIONS ON HIS IPHONE».** He is on the
   App Store build, which is 1.0.3 or older, and **push does not exist in it**: the
   `aps-environment` entitlement was only added in 1.0.4. His app has never been able to ask for
   permission, so there is no token and nothing can be delivered to him. Nothing is broken
   server-side — the APNs key is installed and was verified against Apple's production endpoint.
   Releasing 1.0.4 (or a TestFlight install) is the entire fix; **do not go looking for a bug in
   `lib/push.js`.**
3. ✅ **DONE 2026-08-29 — iOS push is proven on a real iPhone.** 1.0.5 installed from the App
   Store, token registered, and a test notification arrived. Do not re-run this. What remains
   from the original item is the deep-link half: tap a `/join/` WhatsApp link on an iPhone and
   confirm it opens the app rather than Safari.
5. **⚠️ Enter the shop coordinates** at `/admin/attendance` (خط العرض · خط الطول · نطاق الموقع)
   **before** moving `verification_mode` off `'none'`. Wrong order 403s every بصمة for every
   worker on every platform.
6. **Play Data Safety form + Apple privacy label:** declare location **and notifications** —
   both are in the binary now. Declare the **device token** too: it is an identifier tied to an
   account (`device_tokens`).
   ⚠️ **2026-08-25: the marketing question now has an honest answer, and it did not before.**
   Promotional push is **opt-in, off by default, with an in-app opt-out** («العروض والأخبار» on
   `/account`, migration 089) — which is what Apple's guideline 4.5.4 asks for. Answer the forms
   to match that, and if the default ever flips to true the forms become false the same day.
6b. **🗓️ CHECK جدول الدوام AND RUN THE FRIDAY REPORT — new 2026-08-27.**
   `/admin/attendance` now opens on **جدول الدوام الأسبوعي**. It ships seeded السبت–الخميس
   **9:00 ص – 10:00 م** and الجمعة **3:00 م – 12:00 ص** — confirm those are the real hours,
   because every تأخير from now on is measured against them. Add any عيد to **أيام الإجازات**
   *before* it arrives; a date there means no تأخير and no خصم, for everyone.
   Then run **`npm run friday-deduction-report`** on prod. Read-only, changes nothing: it lists
   every Friday بصمة recorded late against the OLD wrong opening, separated from the genuinely
   late ones, with the salary-transaction id per row. Dev DB was 5 suspect / 3 genuine /
   **0 charged**. Prod will differ — read it before deciding anything.

6c. **📏 SET THE مسطرة RATE** at `/admin/workshop → أسعار القطع` — seeded at **0** on purpose —
   **and create «إضافة إطار»** at `/admin/products` (الوشاح → toggle → «الطلاب العاديين فقط» →
   سعر التجزئة 5,000). Both are data, not code; nothing is blocked on a session.

6d. ✅ **THE K40 IS LIVE — serial `GED7251600256` registered, 7 PINs mapped, punches landing
   (2026-08-30).** The device dials the **bare IP `169.58.114.255` port 80** (its keypad
   cannot type letters, so the Caddyfile carries an IP host block for `/iclock/*` — see the
   proxy landmine). Nothing was lost after all: the K40 held its buffer and replayed back to
   08-29 22:52 the moment it could reach us.
   **Three small things still open, all data, none blocking:**
   · ✅ **The «تجاهل» button EXISTS** (`f4fae7e`, marker `unmapped_dismissed`). PIN 12 — the
     owner's own test finger, 20 punches — was dismissed 2026-09-06. Still unclaimed:
     **1 (5) · 7 (5) · 8 (2)**. ⚠️ Never map one of these to a real worker without dismissing
     the test punches first: `linkPin` REPLAYS every stored punch onto their attendance, so
     an installer's old taps become that person's day.
   · **The Arabic names have never been pushed to the device**: all 7 PINs sit at
     `push_state = 'pending'` with **zero** rows in `device_commands`, because
     `queueOnActiveDevices` had no active device when they were saved. **Re-save one PIN now
     that the device is online** and they queue.
   · **مضر محمد's shift is set to 22:16 → 10:15**, which is why a 10:19 دخول scores 708
     minutes late. The arithmetic is right; `22:16` looks mistyped.

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
- **⚠️ The App Review demo-login bypass now DIES 2026-09-20** (extended 2026-08-26 for the 1.0.5
  submission; `.env` backed up to `/root/.env.bak-2026-08-26`). `DEMO_LOGIN_EXPIRES_AT` in the
  prod `.env`; past that date `07700000000` hits the WhatsApp OTP wall and the submission fails.
  Push the date forward + `pm2 restart loloshop-api --update-env`. Setting only
  `DEMO_LOGIN_PHONES` looks configured and is **silently inert**.
  ⚠️ **THE DEADLINE IS CAPPED AT 30 DAYS OUT — a FURTHER date is not safer, it is INERT.**
  `lib/otp.js:45-49` voids the allow-list when `remaining > 30 days`, so `2027-01-01` would
  disable the very bypass it looks like it extends. Set something inside a month and verify with
  `node -e "require('dotenv').config(); console.log(require('./lib/otp').isDemoLoginPhone('07700000000'))"`.
  ⚠️ **It had ALREADY expired on 2026-08-21 and nobody noticed, because `OTP_DEGRADED_UNTIL=always`
  was masking it** — the reviewer was getting in through the shop-wide OTP bypass instead. The
  tell is `degraded_auth: true` in the login response: when the demo allow-list is doing the
  work, that field is absent. **So fixing WhatsApp and turning degraded mode off would have
  silently broken App Review**, on a path nothing tests. Verified 2026-08-26: the field is now
  absent, i.e. the review login stands on its own again.
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

- **⚠️ THE DEVICE NOW SAYS WHAT A PUNCH MEANS, AND THE MAP WAS MEASURED, NOT READ (2026-09-06).**
  `PUNCH_STATE` in `lib/attendanceDevice.js`: **255 = nobody pressed · 0 ▲ دخول · 1 ▼ خروج
  نهائي · 4 ← أطلع مؤقت · 5 → رجعت**. Confirmed by pressing each key against a real finger on
  `GED7251600256` and reading `punch_raw` — every punch before this date carried `raw_status = 0`
  because «Punch State» was off, which is why the server had to guess from the clock and why
  five separate money bugs existed at once.
  · ⚠️ **4 AND 5 ARE INVERTED FROM THE DEVICE'S OWN ENGLISH LABELS, ON THE OWNER'S INSTRUCTION.**
    ZKTeco calls ← "Break-In" and → "Break-Out"; the shop's Arabic sticker calls ← «أطلع» and
    → «رجعت». "Correcting" the map against the ZK documentation swaps the start and end of every
    break, and the salary follows the break. Pinned by tests P1–P6.
  · ⚠️ **EVERY UNKNOWN VALUE FALLS BACK TO THE CLOCK RULE ON PURPOSE.** 255, null and anything
    unrecognised derive exactly as they did before, which is the only reason this shipped the
    same day it was measured — and it is what keeps every pre-2026-09-06 punch meaning what it
    meant. Do not "tidy" that fallback away (test P5).
  · **Punch State Required is ON with a 10s timeout** (the firmware's maximum). A refused punch
    leaves **NO ROW ANYWHERE** — the only symptom is a worker whose day has no دخول. There is
    no admin alert for that yet; build one before trusting the data.

- **⚠️ THE 5-MINUTE COOLDOWN READS `device_ts`, NEVER `punched_at` (2026-09-06).** It describes
  a FINGER on a SENSOR, and only the device's own clock can see that. Since 2026-08-30
  `punched_at` is the ARRIVAL instant, so a buffered replay gives an entire batch one identical
  timestamp: on 2026-09-01 the K40 came back from an outage, uploaded **21 punches all stamped
  20:39**, and this rule destroyed **12 of them** — every worker's day collapsed to its first
  punch, their real خروج was thrown away as a "duplicate", and seven records had to be repaired
  with hand-written SQL. It also compares `raw_status`, so two DIFFERENT deliberate keys six
  seconds apart both count while a repeat of the same key does not (test P6).

- **⚠️ `overridden_at` IS THE ADMIN'S RULING; `status = 'overridden'` IS A FREEZE. TWO THINGS
  (2026-09-06).** They shared one flag until now, and «إلغاء مبلغ التأخير» — a pure money
  waiver — set it, freezing the whole day against the device: on 2026-09-04 محمد عماد's 18:21,
  18:32 and 23:02 were all discarded as «ما ينلمس» and his checkout was fabricated at 00:00 by
  `closeStaleOpenDay`. `overrideRecord` now takes `freeze_day` (**default TRUE**, so every
  pre-existing caller is unchanged) and the button sends `false`. `applyPunch`'s rule 3 reads
  `overridden_at`, not `status`, so an earlier punch can move a check-in back without
  re-charging a تأخير a human cancelled. Tests F1–F2.

- **⚠️ A خروج AFTER MIDNIGHT CLOSES YESTERDAY — TWO BOUNDS, BOTH GUESSES (2026-09-06).** The
  shop shuts at 22:00 and people punch out at 23:48 / 00:14 / 00:17, and a 10:00→22:00 shift
  does not cross midnight, so `resolveStamp` alone filed every one of those under the NEXT date:
  محمد عماد's 09-02 خروج at 00:17 became his 09-03 check-in and 09-02 was auto-closed at a
  fabricated 22:00; محمد عادل's record says he "arrived" 09-06 at 05:12.
  `previousDayDeparture` now carries such a punch back, bounded by
  **`LATE_DEPARTURE_WINDOW_MINUTES` (6h after the shift end)** and
  **`LATE_DEPARTURE_CUTOFF_MINUTES` (nothing from 08:00 local counts as a departure)**. The
  cutoff is what stops a night-shift worker's AFTERNOON ARRIVAL being read as yesterday's
  departure — do not remove it. An explicit ▼ skips the cutoff (the worker said what it is) but
  not the window. Tests M1–M3.

- **⚠️ THE +24h WRAP IS GATED ON `belongs_to_previous_day` (`schedule.stampMinutes`, 2026-09-06).**
  A midnight-crossing shift has two ways for a stamp to read earlier than its start and they
  mean opposite things: 00:10 inside the after-midnight window is genuinely late (add the day),
  while 10:53 after that window closed is someone arriving ELEVEN HOURS EARLY for tonight. The
  old rule wrapped both, so مضر محمد was recorded **1410 · 845 · 994 · 993 · 742** minutes late
  on five consecutive days — every one an early arrival. `shiftIsOver` in `attendanceDevice.js`
  MUST keep calling `stampMinutes` rather than re-deriving it; a second copy is how this
  happened. Tests N1–N2.
  · ⚠️ **مضر محمد's stored hours are still 22:16 → 10:15 and his rate is 0** — the owner is
    asking the client. Until that row is right his numbers stay wrong, and it is DATA, not code.

- **⚠️ THE BREAK ALLOWANCE IS 300 MINUTES (5h), CHANGED FROM 600 ON 2026-09-06**, and it is read
  LIVE by `recomputeMonth` — so lowering it RE-CHARGES past breaks the next time anything
  recomputes that worker's month. That is not hypothetical: علي اديب's phantom 640-minute break
  had to be cancelled BEFORE he took his next break, or his 40,000 IQD deduction would have
  recomputed to **~370,000**. Anyone changing this number again must sweep the month's existing
  breaks first.


- **⚠️ «صورة الشال» / «صورة القبعة» ARE PRODUCT PICKERS, NOT EMBROIDERY — migration 096, and the
  flag has NO admin UI.** `priceSelections` used to route an order to التصميم → التطريز from ANY
  option group carrying text or a photo, and those two store the student's *choice of product* as
  `customer_text`. 468 شال امريكي went that way and **not one carried a «تطريز» line**; they then
  sat at التطريز showing ZERO zones, because `ZONE_DEFS` correctly says the American shawl is not
  embroidery. Two rules contradicting each other, pieces falling in the gap, from 2026-06-29 until
  2026-08-31. `option_groups.is_embroidery` is **nullable and NULL means YES** — that is what lets
  the seed fill NULLs only, so `db/schema.sql` (re-applied on every deploy) can never revert an
  admin's later edit. A new picker-shaped group is the admin's to mark:
  «صورة منتج فقط — ما تروح للتصميم/التطريز» is on the group editor at `/admin/products` and
  writes **FALSE or NULL, never TRUE** — a stray TRUE behaves the same but destroys the
  column's meaning («the admin has decided about this group»). «اللون» / «لون التطريز» / «ردن الروب» were left
  TRUE on purpose: a sash with a colour really is embroidered.

- **⚠️ THE CALLIGRAPHY WORKBENCH IS NOT A STATION QUEUE, AND `advanceBlockReason` IS THE ONLY
  THING STANDING IN THE GAP (2026-08-31).** `getQueue` filters `wholesaler_approval='approved'`
  and `returned_to_customer=FALSE`; `zoneBuckets`/`sendOrder` filter neither. Before the gate,
  «تحويل للتطريز» pushed unapproved rep orders into التطريز where EVERY screen hides them — that
  is the «140 at التصميم, 137 at التطريز» report, and three real orders were lost that way. The
  gate lives on the TRANSITION (`advance`, `advanceBulk`, `sendOrder`), never on a list: hiding
  alone still accepts a hand-posted id. It **refuses movement and never approves** — «بانتظار
  موافقة الممثل» is not a queue to drain. Do not "simplify" it into a WHERE clause on the pool.

- **⚠️ `viewerStages` READS `QUEUE_STAGES` AND MUST NOT GO BACK TO DERIVING FROM `STAGE_AUTHZ`
  (2026-08-31).** The owner opened every non-design edge to every line staff type, so the authz
  map now says a presser may move an order out of التطريز — true, and NOT «التطريز is the
  presser's station». Deriving «mine» from it makes «مرحلتي» mean «الكل» for everyone and
  re-opens bug 2. `QUEUE_STAGES` = my job; `LINE_VIEW_STAGES` = what I may look at and move. They
  look redundant, which is exactly why a future tidy-up will want to merge them.
  · `test/viewerStages.test.js` is the guard that catches it, and `test/lineWideAccess.test.js`
    pins the other half (التصميم closed, cancel still manager/admin, edges back INTO design
    restricted).
  · A DB-touching test that leaves a fixture sitting in a live stage **breaks
    `adminNumbers.test.js`** — it compares two live COUNT queries and a moving row straddles them
    (measured: off by exactly one). Retire such a fixture inside its own test, not in cleanup.

- **⚠️ `scripts/deploy.sh` DOES `git pull` BEFORE THE BUILD, SO A FAILED BUILD LEAVES `git log` ON
  THE BOX LYING.** CI run `33275028760` (2026-08-29) died on
  `ENOTEMPTY … rmdir '.next/server/app/index.segments/…'` and prod served the `162cfab` frontend
  for two days while the box's git said `7a7dffe`. The `[PM2][ERROR] File ecosystem.config.js not
  found` in that log is a CONSEQUENCE — the script died inside `cd frontend && … && cd ..`, so PM2
  ran from `frontend/`; the file exists at the repo root. **`rm -rf .next` before `npm run build` is now
  in the script (2026-08-31).** Never read the box's `git log` as proof that a deploy landed —
  check the CI run and PM2 uptime.

- **⚠️ A DAY IS READ FROM THE SEQUENCE OF PUNCHES, AND THE CLOCK — NOT THE COUNT — DECIDES
  WHERE IT ENDS (owner rule, 2026-08-30).** بصمة ١ دخول · ٢ خروج مؤقت · ٣ عودة · ٤ خروج, and
  a punch **at or after the shift's own `end_time`** closes the day while anything earlier
  opens or closes a break. Multiple trips out are allowed; every pair is its own break.
  · **⚠️ A DEVICE BREAK IS BORN `approval = 'approved'` AND THAT IS A MONEY DECISION.**
    `computeCharge` gives an UNAPPROVED break **zero** free minutes — every minute deducted —
    so creating these as `pending` would silently bill every worker for every break the day
    the shop stopped using the phone's request flow. There is no إذن to ask for at a sensor.
    `ffcb0ce` removes الإذن from the money rule outright; this line keeps the two consistent
    until it merges. The allowance (`break_monthly_minutes`, **600** on prod) still applies.
  · **⚠️ THE ACCEPTED FLAW, chosen by the owner over the alternatives:** someone who goes home
    BEFORE the shift ends opens a break instead of closing their day. It is not swallowed —
    the break stays `out`, crosses `OPEN_BREAK_ALERT_MINUTES` (4h) and surfaces to the admin,
    who fixes it with `PATCH /admin/attendance/records/:id/override`. Do not "fix" it by
    guessing at intent.
  · **⚠️ ON A MIDNIGHT-CROSSING SHIFT NO PUNCH CAN EVER CLOSE THE DAY**, and مضر محمد is on
    one (22:16 → 10:15). `resolveStamp` files a stamp under the previous day only while it is
    STRICTLY BEFORE that end, so the closing instant is already the next shift's دخول. That is
    what `closeStaleOpenDay` exists for: the **next** day's first punch closes the previous
    open day at ITS OWN scheduled end and auto-closes any break still `out` inside it
    (`auto_closed = true`, so an admin can tell it from a real عودة). It never touches an
    `overridden` row. Pinned by test 6d — deleting it leaves those workers' days open forever.
  · **⚠️ A PER-WORKER 5-MINUTE COOLDOWN** (`PUNCH_COOLDOWN_MINUTES`) drops a repeat punch from
    the same person: a finger resting on the sensor reads twice, and under this rule a stray
    read would open a break nobody took. **Per worker, never per device** — two people at
    10:15 and 10:16 is the morning queue and both must count. It is measured from the last
    **accepted** punch, not the last rejected one, or someone tapping every four minutes locks
    themselves out all day. Tests C1/C2.

- **⚠️ THE SERVER CLOCK STAMPS A PUNCH, AND THAT REVERSED `c494dc9` ON PURPOSE (2026-08-30).**
  `punched_at` is the instant the punch REACHED the API; `device_ts` keeps the K40's own
  reading. The owner ordered it after the device's wall clock was found wrong on site — a
  wrong clock mis-marks every تأخير and nothing on any screen reveals it. **The cost is not
  hypothetical:** punches buffered through an internet outage all arrive in one batch and all
  get that batch's arrival time, so a worker who came at 9:00 and one who came at 10:30 land
  on the same minute. The 2026-08-30 backlog would have collapsed onto 20:55 under this rule
  instead of replaying across the day. After any outage the repair is
  `PATCH /admin/attendance/records/:id/override`, reading `device_ts` as the evidence.
  · **`device_ts` is still the dedupe key** (`punch_raw_dedupe_ux`), which is the only reason
    this change was safe — a re-sent batch is still recognised as the same punches. Never
    move that index onto `punched_at`.
  · The contract is asserted in `test/attendanceDevice.test.js` test 1 and in
    `test/iclockRoute.test.js`. **Nine tests used to assert the opposite**; if anyone flips it
    back, flip this landmine and `ingestPunches`' header with it.
  · Shift-math tests use the file's `replay()` helper, not `ingest()`, because ingest now
    overwrites any time you hand it. That is not a shortcut — `assignUnmapped` replays stored
    punches the same way.

- **⚠️ THE PHONE CAN NO LONGER PUNCH, BUT الخروج المؤقت IS STILL A PHONE ACTION (2026-08-30).**
  `check-in`/`check-out` are gone from `routes/staff.js` AND `routes/payroll.js` — there were
  two doors onto the same controller, and removing one would have left the other working with
  nothing on screen to explain it. `attendanceController.checkIn`/`checkOut` are deliberately
  KEPT and unrouted (breaks and tests call them); re-exposing them is a route line, so do not
  delete the controller half as dead code. ✅ **2026-09-06: THE DEVICE HAS BREAK KEYS NOW** —
  ← «أطلع مؤقت» and → «رجعت», read from `raw_status` (4 and 5 — see the PUNCH_STATE
  landmine). Proven on prod with a real finger: punch 187, PIN 11, 17:37:03, status 4 → an
  open `staff_attendance_breaks` row. This line used to say breaks were phone-only pending
  `ffcb0ce`; they are not any more. The phone flow still works and is the fallback for a
  worker who forgets the key. If the device dies, only an admin can fix a day
  (`PATCH /admin/attendance/records/:id/override`); there is no worker-facing fallback, by
  design.

- **⚠️ ONLY THREE PATH PREFIXES REACH EXPRESS. THE PROXY IS NOT IN THIS REPO, AND A NEW
  NON-`/api` ROUTE IS INVISIBLE UNTIL SOMEONE EDITS IT** — `/opt/revoart/supabase/volumes/proxy/caddy/Caddyfile`
  on the box, mounted into the `supabase-caddy` container. The LoloShop block forwards
  `/uploads/*`, `/api/*` and (since 2026-08-30) `/iclock/*` to `172.18.0.1:4000`; **everything
  else goes to Next.js on :3000**. So a backend route that cannot live under `/api` — the K40's
  paths are fixed in firmware — mounts fine in `server.js`, passes its tests, deploys, and then
  answers **404 from the frontend**. The failure is silent from every angle a developer checks:
  nothing in the API log, because the request never reaches Express. That is exactly how the
  fingerprint device sat dead from 2026-08-29 to 2026-08-30 while five workers used it; it had
  been "proven" over a temporary tunnel that bypassed the proxy entirely.
  · **The `http://lolo-shop96.com` block is the shop's one cleartext door and exists only for
    the K40**, which has no TLS stack. ⚠️ **Declaring `http://` for a host REPLACES Caddy's
    automatic http→https redirect**, so that block re-creates it by hand — with **308, not
    `permanent`/301**, because only 308 preserves a POST's method and body. Delete the second
    `handle` and every plain-HTTP visitor gets a 404 instead of being upgraded to TLS.
    Nothing carrying a session, a token or a price may ever be added to the cleartext handle.
  · ⚠️ **Reload it with the startup shell, never a bare `caddy reload`:**
    `docker exec supabase-caddy sh -c 'PROXY_AUTH_PASSWORD=$(caddy hash-password --plaintext "$PROXY_AUTH_PASSWORD") && caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile'`.
    The container hashes that password at boot; a plain reload re-adapts the file with the
    plaintext still in the container env and breaks Studio's basic_auth on `api.revo-art.com`.
  · That one file fronts **three production sites** — LoloShop, RevoArt and Grand-Layan. Always
    `caddy validate` a candidate copy first, and re-check all three plus `/api/health` and both
    `/.well-known/assetlinks.json` after (a redirect there silently kills Android deep links).

- **⚠️ THE iOS UPDATE MESSAGE IS A WALL NOW (`components/AppUpdateGate.tsx`, 2026-08-29), so
  `MIN_IOS_VERSION` IS A RELEASE EVENT AND NOT AN EDIT.** It blocks the whole app — students,
  reps, staff and the admin alike — on any iOS shell older than the constant. Point it at a
  version that is approved but still sitting behind «Manually release this version» and the shop
  is shut for every iPhone at once, with no way back that does not need a deploy. Three
  conditions must ALL hold before anything is blocked (iOS shell · a parseable version · genuinely
  older); every unknown resolves to "let them through", and that asymmetry is the safety. Android
  is deliberately not gated. The old dismissible banner's reasoning («it asks, it does not
  block») is preserved in the new file's header — it was overruled by the owner, not forgotten.

- **⚠️ THE PERMISSION CARD'S ARABIC COPY IS A LEGAL ARTEFACT, NOT UI TEXT**
  (`components/NotificationPermissionPrompt.tsx`). Apple 4.5.4 permits promotional push only
  behind consent language shown in the app's own UI; the OS sheet carries none and never will,
  so that paragraph — the one naming العروض والخصومات beside the order updates — IS the opt-in.
  Trim it to just order updates and every consent collected afterwards is retroactively
  unfounded. Two more rules around it: it is the **only** caller of `requestPermissions()` in
  the app (iOS grants one sheet per install; a second caller spends it silently), and both
  opt-out paths must call `setMarketingConsent(false)`, or the next launch re-asserts the cached
  consent and quietly undoes the opt-out.

- **⚠️ THE TWO MARKETING-CONSENT COLUMNS ARE OPPOSITE SUBJECTS AND MUST NEVER BE MERGED**
  (migration 095). `users.notification_prefs.marketing` (089) belongs to a PERSON and has to
  follow them onto their next phone, so it cannot live on a device row;
  `device_tokens.marketing_opt_in` (095) belongs to a HANDSET with nobody behind it, so it has
  no user row to live on. `lib/pushBroadcast.js` applies exactly one per recipient — never both,
  never neither — split by `user_id IS NULL`. They look like duplicates, which is why a future
  tidy-up will want to fold them together. Same shape of trap as the two answer guards.
  · `device_tokens.user_id` IS NULLABLE ON PURPOSE. Restoring `NOT NULL` throws away every
    token from a phone that granted permission before it had an account — the thing an iOS
    install can only grant once.
  · The device endpoints sit **above** `router.use(authRequired)` in `routes/notifications.js`
    on `optionalAuth`. Moving them below re-breaks anonymous push with a 401 and no other sign.
  · `device_notifications` (095) is drained by its OWN pass, `pushOutbox.drainDevicesOnce()`.
    Do not fold it into the user pass: that one fans one notification out to all of a person's
    handsets and calls it sent if any took it, while here the row IS the handset.
  · A registration may only ever RAISE consent. An omitted flag is not a withdrawal.

- **⚠️ THE STAFF SCHEDULE LIVES IN ONE FILE AND MUST STAY THERE — `lib/staffSchedule.js`
  (migration 093, 2026-08-27).** Before it, `checkIn` computed lateness against ONE global start
  time on all seven days while the shop opens 3 م الجمعة, so every Friday بصمة was recorded ~6
  hours late — for months, on a path nothing tested. A second copy of the resolution rule is
  exactly how that happens again. Five things not to "tidy":
  · **`weekday` is POSTGRES `EXTRACT(DOW)` numbering** — 0 = الأحد … 6 = السبت, **الجمعة is 5**.
    JS `getUTCDay()` agrees; nothing else does.
  · **The 7-row seed's `ON CONFLICT DO NOTHING` is load-bearing**, not tidiness. It is repeated
    in `db/schema.sql`, which `scripts/deploy.sh` applies on EVERY deploy — remove the guard and
    each deploy silently reverts the owner's edited hours. Same trap as 077's and 080's backfill.
  · **الجمعة ends at EXACTLY 00:00, so it has no after-midnight window, and that is correct** —
    a 00:10 stamp is a new السبت shift. `resolveStamp`'s midnight rule only fires while the
    previous shift is still running; it starts mattering if an admin sets الجمعة to end at 01:00.
    `scheduledMinutes` (adds 24h when `end <= start`) and `checkOut` (finds the open record by
    `check_out_at IS NULL`, never by date) were already correct and were **not** changed.
  · **`late_minutes` is frozen onto the record at check-in.** Editing the schedule or deleting a
    holiday never rewrites history — deliberate, and `/staff/me` says so to the worker.
  · The week saves **whole**; `updateSchedule` refuses anything but seven days on purpose.

- **⚠️ LATENESS AND SALARY ARE TWO LEDGERS — never merge them.** `/payroll/me/summary` returns
  `late_amount_shown` beside `salary.balance` and they must stay apart: lateness is never posted
  to `staff_salary_transactions`, so folding it into the balance shows a worker a debt the shop
  has not charged. Pinned by `test/payrollSummary.test.js`, and `/staff/me` states it in words.

- **⚠️ THE WORKSHOP OPERATION LIST IS CODE, NOT A TABLE.** `workshop_piece_rates` stores an
  amount per (operation, product, audience) but never the vocabulary. Adding a job means
  `OPERATIONS` + `PRODUCT_OPS` + `OP_LABEL_AR` in `workshopController.js`, the
  `WorkshopOperation` union in `frontend/lib/workshop.ts`, **and** the rate seed in
  `db/schema.sql` (the file `npm run migrate` applies) as well as a numbered migration. Miss the
  seed and the job appears on screen paying nothing; miss `PRODUCT_OPS` and `upsertRate` 400s on
  a pair the rates screen just offered. مسطرة (migration 091) is the worked example.

- **⚠️ `option_groups.price_role_restriction` IS ENFORCED IN TWO PLACES ON PURPOSE** (migration
  092). `catalogController` hides a restricted group from the configurator; `orderController`
  refuses it on the order path. Hiding alone still accepts a hand-posted `group_id`. Both filter
  in the QUERY rather than rejecting afterwards, so a restricted group is invisible to the
  `required` check too — otherwise a retail-only *required* group blocks every rep-linked
  student's checkout. **Privileged callers see every group**, because the admin product editor
  reads the same `/catalog/products/:id/full`. And the mechanism itself: a rep-linked student's
  price role is **`'wholesaler'`** (`priceRoleForUser`), so `'retail'` here means «الطلاب
  العاديين فقط» — that is not incidental. Covered by `test/optionGroupAudience.test.js`.

- ✅ **CLOSED 2026-08-29 — iOS push delivers. The landmine that stood here for 13 days named
  the wrong suspects, and its list of "ruled out already" was right about every one of them.**
  The answer was in neither the entitlement, the plugin registration, the APNs key, the platform
  detection nor the provisioning profile: **Capacitor's iOS template ships no
  `didRegisterForRemoteNotificationsWithDeviceToken`**, so AppDelegate received the token from
  iOS and dropped it on the floor. `register()` resolved, and the plugin fired NEITHER
  `registration` NOR `registrationError` — which is exactly why `push_register_errors` was empty
  and why every phone looked healthy from every angle. Fixed by `cb91f8d`, shipped as **1.0.5**,
  and `b8b0ba0` re-pointed the update banner at it (it had been pinned to 1.0.4 — a version every
  iPhone in the field already had, so it rendered to nobody).
  **The lesson worth keeping: an empty error table is evidence of a DROPPED token, not of a
  refused permission.** Two days of theorising went into a signing story that a one-line
  AppDelegate gap explains completely.

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
- **⚠️ `pg_dump` AS THE APP DB USER NOW FAILS ON PROD.** Hit while taking the pre-deploy backup
  2026-08-21: `permission denied for table _backfill_sash_carrier_20260821`. That scratch table
  is left over from the 2026-08-21 rep-sash-carrier backfill and is owned by a different role,
  and `pg_dump` takes an ACCESS SHARE lock on **every** table, so one unreadable table fails the
  whole dump — including the shop data you actually wanted. **Dump as the superuser instead:**
  `sudo -u postgres pg_dump -d loloshop -Fc -f /tmp/x.dump` (write to `/tmp`, then `mv` — the
  `postgres` user cannot write to `/root`). Dropping the leftover backfill table would also fix
  it, but check with the owner first: it is the rollback evidence for that backfill.
- **⚠️ «ONE STUDENT PER خانة» IS NO LONGER A SHELF-WIDE RULE — it is PER SECTION.** Since
  migration 085 the وشاح section is `mode = 'shared'` with `max_per_slot = 20`: any student's
  sash may join a خانة, bins fill to 20 and then spill to the next one. روب (10) and قبعة (4)
  are still `exclusive` and still enforce D2. So `placePiece`'s «الخانة مشغولة بطالب آخر» now
  fires for some sections and not others, on purpose, and a reader who assumes D2 everywhere
  will misread the code. Two things follow and must not be "tidied":
  · **A communal bin's `student_id` is NULL and must stay NULL.** «وين وشاح فلان؟» is answered by
    searching each PLACED PIECE's student name (`ShelfMap.tsx`), never the bin's owner. Writing
    an owner onto a communal bin would make it claim one student while holding twenty.
  · **`max_per_slot` is a FLAG, not a cap.** `placePiece` never refuses on count; D4 says the
    worker may always keep stacking. The number only decides when the screen says «فوق الحد».
    A section with a NULL max (شال) is the bottomless single bin it has always been.
  The measurements behind the change are in migration 085's header — read them before reverting
  it: one-student-per-خانة capped the sash shelf at 15 students while 47 sashes were waiting.

- **⚠️ THE TWO ANSWER GUARDS ARE OPPOSITE AND MUST NEVER BE MERGED.** `lib/answerGuard.js`
  (storefront) rejects any IQD figure not in the price book; `lib/adminAnswerGuard.js` (console)
  rejects any number NOT in the facts we computed. Point the storefront guard at `/admin` and
  every correct money answer trips; point the admin guard at the storefront and any price
  passes. They look like duplicates — same shape, same `inspect(answer, …)` signature — which is
  exactly why a future tidy-up will want to fold them together. Same for the surfaces' budgets:
  `evaluateCaps` splits public spend from `adminUsdPerDay` so the two cannot switch each other
  off, and **a caller that omits `surface` keeps the old whole-shop behaviour on purpose** —
  do not "clean up" that branch, every pre-existing caller and test depends on it.
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
  **`node --test test/*.test.js`**, and it **must be run from `backend/`** (467 tests on
  `feat/admin-ai-console`; the count in older entries is stale).
  ⚠️ On Node 26 the bare `node --test test/` form this file used to give now fails to resolve
  the directory, and `node --test` with no path sweeps in `test-full-set.js` / `test-zentramsg.js`
  at the backend root — manual scripts, not tests — for **2 failures that mean nothing**.
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

- ✅ **`fix/calligraphy-cost` MERGED & DEPLOYED 2026-08-18, verified on prod** (migration 082
  applied, 1,892 plates backfilled, API + site 200). The four calligraphy cost fixes (audit:
  **92.5% of the whole OpenRouter bill was the calligraphy generator**, $40.53 in August's
  first 17 days): rerolls at 1K 1:1 · the geometry ratchet closed (migration **082**,
  `original_plate_path`) · sheets top up with pending plates from other jobs before buying a
  near-empty image · a daily USD ceiling + admin push warning (`lib/calligraphySpend.js`,
  `calligraphy_spend_log`, `CALLIG_DAILY_USD_MAX`/`_WARN`, defaults $10/$5 in code). Expected:
  **~$53 → ~$25-30/month at August volume, same quality** — re-check the OpenRouter activity
  page after a week to confirm. Full detail in the 2026-08-18 (b) PROGRESS entry.
- ✅ **`feat/admin-ai-console` MERGED & DEPLOYED 2026-08-21, verified on prod.** «لولو الإدارة»
  at `/admin/assistant`: metrics 8 → 22, an action registry the AI executes only after an
  explicit تأكيد, a model-free suggestion feed, staff app-open tracking (**migration 084,
  applied**) and a nightly staff-report push (**registered: `0 21 * * * Asia/Baghdad`, first
  fire 2026-08-22 21:00**). 467/467 backend tests, CI green, backup taken first
  (`/root/loloshop-prod-2026-08-21-2158.dump`). Storefront «لولو» re-checked live and unaffected.
  ⚠️ **Today's (2026-08-21) report row «بصم بس ما فتح التطبيق» is an ARTIFACT** — the beacon
  shipped mid-afternoon, so staff stamped before the recording code existed. The column is
  meaningful from 2026-08-22 on. Do not act on it.
  ⚠️ **Phone width is still unseen** — Chrome refused to resize the maximized ultrawide window
  across two attempts, the same obstacle the assistant hit on 2026-08-12. Look at the suggestion
  cards, the confirm card and the report table at ~390px.
  ⚠️ New env, optional, defaulted in code: `AI_CHAT_ADMIN_DAILY_USD_MAX` (2.0). Not set on prod;
  the default applies.
  Full detail in the 2026-08-21 (d) PROGRESS entry.

- ✅ **`fix/shelf-and-queue-price` MERGED & PUSHED 2026-08-24** (rebased onto `main` over the
  discount-round commits), together with the staff-home instant search written the same day.
  **Migration 085 rides this deploy** — `scripts/deploy.sh` runs `npm run migrate` first, so its
  UPDATEs (repeated in `db/schema.sql`, the 077/080 pattern) move the وشاح section to communal
  20-per-خانة and NULL the owner on its **two** open bins, B01 and B02, one sash each — the whole
  live state of that shelf. Read the «ONE STUDENT PER خانة» landmine above before touching it.
  Prod DB dumped first: `/root/loloshop-prod-2026-08-24.dump` on the box **and** copied to
  `~/Desktop/_private/loloshop-db/` (5.0 MB, 69 tables, orders/users/shelf present).
  ⚠️ **Phone width is STILL unseen — fourth session in a row.** `resize_window` is a no-op on
  this window and `X-Frame-Options: DENY` refuses an iframe rig. Someone with a phone should look
  at the المجهز sheet's nav row, the shelf map's «١/٢٠ وشاح» labels, and the new `/staff` search
  box (`w-full` under `sm`, 44px tall — built for it, not measured on one).

- ✅ **`feat/discount-round-and-app-console` MERGED & DEPLOYED 2026-08-25, verified on prod**
  (`6d97196`; migrations **086·087·088·089** applied, site + API 200). Four things the admin
  could not do without a developer. Full detail in the 2026-08-25 PROGRESS entry; what stays
  here is only what a future session can break:
  · ⚠️ **A discount round does NOT touch `products.base_price` when a retail row exists**, and
    that is load-bearing rather than tidiness. Ending a round restores every selected cell to
    the single `compare_at_price` column, so discounting both leaves the base permanently
    lowered after a start→end cycle — the exact shape of the four cells the August round
    stranded, and `products.base_price` is what a REP-LINKED student pays. Pinned by
    `test/discountRoundRoundTrip.test.js`; the tick is still offered, just never the default.
  · ⚠️ **Starting a round REFUSES a product that already carries a «السعر قبل الخصم»** instead
    of skipping it. A second round would write the *discounted* price in as «the old price» and
    the real one would be gone from the database — the one loss `discount_restore_log` cannot
    undo, because the damage is in what was WRITTEN to it.
  · ⚠️ **`users.notification_prefs.marketing` DEFAULTS FALSE and must stay that way (089).** It
    is what keeps promotional push inside **Apple's guideline 4.5.4** (in-app opt-in AND in-app
    opt-out). Consent cannot be inherited from a column default: flipping it true enrols all
    1,100+ existing accounts at once and looks fine until a reviewer checks. The gate lives in
    ONE place — `notificationPrefs.marketingFilterSql()`, applied by `pushBroadcast.audienceSql()`
    — so **never add a second path that sends promotional copy**. Measured on the dev DB: the
    retail audience is 1,147 transactional and 1 marketing with one opt-in.
  · ⚠️ **An admin-composed push cannot be recalled**, and `lib/pushBroadcast.js`'s link
    allowlist is a CLOSED list matched exactly — never a prefix, since `/orders` and
    `/orders-evil` share one. It is what stands between one compromised admin session and a
    phishing message wearing the shop's name in front of 1,100+ accounts. Do not relax it to
    "any relative path". «الكل» also demands the recipient count typed back.
  · ⚠️ **`staff_app_opens` (084) was NOT widened.** `app_opens` (087) is a second table and the
    beacon writes both for staff, in one request. Do not "deduplicate" them — 084 feeds the
    nightly staff report and sits beside payroll rules.
  · ⚠️ **App-usage figures start on 2026-08-25 and iOS reads 0.** Nothing recorded a student
    opening the app before the deploy, and no iPhone has ever registered a token. The owner
    asked the on-page iOS explanation removed, so that fact now lives only in
    `AppStatsPanel.tsx`'s header — do not read a zero iOS column as a broken push pipeline
    without checking `device_tokens` first.
  · Two files are both numbered **085** (`_discount_restore_log`, `_sash_shelf_shared_bins`).
    Harmless — both are in `schema.sql` — but `migrate:file 085` is ambiguous. Left alone on
    purpose: both are applied to prod, and renaming an applied migration matches no history.

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
- ✅ **ANSWERED 2026-08-27 — «should lateness deductions reach the salary?» They do NOT, and
  never did.** `staff_attendance_records.deduction_transaction_id` is only ever *cleared*
  (`attendanceController.js`), never set; the sole writer of an attendance salary transaction is
  `lib/attendanceBreak.js`, for breaks. So «مبلغ التأخير» is a displayed figure a human then pays
  from, which is why migration 093 mattered even though no money had moved.
  ⚠️ **And `source_type <> 'attendance'` in `buildSalarySummary` MATCHES NOTHING** — measured, no
  row has ever carried that value. Break deductions use **`'attendance_break'`**
  (`lib/attendanceBreak.js:28`), so they ARE in the balance — the older claim above was right
  about breaks and wrong about the filter. **Do not "clean up" that predicate:**
  `payoutController`'s «المبلغ المقترح» carries the identical one and the two must keep agreeing.
  What is left is a policy question for the owner: should lateness start charging? If it ever
  does, `/staff/me`'s «معروض — ما انخصمت من راتبك» is the first sentence to change.
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
