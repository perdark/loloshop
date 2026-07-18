# Season Scaling Prep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LoloShop survive the months 8–10 joining season (baseline 200 users/hour, +1000-student referral spikes) via polling calm-down, in-process caching, infra dials, dev/prod DB split, CI artifact deploys, developer-only monitoring, and a server-side pg-boss queue for AI calligraphy.

**Architecture:** All backend caching is a single in-process TTL map (valid because the API is one PM2 fork-mode process). The calligraphy queue is pg-boss on the existing Neon Postgres (no Redis); a third PM2 process (`loloshop-worker`) consumes jobs by reusing the exact controller batch logic, extracted into a shared lib. CI already builds the frontend on every push — we start shipping that artifact instead of rebuilding on the VPS.

**Tech Stack:** Express 5, Node 20, pg / Neon (pooled endpoint), pg-boss ^10, Next.js 16 + React 19 (read `frontend/node_modules/next/dist/docs/` before Next code), Tailwind v4, PM2, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-07-18-season-scaling-prep-design.md`

## Global Constraints

- **NEVER `git push` during this plan.** Push to main auto-deploys prod. Commit locally per task; deploy is the final owner-approved step (Task 11).
- **Rate limits are UNTOUCHED** (owner decision, spec §2.1). If any task's diff touches `rateLimit(` config, that diff is wrong.
- **No admin-facing monitoring surface** (spec §8): no UI, no admin notifications — logs + external alerts to the developer only.
- **Never cache:** money/settlement data, per-student order/approval status, auth/user lookups (spec §4).
- **Task 0 runs first** — every later e2e/manual test hits the new dev DB branch, never prod.
- Error responses keep the project shape `{ error: <Arabic>, code: 'ERR_*' }`.
- Gates per task: backend `node --check <file>` on every touched JS file; frontend `npx tsc --noEmit` = 0 errors and `npm run lint` = 0 errors. New backend unit tests run with `node --test`.
- The repo working tree contains uncommitted files from other sessions — `git add` ONLY the files this plan names. Never `git add -A`.

---

### Task 0: Neon dev branch + local repoint (workflow split)

**Files:**
- Modify: `backend/.env` (local only — NOT committed; verify it is gitignored first)
- Modify: `CLAUDE.md` (workflow note)

**Interfaces:**
- Produces: local `DATABASE_URL` pointing at the `dev` Neon branch; prod branch untouched. All later tasks' e2e runs hit dev.

- [ ] **Step 1: Confirm `.env` is not tracked**

Run: `git check-ignore backend/.env && echo SAFE`
Expected: `SAFE`. If not ignored, STOP and fix `.gitignore` first.

- [ ] **Step 2: Owner/manual — create the branch** (needs Neon console access; ask the user to do this or provide the Neon API key)

In Neon console → project → Branches → **New branch** named `dev`, from the primary branch, "current point in time", with its own compute. Copy the **pooled** connection string (host contains `-pooler`).

- [ ] **Step 3: Repoint local `.env`**

In `backend/.env`, replace the `DATABASE_URL=` value with the dev-branch pooled string. Keep every other var unchanged.

- [ ] **Step 4: Verify dev is a separate DB**

```bash
cd backend && node -e "
const { query } = require('./lib/db');
(async () => {
  const r = await query('SELECT count(*)::int AS n FROM orders');
  console.log('orders on THIS db:', r.rows[0].n);
  await query(\"CREATE TABLE IF NOT EXISTS _dev_branch_marker (id int)\");
  console.log('marker created — this is DEV');
  process.exit(0);
})();"
```
Expected: order count prints (snapshot of prod data), marker table creates. Then confirm in the Neon console that `_dev_branch_marker` exists ONLY on the `dev` branch.

- [ ] **Step 5: Document the workflow change in `CLAUDE.md`**

In the `## IMPORTANT version facts` section, replace the line
`- DB is **PostgreSQL via Neon** in dev (not local VPS disk as older spec implies). \`lib/db.js\` forces IPv4 + SSL for Neon hosts.`
with:
```markdown
- DB is **PostgreSQL via Neon**. Since 2026-07-18 dev and prod are SEPARATE Neon branches:
  local `.env` → `dev` branch; the VPS `.env` → primary. "Applied to Neon" no longer means
  "applied to prod" — every numbered migration MUST be mirrored into `db/schema.sql`
  (deploy runs `npm run migrate` = schema.sql, that is how prod gets schema). Data repairs
  must be run against prod explicitly. Refresh dev data by re-branching in Neon.
  `lib/db.js` forces IPv4 + SSL for Neon hosts.
```

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: dev/prod DB split — local .env now targets the Neon dev branch"
```

---

### Task 1: `memoCache` lib + unit tests

**Files:**
- Create: `backend/lib/memoCache.js`
- Create: `backend/test/memoCache.test.js`

**Interfaces:**
- Produces: `memoCache.get(key)` → value | `undefined`; `memoCache.set(key, value, ttlMs)`; `memoCache.del(prefix)` (deletes every key starting with prefix); `memoCache.wrap(key, ttlMs, fn)` → cached value or `await fn()` then cache. Tasks 2–4 consume `wrap` and `del`.

- [ ] **Step 1: Write the failing test**

```js
// backend/test/memoCache.test.js
const test = require('node:test');
const assert = require('node:assert');
const memoCache = require('../lib/memoCache');

test('set/get within TTL', () => {
  memoCache.set('a:1', { x: 1 }, 1000);
  assert.deepStrictEqual(memoCache.get('a:1'), { x: 1 });
});

test('get after TTL expiry returns undefined', async () => {
  memoCache.set('a:2', 'v', 10);
  await new Promise((r) => setTimeout(r, 25));
  assert.strictEqual(memoCache.get('a:2'), undefined);
});

test('del(prefix) removes only matching keys', () => {
  memoCache.set('cat:x', 1, 5000);
  memoCache.set('cat:y', 2, 5000);
  memoCache.set('join:z', 3, 5000);
  memoCache.del('cat:');
  assert.strictEqual(memoCache.get('cat:x'), undefined);
  assert.strictEqual(memoCache.get('cat:y'), undefined);
  assert.strictEqual(memoCache.get('join:z'), 3);
});

test('wrap caches the fn result and skips the second call', async () => {
  let calls = 0;
  const fn = async () => { calls += 1; return 'r'; };
  assert.strictEqual(await memoCache.wrap('w:1', 1000, fn), 'r');
  assert.strictEqual(await memoCache.wrap('w:1', 1000, fn), 'r');
  assert.strictEqual(calls, 1);
});

test('bounded: oldest entries evicted past MAX_ENTRIES', () => {
  for (let i = 0; i < 600; i++) memoCache.set(`b:${i}`, i, 60000);
  assert.strictEqual(memoCache.get('b:0'), undefined);   // evicted
  assert.strictEqual(memoCache.get('b:599'), 599);        // newest kept
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node --test test/memoCache.test.js`
Expected: FAIL — `Cannot find module '../lib/memoCache'`

- [ ] **Step 3: Implement**

```js
// backend/lib/memoCache.js
// In-process TTL cache. Valid ONLY while the API runs as a single PM2 fork process —
// if PM2 cluster mode ever lands, replace with a shared store (Redis).
const MAX_ENTRIES = 500;
const store = new Map(); // key -> { value, expiresAt }  (Map preserves insertion order)

function get(key) {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) { store.delete(key); return undefined; }
  return hit.value;
}

function set(key, value, ttlMs) {
  if (store.has(key)) store.delete(key); // re-insert to refresh recency order
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  while (store.size > MAX_ENTRIES) {
    store.delete(store.keys().next().value); // evict oldest insertion
  }
}

function del(prefix) {
  for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
}

async function wrap(key, ttlMs, fn) {
  const hit = get(key);
  if (hit !== undefined) return hit;
  const value = await fn();
  if (value !== undefined) set(key, value, ttlMs);
  return value;
}

module.exports = { get, set, del, wrap };
```

- [ ] **Step 4: Run tests**

Run: `cd backend && node --test test/memoCache.test.js`
Expected: 5 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/memoCache.js backend/test/memoCache.test.js
git commit -m "feat(cache): in-process TTL memoCache (get/set/del-prefix/wrap, bounded)"
```

---

### Task 2: Cache the join-code lookup

**Files:**
- Modify: `backend/controllers/joinController.js` (function `getReferral`, lines 5–23)

**Interfaces:**
- Consumes: `memoCache.wrap` from Task 1.

- [ ] **Step 1: Wire the cache**

Replace `getReferral`'s body so the SELECT goes through the cache (60s). Only successful lookups are cached — a 404 keeps hitting the DB (so a newly created rep link works immediately):

```js
const memoCache = require('../lib/memoCache'); // top of file

async function getReferral(req, res) {
  const { code } = req.params;
  const data = await memoCache.wrap(`join:${code}`, 60_000, async () => {
    const { rows } = await query(
      `SELECT u.name AS wholesaler_name, w.deadline, w.university_name, w.department
       FROM wholesalers w JOIN users u ON u.id = w.user_id
       WHERE w.referral_code = $1`,
      [code]
    );
    return rows.length ? rows[0] : undefined; // undefined → not cached
  });
  if (!data) {
    return res.status(404).json({ error: 'الرابط غير صالح', code: 'ERR_REFERRAL_INVALID' });
  }
  res.json({
    wholesaler_name: data.wholesaler_name,
    deadline: data.deadline,
    university_name: data.university_name,
    department: data.department,
    valid: true,
  });
}
```

- [ ] **Step 2: Gate + live check (dev DB)**

Run: `cd backend && node --check controllers/joinController.js`
Then with the dev server on :4000 (`node server.js`), pick a real referral code from the DB (`node -e` + `SELECT referral_code FROM wholesalers LIMIT 1`) and:
```bash
curl -s localhost:4000/api/join/<CODE> | head -c 200; echo
curl -s localhost:4000/api/join/<CODE> | head -c 200; echo   # second hit = cached, same body
curl -s -o /dev/null -w "%{http_code}\n" localhost:4000/api/join/NOPE_INVALID   # 404
```
Expected: identical 200 bodies; invalid code → 404.

- [ ] **Step 3: Commit**

```bash
git add backend/controllers/joinController.js
git commit -m "feat(cache): join-code lookup cached 60s (hits only)"
```

---

### Task 3: Cache full-set packages + rep public pricing

**Files:**
- Modify: `backend/controllers/wholesalerController.js` (`fullSetPackages`, line ~245)
- Modify: `backend/controllers/orderController.js` (`repFullSetContext`, line ~1428)
- Modify: `backend/controllers/adminController.js` (invalidation hooks)

**Interfaces:**
- Consumes: `memoCache.wrap` / `memoCache.del`.
- Cache keys produced: `pkg:fullset` (global, 60s) and `reppricing:<wholesalerId>` (per rep, 60s).

**CRITICAL:** `repFullSetContext` also returns `existing`, `wholesaler_approval`, `wholesaler_reject_reason` — the waiting screen polls these. Those reads MUST stay live; only the `packages` and pricing sub-reads are cached.

- [ ] **Step 1: Cache the two sub-reads in `orderController.repFullSetContext`**

Add `const memoCache = require('../lib/memoCache');` to the top of `orderController.js`. Inside `repFullSetContext`, replace the packages query and pricing load:

```js
    const packagesRows = await memoCache.wrap('pkg:fullset', 60_000, async () => {
      const pk = await query(
        `SELECT id, name_ar, price FROM packages
         WHERE active = TRUE AND is_full_set = TRUE ORDER BY sort, created_at`
      );
      return pk.rows;
    });
    packages = packagesRows;
    const p = await memoCache.wrap(`reppricing:${student.wholesaler_id}`, 60_000, () =>
      loadWholesalerPricing(student.wholesaler_id)
    );
```
(the `pricing = { base: ..., addons: ... }` mapping below stays exactly as-is).

- [ ] **Step 2: Same two caches in `wholesalerController.fullSetPackages`**

Add the `memoCache` require, then:

```js
async function fullSetPackages(req, res) {
  const wId = await getWholesalerId(req.user.id);
  const rows = await memoCache.wrap('pkg:fullset', 60_000, async () => {
    const r = await query(
      `SELECT id, name_ar, price FROM packages
       WHERE active = TRUE AND is_full_set = TRUE ORDER BY sort, created_at`
    );
    return r.rows;
  });
  const pricing = await memoCache.wrap(`reppricing:${wId}`, 60_000, () => publicPricingFor(wId));
  res.json({ data: { packages: rows, pricing } });
}
```

- [ ] **Step 3: Invalidation hooks in `adminController.js`**

Add the `memoCache` require. Run `grep -n "UPDATE wholesalers\|pricing_addons\|wholesaler_price" backend/controllers/adminController.js` — in EVERY function that writes the `wholesalers` row (at minimum `updateWholesaler`; include any pricing-set endpoint the grep reveals), add after the successful UPDATE:
```js
  memoCache.del(`reppricing:${id}`); // id = the wholesaler id variable in that function
```
Also `grep -n "INSERT INTO packages\|UPDATE packages\|DELETE FROM packages" backend/controllers/*.js` — in every package mutation (they live in `catalogController.js`: `createPackage`, `updatePackage`, `deletePackage`, `setPackageProducts`, `setPackageRule`), add `memoCache.del('pkg:fullset');` after the write (requires the memoCache import in `catalogController.js` too — Task 4 adds it anyway; add it here if doing this step first).

- [ ] **Step 4: Gate + live check (dev DB)**

`node --check` all three controllers. Live: as a rep JWT (mint via `signToken` like prior sessions), `GET /api/wholesaler/full-set-packages` twice (identical), then change that rep's `wholesaler_price` via the admin endpoint and re-fetch → new price appears immediately (invalidation) — NOT after 60s.

- [ ] **Step 5: Commit**

```bash
git add backend/controllers/wholesalerController.js backend/controllers/orderController.js backend/controllers/adminController.js backend/controllers/catalogController.js
git commit -m "feat(cache): full-set packages + rep pricing cached 60s with admin invalidation"
```

---

### Task 4: Cache storefront catalog + promo

**Files:**
- Modify: `backend/controllers/catalogController.js`

**Interfaces:**
- Consumes: `memoCache`. Keys: `cat:shop:<priceRole>` (120s), `cat:prod:<id>:<priceRole>` (120s), `settings:promo` (60s). Invalidation helper `clearCatalogCache()` (module-local).

**CRITICAL:** `getShop` / `getProductFull` output depends on the caller's price role (`priceRoleForUser`) — the role MUST be part of the key or wholesalers would see retail prices (or worse, the reverse).

- [ ] **Step 1: Add helper + wire the three reads**

Top of `catalogController.js`:
```js
const memoCache = require('../lib/memoCache');
function clearCatalogCache() { memoCache.del('cat:'); }
```
- In `getShop` (line ~167): resolve the price role first (existing `priceRoleForUser` call), then wrap the ENTIRE existing body that builds the response payload in `memoCache.wrap(`cat:shop:${role}`, 120_000, async () => { ...existing queries... return payload; })` and `res.json` the result.
- In `getProductFull` (line ~57): same pattern with key `` `cat:prod:${req.params.id}:${role}` ``. 404s return `undefined` from the wrapped fn (not cached) and respond 404 outside.
- In `isPromoLive` (line ~42): wrap its `site_settings` SELECT with key `settings:promo`, 60s. **Note:** if `isPromoLive` feeds price computation inside `getShop`, keep the promo flag INSIDE the wrapped payload builder so a promo flip is at most 120s stale — and add `memoCache.del('settings:promo'); clearCatalogCache();` to the admin promo PATCH handler (grep `site_settings` writes: `updatePromo`/`PATCH /admin/promo` in `adminController.js` or `catalogController.js`).

- [ ] **Step 2: Call `clearCatalogCache()` after every catalog mutation**

In these functions (all in `catalogController.js` — names verified by grep): `createProduct`, `updateProduct`, `deleteProduct`, `addProductImage`, `deleteProductImage`, `createGroup`, `updateGroup`, `deleteGroup`, `createOption`, `updateOption`, `deleteOption`, `setOptionPriceRole`, `setProductPriceRole`, `lockGroupOption`, `unlockGroupOption`, `createPackage`, `updatePackage`, `deletePackage`, `setPackageProducts`, `setPackageRule`, `createHeroSlide`, `updateHeroSlide`, `deleteHeroSlide` — add `clearCatalogCache();` immediately after the successful write, before the response. (`memoCache.del('pkg:fullset')` from Task 3 stays alongside in the package functions.)

- [ ] **Step 3: Gate + live check (dev DB)**

`node --check controllers/catalogController.js`. Live: anonymous `GET /api/catalog/shop` twice → identical. As a wholesaler-linked JWT → prices differ from anonymous (role keying works). Admin renames a product → anonymous re-fetch shows the new name immediately.

- [ ] **Step 4: Commit**

```bash
git add backend/controllers/catalogController.js backend/controllers/adminController.js
git commit -m "feat(cache): storefront shop/product/promo cached (role-keyed) with write invalidation"
```

---

### Task 5: Polling calm-down (frontend)

**Files:**
- Modify: `frontend/lib/hooks/usePolling.ts`
- Modify: `frontend/components/NotificationBell.tsx` (line ~82)
- Modify: `frontend/app/(student)/my-order/page.tsx` (line ~177)

**Interfaces:**
- Produces: `usePolling(loadFn, intervalMs, enabled?, jitterMs?)` — each tick fires at `intervalMs ± random(0..jitterMs)`. Existing 3-arg callers stay valid (jitter defaults to 0).

Note: `usePolling` ALREADY skips ticks while `document.hidden` and fires on tab return — spec §3's hidden-tab requirement is already met; this task only adds jitter + new intervals.

- [ ] **Step 1: Add jitter to the hook (setTimeout chain replaces setInterval)**

```ts
"use client";

import { useEffect, useRef } from "react";

/**
 * Calls `loadFn` every `intervalMs` ± random(0..jitterMs) milliseconds.
 * Pauses while `document.hidden` (tab in background) and when `enabled` is false.
 * Jitter spreads simultaneous clients (e.g. 1000 students landing together on the
 * waiting screen) so their polls don't arrive as one synchronized wave.
 */
export function usePolling(
  loadFn: () => void,
  intervalMs = 12000,
  enabled = true,
  jitterMs = 0
) {
  const loadRef = useRef(loadFn);
  useEffect(() => {
    loadRef.current = loadFn;
  }, [loadFn]);

  useEffect(() => {
    if (!enabled) return;

    let timerId: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    function nextDelay() {
      const jitter = jitterMs > 0 ? (Math.random() * 2 - 1) * jitterMs : 0;
      return Math.max(1000, intervalMs + jitter);
    }

    function schedule() {
      timerId = setTimeout(() => {
        if (stopped) return;
        if (!document.hidden) loadRef.current();
        schedule();
      }, nextDelay());
    }

    function handleVisibility() {
      if (!document.hidden) {
        loadRef.current();
        if (timerId) clearTimeout(timerId);
        schedule();
      }
    }

    schedule();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      stopped = true;
      if (timerId) clearTimeout(timerId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [intervalMs, enabled, jitterMs]);
}
```

- [ ] **Step 2: New intervals at the two call sites**

`frontend/components/NotificationBell.tsx` — replace `usePolling(load, 30000);` with:
```ts
  usePolling(load, 60000, true, 15000);
```
`frontend/app/(student)/my-order/page.tsx` — replace `usePolling(pollApproval, 12000, isWaiting);` with:
```ts
  usePolling(pollApproval, 45000, isWaiting, 10000);
```
Do NOT add any manual refresh button (owner declined «تحقق الآن»).

- [ ] **Step 3: Gates + browser check**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: 0 errors. Browser (dev): open `/my-order` as a waiting rep-student, network panel → polls arrive ~35–55s apart; switch tabs → polls stop; return → immediate poll.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/hooks/usePolling.ts frontend/components/NotificationBell.tsx "frontend/app/(student)/my-order/page.tsx"
git commit -m "perf(polling): jittered usePolling; bell 60s, waiting-screen 45s"
```

---

### Task 6: Infra dials — pool, slow-query log, memory caps

**Files:**
- Modify: `backend/lib/db.js`
- Modify: `ecosystem.config.js`

- [ ] **Step 1: Pool 10 → 25** — in `backend/lib/db.js` change `max: 10,` to `max: 25,` (safe: prod uses the `-pooler` endpoint, verified 2026-07-18).

- [ ] **Step 2: Slow-query log** — in `db.js`, replace the body of `query()`'s try branch:

```js
async function query(text, params) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const t0 = Date.now();
      const result = await pool.query(text, params);
      const ms = Date.now() - t0;
      if (ms > 500) {
        // Developer-only diagnostics (pm2 logs). SQL text only — never params (PII).
        console.warn(`SLOW QUERY ${ms}ms: ${String(text).replace(/\s+/g, ' ').slice(0, 80)}`);
      }
      return result;
    } catch (e) {
      lastErr = e;
      if (!isTransient(e) || attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  throw lastErr;
}
```

- [ ] **Step 3: Memory caps** — in `ecosystem.config.js`: API `max_memory_restart: '300M'` → `'800M'`; web `'500M'` → `'1G'`.

- [ ] **Step 4: Gate + verify**

`node --check backend/lib/db.js && node --check ecosystem.config.js`. Restart local `node server.js`, hit any endpoint — normal queries log nothing; artificially verify the path with `node -e "require('./lib/db').query('SELECT pg_sleep(1)').then(()=>process.exit(0))"` → one `SLOW QUERY` line.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/db.js ecosystem.config.js
git commit -m "perf(infra): pool 25, slow-query warn >500ms, PM2 memory caps raised"
```

---

### Task 7: Extract the calligraphy engine (pure refactor)

**Files:**
- Create: `backend/lib/calligraphyEngine.js`
- Modify: `backend/controllers/calligraphyController.js` (`processNext`, lines 256–342)

**Interfaces:**
- Produces: `processNextBatch(jobId)` → `Promise<{ processed, done, failed, pending, remaining, review, plates }>` — exactly the fields the current HTTP response of `POST /jobs/:jobId/process` carries (FE type `CalProcess`: `processed`, `done`, `remaining`, `review`, `plates`). Task 8's worker consumes this.
- Behavior contract: byte-identical to today — same ≤10 batch pick, same `generateImage` + `cropSheet` + plate saves + `autoLinkPlate` + cost rows + `review` flagging.

- [ ] **Step 1: Move the logic**

Create `backend/lib/calligraphyEngine.js`. Move the BODY of `processNext` (everything between reading `jobId` and the final `res.json(...)`, lines ~258–341) into:

```js
// backend/lib/calligraphyEngine.js
// Single source of truth for "process the next batch of ≤10 pending plates".
// Called by BOTH the HTTP endpoint (controllers/calligraphyController.processNext)
// and the pg-boss worker (worker.js). Must never touch req/res.
async function processNextBatch(jobId) {
  // <moved body — returns the object instead of res.json'ing it>
}
module.exports = { processNextBatch };
```
The moved code needs these imports carried over from the controller: `query` (lib/db), `generateImage`/`MODELS` (lib/openrouter), `cropSheet` (lib/sheetCrop), `saveBufferToUploads` (lib/upload), plus the controller-local helpers it references. Helpers used by BOTH the moved body and the remaining controller (`toPlate`, `autoLinkPlate`, `jobCounts`, `jobCost`, prompt builders) move into the engine and are re-exported; the controller imports them from the engine (`const { processNextBatch, toPlate, autoLinkPlate, jobCounts, jobCost } = require('../lib/calligraphyEngine');`) and deletes its local copies. `attachOrderContext` stays in the controller (HTTP-presentation concern) unless the moved body references it — check with grep; if it does, move it too and re-export.

- [ ] **Step 2: Thin controller wrapper**

```js
// controllers/calligraphyController.js
async function processNext(req, res) {
  const { jobId } = req.params;
  const result = await processNextBatch(jobId);
  if (result.error) return bad(res, result.error.msg, result.error.code, result.error.status || 400);
  res.json({ data: result });
}
```
(Preserve today's exact error statuses/Arabic messages: any `bad(...)` call inside the old body becomes `return { error: { msg, code, status } }` from the engine, translated back in the wrapper as above.)

- [ ] **Step 3: Gates + behavior check (dev DB)**

`node --check` both files. Then run a REAL tiny job over HTTP against dev (admin JWT): `POST /api/calligraphy/jobs` with 2 typed names → `POST /jobs/:id/process` → expect the same response shape as before (`processed`, `done`, `remaining`, `plates[]` with statuses), plates written under `/uploads/calligraphy/plates`. This costs ~$0.04 (one OpenRouter sheet) — acceptable; delete the test job rows after (`DELETE FROM calligraphy_plates WHERE job_id='<id>'`).

- [ ] **Step 4: Commit**

```bash
git add backend/lib/calligraphyEngine.js backend/controllers/calligraphyController.js
git commit -m "refactor(calligraphy): extract processNextBatch engine (no behavior change)"
```

---

### Task 8: pg-boss queue + worker process

**Files:**
- Modify: `backend/package.json` (add `pg-boss`)
- Create: `backend/lib/queue.js`
- Create: `backend/worker.js`
- Modify: `backend/controllers/calligraphyController.js` (`createJob` line ~184, `queueGenerate` line ~440)
- Modify: `ecosystem.config.js`

**Interfaces:**
- Consumes: `processNextBatch(jobId)` from Task 7.
- Produces: `enqueueGeneration(jobId)` (lib/queue.js) — fire-and-forget enqueue with singleton dedup; queue name `calligraphy-generate`.

- [ ] **Step 1: Install**

Run: `cd backend && npm install pg-boss@^10`
Expected: added to `package.json` dependencies.

- [ ] **Step 2: `backend/lib/queue.js`**

```js
// Shared pg-boss handle. The API process uses it only to SEND; worker.js also WORKs.
// Tables live in the same Neon DB under the `pgboss` schema (auto-created on start).
const PgBoss = require('pg-boss');

const QUEUE_GENERATION = 'calligraphy-generate';

let bossPromise = null;
function getBoss() {
  if (!bossPromise) {
    const boss = new PgBoss({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3, // small dedicated pool — do not starve the app pool
    });
    boss.on('error', (err) => console.error('pg-boss error:', err));
    bossPromise = boss.start().then(async () => {
      await boss.createQueue(QUEUE_GENERATION).catch(() => {}); // idempotent
      return boss;
    });
  }
  return bossPromise;
}

// Fire-and-forget: generation must keep working even if the queue is down
// (the FE's /process fallback still exists). singletonKey dedupes re-enqueues
// of the same job while one is queued/active.
async function enqueueGeneration(jobId) {
  try {
    const boss = await getBoss();
    await boss.send(QUEUE_GENERATION, { jobId }, {
      singletonKey: jobId,
      retryLimit: 2,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 60 * 60, // a huge job may run long; per-attempt cap 1h
    });
  } catch (err) {
    console.error('enqueueGeneration failed (client loop still works):', err.message);
  }
}

module.exports = { getBoss, enqueueGeneration, QUEUE_GENERATION };
```

- [ ] **Step 3: `backend/worker.js`**

```js
require('dotenv').config();
const { getBoss, QUEUE_GENERATION } = require('./lib/queue');
const { processNextBatch } = require('./lib/calligraphyEngine');

// Drains one calligraphy job: batch after batch (≤10 names each) until nothing is
// pending. A batch that processes 0 while work remains means the upstream
// (OpenRouter/crop) failed — throw so pg-boss retries with backoff; plates keep
// their pending/failed statuses and the resumed attempt picks up where it stopped.
async function handleGeneration(jobId) {
  for (;;) {
    const r = await processNextBatch(jobId);
    if (r.error) throw new Error(`${r.error.code}: ${r.error.msg}`);
    console.log(`[worker] job ${jobId}: +${r.processed} done=${r.done} remaining=${r.remaining}`);
    if (r.remaining <= 0) return;
    if (r.processed === 0) throw new Error('batch made no progress — retrying later');
  }
}

(async () => {
  const boss = await getBoss();
  await boss.work(QUEUE_GENERATION, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) await handleGeneration(job.data.jobId);
  });
  console.log('loloshop-worker up — consuming', QUEUE_GENERATION);
})().catch((err) => { console.error('worker boot failed:', err); process.exit(1); });

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
```

- [ ] **Step 4: Enqueue on job creation**

In `calligraphyController.js` add `const { enqueueGeneration } = require('../lib/queue');`. In `createJob`, after `insertPlates(...)` succeeds and BEFORE the `res.status(201)` line, add:
```js
  enqueueGeneration(jobId); // server-side generation; FE now just polls getJob
```
In `queueGenerate` (line ~440): it also creates plates via `insertPlates` — add the same `enqueueGeneration(<its job id variable>)` after its insert (read the function to find the variable name; same pattern).

- [ ] **Step 5: PM2 app**

In `ecosystem.config.js` `apps` array, append:
```js
    {
      name: 'loloshop-worker',
      cwd: './backend',
      script: 'worker.js',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '500M', // sharp cropping spikes
    },
```

- [ ] **Step 6: Gates + e2e (dev DB, real OpenRouter — ~$0.04)**

`node --check` on all touched files. Then:
1. Start `node worker.js` locally (dev DB). Expect the "worker up" log + `pgboss` schema visible in the dev branch.
2. Admin JWT → `POST /api/calligraphy/jobs` with 2 names. Do NOT call `/process`. Within ~30s, `GET /jobs/:id` shows plates `done` — server-side generation works with zero client driving.
3. Kill the worker mid-job on a fresh 12-name job (after the first batch logs), restart it → job resumes and finishes (pg-boss redelivery).
4. Cleanup: delete the test plate rows.

- [ ] **Step 7: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/lib/queue.js backend/worker.js backend/controllers/calligraphyController.js ecosystem.config.js
git commit -m "feat(queue): pg-boss calligraphy generation worker (server-side, retries, singleton)"
```

---

### Task 9: Frontend — enqueue-then-poll generation

**Files:**
- Modify: `frontend/components/calligraphy/CalligraphyTool.tsx` (`runCreatedJob`, line ~653)

**Interfaces:**
- Consumes: existing `getCalJob(jobId)` wrapper (`lib/calligraphy.ts`). Backend now generates server-side (Task 8). `processCalJob` stays exported (manual fallback) — do not delete it.

- [ ] **Step 1: Replace the client-driven loop with polling**

Replace the body of `runCreatedJob` (keep the signature):

```ts
  // Server-side generation (pg-boss worker) — the browser only WATCHES progress.
  // Closing the tab no longer stops generation; reopening + fetching the job
  // (cal_last_job in localStorage) shows the finished plates.
  async function runCreatedJob(job: CalJob) {
    setJobId(job.job_id);
    setPlates(job.plates);
    setTotal(job.total);
    setDone(0);

    let stalledPolls = 0;
    let lastDone = 0;
    for (;;) {
      await new Promise((r) => setTimeout(r, 4000));
      const full = await getCalJob(job.job_id);
      setPlates(full.plates);
      setDone(full.done);
      const finished = full.plates.every((p) => p.status !== "pending");
      if (finished) break;
      // Watchdog: no progress for ~2 min → worker likely down. Fall back to the
      // old client-driven loop so generation never hard-blocks on the worker.
      stalledPolls = full.done === lastDone ? stalledPolls + 1 : 0;
      lastDone = full.done;
      if (stalledPolls >= 30) {
        toast.message("المولّد الخلفي متوقف — نكمل التوليد من المتصفح");
        let remaining = full.total - full.done;
        while (remaining > 0) {
          const r = await processCalJob(job.job_id);
          setDone(r.done);
          setPlates((prev) => prev.map((p) => r.plates.find((u) => u.id === p.id) ?? p));
          if (r.review) toast.error("تعذّر تقطيع إحدى الأوراق — راجِعها يدويًا");
          if (r.processed === 0 && r.remaining > 0) break;
          remaining = r.remaining;
        }
        break;
      }
    }
    const full = await getCalJob(job.job_id);
    setPlates(full.plates);
    setDone(full.done);
    setControlsOpen(false);
  }
```

- [ ] **Step 2: Gates + browser check (worker running)**

`cd frontend && npx tsc --noEmit && npm run lint` → 0 errors. Browser as admin: generate 2 names → progress bar advances WITHOUT any `/process` request in the network panel (only `/jobs/:id` polls); close the tab mid-job on a bigger batch, reopen the tool → plates finished. Stop the worker, generate → after ~2 min the fallback toast appears and the client loop finishes the job.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/calligraphy/CalligraphyTool.tsx
git commit -m "feat(calligraphy): FE watches server-side generation, client-loop fallback on stall"
```

---

### Task 10: CI artifact build + no-build deploy path

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/deploy.sh`

**Manual prerequisite (with the user):** SSH to the VPS and run `grep -h NEXT_PUBLIC /var/www/loloshop/frontend/.env* 2>/dev/null` — every `NEXT_PUBLIC_*` var found (at minimum `NEXT_PUBLIC_API_URL`) must be added as a **GitHub Actions repository variable** with the same value, because these are baked in at build time and the build now happens in CI. If none exist on the VPS, none are needed in CI.

- [ ] **Step 1: Frontend job builds WITH prod env + uploads the artifact**

In `ci.yml`, in the `frontend` job, replace the build step and add upload:

```yaml
      - run: npm run build
        env:
          NEXT_TELEMETRY_DISABLED: "1"
          NEXT_PUBLIC_API_URL: ${{ vars.NEXT_PUBLIC_API_URL }}
      - name: Pack build
        run: tar -czf next-build.tgz .next
      - uses: actions/upload-artifact@v4
        with:
          name: next-build
          path: frontend/next-build.tgz
          retention-days: 3
```

- [ ] **Step 2: Deploy job ships the artifact then runs the no-build deploy**

Replace the `deploy` job's steps with:

```yaml
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: next-build
      - name: Ship build to VPS
        uses: appleboy/scp-action@v0.1.7
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SERVER_SSH_KEY }}
          port: ${{ secrets.SERVER_PORT || 22 }}
          source: next-build.tgz
          target: /var/www/loloshop/.deploy/
      - name: SSH deploy
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SERVER_SSH_KEY }}
          port: ${{ secrets.SERVER_PORT || 22 }}
          script: |
            bash /var/www/loloshop/scripts/deploy.sh --prebuilt
