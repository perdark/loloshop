# Spec — App-only gate: the website becomes a download wall for the app

**Date:** 2026-07-31 · Owner decisions locked in session · **Status: code written, NOT verified, NOT deployed, flag OFF**

## Goal
Everything functional lives in the app. `lolo-shop96.com` in a browser redirects to the
store. The real marketing landing page is a LATER, separate job.

## THE FACT THAT SHAPES EVERYTHING
`frontend/capacitor.config.ts` → `server.url: "https://lolo-shop96.com"`, `webDir: "public"`.
**The app IS the website.** Both binaries are webview shells with zero bundled app code.

1. Staff / wholesaler / admin logins **already work in the app** — there was never anything to port.
2. You **cannot** strip the website without stripping the app. They are one artifact. The job
   is *separating* them, which did not exist before this change.

## VERIFIED: this ships with NO rebuild and NO App Review
Read from `node_modules/@capacitor/android/.../getcapacitor/Bridge.java`:
- L241–242 `if (getServerUrl() != null) allowedOriginRules.add(getServerUrl());`
- L265–269 `WebViewCompat.addDocumentStartJavaScript(webView, injector.getScriptString(), allowedOrigin)`

The remote `server.url` is an allowed origin and the bridge is injected **at document start**,
so `window.Capacitor` exists in the **already-shipped** binaries. Website deploy only — the
same route the 2026-07-30 account-deletion fix took.

## Owner decisions (locked)
| Question | Decision |
|---|---|
| Admin | Web **and** app — exempting `/admin` from the gate gives both for free |
| `/tv/[key]` workshop display | Stays on web |
| Join links | Hard redirect to the store. **No interstitial, no buttons** |
| Invite code | **Wholesaler tells students the code** in the same WhatsApp message → the code never travels through the store install, so the whole deferred-deep-link problem disappears |
| iOS | Live on the App Store |
| Landing page | Later, separate session |
| Image/upload slowness | **Deferred** — owner said later. See "Deferred" below |
| Deploy | One deploy, gate behind a flag |

## What was BUILT this session
| File | What |
|---|---|
| `frontend/lib/app-gate.ts` | **NEW** — allowlist, store URLs, kill switch, `buildGateScript()` |
| `frontend/app/layout.tsx` | gate script as the **first element in `<body>`**, only when `NEXT_PUBLIC_APP_ONLY=1` |
| `frontend/app/get-app/page.tsx` | **NEW** — desktop fallback placeholder (phones never see it) |
| `frontend/components/auth/TeamKeyEntry.tsx` | **NEW** — in-app entrance to the `/s /w /d` secret portals |
| `frontend/app/login/page.tsx` | renders `<TeamKeyEntry />` as a **sibling** of the form (nested forms are invalid HTML) |

Gate verified so far: **`tsc --noEmit` exit 0.** Nothing else. Not run in a browser, not on a phone.

### Why an inline `<head>`-level script and not a React effect
Capacitor injects its bridge at document start, so `window.Capacitor` is readable before first
paint. A `useEffect` gate would flash the real storefront to every browser visitor first.

### Route policy — `BROWSER_ALLOWED_PREFIXES`
`/admin`, `/workshop`, `/tv/`, `/s/`, `/w/`, `/d/`, `/privacy`, `/terms`, `/delete-account`,
`/get-app`, `/manifest.json`, `/.well-known/`

⚠️ `/privacy`, `/terms`, `/delete-account` are allowlisted **because Apple and Google require
them reachable on the open web** — gating them risks a rejection on the next submission.
⚠️ `/get-app` must stay allowlisted or the redirect is an infinite loop.

### BLOCKER THAT WAS FOUND AND FIXED — staff who cannot receive an OTP
Staff login is two things, not one:
- Staff **with** a phone → `/login` + WhatsApp OTP → already worked in the app ✅
- Staff **without** a phone → secret URL `/s/[key]`; workshop (Syrian workers) `/w/[key]`;
  design team `/d/[key]`

**The app has no address bar** — those three groups could not reach their own login screen
inside the app. `TeamKeyEntry` moves the secret from the URL bar into a password field, then
routes to the **existing** portal page, which already owns the member-list + password step —
no duplicated auth logic, backend untouched.
Accepts a bare key **or** a whole pasted `/s/<key>` link (staff were originally handed URLs).
Strictly *more* secure than the URL it replaces: URLs leak via history, WhatsApp link previews
and referrer headers; a password field does not.

## Session persistence — no work needed
`lib/auth.ts` keeps `token`, `user` and `loloshop_device_token` (90-day trusted device,
survives logout, skips OTP) in `localStorage`, which the webview persists like a browser →
**log in once, stay logged in.**
⚠️ App and Chrome are **separate storage containers despite the identical origin** — everyone
logs in once more inside the app. Expected, not a bug.

