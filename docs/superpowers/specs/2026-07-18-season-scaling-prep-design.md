# Season scaling prep (months 8–10) — design

**Date:** 2026-07-18 · **Status:** approved in discussion, pending owner spec review
**Scope decision:** Tiers 1+2 + AI queue (owner choice). Rate limits UNCHANGED (owner choice).

## 1. Context & load model

Joining season runs months 8–10 (Aug–Oct 2026). Expected:

- Baseline: ~200 users/hour — trivial for the current stack.
- **Spike:** a rep shares the referral link in a university group → **+1000 new students
  within minutes**, then traffic drops back. ~10 new wholesalers onboarded per day.
- Spike path (confirmed with owner): `/join/[code]` → waiting-for-approval screen →
  password-only login (**no OTP anywhere on this path** — join sends none since
  2026-06-27, rep-linked students log in password-only) → shared طقم order form
  (`FullSetOrderForm` → `persistFullSetOrder`). Storefront browsing is NOT part of the
  spike.

Current stack (verified 2026-07-18): one VPS, Nginx → PM2 fork mode running one Express
process (`max_memory_restart: 300M`) + one `next start` process (500M). Neon Postgres on
the **pooled** endpoint (`-pooler`), app pool `max: 10`, dev+prod share the one DB.
Uploads served through Express static. Rate limits per-IP in-memory. Polling:
NotificationBell 30s/user, staff consoles 15s, `/my-order` waiting screen 12s.

## 2. Owner decisions locked (2026-07-18)

1. **Rate limits stay exactly as-is** (join 10/h/IP, login 20/15min/IP, OTP 5/h/IP).
   Owner declined per-phone rekeying and Cloudflare over DDoS/security concerns.
   **Accepted risk (documented, owner informed twice):** Iraqi carrier CGNAT puts
   thousands of users behind a few IPs, so a 1000-student wave can be throttled to
   ~10 joins/hour per carrier IP (≈950 students see 429). **Emergency revert path:**
   raising `max` in `backend/routes/join.js` / `routes/auth.js` + `pm2 reload` takes
   minutes if this bites live.
2. Polling slow-down: YES. Manual «تحقق الآن» button: **NO** (owner declined).
3. Caching: YES — in-process TTL only; **money/settlement data is never cached**.
4. AI queue: YES — pg-boss on the existing Postgres, no Redis.
5. Dev/prod DB split via Neon branch: YES. CI artifact builds: YES. Minimal
   monitoring: YES.
6. **Out of scope:** Redis, PM2 cluster mode, CDN/Cloudflare, storefront SSR/ISR
   caching. Revisit only if the season shows a real bottleneck.

## 3. Polling calm-down (frontend)

- `app/(student)/my-order/page.tsx`: waiting-screen approval poll 12s → **45s + random
  jitter (±10s)**. No manual check button. Poll still re-applies state only on a real
  transition (existing behavior preserved).
- `components/NotificationBell.tsx`: 30s → **60s + jitter**, and **skip polls while the
  tab is hidden** (`document.visibilityState !== 'visible'` → skip tick; poll
  immediately once visible again). Students leave tabs open for days — this removes a
  large share of background load.
- Staff consoles / admin pages keep their current 15s polling (small user count,
  real-time matters). `usePolling` hook gains optional jitter support rather than
  per-page reimplementation.

**Effect at spike:** 1000 waiting students drop from ~83 req/s to ~20 req/s; hidden-tab
skip cuts bell traffic to roughly the number of tabs actually open on screen.

## 4. In-process TTL cache (backend)

New `backend/lib/memoCache.js`: `get(key)` / `set(key, value, ttlMs)` / `del(prefix)`,
LRU-ish max-entries bound (e.g. 500), timestamps checked on read. No external service —
valid because the API is a single process (out-of-scope note: if PM2 cluster ever
happens, this must move to Redis).

Cached reads (TTL / invalidation):

| Endpoint / read | Key | TTL | Invalidation |
|---|---|---|---|
| `GET /join/:code` lookup (rep + جامعة/قسم) | `join:<code>` | 60s | TTL only |
| طقم form context: rep pricing, packages (`repFullSetContext`, wholesaler variants) | `repctx:<wholesalerId>` | 60s | `del` on admin wholesaler/pricing update |
| Catalog: product feed + product detail (`getProductFull`) | `cat:*` | 120–300s | `del('cat:')` on admin product/option writes |
| `site_settings` reads (promo, money-gate `configured`, etc.) | `settings:<key>` | 60s | `del` on `PUT/PATCH` settings |

Hard rules:

- **Never cached:** anything money/settlement (order totals, costs, profits, dashboards,
  TV snapshot beyond its existing internal cache), any per-student order/approval status
  (the waiting screen must see fresh approval state), auth/user lookups.
- Cache the **result object post-authorization** only for public/role-independent data;
  per-wholesaler keys carry no cross-tenant data.
- The cached order-form context is display/pricing-config data; `persistFullSetOrder`
  still reads pricing live inside its transaction (source of truth untouched).

**Effect at spike:** the same-rep spike collapses to ~1 DB read per rep per minute for
context/pricing regardless of student count; join lookups drop ~99%. Also removes the
VPS→Neon (eu-central-1) network round-trip per read for hot paths.

## 5. Infra dials

- `backend/lib/db.js`: pool `max: 10` → **25** (safe on the `-pooler` endpoint).
- `ecosystem.config.js`: API `max_memory_restart` 300M → **800M** (sharp/crop spikes),
  web 500M → **1G** (box has 24GB).
