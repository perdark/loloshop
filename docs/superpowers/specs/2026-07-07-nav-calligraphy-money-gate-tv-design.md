# Design — Back-nav fix · calligraphy preview+designer access · money-gate + TV freestyle

**Date:** 2026-07-07 · **Status:** approved (build)

Four independent changes, bundled. Money-gate (item 4) is the large one.

---

## Item 1 — Order back button returns to the wrong page (admin & staff)

**Root cause.** `app/staff/orders/[orderId]/page.tsx` has two hardcoded back affordances:
the "→ العودة" link always → `/staff`, and the `PageHeader backHref` for admin always → `/admin`.
So back always dumps you on the dashboard, never the queue/list you came from.

**Fix — return to where you came from.**
- Every entry point passes `?from=<current path>` when linking into an order. Entry points:
  `app/staff/page.tsx` (2 links), `app/staff/queue/page.tsx` (2), `app/staff/tailor/page.tsx`,
  `app/staff/wholesalers/[wholesalerId]/students/page.tsx`, `app/admin/orders/page.tsx`.
- Order page computes back target: **validated same-origin `?from`** → else `document.referrer`
  (same-origin, not this order page) → else role default (`/admin` for admin, `/staff` for staff).
  Both the "العودة" link AND the header back use it. Label derived from the target
  (`/admin/orders`→"العودة للطلبات", `/staff/queue`→"العودة للطلبات", `/staff/tailor`→"العودة للفصال",
  `/staff/wholesalers/...`→"العودة للممثل", else "العودة").
- Helper `orderBackTarget(fromParam, role)` in `lib/back.ts` (validates the path starts with `/` and
  is one of the known internal prefixes; never trusts an absolute URL).

## Item 2 — AI calligraphy: cannot close the photo preview

Close paths (✕, backdrop, Esc) exist in code, so this is a runtime stacking bug. **Fix:** render the
full-size plate preview overlay (and the compositor overlay if it shares the fault) via
`createPortal(..., document.body)` — the same pattern the shared `Modal` uses — so the `fixed inset-0`
overlay escapes any ancestor stacking/`transform`/`overflow` context in the admin layout that was
trapping it below the sidebar/header or clipping the ✕. Reproduce in-browser, confirm ✕ + backdrop +
Esc all close, re-verify.

## Item 3 — Give the AI calligraphy generator to designers

- **Backend** `routes/calligraphy.js`: replace `requireRole('admin')` with a guard that allows
  **admin OR designer** (`requireStaffType('designer')`, which auto-passes admin/manager). Designers
  generate / re-roll / download / link plates to orders.
- **Frontend:** extract the tool into a shared `components/calligraphy/CalligraphyTool.tsx`; render it
  from both `app/admin/calligraphy/page.tsx` (unchanged behaviour) and a new `app/staff/calligraphy/page.tsx`.
  Add a "الخط العربي" link to `components/staff/StaffSidebar.tsx` for the designer role (multi-role aware —
  use the `staff_types` union, not just primary).

## Item 4 — Money-gate (hide by default, disguised reveal) + freestyle TV

### 4A — Reveal mechanism (shared by `/admin` and `/tv`)
- **Disguised trigger:** a discreet **🎓 graduation-cap icon** in a corner (reads as branding). Click →
  a small **secret-text** prompt (password input, no "money" wording). Correct passphrase → money shown.
- **Passphrase:** admin-set, stored **hashed** (sha256) in `site_settings` key `money_gate`
  (`{ secret_hash }`). Fallback: env `MONEY_GATE_SECRET` used only when the DB hash is unset, so it works
  out-of-box; setting a passphrase in the dashboard overrides the env. If neither set → money cannot be
  revealed (fail-safe). Never ship the hash to the client.
- **Auto-hide:** TV re-hides after ~90s idle or instant tap-to-hide. Dashboard stays revealed for the
  session but re-locks after ~5 min idle. Reveal state is in-memory only (a refresh re-locks).

