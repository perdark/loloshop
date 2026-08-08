# Finish the app: entry paths, deep links, GPS — 2026-08-07

Closes the question «can staff and a rep's students get into the app without the website?».

## The constraint everything follows from

`capacitor.config.ts` sets `server.url = https://lolo-shop96.com`. The binaries are WebView
shells that load the live site. **App and website are one artifact.** So:

- Anything that is HTML/JS/API ships by website deploy — instantly, in the already-installed
  app, no store review.
- Anything in `AndroidManifest.xml` or the iOS entitlements/Info.plist needs a **new binary**
  and a **store review**.

Every decision below is sorted by that line.

## What we are NOT doing, and why

**Fully-automatic first-tap join after install.** Android could do it (Play Install Referrer
carries `?referrer=join_<code>` through the install; `lib/app-gate.ts:113` already appends it).
**iOS cannot** — the App Store passes nothing into a freshly-installed app, and deferred deep
linking is not a platform feature. The alternatives are third-party fingerprint SDKs
(Branch/AppsFlyer — paid, degrading under Apple's privacy changes) or clipboard sniffing
(visible paste banner, fragile).

Rather than ship two different flows and maintain the Android-only one forever, both platforms
get the same answer: **tap the link again after installing.** One line of Arabic on `/get-app`,
zero native code. Owner decision, 2026-08-07.

## Work

### A — Web only. Ships on deploy. No store, no review, no waiting.

| # | Change | File |
|---|---|---|
| A1 | `GET /api/join/representatives` — public list of approved reps (جامعة · قسم · code) | `backend/{routes,controllers}/join*.js` |
| A2 | Typed client wrapper | `frontend/lib/auth-api.ts` |
| A3 | «ادخل مع ممثلك» on `/login` → جامعة → قسم → routes to `/join/<code>` | `frontend/app/login/page.tsx` |
| A4 | «بعد التثبيت، ارجع واضغط الرابط مرة ثانية» | `frontend/app/get-app/page.tsx` |
| A5 | Allowlist `/join/` in the app-only gate | `frontend/lib/app-gate.ts` |

**A1 route order matters:** `router.get('/:code')` already exists and would swallow
`/representatives`. The literal route must be registered first.

**A3 is the real fix.** `referral_code` is an admin-typed Latin slug (`/^[a-z0-9-]+$/`, e.g.
`damascus-medicine`). Asking an Arabic-speaking student to type that from memory on a phone is a
support-ticket machine. One list, one tap, zero typing.

> **Shipped shape differs from this line, deliberately (2026-08-08).** It was built as two
> dependent dropdowns (جامعة → قسم) first and the live data killed it: `university_name` is
> admin free text and the 12 real rows spell one university three ways, so a student who picks
> the wrong spelling gets an empty قسم list and concludes their rep is not registered. The
> shipped picker is ONE `<select>` grouped by `<optgroup>`, which makes a mis-spelled twin
> visible instead of hidden. Reasoning is in the header of `frontend/app/join/page.tsx`.

**A5 is a correctness fix, not a nicety.** `/join/` is not in `BROWSER_ALLOWED_PREFIXES` today,
so the moment `NEXT_PUBLIC_APP_ONLY=1` is set, every student without the app is bounced to the
store and loses their code — see "what we are NOT doing". Allowlisting `/join/` costs nothing:
once App Links verify, Android intercepts the URL *before* the browser loads it, so students who
do have the app still land in the app.

**Tradeoff accepted in A1/A3:** the rep list (universities + departments) becomes public to
anyone opening `/login`. Joining is still gated — the wholesaler approves each student one by
one — so this is a client-list disclosure, not a security hole. Reversible: delete the endpoint
and the picker falls back to a code box.

### B — Native. Needs one new binary per store.

| # | Change | File |
|---|---|---|
| B1 | Deep links already claim `/join/` | done, uncommitted |
| B2 | Extend the claim to `/s/`, `/w/`, `/d/` (team key portals) | manifest · AASA · `DeepLinkHandler.tsx` |
| B3 | `ACCESS_FINE/COARSE_LOCATION` | done, uncommitted |
| B4 | iOS: `NSLocationWhenInUseUsageDescription` + associated-domains entitlement | `codemagic.yaml` (`ios-appstore`) |

B2 is why the team portals matter: `/s/`, `/w/`, `/d/` are the **only** way in for staff,
workshop and design-team members who have no phone for the WhatsApp OTP (`TeamKeyEntry` was
deleted from `/login` in `bc0c6fe`). Today those links can only open in a browser. Claiming them
means the same link opens the app, logged in and persistent.

All four ride **one** Android release and **one** iOS release. Not two.

### C — Owner actions. Cannot be done from code.

1. **⚠️ Enter the shop coordinates.** `staff_attendance_settings.shop_latitude/longitude` are
   NULL. Setting `verification_mode` to `location`/`both` before they are filled **403s every
   بصمة for every staff member on every platform**. Do this first, flip the mode last.
2. `ANDROID_SHA256_CERT_FINGERPRINTS` on the VPS — Play Console → App integrity → **App signing
   key** certificate. Not the upload keystore; Play re-signs the AAB.
3. `IOS_TEAM_ID` on the VPS.
4. **⚠️ Enable "Associated Domains" on the App ID** in the Apple Developer portal **before** the
   next Codemagic run, or `fetch-signing-files` builds a profile without the entitlement and the
   build fails at signing.
5. Play Data Safety form + Apple privacy label: declare location.

## Order of operations

```
A (deploy today)  →  students + reps unblocked, no store involved
B (one build each) →  submit; deep links + GPS permission land together
C1 (coordinates)   →  before any GPS flip
verify on a real phone of each platform
  adb shell pm get-app-links com.loloshop96.app
then flip verification_mode, and only then NEXT_PUBLIC_APP_ONLY=1
```

Flipping either flag before its verification step strands a whole user group: `APP_ONLY` before
deep links verify strands new students; `verification_mode` before coordinates exist strands all
staff.

## Acceptance

- [ ] `/api/join/representatives` returns only `approved_by_admin` reps with a university
- [x] `/login` → «ادخل مع ممثلك» → one grouped `<select>` (NOT two dropdowns — see A3 above)
      → lands on `/join/<code>`, no typing
- [ ] `/join/` in `BROWSER_ALLOWED_PREFIXES`
- [ ] `/get-app` states the second-tap instruction
- [ ] manifest + AASA + `DeepLinkHandler` claim the same four prefixes — **all three in sync**
- [ ] `codemagic.yaml` injects the location string and the entitlement *after* `cap sync`
      (the iOS project is regenerated every build, so a one-time commit is wiped)
- [ ] backend `node --test test/` green · `tsc` 0 · `eslint` 0 · `next build` exit 0
