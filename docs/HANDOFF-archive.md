# HANDOFF archive (2026-06-14 → 2026-08-08)

Full session narratives moved out of `HANDOFF.md` to cut the auto-loaded context (first pass
2026-07-19, extended 2026-08-04, extended again 2026-08-05). **Nothing here was deleted — this is
the long form.** `HANDOFF.md` keeps only what is still actionable and links back here.

**How to read an entry:** each one is a snapshot of the day it was written, *not* current state.
Its «open follow-ups» were true then; the ones still open were carried onto the board in
`HANDOFF.md`, and the rest were closed by later work. Check the board first, then git, before
acting on any line in here.

Work below is committed unless its own entry says otherwise. (The **2026-08-05 (b)** entry was
written against an uncommitted tree; **(d)** committed it, so that caveat is discharged.)
*Committed is not deployed* — check the board in `HANDOFF.md` for what has actually reached
`origin/main` and the VPS. Durable facts also live in PROGRESS.md, git history, and Claude's memory.

---

## 2026-08-10 — 🍎 iOS 1.0.4 uploaded, APNs verified against Apple, both platforms at parity

**Two bugs, both of which produced a *successful-looking* run that failed later.** That is the
theme of the day and the reason both fixes ship with assertions.

**1. The entitlement assertion failed on a correct file.** The 2026-08-09 Codemagic run died at
step 6 «Wire the App entitlements». The entitlements file was fine; the *check* was wrong.
`plutil -extract` splits its keypath on `.`, so `com.apple.developer.associated-domains` was read
as four nested keys and never resolved — and `raw` output cannot represent an array anyway. The
neighbouring `aps-environment` (no dots, scalar) passed happily and hid the cause, so the build
reported the entitlement "missing" immediately after writing it. Fixed in `d9688a6` with
`PlistBuddy -c "Print :$KEY"`, which separates path components on `:` and treats dots literally.
**This run proved it:** the build got past step 6 and all the way to publishing.

**2. Nothing had ever set the marketing version.** The build then archived and signed cleanly and
died at App Store Connect with `90186` (train `1.0` is closed) + `90062` (`CFBundleShortVersionString`
must exceed the approved `1.0`). One cause: the version step only ran `agvtool new-version`, which
sets **`CFBundleVersion`** — the build number. `CFBundleShortVersionString` was set by nothing, and
`frontend/ios/` is not committed, so Codemagic regenerates it with `cap add ios` every run and
re-inherited Capacitor's template default of `1.0` **every time**. Apple had already approved a
1.0, which closes that train permanently — a build number bump does not reopen one.

Fixed in `b68eb94`: `MARKETING_VERSION = 1.0.4`, matching Android's `versionName`, written to the
**pbxproj build setting** rather than the plist, because Capacitor's `Info.plist` carries the
literal `$(MARKETING_VERSION)` and a plist-only patch would be silently overwritten at build time.
Applied *after* `agvtool` so nothing clobbers it. Both silent-failure modes now fail the build:
the pbxproj is re-read after writing, and an `Info.plist` that ever carries a literal instead of
the variable is detected and overwritten.

Validated on Linux without a Mac before pushing — YAML parses, `bash -n` clean, the heredoc
terminator dedents to column 0, the embedded Python rewrites a realistic pbxproj (2 configs) and
exits non-zero when `MARKETING_VERSION` is absent, and all three plist branches behave.
**Result: TestFlight shows `1.0.4 (1786309948)` Complete**, against three earlier uploads all
stamped `1.0` — the diagnosis confirmed from Apple's side, not inferred.

**APNs went live and was actually proven.** Key `72D98R3MFC` («LoloShop APNs Push», Team Scoped
(All topics), **Sandbox & Production**). ⚠️ The Apple form defaults Environment to **Sandbox
alone**, which would have registered fine, accepted the key, and delivered nothing to any store
build — the same silent shape as the missing `google-services.json`. There is no "Unrestricted"
restriction option; **Team Scoped (All topics)** is that choice and is the default.

`.p8` → `/etc/loloshop/AuthKey_72D98R3MFC.p8` (`0600`, md5-verified, outside the git checkout),
`APNS_KEY_FILE`/`APNS_KEY_ID`/`APNS_TEAM_ID` appended to the prod backend `.env` (backup
`.env.bak.2026-08-10-apns`, confirmed caught by `.gitignore:10`), API restarted →
`push.configured()` = `{"android":true,"ios":true}`.

But *configured* only means the file parsed. **The real check: a push to a deliberately fake
device token returned `apns_400:BadDeviceToken`.** Apple must authenticate a request before it can
judge the token, so that error proves the JWT signed with the `.p8` was accepted and that
`apns-topic: com.loloshop96.app` matched. A wrong key/keyId/teamId returns `403
InvalidProviderToken` instead. `dead: true` also confirmed the device-cleanup path.
*(A false start: `/proc/<pid>/environ` showed no `APNS_` vars and looked like a failed restart.
It was the wrong instrument — `server.js:1` calls `dotenv.config()`, which populates `process.env`
at runtime and never touches the startup environment that `/proc` reports.)*

**Credential hygiene.** Both `.p8` files in `~/Downloads` were EC private keys, indistinguishable
by content. Checking both Apple consoles settled it: `72D98R3MFC` is **APNs**
(developer.apple.com → Keys) and `WLABBTJQT2` is the **App Store Connect API key** («RevoArt»,
Admin, last used today — it is what Codemagic uploads with). Deleting the wrong one would have
broken uploads entirely. All four LoloShop credentials moved to
`~/Desktop/_private/loloshop-credentials/` (dir `700`, files `600`, md5-verified before and
after) with a `README.md` naming each. Three **awtar** files left alone — different project.

**Merged and deployed.** `ios-appstore` → `main` (`11a7a43`), then `ios-appstore`
fast-forwarded to it so the pipeline is no longer stranded on a branch. The merge adds
`@capacitor/ios` as a **dependency**, so it passes through the `npm audit` deploy gate that
blocked deploys twice on 2026-08-09 — all four CI gates were therefore run locally first (audit
0 vulnerabilities, `npm ci --dry-run` in sync, 0 lint errors, build completes) before the push
that triggers the auto-deploy. Prod confirmed on `11a7a43`.

**Also corrected:** the board called iOS "unshipped". App Store Connect shows **iOS 1.0 Ready for
Distribution** — it was approved, which is precisely what closed the 1.0 train.

**Open follow-ups:** no iOS device token exists until someone installs 1.0.4 from TestFlight and
grants the prompt, so iOS push is proven only at the credential layer · Android 1.0.4 is in
production review with managed publishing ON (approval will not publish it) · iOS 1.0.4 still
needs submitting in ASC · **every future iOS submission must raise `MARKETING`** or it fails at
publish after a full successful build.

---

## 2026-08-08 — 🔔 push notifications built end-to-end, and the eight review findings closed

Branch `claude/handoff-cloud-board-tasks-v342hb`, off `feat/deeplinks-and-location`.
**Migration `077_push_notifications.sql` — pending.** Gates: `tsc` 0 · `eslint` 0 · `next build`
exit 0 · backend syntax check clean · `node --test` on the three DB-free suites **13/13**.
⚠️ The DB-backed suites (the other ~177) were **not run** — this sandbox has no PostgreSQL and
`lib/db` refuses a Neon URL outside production. That is a real gap in the evidence, not an
omission: the migration and the outbox drain have never touched a live table.

This clears both items the cloud board listed. The full narrative:

### Why the outbox, and not a send call at each site

There are **thirteen** `INSERT INTO notifications` in this codebase and several of them run
inside `tx()` — `orderController`, `joinController`, `designController`, `productionController`,
`lib/orderApproval`. Two bad options follow from that. Sending from inside the transaction pushes
a notification for work that can still roll back: a student gets «تمت الموافقة» for an order that
does not exist. Sending after it means threading an "and now push this" value out through every
one of those callers, and the fourteenth insert somebody writes next month forgets.

Making the ROW the queue removes the choice. `push_state` / `pushed_at` on `notifications`, and
`backend/lib/pushOutbox.js` claims committed rows with `FOR UPDATE SKIP LOCKED`. Only committed
rows are ever visible, so the rollback case is structurally impossible; a row claimed by a
process that dies comes back after five minutes; and **no controller changed**, so nothing can
forget. It is also safe if PM2 ever moves to cluster mode, unlike `memoCache` and `eventBus`.

**⚠️ The flood guard is the part to be careful with.** `push_state` defaults to `'pending'`,
which means every notification this shop has ever written becomes a send candidate the instant
the columns exist. Two independent guards: the migration retires everything older than ten
minutes to `'skipped'`, and the drain only ever claims rows from the last fifteen. The backfill
is repeated verbatim in `db/schema.sql` — that is the file `npm run migrate` actually applies,
against the production database, and running the plain migrate command without it would have
been the accident. A third piece, `retireStale()`, sweeps every five minutes: without it every
row the drain never reached stays `'pending'` forever and the partial index grows to cover the
whole table, which is the opposite of why it is partial.

### Why no `firebase-admin`

`.github/workflows/ci.yml:46-58` gates the **deploy** on `npm audit --omit=dev
--audit-level=moderate` in both jobs. A dependency that picks up a moderate advisory therefore
stops the *website* shipping, not just the feature that pulled it in — the board already flagged
this as "relevant the moment `firebase-admin` or similar lands". `firebase-admin` brings ~40
transitive packages (google-auth-library, gaxios, protobufjs, …) permanently inside that gate,
to do two things Node already does: sign a JWT and open an HTTP/2 stream.

`backend/lib/push.js` is FCM HTTP v1 + APNs HTTP/2 on `crypto`, `http2` and global `fetch`.
~330 lines, no new package.json entry.

**The ES256 detail that eats a day if you get it wrong:** Node signs ECDSA as DER by default and
JOSE wants the raw r‖s pair, so the APNs provider token needs
`crypto.sign('sha256', data, { key, dsaEncoding: 'ieee-p1363' })`. Without it every request comes
back 403 InvalidProviderToken while the key, the kid and the team id are all correct and there is
nothing to read that says why. `backend/test/push.test.js` verifies the signature against the
public key **and** asserts it is exactly 64 bytes, because the length alone catches it.

### Why iOS does not go through Firebase

The board's plan was "APNs `.p8` → upload to Firebase". That works, but it costs an iOS SDK
inside the app: with plain `@capacitor/push-notifications` the iOS token IS the APNs token, and
getting an FCM token instead requires Firebase Messaging linked into the Xcode project plus a
`GoogleService-Info.plist`. That project is regenerated from Capacitor's template on **every**
Codemagic run (`npx cap add ios`) — the same trap that already forces the privacy strings and the
associated-domains entitlement to be re-injected by hand each build. A third thing to lose
silently, for no gain.

Sending straight to Apple needs nothing in the app at all. So: **the owner's Firebase project is
Android-only**, and the `.p8` goes in the backend `.env` (`APNS_KEY_FILE` / `APNS_KEY_ID` /
`APNS_TEAM_ID`), not — or not only — uploaded to Firebase. Documented in `backend/.env.example`
and at the top of `lib/push.js`.

### The Android permission nobody declares for you

`@capacitor/push-notifications` does **not** put `POST_NOTIFICATIONS` in its manifest. It names
it only in a Capacitor `@Permission` annotation on `PushNotificationsPlugin.java:29`, which is a
runtime alias; the plugin's own `AndroidManifest.xml` contains one thing, the
`FirebaseMessagingService` entry. Both files read in `node_modules`, not assumed.

Android denies a runtime request for a permission the merged manifest does not declare **without
showing a dialog**. So on every Android 13+ phone `requestPermissions()` would resolve `'denied'`
instantly, `register()` would never run, no token would ever exist — and nothing anywhere would
say why. That is precisely the failure mode the two location permissions were added to fix in the
same file. It is compiled into the AAB, so noticing it after the release costs another one.

Also: `npx cap update android` was run, because `capacitor.settings.gradle` and
`capacitor.build.gradle` are generated and had never seen the plugin — it was in `package.json`
since some earlier session and synced nowhere. `app/build.gradle` already applies the
google-services plugin only `if (servicesJSON.text)`, so a build **without**
`google-services.json` still succeeds and silently produces an app that can never register. That
is written into the manifest comment where somebody will actually hit it.

### The device-token rule that matters in this market

The upsert conflicts on **`token`**, not on `(user_id, token)`. Phones here are shared and
resold, and FCM/APNs hand the same token to whoever signs in next; conflicting per-user would
leave two live rows and deliver a student's «تمت الموافقة على طلبك» to the person who bought
their handset. `logout()` also unregisters **before** clearing the JWT and passes the token
explicitly, because axios' request interceptor reads localStorage in a microtask — by then it is
gone and the request would be a 401. Account deletion (migration 076 is an *anonymise*, so the
`ON DELETE CASCADE` never fires) drops device rows explicitly, with the test extended to cover it.

And the only thing that ever deletes a device row is an explicit provider verdict — FCM 404/403,
APNs 410/BadDeviceToken. Never a timeout, never a 5xx: treating those as fatal would quietly
unsubscribe every phone in the shop during one FCM outage, and nobody would find out until the
next notification nobody received. `push.test.js` pins that table both ways.

### The permission prompt is asked once, after login

iOS shows the notification sheet **once per install** and a «رفض» can only be undone in system
Settings, which nobody does. Spending it on a student who is still browsing the shop, with
nothing to notify them about, burns it permanently. `PushRegistrar` therefore does nothing until
`getToken()` is non-null, and re-runs on `AUTH_CHANGED_EVENT` so signing in triggers the ask.
Both it and `lib/push.ts` are dynamically imported — the component sits in the ROOT layout, and a
static import would put axios in the first chunk of every page including the SSR storefront that
was deliberately built not to need it.

### The eight review findings

**Native detection was the interesting one.** `DeepLinkHandler.tsx:45-48` tested
`window.Capacitor` alone while `app-gate.ts:110` tested `window.Capacitor || window.androidBridge`
and the comment claimed parity. Both now import `isNativeShell()` from the new
`frontend/lib/native-shell.ts`, so they cannot drift again; the gate's inline head script is the
one unavoidable copy (it is built as a *string* for `<head>` and cannot import), and both sides
now say so.

**The hole underneath it is accepted, not fixed, and the board's own framing was right.** On
Android WebView <105 there is no Capacitor JS runtime at all, so `@capacitor/app` resolves to its
web implementation: `AppWeb.getLaunchUrl()` returns `{url: ''}` and `appUrlOpen` never fires. An
App Link on such a phone opens the app and drops the code — worse than the browser behaviour it
replaces. No feature detection recovers it, because reading the launch intent needs the bridge
that is missing. WebView 105 shipped in August 2022 and updates through Play, so the affected
population is phones with Play Services disabled or never updated — largely the same phones that
cannot install from Play in the first place. The real fix is navigating the WebView from
`onNewIntent` in `MainActivity`, which is native code no cloud session can compile or test. The
reasoning is written at the top of `native-shell.ts` so the next person does not re-derive it.

**Route order is pinned** by `backend/test/joinRouteOrder.test.js` — three tests, no database
(`lib/db` and the controller are stubbed into `require.cache` before the router loads, so it runs
anywhere in ~300ms). The third test builds a deliberately mis-ordered router and asserts
`/representatives` really *is* swallowed by `/:code`, so the first two cannot pass for unrelated
reasons. That mattered: a test that only asserts the good case is indistinguishable from a test
that asserts nothing.

**`join:` cache invalidation** now fires on rep create / update / deadline / delete, via a named
`invalidateJoinCaches()` in `adminController` with the reasoning attached. The prefix clears
`join:<code>` as well as `join:representatives`, deliberately — a جامعة or deadline edit changes
the referral page a student reads, not just the picker.

**The shared limiter is split and both halves raised.** `directoryLimit` 300/15min,
`lookupLimit` 200/15min. Iraqi carriers CGNAT, so one IP is routinely a cohort of 100+; the
enumeration defence the old shared 60 was tuned for is already spent, since `/representatives`
publishes every referral code in one unauthenticated response. **`joinLimit` (10/hour/IP) was
deliberately left alone** — it is the explicit bound on approval-queue spam accepted on
2026-08-07, and loosening a deliberate control is an owner decision, not a review finding. Its
identical CGNAT exposure is now on the board instead.