### 4B — Server-side gating
- **TV** (`/api/tv/snapshot`, key-gated, no JWT): accepts `&reveal=<secret>`. If it matches the hash →
  payload includes money (`kpis.revenue_today/revenue_delta/profit_today`, `graphs.series[].revenue/profit`);
  otherwise those are **stripped** (omitted/0) so staff can't read money from the network tab. Snapshot
  returns `money_visible: boolean`. `growth.series` (year-over-year order **counts**) is NOT money and stays.
- **Admin** (JWT, `requireRole('admin')`): `POST /api/admin/money-gate/verify {secret}`→`{ok}`,
  `PUT /api/admin/money-gate {secret}` (set/change), `GET /api/admin/money-gate`→`{configured}`.
  Dashboard money data is admin-only already (staff can't call these endpoints), so the dashboard
  **masks** money in the UI (••••) until verified — shoulder-surfing is the only threat there.

### 4C — Admin dashboard (`app/admin/page.tsx`)
- Mask the three headline Figures (revenue/cost/profit), the margin hint, and the accounting receipt
  (revenue/cost/profit + per-row profit) with the 🎓 reveal. `orderCount` stays visible.
- Add **non-money charts** derived from data the dashboard already loads: **orders trend** (`daily[].orders`
  count) and **production pipeline** (`ordersByStatus`). No new backend needed for these.

### 4D — Freestyle TV (`/tv/[key]`) — watchable for 6h+, warm brand, keep old Iraq map
Evolve the existing scene rotation into a **full-screen scene cinema** (warm cream/orange brand — NOT
obsidian/gold, NOT the rejected throne-room theme). Slim persistent header (brand + live clock + rotating
**non-money** KPI ticker + 🎓 icon) over a large stage that cross-fades between rotating scenes, plus a
thin footer event ticker. **Keep the existing `IraqMap` component** as the map scene. Default (money hidden)
scene rotation, all from the current snapshot:
1. **Pulse** — orders today, delivered today, live visitors (`audience.now`), active batches.
2. **Pipeline** — WIP funnel per stage + bottleneck highlight (`pipeline`).
3. **Orders trend** — orders/day count (`graphs.series[].orders_in` / `growth.series`).
4. **Conquest map** — the old `IraqMap` + orders-by-governorate (`map.gov`).
5. **Lifetime reach** — graduates · universities · orders brag scene (backend `lifetime`/`growth`; non-money).
6. **Deadlines & staff** — batches nearing deadline (`deadlines`) + who's-working spotlight (`staff`).

When money is **revealed**, extra money scenes (revenue/profit trend, cumulative revenue, revenue odometer,
margin) join the rotation and the money KPI ticks appear; otherwise they are absent entirely. Preserve the
data layer (fetchSnapshot, SSE events auto-refresh, scale-to-fit / full-screen no-scroll).

---

## Build structure (workflow)
- **Phase 1 (parallel):** F1 backend money-gate (tvBoardController strip+reveal, admin verify/set/get endpoints);
  F2 frontend reveal primitives (`MoneyRevealTrigger`, `useMoneyGate`, `MoneyMask`, `lib/money-gate.ts`) — all new files.
- **Phase 2 (parallel, disjoint files):** A back-nav; Calligraphy (item 2 portal fix + item 3 designer access, one owner of the calligraphy files); D TV freestyle; E admin dashboard mask + charts.
- **Phase 3:** gates (tsc/eslint/node --check) + adversarial critic (money-leak in TV payload, back `from` validation, calligraphy role gate).
- **Phase 4:** apply critic high/critical fixes; re-gate. Live verify (showme + browser) done by orchestrator after.

## Verification
- BE `node --check` on all touched files; FE `npx tsc --noEmit` 0 + `npx eslint` 0.
- Live: TV shows no money by default; 🎓 + correct secret reveals money then auto-hides; wrong secret →
  money stays gone + no money in the network payload. Dashboard masks/reveals. Order back returns to origin.
  Designer can open `/staff/calligraphy` and generate. Calligraphy preview closes (✕/backdrop/Esc).
