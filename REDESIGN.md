# REDESIGN — Portfolio-grade pass to ~95%

Master backlog from the verified multi-agent audit (102 findings) **plus** the
gaps the defect-audit missed: content/copy quality, the conversion/onboarding
flow, a low-end-Android perf budget, the designer gender-gate UX, and a real
Phase 6 verify + security checklist.
Bar: agency portfolio piece judged by 50+ businessmen. Spec source of truth: `DESIGN.md`.
**Tracking:** check items as done. Update after every task.

## ▶ Status — resume here
- **Branch:** `redesign/design-system` (not merged to main, not deployed). Dev server: `localhost:3000`.
- **Done (8 commits, ~50/102 findings, tsc clean):** unified palette + ink shadows + primitives
  (Button/Input/Select/EmptyState/Modal); `--color-danger`, `.font-display-ar`; sash editor real
  fabric (`.sash-stage`); storefront unlocked → editorial grids + cinematic hero + scroll-reveal/parallax
  (CSS `view()`, no JS); AA contrast sweep (~50 files); admin chart recolor + max-width; auth + wholesaler
  onto unified system (join rewrite, danger token, real empty/error states).
- **Now (this session): execute the 5 lanes below in parallel, then Phase 6.** Lanes are sized so
  subagents don't collide (admin / staff / designer-chrome / storefront-shop / cross-cutting+content).

## Reuse, don't invent (the established system)
- **Tokens:** `paper/cream` page, `surface/beige` cards, `surface-sink` recessed, `ink`/`ink-soft` text,
  `muted` labels-only, `line` hairlines, `orange-ink` earned accent, `--color-danger` warm brick.
