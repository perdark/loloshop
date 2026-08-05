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

## 📍 WHERE THE TREE IS — 2026-08-05

Verified from git this session, not carried over from a previous entry.

| | |
|---|---|
| Checked-out branch | `feat/ssr-storefront-native-auth` @ `eb92e06` — **pushed** |
| `origin/main` | `baceb73` (2026-08-01) |
| Local `main` | `eb92e06` — **ahead of `origin/main` by 3** |
| Pending migration | **none** |

**On `origin/main` already** (so the board must stop calling these undeployed): the 2026-08-01
image work (`9544add`) + serial-fetch fix (`baceb73`) · the app-only gate (`00a634d`, `b76ab7f`,
flag still OFF) · the attendance-break payload fix (`e458fb4`) · **the SuperQi payout cards**
(`345944f`, `12646b3`, `ade2510`) · **the Android 1.0.2 / versionCode 3 icon + splash assets**
(`c171024`).

**NOT on `origin/main`** — 4 commits on `feat/ssr-storefront-native-auth`: the 2026-08-04 app-shell
+ SSR storefront batch (`b23b29e`, `67b801d`, `eb92e06`) and the 2026-08-05 التجهيز/prep-console
batch, **committed as one unit** (26 files) — that commit is the newest.

**Working tree is clean.** Gates re-run at commit time on the batch as a whole: backend **167/167** ·
`tsc` 0 · `eslint` 0 errors · `next build` exit 0. The one-unit warning that used to sit here is
discharged — the cross-imports (`app/staff/page.tsx` → `staff/prep/PrepConsole` ·
`AttendanceReminder` · `hooks/useScrollRestore`; `StudentSheet.tsx` → `staff/ZoneThumb`;
`app/(student)/layout.tsx` → `shop/FooterSignature`) all landed together, so there is no `npm ci`
trap left on this branch.

⚠️ **What prod is actually *running* was NOT re-verified this session** — the sandbox allows no
outbound network and no prod SSH. Everything above is git ancestry, which is what's provable here.
Confirm on the box before trusting "it's live".

---

## 🚢 SHIP QUEUE

- **Deploy = merge to `main` + push + `bash scripts/deploy.sh` on the VPS.** No migration pending.
- **One branch is waiting:** `feat/ssr-storefront-native-auth`, 4 commits — the SSR/app-shell batch
  then the prep-console batch. Merging the branch ships both in the right order.
- **The prep console has not been browser-smoked** against the real queue (326 students / 429
  pieces). It typechecks, lints and builds; nobody has clicked it. Worth ten minutes before or
  right after deploy, since التجهيز is a station a worker uses all day.
- **Set `API_INTERNAL_URL=http://127.0.0.1:4000` in the VPS frontend `.env`** before/with the SSR
  batch. Optional but free: without it the server-side fetch falls back to `NEXT_PUBLIC_API_URL`,
  so the box resolves its own DNS and opens a TLS connection to itself through nginx to reach an
  API on localhost. Correct either way, just slower.
- **The API must be reachable during `npm run build`** now that `/` and `/shop` prerender. It is —
  PM2 keeps the old backend up through the frontend build — and if it ever isn't, the pages
  prerender with `initialFeed: null` and self-heal on the first revalidation.

---

## 👤 OWNER ACTIONS — outside the code

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

- **⚠️ Do NOT set `staff_attendance_settings.verification_mode` to `location`/`both`** —
  `shop_latitude`/`shop_longitude` are NULL, so every بصمة would 403 for every user on every
  platform. Staff GPS is parked.
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
  only · `configurePackage` for a rep-linked student bypasses approval and books cost=0 ·
  governorate is free text · dev/demo rows left in the laptop dev DB (incl. an open attendance
  record + 2 closed breaks for ابو عبدو).

---

## 🤔 OPEN DECISIONS + NEXT MOVES

- **The prep-queue data gap is the highest-value next move for التجهيز.** 325 of 326 student cards
  show «لا تطريز على هذه القطعة» — correctly, because the queue is 71% robes and zone artwork is a
  sash/cap concept. **Do not "fix" the detector.** What the preparer actually needs is already in
  the DB and still unrendered: `لون الروب` · `قماش الروب` · `فصال الروب` · `الشكل` · `لون القبعة`,
  plus `measurements` on 303 of 477 preparing orders and «كسرة الكتف» text on 225 items.
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
  touches every login path for 1,141 live accounts) · Track B deep links (both manifests 404 today;
  needs new binaries + one review; claim `/join/*` ONLY) · `server-only` is not a dependency, so
  `lib/catalog-server.ts` uses a `typeof window` guard instead.

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