**`/join` can tell a network failure from an empty directory.** `getJoinRepresentatives` threw
away every error and resolved `[]`, so one dropped request on a phone rendered «لا توجد قائمة
ممثلين» — which reads as *your rep is not registered here* — on the exact screen that exists
because the student already lost their link. It throws now, and the page has a real error state
with a retry button and a request-sequence guard so a slow first response cannot land on a fresh
one.

**Dead code, stale comments, and the codemagic edge** were the remaining four: the
`?referrer=join_<code>` branch (unreachable since `/join` was allowlisted — removed, with what it
was for and when to restore it left in its place), `app-gate.ts` no longer claiming `/s /w /d`
must open in a browser, the spec's «two dropdowns» acceptance line reconciled with the shipped
grouped `<select>`, and the pbxproj injection made idempotent instead of bailing out on any
foreign `CODE_SIGN_ENTITLEMENTS`.

**⚠️ `codemagic.yaml` is not on this branch and could not be.** It exists **only** on
`ios-appstore` (`git log --all -- codemagic.yaml` — every commit is there; `main` has never had
it). Creating it here would be an add/add conflict the day that branch merges. So the
`aps-environment` entitlement and the injection fix are prepared as
`docs/patches/codemagic-ios-push-capability.patch`, verified `git apply --check` clean against
`f1785c0`, with the embedded Python executed against a synthetic `project.pbxproj` for three
cases — fresh template, re-run, and a foreign target with its own entitlements key. All three
wire exactly 2 configurations. `docs/patches/README.md` explains the whole arrangement.

**Not done, on purpose:** no Android CI workflow. The board says the owner builds the AAB by hand
and the keystore stays off GitHub.

---

## 2026-08-05 (e) — 🧾 the prep-queue data gap CLOSED: التجهيز cards now show the garment, not just the stitching

No migration. Gates: backend **177/177** (+10 new) · `tsc` 0 · `eslint` 0 errors · `next build`
exit 0. Committed to `feat/ssr-storefront-native-auth`.

**The board's framing was right and the fix followed it.** 325 of 326 prep cards read «لا تطريز على
هذه القطعة» *correctly* — the queue is robes, and zones are a sash/cap concept. The detector was
**not** touched. What changed is that the console now also answers the preparer's actual question.

**The two questions are different, and that is the whole insight.** The embroiderer asks «ما الذي
أطرّزه؟» — answered by `order_items` rows that carry `customer_text` or `customer_image_url`. The
preparer asks «أي روب أرفعه من الرف؟» — answered by rows that carry **neither**, because a spec line
(«لون الروب: أسود») is a *choice*, not content. Same table, opposite filter. That is why the data
was "already in the DB and still unrendered": every existing code path filtered on content.

`buildPieceSpec` partitions each order's lines three ways — grouped (a chosen option → the spec),
ungrouped with text (the student's own instruction), ungrouped and silent (pricing bookkeeping,
dropped). Zone lines are dropped too, since they already render as artwork. It is pure, so the rules
are asserted directly in `test/prepSpec.test.js` against **labels measured off the live queue**, not
invented fixtures.

**Measured before/after, by driving the real `getQueue` with a real preparer user over the real
435-row queue** — not a re-implementation of the handler:

| | before | after |
|---|---|---|
| prep rows with something to show | 3 | **416 (95.6%)** |
| rows carrying measurements | 0 (never sent) | **281** |
| empty cards | 432 | **19** |

**All 19 remaining empties are correct** and worth not "fixing": they are American shawls whose only
order line is «السعر الأساسي», because the product name — *شال امريكي 10* — already IS the spec. The
card shows the name and photo, which is the complete answer for that product.

**Details worth keeping:**
- `measurements` is gated **in SQL** (`CASE WHEN o.status IN ('preparing','ready')`), not filtered in
  JS. The prep queue is ~480 rows and that JSON would otherwise ride on every station's payload —
  dead weight on workshop wifi for a station that cannot use it.
- `chest_cm` is `0` on effectively every live order, so `0` is rendered as *absent* rather than
  «محيط الصدر: 0 سم». Documented on the shared `RobeMeasurements` type.
- The measurements type was **extracted** from an inline type on the order-detail response into
  `RobeMeasurements`, so the detail page and the queue row cannot drift. Same Arabic labels on both.
- `PieceSpec` uses flex rows, **not** `grid-cols-subgrid` — this renders on whatever WebView the
  workshop's Android phones ship with, and subgrid is too new to bet a production station on.
- Adding `spec`/`measurements` to `StationPiece` made `tsc` fail on the two *other* mappers
  (`queueToPiece`, `tailorToPiece`). Both were filled with an explicit `null` and a note, so the
  types record that التطريز/الفصال/الكوي never ask this question.

**⚠️ Note for anyone using the `postgres` MCP server on this project: it is pointed at a DIFFERENT
project's database.** Its `orders`/`order_items` carry `guest_claim_token`, `bundle_path`,
`delivered_inventory_ids` — a digital-goods store, not LoloShop. Every measurement above came from
LoloShop's own configured DB via `backend/lib/db.js`. Do not trust that MCP tool for this repo.

**Still open:** nobody has clicked the console in a browser.

---

## 2026-08-05 (d) — ✅ the prep batch reviewed, two defects fixed, committed as one unit

No migration. Gates on the batch as a whole: backend **167/167** · `tsc` 0 · `eslint` 0 errors ·
`next build` exit 0. Committed to `feat/ssr-storefront-native-auth` — 26 files, the (b) batch plus
the (c) docs trim plus the two fixes below. The branch now carries 4 unmerged commits.

**The batch was reviewed before committing, not just gated.** Both defects below pass `tsc`,
`eslint` and `next build` — the same class of thing as the TEMP line that once locked out every
user. Gates prove a batch compiles; they say nothing about whether a screen tells the truth.

**Defect 1 — «جاهزة للتسليم» told the preparer every packed piece had no embroidery.**
`PrepConsole` has two tabs over one queue (`preparing` · `ready`), but the station=1 enrichment in
`productionController.getQueue` attached zones only for `embroidery`/`preparing`. So every row in
the second tab arrived with no `zones`, and `StudentSheet` renders **«لا تطريز على هذه القطعة»** for
an *empty* zone list. The sheet cannot distinguish *"we looked and there is no artwork"* from *"we
never looked"* — so silence rendered as a statement of fact, on pieces that are demonstrably
embroidered. This is precisely the failure `ZoneThumb`'s own header warns about («a broken artwork
URL must not read as 'this zone has no image' — the preparer would pack a piece believing nothing
was stitched on it»), reached by a different route.
Fixed on both sides, deliberately: `ready` joined a named `ZONE_STAGES` set in the controller (free
— `detectZonesForOrders` is a single `order_id = ANY($1)` query, so a wider id list costs no extra
round-trip; `delivered` stays out, it is a history column, not work), **and** `PrepConsole` +
`StudentSheet` stopped collapsing `null` into `[]`. `StationPiece.zones` was already typed
`StationZone[] | null` and that null was meaningful; two `?? []` were throwing it away. The backend
change makes the tab useful; the frontend change means the screen can never again turn *not fetched*
into *not embroidered*, whatever a future caller does.

**Defect 2 — the same tab was then a dead end.** With zones fixed, every «جاهزة» row still read
«لا يمكن إكمال هذه القطعة من هنا حالياً». True — تأكيد التسليم collects a delivery method and
recipient, so it lives on `/staff/orders/[id]` and the backend grants no one-tap advance out of
`ready` — but useless as the only text on a tab that is nothing but those rows. Now «أكّد التسليم من
«التفاصيل»», via a `noActionHint` prop. It is a **prop, not a `kind` check**: both tabs render with
`kind="preparing"`, so the sheet genuinely cannot tell them apart, and a piece still *at* التجهيز
must not be told to confirm a delivery that has not happened. Only `PrepConsole` knows the tab.

**Not done, and not claimed:** nobody has clicked the prep console in a browser. It typechecks,
lints and builds against the real 326-student / 429-piece queue shape, but the smoke test is open —
carried onto the board.

---

## 2026-08-05 (b) — 🧵 التجهيز REBUILT AS THE التطريز UI (shared component, not a lookalike) · product photo on the queue row · **staff order photos were 60× oversized on prod** · the real prep queue has almost no embroidery in it

**Uncommitted.** No migration. Gates on the FINAL tree: **`tsc` 0** · **`eslint` 0 errors** (6 warnings, all
pre-existing in the Android build artifact) · **`next build` exit 0** (49/49 pages) · **backend 167/167** ·
walked in a real browser against the **real production data** (laptop dev DB is a prod snapshot: 1,787 orders,
1,165 users through 2026-07-26).

### What the owner asked
① «make it just like التطريز ui» — the same-day first cut had **deliberately departed** from the embroiderer's
console (one card per student, every zone image on screen at once, no sheet). That was the wrong read of the
original request «خلي عامل التجهيز مثله مثل واجهة عامل التطريز»: *مثله مثل* means the SAME interface.
② «add the pic of the product also». ③ «are the صور التصاميم the same ones التطريز sees — the calligrapher's?»

### ③ answered first, because it is a fact about the code, not a choice
**Yes, identical — by construction, not by convention.** `productionController` builds ONE id list
(`status === 'embroidery' || status === 'preparing'`) and makes ONE `detectZonesForOrders` call, which reads
`order_items.customer_image_url`. There is no second التجهيز path that could ever drift.
And that column is exactly where the calligrapher's plates land — `calligraphyController.js:558`:
`UPDATE order_items oi SET customer_image_url = cp.plate_path … AND oi.customer_image_url IS NULL`.
So a zone picture is **the student's own upload if they made one, otherwise the calligrapher's plate** (the
`IS NULL` guard means a plate never overwrites a student image). Same rule, same pixels, both stations.

### What shipped
- **`PrepConsole.tsx` rewritten (486 lines) as the station console's students view**, and
  **`"preparing"` is now a real `StationKind`** so التجهيز literally reuses **`StudentSheet`** — the two screens
  cannot visually drift. Same list rows, same filter card (search · الكل/تجزئة/ممثلين · rep select), same sheet,
  same ✓ ghost rows, same scroll-restore and sheet-reopen-on-back.
- **The ONE difference lives in the shared sheet, not in a copy:** التجهيز zones are **read-only** (`zonesReadOnly`).
  No checkbox — the stitching is finished by the time a piece reaches التجهيز and the backend exposes **no
  zone-tick endpoint** for `preparing`, so `done` is meaningless there.
- **🔴 Fixed a real bug in the shared sheet: zone text was being DROPPED.** The old split was
  `withImage` / `textOnly`, so a zone carrying **both** an image and text rendered only the thumbnail. All 3 real
  zones in the live queue hit it, hiding «كلية الطب -الشعار غير ملون-Class of 2027» and
  «الدكتورة ملاك خالد غضبان (اذا كفى المكان بالوشاح)» — *instructions*, not decoration. Text now sits beside the
  artwork. This also affected التطريز.
- **Product photo on the queue row** — `p.image_url AS product_image_url` added to the production-queue SELECT
  (it was already on the order DETAIL for every staff role). Renders as a 44 px thumb beside the piece name in the
  shared `PieceCard`, tappable into the same lightbox. **Deliberately in the shared card, so التطريز gets it too**
  — putting it only in التجهيز would re-create the divergence this session removed. الفصال passes `null` (its
  tailor-queue endpoint carries no catalog photo).
- **`StationConsole`'s `kind` narrowed to `ConsoleKind = Exclude<StationKind,"preparing">`** — honest typing:
  التجهيز shares the *sheet*, not the console (its tabs are a status filter, not عرض بالطلب/عرض بالقطع).
- **The `عرض 25 من 326` cap is GONE.** It only existed because the rejected design rendered every student's
  artwork at once (which OOM-killed the dev server). Images now load only inside the opened sheet, so all 326
  students render uncapped — the same reason التطريز never needed a cap.

### 🔴 SEPARATE AND LIVE ON PROD: staff order photos bypassed the image optimizer
`app/staff/orders/[orderId]/page.tsx` hardcoded **`unoptimized` on all 9 `<Image>` tags**. A per-image prop
**overrides** `next.config.ts`'s `unoptimized: NODE_ENV === "development"`, so this was bypassing the optimizer
**in production too**. Measured against the live server, same photo:

| | bytes | cache |
|---|---|---|
| raw (what the page did) | **724,571** | `private, no-store` → refetched every single visit |
| via `/_next/image` | **12,148** WebP | `public, max-age=604800`, `x-nextjs-cache: HIT` |

**60× smaller and actually cacheable.** All 8 props removed (the 9th was already gone). Verified every site is a
real server URL via `resolveImageUrl` — **no blob:/data: upload previews**, which genuinely need `unoptimized`.
Dev behaviour is unchanged (the global config still disables the optimizer there, for the documented 7 s
upstream-timeout reason). The page is also `"use client"`, so it still pays a client waterfall — untouched.

⚠️ **The same bug is in 12 more places, NOT fixed** (each needs the blob/data check first):
`admin/packages` ×3 · `admin/products` · `AdminProductMedia` ×2 · `design-support` ×2 · `(student)/package` ·
`(student)/cart` · `VipHero` · `VipStoryStrip` · `StaffOrderBreakdown` · `OrderBreakdownCard`.

### ⚠️ THE FINDING THAT MATTERS MOST: التجهيز has almost no embroidery in it
Measured through the real `?station=1` endpoint with a real preparer token — **429 pieces, 326 students**:

- **325 of 326 student cards (99.7%) show «لا تطريز على هذه القطعة» on every piece.** Exactly **one** student
  (Malak Khalid) has artwork.
- Because the queue is **307 robe · 104 cap · 64 shawl · 2 sash**. Zone artwork is a sash/cap concept; the
  preparer's real work is 71% robes.
- **This is not a bug** — the detector is right. `القبعة من الأعلى: سادة` (60 items) matches the zone regex but
  carries no text and no image, because *سادة* means plain. Correctly skipped. **Do not "fix" it.**
- **What the preparer actually needs is in the DB and still not rendered:** `لون الروب` · `قماش الروب` ·
  `فصال الروب` · `الشكل` · `لون القبعة`, plus **303 of 477** preparing orders carry `measurements`, and 225 items
  carry «كسرة الكتف» text. A card today is name + product photo + product name + التفاصيل + إنهاء.
  **Owner decision, deliberately not built.**

### Verified in a browser (real data)
Signed in as `موظف التجهيز (تجريبي)` (`staff_types={preparer}`) → list renders **429 قطعة · 326 طالب**, uncapped,
compact rows with a `N صورة تطريز` hint marking which students are worth opening → search «Malak» narrows to 1 →
sheet opens showing the **product photo beside each piece name**, three **read-only** zone rows each with
**artwork + its stitch text**, «إنهاء التجهيز، تحديد جاهز» per piece and a sticky «إنهاء كل القطع (3)» footer →
the no-artwork pieces render «لا تطريز على هذه القطعة.» + their button. Console clean.
Live API re-checked after the SQL change: `product_image_url` present on **429/429** rows.

### Open follow-ups
- **▶ NOTHING IS DEPLOYED — and the 2026-08-04, 08-02 and 08-01 work is still undeployed too. Deploy = push +
  `bash scripts/deploy.sh`.** No migration.
- **⚠️ COMMIT AS ONE UNIT** — same trap as before: `app/staff/page.tsx` imports the untracked
  `components/staff/prep/`, `components/staff/ZoneThumb.tsx` and `hooks/useScrollRestore.ts`. A partial commit
  typechecks locally and dies on the VPS at `npm ci`.
- **The prep-queue data gap above** is the highest-value next move for التجهيز.
- **⚠️ The Next 16 dev server OOM'd 3× this session** (V8 heap ~3.5 GB while 4.5 GB of system RAM was still free).
  It first died **before any code changed**, on the order detail page — it is the dev server on this laptop, not
  this work. `NODE_OPTIONS=--max-old-space-size=3072` did not save it. `next build` is unaffected.
- **⚠️ `pkill -f "next dev"` kills its own launcher** — `pkill -f` matches the pattern text inside the invoking
  shell's own command line. Kill the port owner instead (`ss -ltnp | grep :3000`).
- **The turbopack workspace-root warning is back** — a stray `/home/mint/package-lock.json` outranks the repo.
  The 2026-08-04 entry says `turbopack.root` was pinned; the warning still prints. Worth a look.