```

- [ ] **Step 3: `deploy.sh` gains the `--prebuilt` path**

Replace the frontend section of `scripts/deploy.sh`:

```bash
echo "==> frontend: install deps"
cd frontend && npm ci && cd ..

if [ "${1:-}" = "--prebuilt" ] && [ -f "$REPO_DIR/.deploy/next-build.tgz" ]; then
  echo "==> frontend: using CI-built artifact (no local build)"
  rm -rf frontend/.next.new
  mkdir -p frontend/.next.new
  tar -xzf "$REPO_DIR/.deploy/next-build.tgz" -C frontend/.next.new --strip-components=1
  rm -rf frontend/.next.old
  [ -d frontend/.next ] && mv frontend/.next frontend/.next.old
  mv frontend/.next.new frontend/.next
  rm -f "$REPO_DIR/.deploy/next-build.tgz"
else
  echo "==> frontend: building locally (fallback)"
  cd frontend && npm run build && cd ..
fi
```
(`tar -czf next-build.tgz .next` produces entries under `.next/…`, hence `--strip-components=1` into `.next.new`. The local-build fallback keeps a manual `bash deploy.sh` working exactly as today.)

- [ ] **Step 4: Verify without deploying**

`bash -n scripts/deploy.sh` (syntax). `ci.yml` lint via `npx yaml-lint .github/workflows/ci.yml` or a YAML parse in node. Full pipeline verification happens on the actual season deploy (Task 11) — the fallback branch guarantees a broken artifact path degrades to today's behavior, not an outage.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml scripts/deploy.sh
git commit -m "ci: build frontend in Actions, ship artifact, no-build deploy path (--prebuilt)"
```

