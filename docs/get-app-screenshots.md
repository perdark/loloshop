# Re-taking the `/get-app` phone screenshots

`frontend/public/get-app/app-home.webp` and `app-product.webp` are real screenshots of the
running storefront at 390×844 @3× — the two phones on the download page. They are a **snapshot**:
a storefront redesign makes them wrong and nothing in the build will notice. Re-take them here
rather than editing the images.

## Why it is not just "open Chrome and screenshot"

Three things get in the way, and each one silently produces a wrong-looking shot:

1. **The gate.** With `NEXT_PUBLIC_APP_ONLY=1` every browser is bounced to `/get-app`, so the
   storefront never renders. Seed `localStorage.loloshop_web_ok = '1'` first (that is what
   `?web=<NEXT_PUBLIC_GATE_BYPASS>` sets).
2. **Onboarding.** A first-time visitor gets the «اسمك / طالب لو طالبة» card, not the shop. Seed
   `localStorage.loloshop_profile` with `{name, gender, seen:true}`.
3. **The catalog photos time out locally.** The dev DB is a production snapshot, so every
   `image_url` is an absolute `https://lolo-shop96.com/uploads/…` URL pointing at a 4–6 MB PNG.
   Measured from this laptop: 5.6 MB in 8.4 s — past `next/image`'s own fetch timeout, so the
   optimizer answers 500 and **every product renders as a broken-image icon**. That is the same
   root cause as the open «backfill the 54 existing 4–6 MB catalog photos» decision in HANDOFF.

## The recipe

`--headless` + `--screenshot` cannot seed storage, so drive Chrome over CDP. Node 26 has a global
`WebSocket`, so this needs **no dependencies** — which matters, because both CI jobs run
`npm audit` and a new package would sit inside the deploy gate forever.

1. Run the backend (`cd backend && node server.js`) and a production frontend build
   (`cd frontend && NEXT_PUBLIC_APP_ONLY=1 npm run build && npm start`). Use the production
   build, not `next dev`: the dev server OOMs on this laptop and paints differently.
2. Pre-download the catalog images you need into a cache dir, keyed by basename, and downscale
   them (`PIL.Image.thumbnail((900, 900))` — 88 MB → 9.5 MB for 24 photos).
3. Launch `google-chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<tmp>`.
4. Over CDP: `Fetch.enable` on `*_next/image*` and `*lolo-shop96.com/uploads/*`, and fulfil each
   paused request from the cache (decode the `?url=` param, take the basename). Then
   `Emulation.setDeviceMetricsOverride` at 390×844 / dSF 3 / mobile, navigate once to seed the
   two localStorage keys, navigate to the target, wait ~9 s, `Page.captureScreenshot`.
5. Resize to 780 px wide and save as WebP q84 (~110 KB and ~54 KB respectively).

The working script from the 2026-09-12 session is small enough to rewrite from this description;
it lived in the session scratchpad and was deliberately not committed.

## Choosing what to shoot

- **Home** — `/`. Carries the cohort photo and the live count, which is the whole trust argument.
- **Product** — pick one with a real photo. `/shop` is a bad choice: the dev DB is full of
  `ZZTEST-…` fixtures that render as named placeholder tiles.
- Check the shot for test data and for a signed-in state before exporting it.