- **Primitives:** `Button` (primary/secondary/ghost/**danger**, sm/md/lg all ≥44px, `loading`),
  `Input`/`Select` (warm error, orange-ink focus), `EmptyState` (title/message/icon/action),
  `Modal` (focus-trap, Esc, RTL) → **use for every `window.confirm`**.
- **Motion:** `.scroll-reveal`/`.scroll-reveal-soft`/`.parallax-photo`+`.parallax-frame`, `.font-display-ar`.
- **State trio contract (apply to EVERY data screen):** loading = content-shaped skeleton (not a lone
  spinner); error = distinct panel + retry button (never spin forever, never render an error as "no data");
  empty = `EmptyState` with a path forward.

---

## LANE 1 — Admin shell & lists  *(agent: admin)*
ROI: high — admin is the "businessman" judging screen. Self-contained under `app/admin/*` + `AdminSidebar`.
- [ ] `admin/layout.tsx main` — add max-width + editorial grid (kill skinny full-width bars + empty void)
- [ ] `AdminSidebar` — remove disabled `الإعدادات` + `قريباً` (Soon) stub from production nav; strip brand-gradient side-stripe / orange blur blob
- [ ] **`window.confirm` → `Modal`** (RTL confirm) for destructive deletes in `admin/products`, `admin/wholesalers`
- [ ] **error/loading/empty trio** on admin orders, batches, products, wholesalers, staff, hero-slides lists (skeleton + retry panel + EmptyState)
- [ ] batches: price save-on-blur → explicit confirm + clear role target; no blank/stuck spinner
- [ ] wholesaler card 6-action pile → tidy grouping; remove header side-stripes
- [ ] native `type="date"` LTR pickers (orders + wholesalers) → RTL-aligned date input (`dir="rtl"` wrapper, `text-align:right`, Arabic-friendly)
- [ ] reversed prev/next chevrons in RTL pagination (next points ←, prev →)
- [ ] fix shipped-order TODO per-student order link
- [ ] sweep off-palette green/red/amber/yellow → palette (profit green / loss red → ink + orange-ink + danger)

## LANE 2 — Staff shell & lists  *(agent: staff)*
ROI: medium-high — fewer screens, but `OrderCard`/sidebar are loud. Under `app/staff/*` + `StaffSidebar` + `OrderCard`.
- [ ] apply the `.sash-stage` real-fabric render to staff `DesignViewer` (parity with editor; confirm `SashGownPreview`/`SashFlat` already good)
- [ ] `StaffSidebar` — remove brand-gradient side-stripe + orange blur blob; filter chips as full primary Buttons → quiet selectable chips (one selected max, fill not border)
- [ ] staff `OrderCard` + student status pills — off-palette amber/blue/emerald/red candy chips → neutral/orange-ink/danger scheme
- [ ] **error/loading/empty trio** on staff orders + staff wholesalers lists
- [ ] RTL chevrons + ≥44px row controls; attachment thumbs get `sizes` + lazy

## LANE 3 — Designer chrome & motion  *(agent: designer)*
ROI: signature screen — highest memorability per DESIGN.md §5. Under `app/design/*` + `components/designer/*`.
- [ ] **De-orange chrome** — strip ambient orange from header/toolbar/tashkeel/ornament/font chips; orange marks ONLY active tool/selection (gold/navy thread swatches are product data — keep)
- [ ] remove header brand-gradient + shimmer overuse; larger Amiri (`.font-display-ar`) headings
- [ ] **gender-gate dead-end → in-place gender control / clear path** (no trap; let user switch/continue without back-button hunting)
- [ ] designer micro-motion: tactile add/drag/select feedback (reuse `sash-float`/`edit-pop`/`pulse-ring`, don't over-animate)
- [ ] confirm delete uses `Modal` not `window.confirm`; delete control ≥44px + danger token (verify)
- [ ] `prefers-reduced-motion` off-state on every designer animation

## LANE 4 — Storefront / shop polish  *(agent: storefront)*
ROI: the lookbook first-impression. Under `app/(student)/*` + `app/shop/*` + `ProductTile`/lookbook.
- [ ] **delete dead scrim landmines** `ShopProductCard`/`ShopPackageCard`/`ShopProductHeroCard`; drop on-photo glass badges → caption-below
- [ ] `ProductTile` `sizes` → real responsive column count (was hardcoded 512 cap) — slow-network image weight
- [ ] **parallax depth** — apply `.parallax-photo`+`.parallax-frame` to hero photo + lookbook frames
- [ ] **choreographed headings** — key Arabic headings reveal (mask/word reveal); the one number counts up
- [ ] presentation rhythm — section pacing so scrolling reads like turning lookbook pages
- [ ] flatten resting `shadow-card` on gallery hero / breakdown / sizes table (flat-by-default)
- [ ] gallery + package + hero-thumb images: add `sizes`, lazy below-fold
- [ ] error/loading/empty trio on catalog/product fetches

## LANE 5 — Cross-cutting a11y / perf / content  *(agent: cross-cutting; mostly mechanical)*
ROI: ripples everywhere; touches many files so run LAST or coordinate to avoid lane collisions.
- [ ] body/secondary copy `ink/40`–`ink/60` alpha → `text-ink-soft` (AA); `muted` reserved for labels
- [ ] remove `surface-glass` backdrop-blur from always-on sticky bars (~6) — low-end Android paint cost
- [ ] `.reveal`/`.scroll-reveal` opacity:0 reset under prefers-reduced-motion / no-JS (never invisible content)
- [ ] ≥44px tap targets (sm Button done — audit row checkboxes, option delete, swatch focus visible); sortable `th` keyboard + `aria-sort`; OTP cells grouped
- [ ] **CONTENT/COPY (NEW):** kill any lorem/placeholder/TODO/English-as-Arabic; real Arabic microcopy on
      every empty/error/loading state, button, and form label; verify tone = calm couture (no urgency/sales spam)
- [ ] **PERF BUDGET (NEW, low-end Android):** transform/opacity-only animations; no layout-thrash; `next/image`
      with correct `sizes`+lazy everywhere; audit bundle of `"use client"` islands; target usable on Slow-4G + 4× CPU

## NEW — Conversion / onboarding / checkout flow (audit missed the journey)
The defect-audit graded screens in isolation; nobody walked the **retail student funnel** end-to-end.
- [ ] **Onboarding path:** join-link → approval → first design is clear; no dead-ends, every step has a next action
- [ ] **Designer gender-gate** (also LANE 3): must not strand the user; in-place switch or labelled continue
- [ ] **Cash checkout** (no payment gateway — CASH ONLY): order-review screen states price + cash terms in
      plain Arabic; server computes totals (see Phase 6); confirmation screen reassures (what happens next)
- [ ] remove `قريباً/Soon` from any user-facing funnel step (also nav stub in LANE 1)

---

## Phase 6 — Verify + security (NEVER SKIP — global rule)
- [ ] delete orphan `app/shop/product/[id]/loading.tsx` (no page) + dead `/shop` redirect shell
- [ ] reconcile `DESIGN.md` muted `#8a8377` (fails AA) → shipped `#6b6356`
- [ ] `npx tsc --noEmit` clean before every commit; commit per lane
- [ ] **VERIFY live (`verify`/browser):** walk each flow at `localhost:3000` — login/join/OTP, approval,
      full designer save, admin order/profit view, staff design view, wholesaler batch. Screenshot before/after.
- [ ] **SECURITY (`security-review`):**
  - [ ] RLS / authz: every route under correct `requireRole`; no IDOR on order/design/student by id
  - [ ] **`getUser()` not `getSession()`** equivalent — JWT verified server-side, `req.user` from DB (already the pattern in `middleware/auth.js`; confirm no route trusts client role)
  - [ ] **server-side totals** — order price/profit/cost computed in controller from DB, never trusted from client body
  - [ ] no secrets in client bundle/git (`.env.local` only); input validation server-side; uploads type/size-checked

## Execution order (ROI)
1. State trio + EmptyState/skeleton across all lists (LANE 1+2+4) — biggest perceived-quality jump
2. De-orange designer chrome + gender-gate fix (LANE 3) — signature screen
3. Delete dead scrim + ProductTile sizes + parallax/choreo (LANE 4) — first impression
4. Admin shell (max-width, nav stub, confirm modal, RTL dates/chevrons) (LANE 1)
5. Cross-cutting a11y/perf/content sweep (LANE 5)
6. Conversion/onboarding walk-through (NEW)
7. Phase 6 verify + security-review