---

### Task 11: Rollout doc + HANDOFF/PROGRESS + owner-approved deploy

**Files:**
- Create: `docs/ops/2026-07-18-season-rollout.md`
- Modify: `HANDOFF.md`, `PROGRESS.md`

- [ ] **Step 1: Write the rollout doc** — it lists every manual step with exact commands:

```markdown
# Season rollout — manual steps (run in this order, after the code deploy)

## 1. Nginx serves /uploads directly (VPS)
Add inside the server block of the loloshop site config (before the proxy locations):

    location /uploads/ {
        alias /var/www/loloshop/uploads/;
        expires 7d;
        add_header Cache-Control "public, max-age=604800";
        add_header Content-Disposition attachment;
        add_header X-Content-Type-Options nosniff;
    }

Then: nginx -t && systemctl reload nginx
Verify: curl -sI https://lolo-shop96.com/uploads/<any-existing-file> | grep -i cache-control

## 2. PM2 (VPS)
pm2 install pm2-logrotate
pm2 reload ecosystem.config.js --update-env   # picks up loloshop-worker + new memory caps
pm2 save
Verify: pm2 ls shows loloshop-api, loloshop-web, loloshop-worker all online.

## 3. Uptime monitoring (developer-only — NOT for admin)
UptimeRobot free: HTTP monitor on https://lolo-shop96.com/api/health, 1–5 min interval,
alert contact = developer email/Telegram ONLY. No admin-facing surface exists or should.

## 4. GitHub Actions variables (before first CI deploy)
Repo → Settings → Variables: NEXT_PUBLIC_API_URL = <value from VPS frontend/.env*>.

## 5. Post-deploy smoke
- /api/health → ok:true
- Storefront loads; product prices correct as anonymous AND as a rep student.
- Generate 2 calligraphy names → completes with the browser tab closed.
- pm2 logs loloshop-api | grep "SLOW QUERY" — note any offenders.
```