- Nginx serves `/uploads` directly: `location /uploads/ { alias <repo>/uploads/;
  expires 7d; add_header Content-Disposition attachment; add_header
  X-Content-Type-Options nosniff; }` — manual VPS step, snippet shipped in the plan.
  Express static stays as fallback (no code removal).

## 6. Dev/prod DB split (Neon branch)

- Create Neon branch `dev` from the prod branch (point-in-time copy, own compute).
  Local `backend/.env` `DATABASE_URL` → the dev branch. **Prod `.env` untouched.**
- Workflow change (goes into CLAUDE.md/HANDOFF): "applied to Neon" no longer means
  "applied to prod". Prod schema stays covered because `deploy.sh` runs
  `npm run migrate` (idempotent `schema.sql`) — so the existing habit of **mirroring
  every numbered migration into `schema.sql`** becomes mandatory, not just convention.
  Data-repair scripts must now be run against prod explicitly and deliberately.
- Dev data is a snapshot; refresh by re-branching when stale.
- The postgres MCP / test tokens / e2e scripts target dev from now on.

## 7. CI artifact builds

- The existing GitHub Actions deploy workflow gains a build job: `npm ci && next build`
  in CI (Node version pinned to match the VPS), with `NEXT_PUBLIC_*` build-time env from
  repo secrets/vars. Artifact (`.next` + `public` + `package.json`) shipped to the VPS
  (rsync/scp over the existing SSH credentials).
- `scripts/deploy.sh` gets a no-build path: backend `npm ci` + migrate as today; frontend
  swaps in the prebuilt artifact (atomic dir swap: extract → `mv`) then `pm2 reload`.
- Wins: deploys stop pegging the VPS CPU during peak season; a broken build fails in CI
  instead of taking prod down; local disk pressure (94%) stops mattering for deploys.

## 8. Minimal monitoring (developer-only)

**Audience decision (owner, 2026-07-18): monitoring is for the developer ONLY.** No
admin-facing UI, no dashboard cards, no notifications to admin/staff accounts — alerts
and logs are visible only to the developer.

- External uptime ping on `/api/health` (free tier, 1–5min interval) alerting the
  developer's email/Telegram. Manual signup step, documented in the plan.
- `pm2 install pm2-logrotate` on the VPS (logs currently grow unbounded).
- `backend/lib/db.js` `query()`: log a warning with the first ~80 chars of SQL + duration
  when a query exceeds **500ms** — identifies the slow query *before* it becomes an
  outage. (No PII/params in the log line.)

## 9. AI calligraphy queue (pg-boss)

- **Dependency:** `pg-boss` in `backend/package.json`; its tables live in the same Neon
  DB under its own `pgboss` schema (auto-migrated on first start).
- **Worker process:** new `backend/worker.js`, registered as a third PM2 app
  `loloshop-worker` (own memory cap ~500M since it runs sharp). Consumes
  `calligraphy-generate` jobs with concurrency 1–2 (paces OpenRouter cost + sharp
  memory). Job payload: `{job_id}` (the existing calligraphy job id) — the worker loops
  "process next pending batch of ≤10" until the job has no pending plates, reusing the
  exact `processNext` logic **extracted from `calligraphyController` into a shared
  `backend/lib/calligraphyEngine.js`** (same batching, prompt, crop, auto-link,
  audit/cost rows — behavior byte-identical).
- **Enqueue:** `POST /calligraphy/jobs` additionally enqueues one pg-boss job per
  calligraphy job (idempotent via pg-boss singleton key = job id). The frontend
  generation loop (`CalligraphyTool`) switches from driving `/process` in a loop to
  **enqueue → poll `GET /jobs/:id`** (endpoint already returns per-plate status). The
  `/process` endpoint stays (manual fallback / resume tool).
- **Retries:** pg-boss `retryLimit: 2`, exponential backoff on OpenRouter failure;
  plates that still fail keep the existing `failed` status + re-roll flow (re-roll stays
  interactive/direct, unchanged).
- **Failure modes:** worker down → jobs persist in Postgres and run on restart (PM2
  auto-restart). Browser closed → generation continues; reopening the tool shows live
  progress via the existing job fetch. Duplicate enqueue → singleton key dedupes.

## 10. Verification plan

- All backend changes e2e-tested against the **dev branch DB** (new workflow's first
  real use).
- Cache: unit-style checks (TTL expiry, invalidation on admin write) + live HTTP checks
  that admin edits appear within one TTL; money endpoints byte-identical to pre-cache.
- Polling: browser check that the waiting screen updates within ~60s of rep approval and
  the bell stops firing when the tab is hidden (network panel).
- Queue: enqueue a small job → close the browser → plates complete; kill the worker
  mid-job → restart → job resumes; OpenRouter failure path marks plates failed after
  retries.
- CI build: one full Actions run deploying to the VPS off-hours, verifying atomic swap +
  `pm2 reload` + live smoke.
- Spike sanity: scripted burst (distinct phones, one IP) against dev to measure — noting
  that with rate limits unchanged this documents the 429 threshold rather than removing
  it (owner-accepted).

## 11. Rollout checklist (manual VPS/owner steps)

1. Create Neon `dev` branch; repoint local `.env` (before any other work starts).
2. Nginx `/uploads` location block + reload.
3. `pm2 install pm2-logrotate`.
4. Uptime monitor signup + alert target.
5. Actions secrets for the build job (if any new ones needed beyond existing SSH).
6. Deploy rides the normal push-to-main flow; worker appears via updated
   `ecosystem.config.js` on `pm2 reload`.