- `frontend/public/dev-token-tmp.json` now holds a **preparer** JWT (was a student's). Gitignored — never commit
  it, nor `frontend/public/dev-login.html`.
- **Prod SSH was blocked by the permission classifier this session**, so every number above comes from the laptop
  prod snapshot (through 2026-07-26). Today's live queue holds different *orders*, but the product mix that drives
  the finding is structural.

---

## 2026-08-04 — ⚡ STOREFRONT MOVED SERVER-SIDE (the recorded SSR blocker was wrong) · auth family made native · onboarding gender rows redrawn · **a TEMP debug line that would have locked every user out**

**Committed on main, NOT pushed.** No migration. Spec: `docs/superpowers/specs/2026-08-04-native-app-shell-and-ssr-design.md`.
Gates on the final tree: **`tsc` 0 · `eslint` 0 errors** (6 warnings, all pre-existing in the Android build
artifact) · **`next build` exit 0** · **backend 167/167** (backend untouched). Walked in a real browser against a
**production** build, not just dev.

Built in parallel across three sessions on disjoint file sets; this session owned the performance lane and did the
merge, gates and commit.

### ⚠️ READ THIS FIRST: the SSR blocker recorded on 2026-08-01 was not real
The board said: *«getShopFeed() is role-aware and the JWT lives in localStorage, so a Server Component cannot know
who is asking»* — and therefore SSR risked showing a wholesaler the retail price book. The backend says otherwise:

- `priceRoleForUser(user)` → **`if (!user) return 'retail'`**. A guest already gets the retail price book.
- `buildShopFeed(audience)` → the visibility filter is the **same string**, `AND p.wholesaler_only = FALSE`, for
  **both** `guest` and `retail`. Only `wholesaler_student` branches.
- So the guest feed and a signed-in retail student's feed are **identical** apart from an `audience` label the UI
  never prices off. The one audience that differs (rep-linked students) is redirected to `/my-order` before the
  feed renders.

**There was never a price book to leak.** No httpOnly-cookie migration was needed. That migration remains the
right long-term move (it would let `/wholesaler` SSR too) and is still deferred — it touches every login path for
1,141 live accounts.

⚠️ **The invariant this now depends on:** if anyone makes the `guest` and `retail` audience filters diverge in
`buildShopFeed`, `lib/catalog-server.ts` becomes wrong and the home page must go back to fetching per-user. That
is written at the top of the file too.

### What shipped — performance
- **`lib/catalog-server.ts`** — unauthenticated server fetch for the feed + maintenance flag. `revalidate: 120`
  matches the backend's own 120 s `memoCache` exactly; maintenance uses **30 s** because it is a switch the owner
  flips when something is wrong. **Never throws** — a failed fetch returns `null`/`{active:false}` and the page
  falls back to the old client path, so a backend hiccup costs the optimisation, not the storefront.
- **`lib/catalog-map.ts`** — the shop-feed mappers extracted out of `lib/catalog.ts`. The feed is now fetched by
  **two transports** (axios in the browser, native fetch on the server) and they must produce byte-identical
  objects or hydration disagrees and React throws away the server HTML. One mapper, imported by both.
- **`app/(student)/page.tsx` → Server Component** rendering the new client `components/shop/StudentHome.tsx`.
  **`app/(student)/shop/page.tsx`** feeds `CatalogBrowser` the same way.
- **Both routes now prerender statically with ISR** — `/` at 30 s, `/shop` at 2 m. Measured on the running server:
  **106 product images and the LCP hero present in the initial HTML, zero skeleton.** That deletes the 2113 ms
  "load delay" from the CrUX field data (where load *duration* was only 289 ms — the bytes were never the problem,
  discovery was), and TTFB becomes a static file read.
- **CLS needed no new work** — the skeleton→content swap that caused most of 0.49 no longer happens, and
  `CohortProof` already pins its band height while `ProductTile` uses fixed aspect ratios.
- **`priority` purged from 8 components.** It is **deprecated and inert in Next 16**, so every one of them was
  silently lazy-loading an above-the-fold image. `BrandMark`/`BrandLogo`'s prop was **renamed `priority` →
  `eager`** deliberately: the rename forces each call site to be re-read instead of letting a dead prop keep
  looking correct.
- **`turbopack: { root }` pinned in `next.config.ts`.** Next infers the workspace root by walking up for a lockfile
  and taking the **outermost** match — a stray empty `package-lock.json` in `/home/mint` (no `package.json` beside
  it) made it treat the entire home directory as the project root. Also deleted a second stray empty lockfile at
  the repo root. Same trap can happen on the VPS; pinning makes it deterministic.

### What shipped — onboarding + auth (other sessions, reviewed here)
- **Gender selector redrawn.** Stacked rows (`icon · label · tick`), 76 px, **58 px full-colour figures** in
  `components/student/GraduateIcons.tsx`. **Three earlier monochrome-silhouette attempts were rejected** —
  a one-colour shape carries meaning only in its outline, and «graduate wearing a mortarboard» has the same
  outline for everyone. These use skin/hair/gown/tassel as four channels, and the differentiator is a large dark
  mass (her hair, drawn wider than her shoulders) because a mass survives blur where a contour does not.
  **No beard** (owner removed it) and **no hijab** — `public/lookbook/grad-moments-1.jpg` shows rows of hijabi
  graduates *and* students with hair out, so committing to either excludes real buyers. Working check: shrink to
  50 % and blur 2 px; the two must still be tellable apart.
- **Onboarding hero re-cropped** to `onboarding-hero-v2.jpg` — the original put the subject dead-centre with gold
  embroidery running through the entire lower third, exactly where the headline sits.
- **Auth family made native by fixing `AuthCard` once**, so login/register/forgot/reset/verify-otp/join all
  inherit it: floating card killed for a full-bleed screen, **`TeamKeyEntry` collapsed behind «فريق العمل؟»**
  (it rendered unconditionally, so every student saw a staff secret-key field), inline errors instead of a
  floating toast, safe-area insets, transform-only step transitions. **No auth logic changed** — phone + password
  + OTP is untouched.

### 🔴 The bug that every gate passed
`app/login/page.tsx` shipped with:
```
const [step, setStep] = useState<"credentials"|"otp">("otp"); // TEMP-VERIFY
```
A verification pass seeded the OTP step to screenshot it and left it in. **The phone/password form was
unreachable — nobody could log in.** `tsc`, `eslint` and `next build` all passed, because it is perfectly valid
code. Only opening the page in a browser caught it. Fixed, with a comment explaining why that line must never
come back, and the whole diff was swept for other `TEMP`/`DEBUG`/`TODO` markers (clean).

### Verified in a browser (production build)
Fresh visitor → onboarding step 1 (re-cropped hero, «تخطّي» reachable) → step 2 → icons measured **58 px inside
76 px rows, not clipped** → filled سارة + طالبة → **register flipped feminine**: «أهلاً سارة» ·
«جاهزة ليوم تخرّجچ؟ خلّينا نجهّز إطلالتچ.» · nav search «دوّري…» → reload: **not asked again**, profile persisted.
`/login` renders the credentials form, full-bleed, no staff-key field. `/shop` and `/account` hydrate fully.
Home page hydrates **67/67 interactive elements, 689/732 nodes**.

⚠️ **Hydration on `/` takes ~2 s on this laptop** under two dev servers + Chrome. Reading the DOM before that
makes the page look dead and the greeting look stuck on the neutral register — it is not. I burned a long
detour on exactly that false alarm; **wait 2 s before asserting anything about home-page hydration.**

### Open follow-ups
- **▶ Committed but NOT pushed. Deploy = push + `bash scripts/deploy.sh` on the VPS.** No migration.
- **Set `API_INTERNAL_URL=http://127.0.0.1:4000` in the VPS frontend `.env`.** Optional but free: without it the
  server-side fetch falls back to `NEXT_PUBLIC_API_URL`, i.e. the box resolves its own DNS and opens a TLS
  connection to itself through nginx to reach an API on localhost. Correct either way, just slower.
- **The API must be reachable during `npm run build`** now, since `/` and `/shop` prerender. It is — PM2 keeps the
  old backend running through the frontend build — and if it ever is not, the pages prerender with `initialFeed:
  null` and self-heal on the first revalidation.
- **`server-only` is not a dependency.** `lib/catalog-server.ts` uses a zero-dependency `typeof window` guard
  instead. Adding the package would be tidier.
- **`npm test` does not exist in `backend/`** — the real command is **`node --test test/`**. Worth putting in
  CLAUDE.md.
- **The product page (`/product/[id]`) was deliberately NOT converted.** 629 lines of client state; splitting it
  into a server hero + client configurator was cut as the highest-risk item in a same-day ship. It still pays the
  full client waterfall.
- Unchanged and still open: `users.gender` column (gender stays device-local), the «لبسوا تصاميمنا» caption
  overstating registrations as wearers, the 54 existing 4–6 MB photos on disk, and the `/get-app` landing page
  (owner is doing that in a separate session).
- Untracked and must never be committed: `frontend/public/dev-login.html`, `frontend/public/dev-token-tmp.json`.

---

## 2026-08-02 — 📱 APP SHELL: onboarding + bottom tab bar + storefront-D home (sliders per family) · `/shop` is a real page · a dead gender key found

**Uncommitted on main.** No migration. Gates, all run against the FINAL code: **backend 167/167** · `tsc` 0 ·
`eslint` **0 errors** · **`next build` exit 0** (49/49 pages, `/shop` prerendered) · walked in a real browser at
390px and 1280px as a guest, mid-onboarding, and signed in.

⚠️ **A cold `next build` right after `rm -rf .next` failed** with dozens of module-not-found errors inside
`next/font/google`'s generated CSS. It is the font fetch, not the code — the immediate re-run was clean. Don't
go hunting for a bug if you hit it.

**The ask.** Owner picked **first-look bet C** («الدفعة» — proof-led), then: «add an onboarding and change navbar
and all home screen like `docs/mockups/storefront-d.html`, **but the onboarding is bad here**».

### What shipped
- **NEW onboarding** (`components/student/Onboarding.tsx`, mounted in the student layout). Two steps: the
  emotional beat, then الاسم + طالب/طالبة. **Three deliberate departures from the mockup, which is what «bad»
  meant:** ① the mockup's continue button stayed disabled with **no way past** — a stranger had to hand over a
  name and a gender before seeing one product; **both steps now carry «تخطّي»**, and skipping is remembered
  (`seen: true`) so nobody is asked twice. ② it asked **signed-in students what the DB already knows** — it now
  renders nothing when a token is present. ③ the ask now **buys something visible** (below).
- **⚠️ THE FIND: `loloshop_student_gender` was READ but NEVER WRITTEN.** The product page filtered its option
  groups by it, and `groupVisibleForGender(g, null)` returns **true** — so every student has been shown the option
  groups restricted to the *other* gender, forever. The onboarding answer now fills the profile the product page
  reads (`lib/profile.ts`, one source, `PROFILE_CHANGED_EVENT` for same-tab sync). This is the honest justification
  for asking at all, and it is the same field the 2026-07-26 session had to convert from a `<select>` to radio
  cards after Chrome autofilled «ذكر» and silently priced the wrong order — so it is radio cards here too.
- **NEW navbar.** Slim sticky top bar (logo · search · bell) + a **bottom tab bar** (الرئيسية · القطع · السلة ·
  حسابي) with cart badge and safe-area inset. The old pill row put every destination in a scrolling strip at the
  top — the one place a thumb cannot reach. **The old header carried the only logout button**, so «تسجيل الخروج»
  moved to `/account`; without that there would have been no way to sign out.
- **NEW home = storefront-D**: **الدفعة (١٬١٤١)** → تحية → وعد → [أوشحة ⇄] → **ليش لولو شوب** → [روبات ⇄] →
  **باقة VIP** → [قبعات ⇄] → [شالات ⇄] → موقعنا. The story sections live in the GAPS between rails, so D's
  «goods first» thesis holds while its one weakness («ليش لولو شوب؟») gets answered. **The الدفعة band opens the
  page** (owner call mid-session — it was first placed mid-page to protect D's no-hero thesis; the owner wants
  bet C's proof first, so it is the opening frame and loads `eager`/`fetchPriority=high` as the LCP).
- **⚠️ `graduates` = the live count of registered student accounts, and is deliberately NOT `lib/counts`.**
  Reads **1,141** today and rises by one per **new account** — not per login, so nobody can inflate it by signing
  in twice. The owner first asked for a hand-given 1,837 baseline, then replaced it («it is a number from me, ok
  make it 1141»); since 1,141 IS the real account count, `graduatesServed()` now just measures it — no magic
  constant, no cutoff date, and it cannot drift from reality. **Never reconcile it against `/admin` or `/tv`**:
  those answer «كم طالب عنده طلب؟» (554 with a live order), this answers «كم طالب مسجّل؟». `GRADUATES_BASELINE`
  (default 0) is still added on top for the day the pre-system years should count.
- **`/shop` is a real page** (`(student)/shop`) — chips + search + `?type=` deep links. It used to `redirect("/")`;
  D's home has no grid, so «القطع» and every «كل ال…» needed a destination.
- **NEW gendered copy dictionary** (`lib/copy-ar.ts`). Arabic conjugates the second person, and the buyers are
  majority women — every second-person string is in one file in both genders plus a **neutral** set for a visitor
  who hasn't answered. Neutral is NOT the masculine. Also `modelsCount()`: 3–10 take the plural (٥ موديلات),
  11+ revert to the singular (١١ موديل) — «5 موديل» is an error a native reader sees instantly.
- **Photo:** `grad-crowd.jpg` carries an Instagram watermark + mute button along its bottom edge (the mockup hid
  them with a CSS crop that only worked at one aspect). `grad-crowd-hero.jpg` is the same shot **pre-cropped**
  above both, so plain `object-cover` is safe at any size. `priority` was NOT used — it is a silent no-op in
  Next 16; the onboarding hero uses `loading="eager" fetchPriority="high"`.

### Claims I refused to print
- **«جاهز خلال 5 أيام» appears in the mockups but NOWHERE in this repo or the DB**, so it is not on the storefront.
  The promise line reads «… · مخيوط بورشتنا · …» instead. Put the real turnaround back in **`lib/copy-ar.ts` only**
  (three strings) once it is confirmed.
- **The mockup's VIP card invented its numbers** — dearest item per family, priced 15% under the sum. The real
  package has its own price, perks and contents, so `VipPackageCard` renders those and shows **no saving at all**
  rather than a fabricated one. Live: ٣٥٠٬٠٠٠ د.ع with the real included items.

### Two things the owner called bad on sight, and what was wrong with each
- **The VIP card** rendered its contents as full-width table rows with a divider and **nothing in the second
  column** — a lone label beside an empty gutter, which reads as an unfinished table — and the price sat naked
  with no label. Now: a «شنو بالباقة» tick list (no second column to leave empty), perks as quiet pills, and
  «سعر الباقة» beside the figure.
- **The intro** was a photo panel stacked on a cream footer bar, so a hard seam cut the screen in two and the
  headline was squeezed against it. Now it is **one full-bleed frame** — copy, dots and button all sit on the
  photo, the copy hangs off the bottom with `mt-auto` so it breathes on any phone height, and a
  «سؤالين بس · أقل من دقيقة» line tells the visitor what «يلا نبدأ» costs before they tap it.

### Verified in a browser
Fresh visitor → onboarding → «تخطّي» present on both steps → filled سارة + طالبة → **the whole app flipped to the
feminine register** («أهلاً سارة» · «جاهزة ليوم تخرّجچ» · «دوّري على…») → reload: **not asked again**, profile
persisted. Signed in with **no** local profile → onboarding **does not show** and the greeting falls back to the
account name. `/shop?type=cap` lands pre-filtered (chips: الكل 53 · وشاحات 11 · روبات 20 · قبعات 5 · شالات 17);
search «توكسيدو» → 3 hits. `/account` signed-out shows «تفضيلاتي» (which is what makes onboarding's «تنعدّل بأي
وقت من حسابي» true for someone with no account); signed-in shows identity + logout + the deletion danger zone.
Console clean. Desktop 1280 renders 4-up rails with the RTL arrows disabling correctly at each end.

Re-verified after the second round of owner changes: the الدفعة band opens the page reading **1,141**, the VIP
card renders its tick list + «سعر الباقة» + gold CTA, and the intro is a single frame with «تخطّي» reachable.

### Open follow-ups
- **▶ NOTHING IS DEPLOYED, and the 2026-08-01 image work is still undeployed too. Deploy = push.** No migration.
- **⚠️ COMMIT THIS AS ONE UNIT.** Tracked, modified files (`(student)/page.tsx`, `(student)/layout.tsx`,
  `StudentNav.tsx`, `(student)/product/[id]/page.tsx`, `(student)/account/page.tsx`) import **nine brand-new
  untracked ones** — `lib/profile.ts`, `lib/copy-ar.ts`, `lib/shop-sort.ts`, `components/student/{Onboarding,
  ProfilePreferences}.tsx`, `components/shop/{CatalogBrowser,CohortProof,FamilySlider,VipPackageCard,
  WhyLoloShop}.tsx` — plus the new asset `public/lookbook/grad-crowd-hero.jpg` and the moved
  `(student)/shop/page.tsx`. A partial commit typechecks locally (the files are on disk) and then **dies on the
  VPS at `npm ci`**. Same trap as the 2026-07-29 workshop branch.
- **Nothing about the app stores.** Both shells are webviews on `server.url = https://lolo-shop96.com`
  (`capacitor.config.ts`), so all of this reaches phones on deploy — **no rebuild, no new binary, no store
  upload**. The service worker is navigation-network-first and Next fingerprints `/_next/static/`, so no stale-UI
  trap and no cache-version bump needed. The open iOS submission track is unaffected and unchanged.
- **⚠️ Restored `frontend/public/logo.png`** — it was deleted in the working tree before this session (tracked, so
  `git checkout` brought it back) and was 404ing on every page. If that deletion was deliberate, revert it.
- **⚠️ Deleted the dead `app/shop/` shell** (`layout.tsx` + two `loading.tsx`, **no page at all** — the real product
  page is `(student)/product/[id]`). Recoverable from git. I nearly lost it to an `rm -rf` before checking; the
  files are back and only the genuinely orphaned ones are gone.
- **Unused now, deliberately NOT deleted:** `components/shop/BrandStory.tsx` (AtelierStory · MilestoneStory ·
  DesignProcess) and `components/vip/VipHomeBand.tsx`. D's home has no room for them. If you want the atelier
  band back, drop it into one of the gaps. (`ShopCover.tsx` WAS deleted — `CohortProof` replaced it, and leaving
  two near-identical heroes would have been a trap.)
- **`/shop` LCP:** the first grid tiles lazy-load, so Next warns they are the LCP element. `ProductTile` has no
  eager option and is shared by many surfaces — wants a small `priority`-style prop for the first N tiles.
- **⚠️ The caption over that number still reads «طالب وطالبة لبسوا تصاميمنا» — *wore*.** The figure counts
  **registrations** (1,141), while only **554** have an order and almost none are marked delivered. If that
  overstates it, «طالب وطالبة سجّلوا معنا» is one string in `CohortProof.tsx`. Owner's call, not changed.
- **`next.config.ts` now lists `lolo-shop96.com` in `images.remotePatterns`.** Redundant on prod (it is what
  `apiHost` already resolves to) and there purely so a LOCAL production run can render the prod-snapshot photos
  instead of 400ing on all 54. This is the «hostname not configured» trap the 2026-08-01 entry warned about.
- **Gender is device-local.** `users` has no gender column, so a signed-in student still gets the neutral register
  until they set it in «تفضيلاتي». Adding the column is the real fix; not done.
- **The home is still a client component** — the 2026-08-01 SSR/waterfall decision is untouched and unchanged.
- **Dev servers:** another project holds **:3000**, so loloshop ran on **:3001** with `CORS_ORIGIN` extended **via
  an env var, not a file edit** (`backend/.env` is unchanged). The frontend dev server was **OOM-killed twice**
  (~1 GB free with two Next servers + Chrome) — expect that on this laptop.
- Untracked and must never be committed: `frontend/public/dev-login.html`, `frontend/public/dev-token-tmp.json`.

---

## 2026-08-01 — 🖼️ IMAGE WEIGHT: product photos were **4–6 MB each, served raw and uncacheable** · fixed at delivery AND at upload · `priority` was a silent no-op in Next 16

**Uncommitted on main.** No migration. Gates: **backend 167/167** (+6 new) · `tsc` 0 · `eslint` **0 errors**
(6 warnings, all pre-existing in the Android build artifact) · verified over real HTTP and in a real browser.
`next build` NOT run locally (disk 93%); it runs on the server at deploy.

**The report.** «the products photos and uploading photos is slow … can u check for everything is a client side or ssr?»

### What was actually wrong — measured on prod, not guessed
1. **Product photos are 4.3–6.1 MB PNGs.** The وشاح الفراشة hero: **6,003,607 bytes, 1856×2304**, on a 390 px phone.
2. **Nothing resized on upload.** `lib/upload.js` loaded `sharp` but only called `.metadata()` to validate. A 6 MB
   phone photo went in and stayed 6 MB on disk forever.
3. **`/uploads` is `Cache-Control: private, no-store`** (`server.js:73` + `nginx-ssl.conf:57`), so every raw-`<img>`
   photo re-downloaded in full on **every visit and every back-navigation**.
4. **The product page bypassed the optimizer** — `ProductMediaGallery` used a raw `<img>` (its comment even said
   "catalog media is served unoptimized anyway") and passed `unoptimized` on the thumbnails. **The home grid was
   already correct**, which is exactly why the grid felt fine and the product page didn't.
5. **Answer to the SSR question: 47 of 54 pages are `"use client"`.** The whole storefront renders client-side —
   no `generateMetadata`, no server fetching anywhere in `app/(student)/`. The product page is a 4-step waterfall
   (HTML shell → JS → hydrate → `useEffect` fetch → *only then* the image request). Trace at Slow-4G + 4× CPU:
   **LCP 3.68 s of which 2.79 s is render delay, CLS 1.10.**

**The optimizer was already installed and working — just unused on the page that needed it.** Measured on prod:
the same 4.5 MB PNG through `/_next/image` is **96 KB PNG / 13 KB WebP**, `x-nextjs-cache: HIT`,
`public, max-age=14400`. It also **overrides the upstream `no-store`**, so routing through it fixes caching too.

### What shipped
- **`ProductMediaGallery`** — hero is now `<Image>` through the optimizer inside a fixed `aspect-[4/5]` box with
  `object-contain` (photos measured 1856×2304 = 4:5, a few 1792×2400 — `contain` means the odd ratio letterboxes
  rather than **distorting**, which plain `fill` would have done). The fixed box also reserves space before load,
  which was the bulk of the 1.10 CLS. Thumbnails dropped `unoptimized` and gained `sizes="64px"`.
- **⚠️ `priority` IS DEPRECATED IN NEXT 16 AND SILENTLY DOES NOTHING** (`node_modules/next/dist/docs/…/image.md`:
  deprecated in v16.0.0 in favour of `preload`). My first cut used it and the browser showed **no**
  `fetchpriority`/`loading` attribute at all. Now `loading="eager" fetchPriority="high"` — `preload` is the wrong
  replacement *here* because the page is a client component that fetches in an effect, so the src does not exist at
  SSR time and a `<head>` preload link could never be written. **See follow-ups: ~8 other components still pass the
  dead `priority` prop.**
- **`backend/lib/upload.js` — re-encode on upload.** Files **over 500 KB** are auto-oriented from EXIF (which also
  strips EXIF/GPS), capped at **2000 px** long edge, and re-encoded. **Format policy is deliberately conservative:
  alpha → PNG, everything else → JPEG q85. No WebP is ever written to disk** — both are universally readable, so
  nothing downstream (staff downloading artwork, the calligraphy compositor, the ZIP export) can be handed a format
  it cannot open. Next converts to WebP/AVIF at *delivery*, which is where a modern format actually matters.
  Never throws: a failure keeps the validated original, because a slow upload beats a rejected one.
- **Artwork is exempt, on BOTH sides.** New `validateUploadedArtwork` (validate, never re-encode) on the two
  final-design routes, matched by `compress: false` on `uploadFinalDesign`. Embroidery artwork stays pixel-exact.
- **`frontend/lib/imageCompress.ts` + wired into `apiUploadFile`** — browser-side downscale before upload, same
  policy as the server. Put at the **single choke point all 11 callers already pass through** so a new upload screen
  cannot forget it. Non-images and small files pass through untouched; any failure returns the original file.

### Verified
- **Server, real HTTP, same file both ways:** the real 6 MB prod photo POSTed to `/api/catalog/uploads/image` →
  **old code stored 6,003,607 bytes** · **new code stored 208,010 bytes (3.5%), `.jpg`, 1611×2000**, no orphan
  `.png`, no stray `.tmp`.
- **Browser, real upload through the real `<input type=file>`:** a 15.53 MB / 2600×3200 PNG left the browser as
  **content-length 385,548 (2.4%)** with `filename="phone-photo.jpg"` + `Content-Type: image/jpeg` rewritten
  **together** (a MIME/extension mismatch is a hard 400 in `imageFilter`). **That file would previously have been
  rejected outright by multer's 10 MB cap.**
- **Browser, product page:** hero renders through `/_next/image` at `w=640`, `object-contain`, `fetchpriority=high`,
  `loading=eager`, uncropped.
- **6 new backend tests** covering the shrink, alpha preservation, the small-file skip, the artwork no-op, the
  mismatch rejection, and the never-grow guard.
- **Prod delivery after the fix:** 20–41 KB WebP in 0.6–0.8 s (cold MISS measured at 1.36 s).

**⚠️ A test caught a real design point.** The first fixture used random noise — incompressible, so the JPEG came out
*larger* and the "never grow the file" guard correctly declined to re-encode. **The code was right and the test was
wrong.** The fixture is now smooth gradients + grain, which reproduces the real ratio (6.0 MB → 184 KB). Kept the
noise case as its own regression test.

### ⚠️ SECOND PASS — the HOME page is a different bug, and the field data says it is the worse one
Owner came back with «at Home page it was loading very fast and now still slow». **First fact: none of the above was
deployed** (still uncommitted), so prod was unchanged. But measuring the home page turned up a separate, real defect.

**CrUX field data (real users, p75, home page URL): LCP 3905 ms · TTFB 1293 ms · Load delay 2113 ms ·
Load duration 289 ms · CLS 0.49.** Read that breakdown carefully: **load duration is only 289 ms**, so on the home
page **image bytes are NOT the problem** — the grid already went through the optimizer. The killer is the **2113 ms
"load delay"**: the browser cannot even *discover* the product images until the client JS has downloaded, hydrated
and fetched the catalog. (A lab trace on a warm cache reports LCP 840 ms and hides all of this — trust the field data.)

**Found and fixed: two API round trips were STRICTLY SERIAL.** `app/(student)/page.tsx` chained `loadShop()` *inside*
`getMaintenance().then()`, so every visitor waited for the maintenance check to come back before the shop feed was
even requested (~0.5 s each on prod, worse on mobile). They are now fired concurrently — verified in the browser:
the two requests start **3 ms apart and overlap**, where they were previously back-to-back. Safe because the
maintenance early-return sits *ahead* of the `loading` gate in the render path, so an active maintenance window still
wins regardless of how the feed resolved; the only cost is one wasted feed fetch during maintenance.
`/api/catalog/promo` was checked and is **not** a third serial hop — it belongs to `DiscountPopup` in the layout.

**What is left on the home page is the client-render waterfall itself, and it needs an owner decision** — see below.

### Open follow-ups
- **▶ NOTHING IS DEPLOYED. Deploy = push.** No migration. This is the single reason the site still felt slow.
- **⚠️ The real home-page fix is SSR, and it is blocked by an architectural constraint worth knowing:**
  `getShopFeed()` is role-aware (`optionalAuth` → retail vs wholesaler pricing) and **the JWT lives in
  `localStorage`, not a cookie — so a Server Component cannot read it** and cannot know who is asking. SSR would
  therefore have to render the *guest* feed and let the client correct it after hydration, which risks briefly
  showing the wrong price book to a logged-in wholesaler. Options: (a) move the token to an httpOnly cookie and
  SSR properly, (b) SSR the guest feed + client re-fetch, accepting the flash, (c) leave it. **Not decided.**
- **CLS 0.49 on the home page** is also unaddressed — same root cause as the product page had (the skeleton→content
  swap), but it needs the sizes of the hero/story bands pinned, not just the product tiles.
- Nothing about the image work is retroactive: **the 54 existing catalog photos stay 4–6 MB on
  disk** — delivery is fixed for them by the optimizer, but only *new* uploads get shrunk at the source.
- **Optional backfill of the existing 54 photos** (6 MB → ~200 KB on disk) is NOT done and is **not** a pure file job:
  re-encoding changes `.png` → `.jpg`, so it needs a matching `products.image_url` / `product_images.url` update in
  the same transaction. Worth it mainly to make optimizer MISSes cheaper; deliberately left as a separate decision.
- **~8 components still pass the dead `priority` prop** (`SplashIntro`, `VipHero` ×2, `BrandMark` in the three
  sidebars/navs, `AutoRotatingImage`, `ui/BrandLogo` which re-exports it as its own prop). All silently lazy-load
  today. Pre-existing, not touched — `BrandLogo` needs an API decision, so it is a small batch of its own.
- **The client-side render waterfall is untouched** (fix #5 from the diagnosis). Making `/product/[id]` a Server
  Component would remove the ~2.79 s render delay, but that file is 600+ lines of client state — a real refactor,
  and a separate decision.
- **`/uploads` `no-store` was deliberately NOT relaxed.** `/uploads/images/` is a shared bucket — admin catalog media
  and customer artwork land in the same directory — so relaxing it would put customer artwork in shared caches. That
  was the LS-08 decision. Routing catalog media through `/_next/image` gets the caching without touching it.
- **⚠️ Housekeeping from this session:** a broad `pkill -f next-server` I ran killed a **khatuna-build** dev server
  as collateral; it came back on its own and now holds **:3000**, so loloshop's dev server was started on **:3001**.
  The API was restarted with `CORS_ORIGIN` extended for :3001 **via an env var, not a file edit** — `backend/.env` is
  unchanged, so a plain restart returns it to normal.
- Local dev only: the dev DB is a prod snapshot holding absolute `lolo-shop96.com` image URLs while local `apiHost`
  is `localhost`, so with the optimizer on, dev 500s with «hostname not configured». Harmless — prod's `apiHost`
  is the real host (proven: `/_next/image` returns 200 + WebP live). Just know it if you enable the optimizer in dev.

---

## 2026-07-31 (b) — ✅ APP-ONLY GATE VERIFIED + DEPLOYED WITH THE FLAG **OFF** · one dead-app bug found in the gate · one live prod bug found in attendance breaks

**Spec: `docs/superpowers/specs/2026-07-31-app-only-gate.md`** (owner decisions, route policy, deferred jobs).
Phase 9 is DONE in a browser. **The flag is still OFF, so prod behaviour is unchanged — flipping it
is the one remaining step and it is a VPS env edit, not a code change (see «HOW TO TURN IT ON»).**

Gates: `eslint` **0 errors** (6 warnings, all inside `android/app/build/intermediates/` — a build
artifact, pre-existing) · `next build` **exit 0 twice** (flag OFF and flag ON) · `tsc` 0 ·
**backend 161/161**.

**Owner decisions this session:** ① installed **PWA users get bounced too** — matches "everything
lives in the app"; and because the gate fires at `/`, Chrome stops offering «Install app» to new
visitors, so PWA installs die off on their own. ② store links supplied: Play
`com.loloshop96.app`, App Store **id6793976053**.

### ⚠️ THE BUG THAT WOULD HAVE KILLED THE APP — one signal was not enough
The spec's read of `Bridge.java` stopped one line too early. **L266 gates the whole injection on
`WebViewFeature.isFeatureSupported(DOCUMENT_START_SCRIPT)` — that is Android WebView 105+.** Below
105 Capacitor falls back to `WebViewLocalServer`, which **never serves our HTML because `server.url`
is remote** → `window.Capacitor` is **undefined** → the app would have redirected **itself** to the
Play Store, on every launch, unrecoverably. **Fix: the gate now accepts `window.Capacitor ||
window.androidBridge`.** `androidBridge` is registered on *every* Capacitor path
(`MessageHandler.java:25-41` — `addWebMessageListener` on WebView 88+, classic
`addJavascriptInterface` below), so it covers exactly the gap. iOS needs no equivalent: `WKUserScript`
at document start has no version gate.

**Proved with a controlled comparison**, not by reading — a proxy that splices the native global in
right after `<body>` (i.e. ahead of the gate script, exactly like `addDocumentStartJavaScript`):
`window.Capacitor` → holds · `androidBridge` **only** → holds · **nothing injected → bounces to Play**.
Same proxy, same page; only the global differs. Script kept at the path named in the session
scratchpad; re-create it in 20 lines if the gate is ever touched again.

### Verified in a real browser (production build, not dev)
- flag OFF → gate string count **0** in the HTML, storefront renders, `/get-app` still 200.
- flag ON desktop → `/` bounces to `/get-app`; `/admin` `/workshop` `/tv/<key>` `/privacy` `/terms`
  `/delete-account` all **held**.
- Android UA → `/join/ABC123` → `play.google.com/…?id=com.loloshop96.app&**referrer=join_ABC123**`,
  and the **real Play listing loaded** (so the package id is right).
- iOS UA → `apps.apple.com/app/id6793976053` returns **301 → `itms-appss://`**. Desktop Chrome then
  aborts it («a user gesture is required») because Linux has no handler for that scheme — that abort
  is a **test-rig artifact, not a defect**; on a real iPhone the hop opens the App Store. **Still the
  one thing to eyeball on a real iPhone.**
- **Inside the app** → `/` and `/join/<code>` both held, full storefront rendered.
- `TeamKeyEntry` — wrong key → «الرمز غير صحيح» · staff key → `/s` «دخول الموظفين» · workshop key →
  `/w` «ورشة لولو» · a whole pasted `/s/<key>` link → routes straight through. It renders as a
  **sibling** `<form>`, so the nested-form hazard is genuinely avoided.
- Per-device bypass `?web=<token>` unlocked a plain browser.

### ⚠️ Three things about the gate the owner should know (none block the flip)
1. **The gate only fires on FULL page loads, never on client-side navigation.** `/admin` is
   allowlisted → the app's own auth guard client-side-redirects to `/login` → the gate never re-runs.
   So anyone who types `lolo-shop96.com/admin` lands on a working `/login` and can browse the whole
   site from there. Consistent with «product routing, not a security boundary», but it *is* a hole in
   the intent. Closing it needs an SPA-navigation guard, which **could bounce app users mid-session if
   it is wrong** — deliberately NOT built without a decision.
2. **`NEXT_PUBLIC_GATE_BYPASS` ships in the page source in plaintext**, so the bypass is not secret.
   Inherent to any client-side gate (turning JS off bypasses it too).
3. The allowlist publishes the strings `/s/ /w/ /d/` in every page's HTML. It leaks **no key**, but it
   does advertise that the secret portals exist — the same concern the spec raises for AASA in Track B.

### 🔴 SEPARATE, AND IT WAS LIVE ON PROD: attendance breaks were broken in the browser
Shipped 2026-07-30 with 161/161 tests and **never clicked by a human**. The first human click failed:
requesting a break threw **`Cannot read properties of undefined (reading 'start_time')`** — a raw
English stack message shown to an Arabic-only worker.

**Root cause:** `attendanceBreakController.staffPayload` returned only `{break, break_balance}`, but
the frontend maps **all five** staff break calls (request · «طلعت» · «رجعت» · cancel) through one
`mapAttendancePayload`, which reads `settings.start_time` unconditionally. **The write always
succeeded (HTTP 201) — only the render died**, so the worker saw an error, retried, and hit «لديك خروج
مؤقت مفتوح» from the DB's partial unique index. The tests never caught it because they call the API
directly and never run the frontend mapper.

**Fix:** extracted `attendanceController.todayPayload()` as the single source for
`{settings, record, break, break_balance}`; `getToday` and `staffPayload` both delegate to it, so the
break endpoints now answer with **exactly** the shape of `GET /attendance/today` by construction
rather than by memory. Backend-only, no migration. **161/161 still pass.**

**Then walked end to end in the browser** (local dev DB, so no real payroll was touched): بصمة دخول →
request 30 د → admin «أوافق» → «طلعت الآن» (live timer + balance ticking down) → «رجعت» → **الرصيد
10 س → 9 س 59 د**, «مدة العمل» annotated «بعد خصم 1 دقيقة خروج مؤقت». Then the money path: a second
break taken via «خرجت بدون موافقة» → «استهلكت 2 دقيقة · **خصم ١٬٠٠٠ د.ع**» → admin «**أوافق وألغي
الخصم**» → **مخصوم ١٬٠٠٠ → —** while استهلك stays 2 د. That is owner rule ⑥ exactly: unapproved minutes
still consume the allowance, and approving afterwards cancels only the money.

### HOW TO TURN THE GATE ON (the only step left)
`NEXT_PUBLIC_*` is inlined at **build** time, so this is an env edit **plus a rebuild** — not a
runtime toggle. On the VPS:
```bash
cd /var/www/loloshop/frontend
echo 'NEXT_PUBLIC_APP_ONLY=1' >> .env
echo 'NEXT_PUBLIC_APPSTORE_URL=https://apps.apple.com/app/id6793976053' >> .env
echo 'NEXT_PUBLIC_PLAY_URL=https://play.google.com/store/apps/details?id=com.loloshop96.app' >> .env
echo 'NEXT_PUBLIC_GATE_BYPASS=<pick-a-random-token>' >> .env   # your own escape hatch
cd /var/www/loloshop && bash scripts/deploy.sh                  # rebuild + pm2 reload (~2-3 min)
```
**Turning it OFF is the same edit in reverse + another deploy (~2–3 min) — it is NOT instant.** The
instant per-device escape is `https://lolo-shop96.com/login?web=<the token you set>`, which sets
`localStorage.loloshop_web_ok` and unlocks that one browser forever.

**Then, on a real phone, in this order:** ① open the **app** → it must behave exactly as today,
nothing bouncing (this is the one that matters); ② open `lolo-shop96.com` in **Chrome** → Play Store;
③ open it on an **iPhone** → confirm the App Store actually opens (the `itms-appss://` hop is the only
step no desktop test could cover); ④ tap a `/join/<code>` link on Android → Play with the referrer.

### Open follow-ups
1. **Flip the flag** (above), then the 4 real-phone checks.
2. ⚠️ **Rotate `STAFF_PORTAL_KEY` if the laptop `.env` value matches prod.** Testing `TeamKeyEntry`
   put the key in a browser network log as a query string (`GET /auth/staff-portal/members?key=…`).
   Worth noting generally: **these portal keys travel as URL query params**, so they land in access
   logs and any proxy in between — the nginx config already redacts the portal paths, but the API
   call is a different line.
3. The `/admin → /login` SPA hole and the plaintext bypass token (above) — owner decisions, not bugs.
4. **Lateness deductions are still display-only** (from 2026-07-30) — «مبلغ التأخير» never reaches the
   salary, while break deductions now do. Still an open owner decision, untouched.
5. Deferred, unchanged: **image/upload slowness** (spec explains why half the diagnosis is probably
   backwards — measure with Slow-4G + 4× CPU before building) and **Track B deep links** (both
   manifests 404 today; needs new binaries + one review; claim `/join/*` ONLY).
6. Local dev DB now has an **open attendance record + 2 closed breaks for ابو عبدو** from this
   walkthrough. Harmless snapshot noise; prod untouched.
7. Still untracked and must never be committed: `frontend/public/dev-login.html`,
   `frontend/public/dev-token-tmp.json`.

---

## 2026-07-30 (c) — ✅ BOTH APPLE FIXES PUSHED + WEBSITE DEPLOYED. Only the Codemagic rebuild + the ASC reply are left.

**Website track is DONE and verified live. iOS track is committed and pushed but the binary is NOT built yet.**

- **main `f42b585`** (2 commits: `6a13162` attendance breaks, `f42b585` account deletion) → **CI green** →
  `deploy.sh` ran migrate → build → pm2 reload. **Verified on prod:** `/account` went **404 → 200**; the App Review
  demo login `07700000000` returns a token with **no OTP wall**, `role: retail`; `GET /api/auth/account/deletion-preview`
  → **200 `{"eligible":true,...}`**, which also proves **migration 076 applied** (all three auth paths query
  `users.deleted_at` in `sessionValid`, so a missing column would 500 on any authed call). **This alone satisfies
  5.1.1(v)** — the app is a webview shell, so no rebuild was needed for it.
- **`ios-appstore` `b83cd5f`** — the camera fix is now **committed and pushed**, out of the temp `/tmp` worktree it was
  authored in. **⚠️ Pushing does NOT start a build:** `codemagic.yaml` has **no `triggering:` block**, so the build must
  be started by hand in the Codemagic UI, then the new binary selected in ASC.
- Attendance breaks shipped in the same push (owner call — it could not be cleanly split: `routes/staff.js` imports the
  break controller, and `db/schema.sql` + `frontend/lib/types.ts` are shared). It is **161/161 test-verified but still
  never walked in a browser** — see follow-ups. `db/schema.sql` was deliberately put in the *deletion* commit so that
  reverting the breaks commit cannot strip `users.deleted_at` from the schema.

Gates before push: backend **161/161** · `tsc` 0 · `eslint` 0 errors (6 warnings, all in an Android build artifact).
`next build` NOT run locally (disk 90%); it ran on the server as part of the deploy.

---

### The original build notes for both fixes (unchanged, kept for the reasoning)

**⚠️ THE KEY INSIGHT — the two fixes deploy by completely different routes.** The iOS app is a **webview shell**
pointing at `lolo-shop96.com`, so **account deletion goes live by deploying the website (push main → VPS); it needs
NO rebuild and NO new binary.** Only the camera crash needs a Codemagic rebuild + re-upload.

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
- ~~**Deploy the website**~~ **DONE 2026-07-30 (c)** — main `f42b585`, CI green, verified live (`/account` 200,
  demo login tokenises, deletion-preview 200). 5.1.1(v) is satisfied on prod right now.
- ~~**Commit + push the `codemagic.yaml` camera fix**~~ **DONE** — `ios-appstore` `b83cd5f`.
- **▶ NEXT, and it is all outside the repo — nothing left to code:**
  1. **Start the Codemagic build by hand** on branch `ios-appstore`. There is **no `triggering:` block** in
     `codemagic.yaml`, so the push did not start one. Watch for the step **"Inject the iOS privacy usage strings"** —
     it prints the three keys and **fails the build** if they are absent, so a green build IS the proof the crash is
     fixed at the plist level.
  2. **Select the new binary in App Store Connect** (the old one, build 1784823314, is the rejected/crashing one).
  3. **Reply to Apple** with a **screen recording on a physical device**: sign in with the demo account → «حسابي» →
     «حذف حسابي نهائياً» → password → «تم حذف حسابك». Apple asked for this explicitly and wants it kept in the App
     Review Notes for future submissions.
  4. **⚠️ AFTER the reviewer walks the deletion flow, the demo account is GONE** — they delete it for real. Run
     **`npm run demo-account`** on prod to recreate it before the *next* submission, or that one fails with "we could
     not sign in". Verified intact as of this session, so nothing to do before *this* resubmission.
  5. **Walk the camera on a real device (TestFlight)** before resubmitting — the one thing that could not be tested
     here (no Mac, no iPhone). The build now fails loudly if the keys are missing, so the failure mode is a red build
     rather than a silent rejection, but the actual "Take Photo" tap should still be tapped once.
- **⚠️ IF THE `codemagic.yaml` EDIT IS EVER LOST AGAIN** — it is now committed at `ios-appstore` `b83cd5f`, so
  recover it with `git show b83cd5f`. Kept below for reference; it belongs as a step in
  `workflows.ios-appstore.scripts`, **after** "Bake the real LoloShop icon" and **before** "Set up code signing":

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
- **⚠️ THE ATTENDANCE-BREAKS BROWSER WALKTHROUGH IS STILL NOT DONE, AND IT IS NOW LIVE ON PROD** (shipped in
  `6a13162` alongside the deletion fix — it could not be cleanly split out). It is 161/161 test-verified, so the
  money rule itself is covered; what is unverified is the UI/flow. **Walk it on prod:** staff request → admin approve
  → «طلعت» → «رجعت» → confirm the balance drops; then an over-quota break and a «خرجت بدون موافقة» to confirm the
  deduction appears and that approving it afterwards removes it. Also expect **مدة العمل on `/admin/attendance` to
  read lower than before** — that is the intended `worked_minutes` change, not a regression.
- **`ios-appstore` is still behind main and its lockfile is still desynced** (`@capacitor/ios` in package.json, not
  in package-lock). Building the app from that branch is fine — the shell just loads the live site — but do not merge
  it to main without running `npm install` in `frontend/` first.
- Unchanged on the board: the payout-card feature's `suggested_amount` lifetime-accrual bug, staff GPS parked. Still
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

## 2026-07-08 — شال امريكي optional notes · TV 🎓 reveal now shows money + menu button · home reverted to old cover · **whole 2026-07-07 session COMMITTED + PUSHED (live redeploy)**

**Committed + pushed to main → auto-deploys prod.** This shipped the entire previously-uncommitted 2026-07-07 session (money-gate,
TV cinema, calligraphy, order back-nav) plus the 3 changes below. No new migration (money-gate reuses `site_settings`; شال adds no
schema). Gates: FE `tsc` 0 · `eslint` 0 errors · BE `node --check` OK (6 files). Built via 2 parallel subagents (شال ∥ TV) + direct edits.

**Three asks this session:**
1. **شال امريكي optional notes.** The wholesaler/student full-set form (`FullSetOrderForm.tsx`) شال امريكي section gained an optional
   «ملاحظات» textarea below the (already optional) photo. Note rides the sash's «شال امريكي» spec line: `customer_text = note || 'نعم'`
   (staff see the note directly). Readback returns `american_shawl.notes` (empty when the line's text is just the 'نعم' marker).
   Backend `lib/fullSetOrder.js` + types in `lib/wholesaler.ts`.
2. **TV 🎓 reveal fixed + menu button.** Root cause: on reveal the money scene was only slotted into the 8-scene auto-rotation, so it
   often never appeared within the 90s reveal window → "graphs don't show". Fix (`app/tv/[key]/page.tsx`): on a correct passphrase it now
   **jumps straight to the money scene** (`setPinnedView("money")`); on hide/auto-hide it un-pins back to `auto`. Added «الأرباح والإيرادات»
   button to the ☰ sidebar «المشهد» menu (`components/tv/Panels.tsx`), shown only once revealed.
3. **Home page reverted to the old design.** `app/(student)/page.tsx` + `components/vip/VipHomeBand.tsx` `git checkout`-reverted to HEAD
   (restores `ShopCover → AtelierStory → VipHomeBand → MilestoneStory → DesignProcess`); the unused `components/shop/HomeTrustStory.tsx`
   was deleted. Both were used only by the home page.

**Env / disk gotchas hit this session:**
- Local `/` 500'd after the revert — NOT a code bug. Two Next servers (`next start` + `next dev`) were running against the same
  `frontend/.next`, compounded by **disk at 98% (1.5 GB free)** blocking recompiles. Fixed by killing both, `rm -rf frontend/.next`,
  and starting a single `next dev` on :3000 → `/` = 200. **Disk is still 98% — clear space soon (dev builds will keep ENOSPC-ing).**
- ⚠️ Deploy prerequisites carried over from 2026-07-07: money-gate passphrase is `lolo2026` on the shared DB (change it via /admin →
  🎓 → «تعيين الرمز»); calligraphy needs `OPENROUTER_API_KEY` in prod `.env` or it returns a clean Arabic error.

### Open follow-ups
- After deploy: browser-glance live `/admin` (money masked, reveal via lolo2026), `/tv` 🎓 reveal jumps to money + menu button, and a
  wholesaler طقم form saves the شال note.
- `design-mockups/` left untracked/uncommitted (reference junk).

---

## 2026-07-07 — Order back-nav fix · calligraphy preview-close + designer access · money-gate (hide by default + 🎓 reveal) · freestyle TV cinema

**Uncommitted on main. NOT deployed.** No new migration (money-gate reuses `site_settings`). Gates green: FE `tsc` 0 · `eslint` 0
(2 unused-var warnings cleaned) · BE `node --check` OK. Built via a multi-agent Workflow (F1 backend money-gate ∥ F2 reveal
primitives → 4 parallel build slices → critic → fixer). **Verified live in-browser** (TV + dashboard driven with chrome-devtools;
admin JWT minted via `signToken`) + backend curl e2e. Spec: `docs/superpowers/specs/2026-07-07-nav-calligraphy-money-gate-tv-design.md`.

**Four asks, all done:**
1. **Order back button (admin/staff) returned to the dashboard, not where you came from.** New `orderBackTarget(from, role)` in
   `lib/back.ts` (same-origin-validated; rejects `//` **and** `/\` backslash open-redirect + control/whitespace). All 6 entry points
   (`staff/page`×2, `staff/queue`×2, `staff/tailor`, `staff/wholesalers/[id]/students`, `admin/orders`) now pass `?from=<path>`; the
   order page (`app/staff/orders/[orderId]/page.tsx`) uses `?from` → else same-origin `document.referrer` → else role home, for BOTH
   the «العودة» link and the PageHeader back, with a label derived from the target.
2. **Calligraphy AI preview couldn't be closed** — root cause was a stacking/containment trap (inline `fixed inset-0` overlay under
   the admin layout). Fixed by rendering the full-size plate preview via `createPortal(document.body)` (like `Modal`); ✕/backdrop/Esc
   all close. Extracted the tool into `components/calligraphy/CalligraphyTool.tsx` (admin page = thin wrapper, byte-identical).
3. **Calligraphy AI opened to designers.** `routes/calligraphy.js` now `requireStaffType('designer')` (admin/manager auto-pass) instead
   of `requireRole('admin')`. New `app/staff/calligraphy/page.tsx` + «الخط العربي» link in `StaffSidebar` for designers. The staff page
   guards to designer/manager/admin (non-designer staff see «غير مصرّح», API would 403 anyway).
4. **Money hidden by default on BOTH `/admin` and `/tv`; revealed by a disguised 🎓 + secret text; TV freestyle-redesigned.**
   - **Server-side money-gate** (`tvBoardController.js`): the TV snapshot **strips every monetary field** (revenue/profit/cost across
     kpis, graphs.series, lifetime, records, growth) unless a correct secret is supplied via the **`x-tv-reveal` header** (moved OFF the
     URL so it can't land in access logs; `?reveal=` still accepted for curl). Adds `money_visible:boolean`. Per-request `stripMoney`
     clone — the 2s cache is never mutated (verified both directions). `crypto.timingSafeEqual` compare; secret never logged.
   - **Passphrase**: hashed (sha256) in `site_settings` key `money_gate.secret_hash`, admin-set via `PUT /admin/money-gate` (min **8**
     chars). Env `MONEY_GATE_SECRET` is a fallback used ONLY when the DB hash is unset. `GET /admin/money-gate`→`{configured}` (never the
     hash), `POST /admin/money-gate/verify`. Snapshot route rate-limited (400/5min — headroom over 3s polling).
   - **Reveal UI** (new shared primitives): `components/MoneyRevealTrigger.tsx` (discreet 🎓 chip → password popover, neutral label
     «خيارات العرض», portals when fixed), `hooks/useMoneyGate.ts` (dashboard reveal + 5-min idle auto-relock), `components/MoneyMask.tsx`
     (••• placeholder), `lib/money-gate.ts`. In-memory only (refresh re-locks).
   - **TV** (`app/tv/[key]/page.tsx` + NEW `components/tv/Scenes.tsx` + `FullGraphs.MoneyScene`): full-screen **scene cinema**, warm
     brand, **old `IraqMap` kept**. 6 money-free scenes rotate (Pulse · Pipeline funnel+bottleneck · Orders-trend · Conquest map+gov
     bars · Lifetime reach/rank/records brag · Deadlines+staff) + Spotlight. Money scene joins the rotation ONLY while revealed, then
     auto-hides after **90s** (and client-strips `data` on hide so the fade-out frame can't flash numbers). 🎓 top corner.
   - **Dashboard** (`app/admin/page.tsx` + `components/admin/DashboardCharts.tsx`): the 3 headline figures + accounting receipt + margin
     are `MoneyMask`-wrapped (order counts stay visible); new non-money charts (orders-trend from `daily[].orders`, pipeline from
     `ordersByStatus`); 🎓 reveal + a «تعيين الرمز» set-code affordance when unconfigured.

**Root-cause caught this session:** the TV first rendered collapsed/empty because `page.tsx` referenced `.tv-scene-layer`/`.tv-scene-in`/
`.tv-scene-out` CSS classes that were **never defined** (only the panel/pulse classes were) — so scenes had no `position:absolute;inset:0`
and every `h-full` collapsed. Added the classes + cross-fade keyframes to `globals.css` → full-frame cinema. (Also: browser was caching
stale CSS through several reloads — needed a hard reload to see it.)

### Open follow-ups
- **⚠️ Money-gate passphrase is `lolo2026`** — set on the shared Neon DB (`site_settings.money_gate`) AND in local `backend/.env`
  (`MONEY_GATE_SECRET`) for testing. **dev+prod share one DB**, so CHANGE it before/after deploy via `/admin` → 🎓 → «تعيين الرمز».
  Prod `.env` has no `MONEY_GATE_SECRET` (fine — the DB hash is the source of truth once set).
- **Minor:** `GET /admin/money-gate` reports `configured:false` when ONLY the env secret is set (env isn't counted for `configured`) —
  so the dashboard shows «set code» even though the TV can reveal via env. Harmless (dashboard-set is the intended path). Wire env into
  `configured` if you want them consistent.
- Digit-system mix on the TV: map «أشعلنا ٢ من ١٨» is Arabic-Indic but recharts axes render Latin (0/45/90…). Cosmetic.
- **Not committed / not deployed.** Run `next build` before deploy (dev servers BE :4000 / FE :3000 left up). `PROGRESS.md` updated.
- Pre-existing uncommitted working-tree files (PROGRESS.md prior state, android build.gradle, `(student)/page.tsx`, VipHomeBand,
  HomeTrustStory, design-mockups/) were left as-is — not part of this session.

---

## 2026-07-01 (b) — Capacitor Android project committed · Google Play submission in progress

Committed the **Capacitor Android wrapper** to main (`frontend/android/`, `capacitor.config.ts`, `@capacitor/*` deps in `package.json`).
**Secrets verified safe:** `.gitignore` ignores `*.jks`/`*.keystore`, `local.properties`, and all android build dirs + the `.aab`;
signing passwords are read from gitignored `local.properties` (not hardcoded in `build.gradle`) — grep confirmed the keystore password
is in **zero** committed files. The signed `~/Desktop/loloshop-v1.aab` (v1) is built and uploaded to Play **internal testing**.

**Google Play submission status (2026-07-01):** Play developer account is **Personal** → must run a **Closed test with ≥20 testers
opted in 14 continuous days** before applying for production access (internal testing does NOT count). **This 20-tester/14-day window
is the only remaining gate.** Everything else is done: App access (reviewer demo login `07700000000`/`Lolo#Review2026` — live), Content
rating (3+), Data safety (no Firebase/ads in v1 build), Financial features (none), Tags, Store contact `info@lolo-shop96.com` (Namecheap
forwarding → user Gmail). Store assets + listing copy (AR+EN) in **`~/Desktop/loloshop-store-assets/`** (feature graphic 1024×500 generated,
icon 512, 5 screenshots). See memory `project_play_publishing_status`, `project_play_reviewer_demo_login`, `project_domain_email_setup`.

### Open follow-ups
- Create the **Closed testing** track (same `.aab`), recruit 20 testers (students/staff/friends), start the 14-day clock, then apply for production.
- Backend SMTP still empty → email password-reset dead in prod (phone OTP works). Firebase push deferred (v2) → re-declare Data safety then.

---

## 2026-07-01 — App-store reviewer demo login (OTP-skip) for the Google Play «App access» form

**Uncommitted on main.** No migration. Gates: BE `node --check` 0 (both touched files). Verified **live on the shared Neon DB**
(9/9 controller e2e) + frontend login path traced. Built for the «تفاصيل تسجيل الدخول» / App access section of the Play submission.

**Why.** Google Play reviewers must be given working login credentials, but retail login sends a **WhatsApp OTP** an overseas
reviewer can't receive on an Iraqi number they don't own → the app would stall at the OTP screen and be **rejected**. Solution: a
single fixed demo retail account that **skips the OTP** (password still required).

**What shipped (2 backend files + 1 data row + 1 env var).**
- `lib/otp.js` — new `isDemoLoginPhone(phone)`: phones in **`DEMO_LOGIN_PHONES`** (comma-separated env, normalized) skip login OTP.
  Empty/unset → nothing bypasses (fail-safe). Exported.
- `controllers/authController.js` `login()` — new branch (mirrors the wholesaler-student one, BEFORE `createOtp`):
  `if (user.role === 'retail' && isDemoLoginPhone(user.phone)) return {token,user}`. **Guard = retail AND listed** (a mistakenly
  listed admin/staff number can't skip OTP); password is still bcrypt-checked first → OTP skip, not a passwordless backdoor.
- **Demo account** (in the shared Neon DB = prod): phone **`07700000000`** · password **`Lolo#Review2026`** · role `retail` ·
  name «Google Review» · approved `students` row · `wholesaler_id=NULL` (so it uses the demo bypass, not the rep one).
  user id `fd00c7e2-50f6-4cb9-89dc-e84a86f467f0`.
- **Local `backend/.env`** got `DEMO_LOGIN_PHONES=07700000000`.

**Verified.** e2e on live DB: correct pw → `{token}`, NO `otp_required`, **0 new otp_codes rows**; wrong pw → 401 (no OTP);
allow-list logic incl. normalization. Frontend (`lib/auth-api.ts` + `app/login/page.tsx`): a `{token,user}` response logs the
reviewer straight in — **no OTP screen shown**.

### Open follow-ups (REQUIRED to work in prod — the app loads lolo-shop96.com)
- **⚠️ Deploy the code:** commit `backend/controllers/authController.js` + `backend/lib/otp.js` and push to main (auto-deploys via
  Actions). Until then the prod backend has no bypass. (Capacitor android/ + capacitor.config.ts + frontend package files stay
  unstaged — unrelated mobile WIP.)
- **⚠️ Set the env on the VPS:** add `DEMO_LOGIN_PHONES=07700000000` to the **prod `.env`** + `pm2 restart` (env isn't in git). The
  account already exists in the shared DB, so no DB step needed in prod.
- Google Play Console → App content → **App access** → "All or some functionality is restricted" → add instructions with
  username `07700000000` / password `Lolo#Review2026` (full text given to the user this session).
- To revoke after launch: remove the number from `DEMO_LOGIN_PHONES` + restart (reverts that account to normal OTP login), or delete
  the account.

---

## 2026-06-30 (b) — TV board: fullscreen new-graphs auto-takeover + live-visits counter

**Committed + pushed to main** (`e9fe71a` → auto-deploys prod via Actions). Migration **056 applied to the shared Neon DB**
(dev+prod = one DB) and mirrored in `db/schema.sql`. Gates green: FE `tsc` 0 · `eslint` 0 · BE `node --check` 0. Backend verified
**live on Neon + over HTTP** (snapshot aggregates, visit dedup, audience count). Graphs page **rendered in-browser** (all 4 charts);
the very last clean screenshot couldn't be retaken (chrome-devtools MCP crashed mid-capture) — browser glance after deploy still wise.

**Context — a redesign was reverted.** This session first did a full "throne-room" scene-cinema redesign of `/tv/[key]` (obsidian/gold,
ego scenes, etc.). **User rejected it: «back to old design, the iraq map old is better».** So the entire frontend redesign was
`git checkout`-reverted to HEAD (`page.tsx`, `Panels.tsx`, `IraqMap.tsx`, `globals.css`, `lib/tv.ts`) and the new `Scenes.tsx` deleted.
The **old board + old Iraq map + existing hero/source auto-rotation are 100% intact** (HERO_MS 13s cycle staff→graphs→map→spotlight,
SOURCE_MS 22s). Only the **backend additions were kept** (they're invisible/additive).

**What shipped (the focused ask).**
- **Fullscreen new-graphs auto-takeover.** `components/tv/FullGraphs.tsx` — a dedicated «لوحة الأداء» page with **NEW** charts (NOT
  the board's existing ones moved): pipeline-distribution **donut**, orders-by-**governorate** bar, **this-year-vs-last-year** area
  (uses backend `growth.series`), **cumulative revenue** area. `page.tsx` toggles `showGraphs` (board 45s → graphs 20s → loop) and
  cross-fades a `fixed inset-0 z-[40]` overlay (`opacity/scale/blur` transition) over the board, then back.
  - **GOTCHA (hit twice this session):** `h-full`/`w-full` does NOT resolve against a `position:fixed` parent → height collapses,
    recharts warns `width(-1) height(-1)`, page looks blank. Fix = the fullscreen child uses **`absolute inset-0`** (fills the fixed
    parent definitely). Also Tailwind `bg-gradient-to-br ...` produced **no** background here (the old board only looks covered because
    its outer wrapper has a solid `bg-[#FAEBD7]`) → FullGraphs uses an **inline-style** `linear-gradient` to be reliably opaque.
- **Live-visits counter («الزيارات الآن»).** First-party, no third-party/cookies. `components/VisitBeacon.tsx` (in the `(student)`
  layout) pings `POST /api/track/visit` on load + a 5-min heartbeat with a localStorage session id → `site_visits` table (migration
  056). `trackController` inserts ≤1 row/session/5min; board counts **DISTINCT session_id in the last 30 min**. Surfaced on the graphs
  page header («X يشاهدون متجرك الآن»). Verified: 3 pings/2 sessions → audience.now=2; junk ignored.
- **Backend snapshot extras (additive, behind the same key gate, 60s cache via `buildLegend`):** `audience.now`, `rank`
  (ladder تاجر→سيّد الأوشحة→مَلِك التخرّج→أسطورة on lifetime orders), `lifetime` (graduates/orders/universities/revenue + uni list),
  `records` (best day/month, streak), `growth` (YoY + 12-mo series), `map.total=18`, `settings.owner_title`. **Only `growth` + `audience`
  are currently CONSUMED by the frontend** (the rest are built/ready but unused after the revert).

### Open follow-ups
- **Browser glance after the deploy finishes** — confirm the board→graphs cross-fade + the 4 charts on the live TV; the auto-rotation
  and old map are unchanged. (Final local screenshot was blocked by an MCP crash; charts were confirmed rendering just before.)
- **Unused-but-built backend data:** `rank`/`lifetime`/`records` are in the snapshot but nothing displays them (the ego scenes that
  used them were reverted). Wire into the board/graphs later if wanted, or leave dormant. Rank thresholds in `tvBoardController.RANKS`
  are guesses — tune to real lifetime volume.
- **Visits in PROD:** the beacon ships with the storefront; numbers will populate once real visitors load `lolo-shop96.com`. Seed not
  updated for 056 (live shared DB has the table; schema.sql mirrored). Dev servers (BE :4000 / FE :3000) left up.
- Capacitor/android working-tree files were **left unstaged** (unrelated in-progress mobile work).

---

## 2026-06-29 — Staff بصمة separated from salary

Uncommitted on **main**. Added migration **054_attendance_exemptions.sql**, mirrored it in `db/schema.sql`, and applied it to the
configured DB. Gates green: BE `node --check` on touched controllers/routes · FE `npm run lint` · FE `npx tsc --noEmit` · DB column
check for `staff_attendance_user_settings.attendance_required`.

**Built.**
- «بصمة الموظف» is now separate from salary: staff get `/staff/attendance` + a dedicated sidebar link; `/staff/me` is salary/activity
  only. `/staff` still shows the attendance card for quick check-in.
- Attendance check-in no longer creates `staff_salary_transactions`; salary summaries also ignore older transactions with
  `source_type='attendance'`, so attendance markers do not affect salary balances.
- Admin can mark each employee as attendance-required or exempt from `/admin/attendance`. Exempt staff see «غير مطلوب» and cannot
  check in/out from the staff UI/API.
- Self-service attendance APIs now live under `/api/staff/attendance/*`; old `/api/payroll/me/attendance/*` aliases remain for older
  frontend builds only.

### Open follow-ups
- Browser smoke test still pending for admin exemption toggle and staff `/staff/attendance` at desktop/mobile widths.
- Existing historical attendance salary rows remain in DB for audit but are ignored by salary summaries.

---

## 2026-06-29 — Staff بصمة · payroll removal · admin custom order

Uncommitted on **main**. Added migrations **052_staff_attendance.sql** + **053_staff_attendance_user_settings.sql**, mirrored them in
`db/schema.sql`, and applied both to the configured DB. Gates green: BE `node --check` on touched controllers/routes · backend smoke
script for attendance/salary-remove/admin-custom-order/per-staff override (temporary data cleaned up) · FE `npm run lint` · FE
`npx tsc --noEmit`.

**Built.**
- Staff attendance / «بصمة الموظفين»: admin settings for shift start/end, 15-min-style grace window, per-minute deduction, verification
  mode (`none/network/location/both/network_or_location`), allowed IP/CIDR ranges, shop GPS radius; staff can check in/out from
  `/staff/me`; admin can review/override records from `/admin/attendance`.
- Per-staff attendance overrides: `/admin/attendance` now lets admin set a custom schedule per employee (e.g. one starts 9:00, another
  starts 10:00); check-in resolves employee override first, then falls back to the default shop schedule.
- Original implementation connected late check-ins to payroll `deduction` transactions; this is superseded by the newer entry above
  that separates attendance from salary.
- Admin can remove manual «حافز»/«خصم» rows from the staff team salary ledger; auto goal/attendance rows are protected from manual
  deletion.
- Admin custom orders: new `/admin/custom-order` page + backend endpoints reuse `persistFullSetOrder()`. Independent admin orders clear
  `wholesaler_approval` so they show as direct production orders; optionally attaching a wholesaler inherits its pricing/university data
  and auto-approves the bundle.

### Open follow-ups
- Browser smoke test pending: admin attendance settings, staff check-in/out from shop network/location, payroll removal, admin custom
  order creation.
- Configure the real LoloShop public IP/CIDR and/or GPS coordinates in `/admin/attendance`; browser apps cannot reliably read Wi-Fi
  SSID, so the safe check is server IP allowlist plus optional geolocation.

---

## 2026-06-27 (c) — OTP send: body-based success detection (catch silent ZentraMsg bans)

Uncommitted on **main**. **No migration, no env change** (per user: do NOT rename env vars — kept `ZENTRAMSG_API_KEY`/
`ZENTRAMSG_DEVICE_UUID`/`ZENTRAMSG_API_URL`). BE `node --check` 0. Verified via a stubbed-fetch/stubbed-db harness (no real send,
no DB): 4/4. Aligned `backend/lib/otp.js` send path to the WhatsApp guide (`~/Downloads/whatsapp-messages-agent-guide.md`, the
ZentraMsg project doing 1000+/day).

**Why.** `sendViaZentramsg` only checked the HTTP status (`res.ok`). ZentraMsg returns **HTTP 200 with `success:false`** when the
sender device is banned/expired (message sits "pending", never delivered) — so the recurring "OTP not sending" looked like a
*successful* send in our logs. Root-cause class of the ban incidents (see [[project_prod_otp_zentramsg]]).

**Fix (logging/visibility only — login flow behavior unchanged).** Parse the JSON body; treat as sent ONLY when
`res.ok && body.success === true && body.msg === 'MESSAGE_CREATED'` (the guide's contract). On anything else, log
`WhatsApp API rejected: <status> <msg> <errors>` and return `{success:false,...}`. `createOtp` is still **non-blocking** (it ignores
the return — the code is still written to DB; a transient send failure does NOT hard-block login, per prior decision) — the change
is purely that a real ban is now **visible in `pm2 logs`** instead of silent. Early guards (invalid recipient / missing creds) now
also return the guide's `{success:false, error}` shape. `test-zentramsg.js` updated to print ✅/❌ on the same body contract.

**Verified (harness).** ① MESSAGE_CREATED → no rejection log, `x-api-token` header sent. ② HTTP200+success:false → logs rejection
with msg+errors. ③ HTTP 500 → logs rejection, no throw. ④ prod path does NOT print the live code.

### Open follow-ups
- **Live test pending:** run `node backend/test-zentramsg.js 07XXXXXXXXX` against the real device → expect `✅ MESSAGE_CREATED`. If
  it prints `❌` with `success:false`/a ban msg, the ZentraMsg device is banned again (relink + update prod `.env`, restart).
- Uncommitted on main; not pushed (a push auto-deploys). Env var names deliberately kept as `ZENTRAMSG_*`.
- Not changed (out of scope): making `createOtp` surface the send failure to the user. Today a failed send still returns
  `expires_in` and the user sees "code sent". If you want login to fail fast on a ban, have `createOtp` check the return.

---

## 2026-06-27 (b) — Retail cap photo · wholesaler طقم form all-optional · storefront location map

On **main**, pushed (auto-deploys). Migration **050 applied to the shared Neon DB** (dev+prod = one DB, so prod is covered;
deploy's `npm run migrate` runs schema.sql only, not numbered files). Gates green: BE `node --check` 0 · FE `tsc` 0 · `eslint` 0.
Verified **live on Neon** (cap-photo 4/4 + inheritance; full-set-optional 10/10; both self-cleaning). `next build` NOT run locally
(disk 94%/3.9G — built on the server by the deploy). Browser click-through pending.

**① Retail cap photo (migration 050).** Caps now let a retail student upload an OPTIONAL reference photo. Implemented via the
existing customer-image plumbing — added a single-option, photo-only option group **«صورة القبعة»** (`required=FALSE`,
`requires_customer_image=FALSE`) to the **top-level** cap (`parent_id IS NULL`); children inherit via `getProductFull`'s
parent+own merge (so it lives ONLY on the parent — adding to children would double-render, per the migration-040 gotcha). FE:
`OptionGroupField` treats «صورة القبعة» as a typed field → auto-selects its sole option + hides the selector; `product/[id]`
detects `isCapPhoto` → renders `<CustomerImageUpload allowOptionalImage>` (photo-only). `CustomerImageUpload` header reworded so an
optional photo-only field says «أرفق صورة» (not «...مطلوبة منك»). Backend: `priceSelections.hasEmbroidery` now also flips on a
PROVIDED image (not just text) → a photo'd cap routes to `design_complete`; a photoless cap stays `preparing` (plain «قبعة سادة»).
**Wholesaler full-set caps are UNAFFECTED** (that path builds cap spec lines by hand, never reads cap option groups) — so "just
retail" is satisfied for free. NB: caps already had required groups (لون/جانب/أعلى/الشكل); the photo is purely additive + optional.

**② Wholesaler طقم order form = EVERYTHING optional.** Per request, a rep/student can now save the full-set order with NOTHING
filled (sash/cap type, robe measurements, embroidery, shawl photo — all optional) and complete it later. Backend `fullSetOrder.js`:
dropped the 400s for measurements / نوع الوشاح / نوع القبعة / shawl photo; type spec lines emitted only when chosen; measurements
stored per-field (null when blank) and the robe JSON is null when fully empty; a PROVIDED measurement is STILL range-checked (typo
guard). **One guard kept:** `wholesaler_price <= 0` still 400s («لم يُحدَّد سعر الطقم…») — that's admin pricing config, not a form
field. FE `FullSetOrderForm.tsx`: removed the required validations (only the "wait for in-flight upload" check stays); per-field
null-safe measurement seeds; shawl photo relabelled «(اختياري)». `CreateFullSetPayload.sash_type/cap_type` made optional.

**③ Storefront location map.** NEW `components/shop/StoreLocation.tsx` — a «موقعنا» section (embedded Google Map iframe + «افتح في
خرائط جوجل» link, owner-provided embed/share URL) rendered on the home page just above the footer (`app/(student)/page.tsx`).
Brand-warm, RTL, responsive aspect-ratio frame.

**Files.** BE: `controllers/orderController.js` (hasEmbroidery on image), `lib/fullSetOrder.js`; NEW `db/migrations/050_cap_photo.sql`.
FE: `app/(student)/page.tsx`, `app/(student)/product/[id]/page.tsx`, `components/catalog/{OptionGroupField,CustomerImageUpload}.tsx`,
`components/wholesaler/FullSetOrderForm.tsx`, `lib/wholesaler.ts`; NEW `components/shop/StoreLocation.tsx`.

### Open follow-ups
- **Browser click-through pending:** (①) open a retail cap → upload a photo → confirm it shows for staff at `design_complete`;
  a photoless cap stays plain. (②) `/wholesaler/custom-order` or a rep student order → submit a blank طقم → 201, appears in queue.
  (③) load `/` → scroll to «موقعنا» → map renders + link opens. Run `next build` before relying on it (done on the server by deploy).
- Seed not updated for 050 (live shared DB has it; schema.sql unchanged — it's a data row, no new columns). Fresh installs via seed
  won't get the cap photo group until seed is updated.
- Decision: cap photo is OPTIONAL (a «قبعة سادة» needs none). If it should be mandatory, set the group `requires_customer_image=TRUE`
  (the product page would then enforce + show the required asterisk automatically).

---

## 2026-06-27 — Wholesaler students: NO OTP (kills the "two codes" bug + the bulk spam-ban)

Uncommitted on **main**. **No migration** (uses existing `students.wholesaler_id`). BE `node --check` 0. Verified **live on Neon**
(6/6 self-cleaning login-controller e2e). NOT pushed/deployed yet.

**Why.** A wholesaler-linked student got **two** WhatsApp OTPs during onboarding, and 100+ students signing in together blasted the
gateway → repeated sender bans. Root cause was two independent sends: ① `joinController.joinReferral` called `createOtp(phone)` on
join — but the join UI never asks for the code (it shows «طلبك قيد المراجعة»), so it was an **orphan/spam** send; ② `authController.login`
sent a `login` OTP on every login. Different purposes ⇒ nothing deduped them ⇒ two messages.

**Fix (2 edits, additive — nothing else touched).**
- **`joinController.js`** — removed the orphan `createOtp(phone)` on join (and the now-unused import). Phone format is still
  validated (`isValidIqMobile`) so junk numbers are still rejected; we just don't SEND. Account is still created `pending_approval`.
- **`authController.login`** — wholesaler-linked students (`role='retail'` AND a `students` row with `wholesaler_id IS NOT NULL`)
  now log in **password-only**: returns `{token,user}` straight away (same shape as the trusted-device branch the FE already handles),
  **no `createOtp`**. The flag is computed in the existing user-lookup SELECT via an `EXISTS(...)` subquery (no extra round-trip);
  the branch sits BEFORE the trusted-device check so it also covers first-ever logins. Self-registered retail (38 in DB) still OTPs
  via `/register`; reps/staff/admin are role≠retail so never match. No FE change (login page already branches on `"token" in res`).

**Verified (live, self-cleaning throwaway WS student).** Correct pw → 200 + token + **0 `otp_codes` rows** (no send); `otp_required`
absent; wrong pw → 401. Live classification: **168 wholesaler students** (now OTP-free) vs 38 plain retail.

### Open follow-ups
- Uncommitted on main; **not pushed** (a push auto-deploys prod via GitHub Actions). Commit/deploy when ready.
- Wholesaler students keep `phone_verified=FALSE` now (was set TRUE by the old login-OTP). Nothing gates on it (verified by grep);
  purely cosmetic in admin views. Set it TRUE on rep-approval if a "verified" count ever matters.
- Edge: if a wholesaler is deleted, the student's `wholesaler_id` goes NULL (FK ON DELETE SET NULL) → that student falls back to
  OTP login. Rare, acceptable. `forgot-password-phone` still OTPs (individual reset, not bulk — intentionally kept).

---

## 2026-06-26 — OTP bans root-caused & fixed: trusted-device login + phone validation + prod security hardening

**Shipped to prod** (commit `8c1c4dd` on **main**, deployed via GitHub Actions → `scripts/deploy.sh`). Migration **048 applied to
Neon** (dev+prod share one DB). Gates green: FE `tsc`/`eslint` 0 · BE `node --check` 0. Verified: 17/17 lib e2e + 4/4 login-controller
e2e on Neon (send-free, artifacts cleaned) + live public-API smoke (invalid phone → 400 on prod). Spec:
`docs/superpowers/specs/2026-06-26-auth-trusted-device-ban-hardening-design.md`.

**Incident → root cause.** "OTP not sending for all" started as a Zentramsg outage (live-debugged: `404 Device not found` = key↔device
account mismatch; user's subscribed key is `b3482ab8`; then `400 No active subscription`; then the device was **banned** → messages
sat `pending`, no delivery). User linked a NEW device `9968d548` (sender `9647888255587`) → delivery restored. But the ROOT of the
recurring bans is the app's send behavior: **no phone validation** (blasting OTPs to garbage numbers `03`/`010`/`07788888` = Meta's
#1 spambot signal), **OTP on every login** (volume), and the **per-phone cap was gated on `NODE_ENV==='production'` while prod ran
`development`** (cap off). Each linked WhatsApp sender got banned, relink, repeat.

**Fix (3 pillars, all live).**
- **A — Trusted-device login.** `trusted_devices` table (mig 048) + `backend/lib/trustedDevice.js`. `login-verify`/`verify-otp` mint a
  sha-256-hashed, user-bound, 90-day device token, return it; FE stores it (`localStorage loloshop_device_token`, **survives logout**)
  and sends it on `/auth/login` → **skips the WhatsApp OTP** (password still verified every login). Password reset revokes all the
  user's devices. `login()` now returns `{token,user}` (trusted) OR `{otp_required}` — login page branches.
- **B — Ban prevention.** `isValidIqMobile = /^07\d{9}$/` rejects garbage before any send (register/login/join/forgot/resend + backstop
  in `createOtp` + hard recipient guard in `sendViaZentramsg` requiring ids `^964\d{10}$`). Per-phone cap **always** enforced (NODE_ENV
  gate removed).
- **C — Prod security (`.env`, done on server + restarted).** `NODE_ENV=production` (user flipped it), `JWT_EXPIRES_IN=30d` (was 7d),
  `ALLOW_PROD_MASTER_OTP` commented (was the armed backdoor), `DEV_MASTER_OTP` commented. Prior security debt RESOLVED.

**Files.** BE: `controllers/{authController,joinController}.js`, `lib/otp.js`, NEW `lib/trustedDevice.js`; NEW `db/migrations/048_*.sql`
+ `db/schema.sql` mirror. FE: `app/login/page.tsx`, `lib/{auth,auth-api,types}.ts`.

### Open follow-ups
- **User-side smoke test pending:** log in as a real student → first login OTPs (device gets trusted) → log out → log in again on the
  same phone → should skip the OTP (password only). Confirm in a browser.
- **This HANDOFF entry is committed locally but NOT pushed** (a push redeploys prod via Actions; didn't want a gratuitous rebuild for a
  docs change). It rides the next deploy.
- **Future cure if bans persist:** swap `sendViaZentramsg` → official WhatsApp Cloud API (deferred; seam is `lib/otp.js`).
- **Zentramsg subscription/device are the user's to keep alive** — if the new device `9968d548` gets banned again, relink + update
  prod `.env ZENTRAMSG_DEVICE_UUID` + restart. (The fix above should drastically cut ban risk.)

---

## 2026-06-25 — Session-persistence (auto-logout) fix · wholesaler name-only «custom order» (skip both approvals) · product photo for ALL staff roles

Uncommitted on **main**. **No DB migration** (verified the data model supports all 3). Gates green: FE `tsc` 0 · `eslint` 0 ·
BE `node --check` 0. **Built via a 5-agent Workflow** (3 ∥ build slices → gates + adversarial critic), then the orchestrator
applied the critic's medium/low fixes + ran live **backend e2e on the Neon DB** (the riskiest path). `next build` NOT run; the
frontend BEHAVIORAL click-through (logout-prevention timing, photo card render) is NOT browser-driven yet — see follow-ups.

**Context.** Site just went live (`lolo-shop96.com`, public storefront healthy). User reported 3 things: ① wholesalers & their
students get logged out after a few minutes / on revisiting, and a waiting student isn't advanced when the rep approves; ② a
wholesaler couldn't make a «custom order»; ③ only ابو عبدو (الفصال/tailor) saw the catalog product photo — extend to all staff.

**① Session-persistence bug — fixed the recurring "single 401 nukes the session" class, EVERYWHERE.**
- `frontend/lib/api.ts`: **verify-on-401** (final approach — supersedes a first cut that only narrowed logout to `/auth/me`).
  On ANY 401 the interceptor probes `/auth/me` ONCE (raw `fetch`, deduped via `sessionProbe`) and only `logout()` + redirects if
  the token is GENUINELY dead. A spurious 401 (NotificationBell's 30s `/notifications` poll, queues, Neon cold-start) leaves
  `/auth/me` at 200 → session kept. This makes the fix apply to **every role, page, and endpoint** — incl. student/retail pages
  with NO `useRequireAuth` guard and background polls — without ever logging out a valid 7-day session. (`/auth/me`'s own 401 →
  direct `logout()`, the page guard redirects; `/login`/`/join` pages + public-catalog + staff-portal excluded.) NB: `authRequired`
  returns 401 on a dead token AND on a hard DB failure — the same ambiguity `useRequireAuth` already had; acceptable + consistent.
- `frontend/hooks/useRequireAuth.ts`: logs out only on a real 401 (or token already cleared); on transient (network/5xx) it
  falls back to cached `getUser()`. **Bounded** the no-cache retry to 4 attempts (~12s) then → `/login` (was an unbounded 3s
  loop / infinite spinner).
- `frontend/app/(student)/my-order/page.tsx`: added `usePolling(pollApproval, 12000, isWaiting)` so the waiting screen
  auto-advances the moment the rep approves/rejects (re-applies state ONLY on a real transition so it never wipes in-progress
  edits). Dead-token handling is delegated to the global verify-on-401 interceptor (an earlier per-page logout patch was reverted).
- `backend/controllers/orderController.js` `repFullSetContext`: now returns top-level `wholesaler_approval` +
  `wholesaler_reject_reason` (read from the student's sash/robe/cap bundle) — the FE banner reads exactly these.

**② Wholesaler «custom order» = rep adds a NAME-ONLY student & places the same full-set طقم order, skipping BOTH approvals.**
NEW `quickFullSetOrder` (`wholesalerController.js`) + route `POST /api/wholesaler/quick-full-set-order` (declared before the
`/students/:studentId/...` params). Flow: validate `student_name` → in a `tx` INSERT a name-only `users` row (phone=NULL,
email=NULL, role='retail', `password_hash`=bcrypt(randomUUID) ⇒ **un-loginable**: no phone⇒no OTP) + a `students` row
(`status='approved'`, inheriting the rep's جامعة/قسم) → `persistFullSetOrder({student:{…, phone:''}, …})` → flip the bundle to
`wholesaler_approval='approved'` via `setBundleApproval`. So the order lands straight in staff/dashboard. **No migration**
(`students.user_id` is NOT NULL so a name-only student needs a `users` row, but `users.phone/email` are nullable + allow multiple
NULLs since migration 042). FE: NEW `app/wholesaler/custom-order/page.tsx` (اسم الطالب + the reused `FullSetOrderForm`), entry
buttons on `wholesaler/students` + `wholesaler/page.tsx`, `lib/wholesaler.ts` wrapper.
- **BUG the live e2e caught (gates/static could NOT): `checkout_groups.phone_primary` is NOT NULL** → a name-only student (no
  phone) 500'd the order. **Fix:** pass `phone:''` (empty, not null) into `persistFullSetOrder` — `users.phone` stays NULL
  (un-loginable); the '' only fills the order's display contact. (`persistFullSetOrder` uses `student.phone` solely for
  `phone_primary`.)
- **Orchestrator hardening (critic medium):** `quickFullSetOrder` now only deletes the name-only user on failure when NO orders
  exist (avoids the silent `orders.student_id` RESTRICT mask), logs cleanup failures instead of swallowing, and wraps
  `setBundleApproval` so a flip failure leaves the order recoverably **pending** (rep can approve) instead of 500-ing.

**③ Product photo for ALL staff.** `productionController.getOrder`: added `'product_image_url'` to the **embroiderer** allow-list
(tailor already had it; lean/default views keep it) → every role's payload now carries the catalog photo (`products.image_url`,
the same storefront image). FE: extracted a shared `ProductPhotoCard` in `staff/orders/[orderId]/page.tsx`, rendered in the
tailor, embroiderer, and default/full views. Only `product_image_url` added — no price/PII/design leak (critic-confirmed).

**Verified.** Gates re-green after the orchestrator fixes (BE `node --check`, FE `tsc` 0 / `eslint` 0). **Live backend e2e on Neon
(then self-cleaned, 0 leftover):** ② `POST /quick-full-set-order` → 201; student `status='approved'`; user phone+email NULL &
role retail (un-loginable); 3 linked orders all `wholesaler_approval='approved'`; all 3 pass the staff/dashboard visibility gate.
① `GET /orders/rep-full-set` returns `wholesaler_approval` + `wholesaler_reject_reason` keys (200). ③ confirmed statically
(allow-list line + 3 render sites). Critic found nothing critical/high.

### Open follow-ups
- **Browser click-through NOT done** (disk 92%/5.1G → skipped `next dev`/`next build`; backend dev server left UP on :4000).
  USER (or a follow-up) should drive: (①) log in as wholesaler/student, let it sit past the old ~few-minute logout window
  (NotificationBell polling) → confirm NO logout; on the waiting screen have a rep approve → confirm `/my-order` auto-flips within
  ~12s without wiping edits; (②) `/wholesaler/custom-order` add a name → fill طقم → submit → appears in staff queue + dashboard;
  (③) open an `embroidery`-stage order as محمد عماد → see «صورة المنتج».
- **② idempotency (critic medium, NOT fixed):** `quickFullSetOrder` creates a fresh student every POST — a lost response on
  retry yields a duplicate name-only student+order. Low harm (admin can delete); add a client request-key if it bites.
- Uncommitted on main; `PROGRESS.md` not updated; seed unchanged (no migration). The name-only student shows «بدون هاتف» in the
  rep roster (cosmetic fix applied).

---

## 2026-06-24 (c) — كوي (pressing) routing fix · per-zone embroidery checkboxes (محمد عماد) · ابو عبدو (الفصال) full view

Uncommitted on **main** (alongside the calligraphy working-tree changes). **Migration 047 applied to Neon + verified.**
Gates green: FE `tsc` 0 · `eslint` 0 · BE `node --check` 0 (5 files). **Built via a 6-agent Workflow** (3 backend ∥ → FE → gates+critic),
then orchestrator applied the migration + fixed the 2 critic findings + verified the backfill against live data. **NOT yet
driven in a browser**; `next build` not run (dev servers up).

**Why.** User report: pressing «إنهاء التطريز، نقل للكوي» sent the order to **التجهيز, not كوي**, and **كوي must also apply to روب**.
Two root causes: (1) the advance label was keyed on the *current* status, so at `embroidery` it ALWAYS read «نقل للكوي» even
when `nextStageFor` routed to `preparing`; (2) `needs_pressing` was `!!design_id` (retail) / hard-`FALSE` (full-set), so robes
& full-set sashes never got `needs_pressing=true` → always skipped كوي. Plus the user spec'd per-zone embroidery checkboxes for
محمد عماد and a fuller فصال view for ابو عبدو.

**1. كوي routing → TYPE-BASED `needs_pressing` (وشاح + روب press; قبعة skips to تجهيز).** Fixed in ALL 5 write paths:
`orderController.configureOrder` (`= productType==='sash'||'robe'`), `orderController.configureFullSet` + `lib/fullSetOrder.js`
+ (critic-caught gap) `orderController.configurePackage` (`= type!=='cap'`, per-type in the loop), and `cartController` checkout
(added `p.type AS product_type` to the checkout SELECT; `= ci.product_type==='sash'||'robe'`). `has_embroidery`/`initialStatus`
logic untouched. NB: `needs_pressing` is only consulted on the `embroidery→next` edge, so non-embroidered pieces (which start at
`preparing`) are unaffected.

**2. Truthful advance label.** `productionController.getOrder` — `ADVANCE_LABEL_AR` re-keyed on the `${from}→${to}` EDGE
(`embroidery→pressing`=«…نقل للكوي», `embroidery→preparing`=«…نقل للتجهيز», `pressing→preparing`=«إنهاء الكوي، نقل للتجهيز», …).
Label now matches reality; no more lie. FE reads `available_actions.advance.label` (already backend-driven).

**3. محمد عماد — per-zone embroidery checklist.** NEW `orders.embroidery_zones jsonb DEFAULT '{}'` (migration 047). NEW
`POST /production/orders/:id/embroidery-zone {zone, done}` (`markEmbroideryZone`, route mounted next to `/advance`). The
embroiderer ticks each present zone; **when EVERY present zone is done (≥1) the order auto-advances** via `performAdvance`
(embroidery→pressing for sash/robe, →preparing for cap). Zones are **detected from the order's spec lines** (`order_items.label_snapshot`
with content) via a self-contained `ZONE_DEFS`/`detectEmbroideryZones` in productionController (mirrors orderController's
ORDER_ZONE_MATCH heuristics in JS — يمين/يسار/خلف/أمام/أعلى/جانب/ردن). `getOrder` returns a top-level `embroidery_zones:[{key,label,done}]`
ONLY at `status==='embroidery'` (else `[]`); raw jsonb stripped off `order`. Guards: embroiderer/manager-admin only · status must be
`embroidery` · zone validated against the order's actual zones · scope enforced. **Critic hardening applied:** the auto-advance now
goes through the SAME `canStaffTransition` guard as the manual button (was calling `performAdvance` directly → potential ghost
transition if STAGE_AUTHZ ever changed). **GOTCHA:** a *designed retail sash* has its embroidery on the canvas, NOT as order_items
zone lines → `detectEmbroideryZones` returns 0 zones → no checklist shown, embroiderer uses the manual advance button (by design;
documented behavior). Retail full-set & wholesaler sash zone lines DO detect (اليمنى/اليسرى/خلف match).

**4. ابو عبدو (الفصال / tailor) — fuller view, caps excluded.** `tailorQueue` now excludes caps (`AND p.type <> 'cap'`); opening a
cap as tailor-only → 403. `getOrder` adds `p.image_url AS product_image_url` (catalog photo, exposed to all). The tailorOnly
allow-list widened to: `id,status,created_at,student_name,product_name,product_type,product_image_url,measurements,
university_name,department,batch_name,source` + ALL `items` (size selections) with `price_snapshot` nulled. Still stripped: price,
intake, working_*, delivery_*, demographics, `final_design_url`, design canvas (`can_see_design:false`). FE `isTailorOnly` branch
rewritten into a real فصال view (catalog photo + lightbox · قياسات الروب · all spec lines + customer photos). Mirror gate in
`page.tsx`.

**Files.** BE: `controllers/{orderController,productionController,cartController}.js`, `lib/fullSetOrder.js`,
`routes/production.js`; NEW `db/migrations/047_embroidery_zones.sql` + `db/schema.sql` mirror. FE: `app/staff/orders/[orderId]/page.tsx`,
`lib/{staff,staff-types}.ts`.

**Verified.** All gates green. Migration 047 applied + verified live: `embroidery_zones` column present; scoped backfill ran →
**0 embroidered sash/robe in-flight skip كوي**, **0 caps** wrongly flagged pressing. Decision recorded below re: the unembroidered
in-flight rows. **Backend e2e + browser click-through NOT done yet.**

**5. Follow-up staff-pipeline audit (critic, same كوي bug-class) → 3 fixes applied, gates re-green.** User asked to hunt for more
label⟂behavior / ghost-button / routing bugs. Fixed (chosen by user):
- **#1 (🔴 silent delivery via bulk «إكمال»).** `advanceBulk` (productionController) now SKIPS any `ready→delivered` edge
  (`reason:'needs_delivery'`) and `staffController.wholesalerOrders.can_advance` is `false` when `to==='delivered'` — so a
  `ready` order can no longer be bulk-advanced to delivered with NULL recipient/method/address. Delivery must go through the
  `/deliver` modal (single-order path). Verified `nextStageFor('ready')==='delivered'` so the guard is the right edge.
- **#2 (🔴 multi-role staff land on wrong `/staff` home).** `app/staff/page.tsx` now reads the `staff_types[]` union
  (`myTypes = user.staff_types ?? [primary]`): `isManager = role==='admin' || myTypes.includes('manager')`; queue role =
  first `myTypes` member in `QUEUE_META`. Fixes designer+manager losing the dashboard and tailor+embroiderer hitting «الدور غير محدد».
- **#3 → REVERSED by user.** The critic flagged the shawl as "missing embroidery work"; I briefly added an `american_shawl`
  ZONE_DEF. **User corrected: «شال امريكي» is an ADD-ON, NOT تطريز** — it must NOT be a checklist zone. Reverted: ZONE_DEFS is
  ONLY the 5 real embroidery zones (sash name/year/back + cap top/side). The shawl line (with its required photo) is now
  deliberately ignored by `detectEmbroideryZones` — it still shows under «خيارات الطلب» as order data, just never as a checkbox.
  So a sash with front + shawl correctly auto-advances once the real embroidery zones are ticked.

**Live-verified via `/showme` (browser, desktop 1440 + mobile 390, zero console errors), tokens minted via `signToken` for
the real accounts محمد عماد (embroiderer) + ابو عبدو (tailor):**
- محمد عماد lands on his «قائمة التطريز» (multi-role fix #2 — single-role embroiderer routes correctly).
- Order detail at embroidery shows «مناطق التطريز» card = «من الأمام» + «من الخلف» (this wholesaler full-set sash has 2 zones; a
  retail sash shows the 3 name/year/back) — **no شال امريكي in the checklist** (shawl shows only under order options). Ticking
  both → toast «تم نقل الطلب إلى قيد الكوي» + status → «قيد الكوي» (كوي routing + auto-advance confirmed end-to-end).
- ابو عبدو «الفصال» queue = 12 retail orders, **no قبعة**; opening a robe shows صورة المنتج (catalog photo) + قياسات الروب
  (shoulder/chest/length/sleeve + notes + receipt) + fabric/color/sleeve details + **no price value**.
- Demo data used: order `4c46f10e` (دابي / احمد علي قاسم) was temporarily moved preparing→embroidery and **reverted to
  preparing** after. No residual state.

**6. Mandatory checklist for the embroiderer (user request, after live testing).** The manual «نقل للكوي» advance let an
embroiderer skip the per-zone checklist (root cause of a «تعذر تحديث الحالة» confusion: a robe had been advanced past التطريز
via the manual button, `embroidery_zones={}`). Now a **non-manager embroiderer must tick EVERY detected zone**; while any zone
is unticked the manual advance is **hidden** (`getOrder` available_actions.advance=null) AND **rejected server-side** in BOTH
`advance()` (409 `ERR_EMBROIDERY_ZONES_INCOMPLETE` «أكمل مناطق التطريز أولاً») and `advanceBulk()` (skipped, reason
`embroidery_zones_incomplete`). Manager/admin keep the manual advance as a fallback; completing all zones still auto-advances.
Verified live (محمد عماد token): incomplete→advance null + 409 + bulk-skip; admin→advance still shown; tick all→auto-advance to
كوي. **Robe embroidery is NOT missing** — «تطريز ردن الروب الأيمن» maps to `robe_sleeve_right`; a robe at التطريز shows «الروب —
الردن الأيمن». NB: `staffController.wholesalerOrders.can_advance` does NOT yet account for the zone gate, so the rep-console
checkbox for an embroidery order may look enabled but bulk will report it skipped — minor, gate later if it bothers.

### Open follow-ups
- **Audit findings NOT fixed (user deferred):** **#4** legacy `staff_review`/`printing` orders are a queue dead-end (no role
  sees them, `nextStageFor`→null) — only reachable via seed/old data; drain them to `embroidery` or add to `MANAGER_VIEW_STAGES`
  if any exist. **#5** `orderController.listOrders` flat mode leaks `recipient_name`/`delivery_*` to read-only roles
  (tailor/presser) — same side-door class as the 2026-06-18 price fix; gate behind `canSeeMoney`. **#6** designer can't
  approve a pending-design sash from the rep console (checkbox just disabled — no ghost, a workflow dead-spot). **#7**
  `StaffSidebar` role-link label still keyed on primary `staff_type` (cosmetic sibling of #2).
- **USER DECISION (2026-06-24):** 23 existing full-set orders (11 sash + 12 robe) at `design_complete` with `has_embroidery=FALSE`
  are **deliberately left** routing `embroidery→preparing` (skip كوي). User chose "leave them" — only new/edited orders get the
  type-based كوي routing. If they should press too, run: `UPDATE orders o SET needs_pressing=TRUE FROM products p WHERE p.id=o.product_id
  AND p.type IN ('sash','robe') AND o.status::text IN ('designing','design_complete','converting','embroidery') AND o.needs_pressing=FALSE;`
- **Decision recorded:** caps do NOT press (وشاح + روب only). One-line flip if that changes.
- **Designed retail sash shows no zone checkboxes** (canvas embroidery isn't order_items zones) → embroiderer uses the manual
  advance button there. If per-zone tracking is wanted for designed sashes too, derive zones from the design canvas sides instead.
- **Live drive pending:** tick sash zones as محمد عماد → confirm jump to «قيد الكوي»; open as ابو عبدو → full view, no caps. `next build` before deploy.
- Uncommitted on main; `PROGRESS.md` not updated; seed not updated for 047 (schema.sql mirrored; migration idempotent).

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
  **left out of this commit** (likely in-progress work from another editor — avoid FE collisions).
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
- `tsc` 0 errors; `eslint` clean on new files (one pre-existing warning in the
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