- [ ] **Step 2: HANDOFF.md entry** (newest-on-top, project format: what changed · why · verified · open follow-ups) + `PROGRESS.md` line. Include the accepted-risk note: rate limits deliberately unchanged (owner decision); emergency bump = `routes/join.js` / `routes/auth.js` `max` values + `pm2 reload`.

- [ ] **Step 3: Commit**

```bash
git add docs/ops/2026-07-18-season-rollout.md HANDOFF.md PROGRESS.md
git commit -m "docs: season rollout runbook + handoff"
```

- [ ] **Step 4: STOP — ask the owner to deploy**

Deploy = `git push` (auto-deploys via Actions). Get explicit owner approval, push, then walk `docs/ops/2026-07-18-season-rollout.md` together. Do not push without the owner's go.

---

## Self-review notes

- **Spec coverage:** §3 polling → Task 5 (hidden-tab skip already existed — verified in code, task documents it). §4 cache → Tasks 1–4. §5 dials → Task 6 + nginx in Task 11 runbook. §6 dev branch → Task 0. §7 CI → Task 10. §8 monitoring → Tasks 6 (slow-query) + 11 (uptime, logrotate; developer-only). §9 queue → Tasks 7–9. §2.1 rate limits untouched → global constraint. §10 verification → embedded per task.
- **Type consistency:** `processNextBatch(jobId)` return `{processed, done, failed, pending, remaining, review, plates}` used identically in Tasks 7 (producer), 8 (worker), 9 (FE reads the same fields via existing `CalProcess`/`CalJob` types — no FE type changes needed). `usePolling` 4th arg `jitterMs` matches both call sites. `enqueueGeneration(jobId)` name identical in Tasks 8 (def) and its two call sites.
- **Known unknowns made explicit:** exact variable names inside `queueGenerate` and admin wholesaler-pricing writes are located by grep instructions with expected patterns, not guessed line numbers; VPS `NEXT_PUBLIC_*` values are read off the server before Task 10's CI change.
