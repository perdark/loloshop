# Native app shell + SSR storefront — design

**Date:** 2026-08-04
**Status:** approved for planning
**Owner ask:** «finish everything this session, be sure performance are 100% good, be ready 100% to ship
after edit onboarding and login pages because it is not like a login for a pro app»

Landing page (`/get-app`) is **explicitly out of scope** — the owner is opening a separate session for it.

---

## 1. Where this starts

Everything through commit `baceb73` is pushed. Uncommitted on `main` is the **app-shell batch**: the
storefront-D home, bottom tab bar, onboarding, `/shop`, and nine new untracked files. It is code-complete
and was verified in a browser last session. This work builds directly on top of it, and **the whole thing
still ships as one commit** — the tracked files import the untracked ones, so a partial commit passes
locally and dies on the VPS at `npm ci`.

The App Store listing is live (owner confirmed), so the app-only gate is safe to flip whenever the landing
page is ready. Nothing in this spec depends on that.

---

## 2. Part A — Onboarding

### A1. Gender selector (decided in review)

Replaces the two icon cards in `components/student/Onboarding.tsx`.

**Layout:** stacked rows, one per option. Each row is `icon · label · tick`, full width, `min-h` ≥ 72px.
Selected row: 2px orange border, `rgba(244,123,66,.09)` fill, filled orange circle with a white ✓.
Unselected: 1.5px hairline, white fill, empty ring.

**Why a tick and not just colour:** the tick is the only selection signal that survives a sun-washed
screen or a colour-blind user. Orange-vs-grey alone is not a state indicator.

**Icons:** hand-drawn SVG, **58px**, full colour — not monochrome pictograms.

- Shared: black mortarboard, orange tassel, skin-tone face, black gown shoulders, orange sash tip.
- طالبة: dark hair mass wider than the shoulders, falling past the jaw, plus a fringe over the brow.
- طالب: short dark crop on top only, **clean-shaven** (owner removed the beard).

**The design rule this pair exists to satisfy:** the two options must stay distinguishable when blurred.
Three earlier attempts failed because they were flat one-colour silhouettes — a monochrome shape carries
meaning in its outline alone, and "graduate wearing a cap" has the same outline for everyone. Colour, a
face, and a hair mass give four channels instead of one.

**Hijab:** deliberately NOT drawn. The cohort photo in `public/lookbook/grad-moments-1.jpg` shows rows of
hijab-wearing graduates *and* frames of students with their hair out. Committing to either excludes real
buyers. The hair-mass silhouette reads as female without claiming which.

Icons live in a new `components/student/GraduateIcons.tsx` exporting `<GraduateFemaleIcon>` /
`<GraduateMaleIcon>` so the account preferences screen and any later avatar use the same pair.

### A2. Intro photo

`public/lookbook/onboarding-hero.jpg` stays on disk but is **re-cropped**, not replaced.

The current shot fails as a hero for three reasons: the subject is dead-centre and vertical so there is no
clean area for copy; gold embroidery runs through the entire lower third, which is exactly where the
headline sits, so text lands on busy detail; and the crimson-and-brown palette fights the orange-and-cream
brand.

**Fix:** crop to cap-and-shoulders (upper third), which keeps the graduate and the tassel — the two things
that say "graduation" — and yields flat drape as the lower half for copy. Add a cream-to-transparent scrim
behind the text block so contrast holds regardless of crop drift. Ship as `onboarding-hero-v2.jpg`,
re-encoded through the same sharp policy `backend/lib/upload.js` uses (≤2000px long edge, JPEG q85).

### A3. Native feel

- Both steps get `env(safe-area-inset-*)` padding. The portal currently renders edge-to-edge with none.
- Step transitions move to `transform`-only with `will-change`, no layout-affecting properties.
- Respect `prefers-reduced-motion`.

**Unchanged:** two steps, «تخطّي» on both, skip remembered via `seen: true`, hidden entirely when a token
exists, and the answer still writes through `lib/profile.ts` — that write is the fix for students being
shown the other gender's option groups, so it must not regress.

---

## 3. Part B — Auth family, made native