## Kill switch — be accurate about the cost
`NEXT_PUBLIC_APP_ONLY=1` enables the gate; anything else removes the script entirely.
⚠️ `NEXT_PUBLIC_*` is inlined at **build** time, so flipping it is **env edit + redeploy
(~2–3 min via `deploy.sh`)** — NOT instant. The instant escape is per-device:
`NEXT_PUBLIC_GATE_BYPASS=<token>` then visit `/login?web=<token>`, which sets
`localStorage.loloshop_web_ok` and unlocks that browser permanently. Unset = no bypass exists.

## ⚠️ OPEN RISK — the PWA
The site is an installed PWA for some users (`manifest.json` + `PwaRegistrar`). A PWA launch
has **no `window.Capacitor`**, so today's PWA users get bounced to the store. That is arguably
the intent ("everything on the app"), but it **is a breaking change for existing PWA users**
and the owner has not explicitly ruled on it. If they should be let through, allow
`window.matchMedia('(display-mode: standalone)').matches` in the gate script.

## NEXT SESSION — do these in order
1. **Owner input still needed:** App Store link (numeric `id…`) → `NEXT_PUBLIC_APPSTORE_URL`,
   and confirm the Play link. **Unset iOS is safe** — it falls back to `/get-app` rather than
   a broken Apple link, so the gate can be verified without it.
2. **Decide the PWA question above.**
3. `npm run lint` + `next build` (⚠️ disk was at 90% — `next build` was NOT run locally last
   deploy for this reason; it ran on the server).
4. **Phase 9 verify — none of this has been run in a browser yet:**
   - flag OFF → site behaves exactly as today (regression check)
   - flag ON, desktop → `/` bounces to `/get-app`; `/admin`, `/tv/<key>`, `/privacy` still open
   - flag ON, Android phone → `/join/<code>` lands on Play with `&referrer=join_<code>`
   - flag ON, **inside the real app** → full site works, nothing bounces ← the one that matters most
   - `TeamKeyEntry`: real staff key, real workshop key, a pasted `/s/<key>` URL, and a wrong key
5. **Walk attendance breaks in a browser** — shipped to prod 2026-07-30 with 161/161 tests but
   *never clicked by a human*. Live risk sitting in prod right now; ~5 min inside this same pass.
6. Deploy, then flip the flag on **last** and re-verify on a real phone.

## Deferred — image / upload slowness (owner: "do it later")
Owner reports product images and image upload are very slow, and believes it is because they
are client-side.
⚠️ **Half of that diagnosis is likely backwards.** A phone camera JPEG is 4–6MB; if it is sent
raw then the upload is slow *because there is no client-side downscale*, and no server change
fixes it. If it already downscales, then canvas encoding is blocking the main thread on a
low-end Android. **Opposite fixes — measure before building.**
Product images are more likely genuinely server-side: originals served off VPS disk at camera
resolution, `next/image` running `sharp` on a small VPS, no CDN, missing `sizes`.
Real fix is probably a server pipeline generating 3 WebP sizes on upload **plus** a client
downscale before send — both, not either. ⚠️ Disk was at 90% (owner rule: stay under 80%),
so variants likely replace originals rather than sit beside them.
Do this as its own session with Slow-4G + 4× CPU throttling, not bundled with the gate.

## Track B — deep links (LATER, needs new binaries + one review)
Live state verified 2026-07-31: **both manifests 404. Deep links are at 0%, not half-done.**
- `/.well-known/assetlinks.json` → 404, `ANDROID_SHA256_CERT_FINGERPRINTS` unset on the VPS
- `/.well-known/apple-app-site-association` → 404, file does not exist
- `AndroidManifest.xml` has only MAIN/LAUNCHER — no `autoVerify`, no `<data>` host
- No iOS Associated Domains entitlement, and `codemagic.yaml` runs `npx cap add ios` which
  **regenerates `ios/` every build** → must be injected in CI with a verifying `exit 1` step,
  exactly like the `NSCameraUsageDescription` fix

⚠️ The Android fingerprint must be **Google Play's re-signing cert** (Play App Signing), NOT
the local upload keystore. A wrong fingerprint fails verification **silently**.

⚠️ **Claim `/join/*` ONLY.** AASA/assetlinks are public and unauthenticated — listing
`/s /w /d` would publish the existence and shape of the secret staff portals to the internet.
It leaks no key, but turns "nobody knows this exists" into "everybody knows what to
brute-force." Claiming only `/join/*` also stops the app hijacking the future landing page.

⚠️ Deep links and the `app.lolo-shop96.com` split each need a binary + review — **do them in
the SAME binary, one review cycle.**

### Known gap until Track B lands
A student who *has* the app taps `/join/CODE` → no OS interception → browser → bounced to the
store → sees "Open". Clumsy, not broken: they open the app and type the code the wholesaler
gave them. Track B removes the extra hop.