Applies to `login`, `register`, `forgot-password`, `reset-password/[token]`, `verify-otp`, and
`join/[code]` — every screen that renders `AuthCard`. Fixing `AuthCard` once fixes the family; that is the
point of doing it there rather than per page.

**No auth logic changes.** Not the flow, not the endpoints, not the OTP, not the trusted-device path. Phone
+ password + OTP stays exactly as it is — the owner reviewed that and left it alone.

1. **Kill the floating card.** `AuthCard` becomes a full-bleed screen: brand lockup top, content in a
   flowing column, primary action anchored at the bottom with safe-area padding. The
   `rounded-[20px] border bg-beige` sheet is the single biggest "this is a web form" tell.
2. **Hide `TeamKeyEntry`.** It renders unconditionally today, so every student sees a secret-key field for
   staff, workshop and design-team portals. It collapses behind a quiet «فريق العمل؟» text link at the very
   bottom. Still a sibling `<form>`, never nested — nested forms silently lose their submit.
3. **Inline errors.** Failed credentials render under the field, not as a floating `sonner` toast. Toasts
   stay for success and for genuinely global failures.
4. **Safe-area insets** on every auth screen. `min-h-screen` inside the Capacitor webview lets a notch clip
   the header and the home-bar overlap the submit button.
5. **Replace the hand-rolled step transition.** The inline `translateX(120%)` + `position:absolute` +
   opacity swap is replaced by a transform-only transition on a fixed-height container, which removes the
   reflow that makes it stutter on low-end Android.

**Field sizing:** every input keeps `font-size` ≥ 16px. Below that iOS Safari zooms the page on focus and
drops the user mid-layout. The phone field already does this; the shared `Input` primitive must be checked.

---

## 4. Part C — Performance

### C1. The blocker in the handoff is wrong, and that unlocks everything

Recorded belief: *"`getShopFeed()` is role-aware and the JWT lives in `localStorage`, so a Server Component
cannot know who is asking"* — therefore SSR would risk showing a wholesaler the retail price book.

Read the code:

- `catalogController.priceRoleForUser`: `if (!user) return 'retail'` — **guests already get the retail
  price book.**
- `buildShopFeed`: the audience filter is `'AND p.wholesaler_only = FALSE'` for **both** `guest` and
  `retail`. Only `wholesaler_student` differs.
- Therefore **the guest feed and a logged-in retail student's feed are identical**, except for an
  `audience` string the UI doesn't price off.
- The one genuinely different audience — rep-linked students — is redirected to the package form and
  never renders the home feed.

**So the home feed can be server-rendered with an unauthenticated fetch, and it is correct for every
visitor who actually sees it.** No httpOnly-cookie migration, no guest-flash, no wrong-price risk.

*(The cookie migration remains the right long-term move and would let `/wholesaler` SSR too. It is
explicitly deferred: it touches every login path for 1,141 live accounts, and shipping that the same day
as everything else is how you break authentication for all of them.)*

### C2. What actually gets built

**Server-side fetch helper** — `lib/catalog-server.ts`. Uses `API_INTERNAL_URL` (new, defaults to
`http://127.0.0.1:4000`) so the Next server hits Express directly instead of going back out through nginx
and TLS to reach its own box. `revalidate: 120` to match the backend's existing 120 s `memoCache` — the
same number, so the two caches don't fight.

**`app/(student)/page.tsx` → Server Component.**
- Static bands (الدفعة proof, تحية, وعد, ليش لولو شوب, VIP, موقعنا) render server-side.
- **`grad-crowd-hero.jpg` lands in the initial HTML**, which is the entire point: field data says
  `load duration 289 ms` but `load delay 2113 ms` — the bytes were never the problem, the browser simply
  could not *discover* the image until JS had downloaded, hydrated and fetched. Server-rendering the band
  deletes that 2.1 s.
- Product rails receive their data as props from the server fetch instead of a `useEffect`.
- Client interactivity (greeting from the local profile, maintenance check, discount popup, slider arrows)
  stays in small client children.
- `generateMetadata` becomes possible for the first time.

**`app/(student)/shop/page.tsx` → Server Component** with the same helper. Fixes the handoff's noted
"first grid tiles lazy-load and Next warns they are the LCP element".

**`app/(student)/product/[id]/page.tsx` → split.** 629 lines of client state is not a same-day rewrite.
A Server Component fetches the product and renders the hero image, name and price; the configurator stays
a client child below. This kills the 4-step waterfall for the above-the-fold content without touching the
Fabric/option logic.

### C3. CLS 0.49

Field CLS is 0.49 on the home page — the skeleton→content swap. Every band gets an explicit
`min-height` matched to its rendered height, and every rail its tile aspect ratio, so nothing reflows when
data arrives. Server-rendering removes most of this by construction; the pinning covers the rest.

### C4. The dead `priority` prop

~8 components still pass `priority` to `next/image`. **It was deprecated in Next 16 and does nothing** —
those images all silently lazy-load, several above the fold. Replace with
`loading="eager" fetchPriority="high"`. `ui/BrandLogo` re-exports it as its own prop, so its signature
changes too.

### C5. Caching — the answer to "check for caching if built or not"

Already correct and **not** to be touched:
- Catalog media through `/_next/image`: `public, max-age=14400`, WebP/AVIF, `x-nextjs-cache: HIT`.
- Backend shop feed: 120 s `memoCache` per `(audience, role)`.
- `/uploads` stays `private, no-store`. It is a **shared bucket** — admin catalog media and customer
  artwork land in the same directory — so relaxing it would put customer artwork into shared caches. That
  was the LS-08 decision and it stands.

**Not in scope:** backfilling the 54 existing 4–6 MB photos. Delivery is already fixed for them by the
optimizer; the backfill only makes cache MISSes cheaper, and it needs a transactional
`products.image_url` / `product_images.url` rewrite because re-encoding changes `.png` → `.jpg`.

---

## 5. Part D — Ship readiness

1. **One commit.** The app-shell batch plus everything here, as a single unit.
2. **Gates, all against the final tree:** `tsc` 0 · `eslint` 0 errors · backend tests green (167 at last
   count) · `next build` exit 0.
3. **Stash-and-rebuild check.** The known trap here is tracked files importing untracked ones — it
   typechecks locally and dies on the VPS. Verify the commit is self-contained before pushing.
4. **Browser walk** at 390px and 1280px: guest → onboarding → skip path → filled path → gendered copy
   flips → reload not re-asked → login → register → OTP → home → `/shop` → product.
5. **Never commit** `frontend/public/dev-login.html` or `frontend/public/dev-token-tmp.json` (live JWT).

---

## 6. Out of scope

- `/get-app` landing page — separate session, owner's call.
- Flipping `NEXT_PUBLIC_APP_ONLY`.
- httpOnly cookie migration (§C1).
- Photo backfill (§C5).
- Any change to the auth flow itself (§3).
- `users.gender` column. Gender stays device-local this session; a signed-in student on a new device gets
  the neutral register until they set it in «تفضيلاتي». The column is the real fix and is a migration.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| SSR conversion breaks the home feed for rep-linked students | Verify the wholesaler-student redirect fires *before* the feed renders; walk it signed in as a rep-linked account. |
| `API_INTERNAL_URL` wrong on the VPS → home page 500s | Default to `http://127.0.0.1:4000`, which is what nginx already proxies to. Fall back to the public URL on failure rather than throwing. |
| Server fetch caches a stale feed | `revalidate: 120` matches the existing backend TTL exactly; admin mutations already clear `cat:`. |
| Splitting the product page breaks the configurator | Server part is strictly additive — hero, name, price. The client child keeps its current props and state. |
| The batch is too large to bisect if prod breaks | Gates run against the final tree, and the browser walk covers each surface before the push. |

## 8. Definition of done

Home page LCP element present in the initial HTML response · CLS measurably below 0.1 in a throttled trace ·
onboarding gender rows distinguishable when blurred · no student ever sees the staff key field · every auth
screen full-bleed with safe-area padding · all four gates green on the final tree · one self-contained commit.
