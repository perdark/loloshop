# REDESIGN — Portfolio-grade pass to ~95%

Master backlog from the verified multi-agent audit (102 findings) **plus** the gaps
that audit missed: content/copy quality, the conversion/onboarding flow, a low-end-Android
perf budget, the designer gender-gate UX, **global error/404 screens + share metadata**, and a
real Phase 6 verify + security checklist.
Bar: an agency portfolio piece judged by 50+ businessmen — this site is the maker's CV.
Spec source of truth: `DESIGN.md`. **Tracking:** check items as done; update after every task.

## ▶ Status — resume here
- **Branch:** `redesign/design-system` (not merged to main, not deployed). Dev: `localhost:3000` (FE) + `:4000` (API).
- **Done (9 commits, ~50/102 findings, tsc clean):** unified palette + ink shadows + primitives
  (Button/Input/Select/EmptyState/Modal); `--color-danger`, `.font-display-ar`; sash editor real
  fabric (`.sash-stage`); storefront unlocked → editorial grids + cinematic hero + scroll-reveal/parallax
  (CSS `view()`, no JS); AA contrast sweep (~50 files); admin chart recolor + max-width; auth + wholesaler
  onto unified system.
- **Now (this session):** lock in the uncommitted WIP (below), finish the 5 lanes + global screens, then Phase 6.

## ▶ WIP to lock in FIRST (uncommitted in working tree — complete, don't restart)
A prior session left coherent redesign work uncommitted across 3 lanes. **Build on it, finish each
file's remaining items, then commit per-lane.** Do NOT revert or rewrite from scratch.
- **Admin (LANE 1):** `admin/batches` + `batches/[id]` full trio (skeleton/error+retry/empty) ✓; `AdminSidebar`
  settings/`قريباً` stub removed ✓; `admin/layout` mobile header de-glassed ✓; `admin/orders` profitColor
  rose/emerald→danger/ink + `fetchError` state added (⚠ verify it's wired into the render).
- **Staff (LANE 2):** `StaffSidebar` rewritten dark-ink-shell → surface + selectable filter chips ✓;
  `OrderCard` candy badges → palette 3-state scheme ✓; `DesignViewer` wrapped in `.sash-stage` real fabric ✓.
- **Designer (LANE 3):** `useDesignDraft` gender hard-block (toast dead-end) removed ✓ — `validateSelection`
  now carries gender (⚠ verify the gender path no longer strands the user).
- Docs: `CLAUDE.md` + `PROGRESS.md` version/architecture facts refreshed ✓.

## Reuse, don't invent (the established system)
- **Tokens:** `cream/paper` page, `surface/beige` cards, `surface-sink` recessed, `ink`/`ink-soft` text,
  `muted` labels-only, `line` hairlines, `orange-ink` earned accent, `--color-danger` warm brick.
- **Primitives:** `Button` (primary/secondary/ghost/**danger**, sm/md/lg all ≥44px, `loading`),
  `Input`/`Select` (warm error, orange-ink focus), `EmptyState` (title/message/icon/action),
  `Modal` (focus-trap, Esc, RTL) → **use for every `window.confirm`**.
- **Motion:** `.scroll-reveal`/`.scroll-reveal-soft`/`.parallax-photo`+`.parallax-frame`, `.font-display-ar`.
- **Do NOT edit `globals.css` or `components/ui/*`** without flagging — they're the locked foundation every
  lane shares. If a primitive truly needs a change, surface it; don't fork it per-area.
- **State trio contract (EVERY data screen):** loading = content-shaped skeleton (not a lone spinner);
  error = distinct panel + retry button (never spin forever, never render an error as "no data");
  empty = `EmptyState` with a path forward.

---

## LANE 1 — Admin shell & lists  *(agent: admin — owns `app/admin/*` + `AdminSidebar`)*
ROI: high — admin is the "businessman" judging screen.
- [x] `admin/layout main` — max-width + editorial grid; mobile header de-glassed
- [x] `AdminSidebar` — disabled `الإعدادات`/`قريباً` stub removed
- [x] `admin/batches` + `batches/[id]` — full error/loading/empty trio
- [ ] **verify `admin/orders` `fetchError` is rendered** (error panel + retry), not just declared; finish its trio (skeleton table + EmptyState)
- [ ] **error/loading/empty trio** on the remaining lists: `products`, `wholesalers`, `staff`, `hero-slides` (+ `wholesalers/[id]/students`)
- [ ] **`window.confirm` → `Modal`** (RTL confirm, danger button) in the 4 files that still use it: `admin/products`, `admin/wholesalers`, `admin/staff`, `admin/hero-slides`
- [ ] native `type="date"` LTR pickers → RTL-aligned input (`dir="rtl"` wrapper, right-aligned, Arabic-friendly) in `admin/orders` + `admin/wholesalers`
- [ ] reversed prev/next chevrons in RTL pagination (next ←, prev →) wherever admin paginates
- [ ] batches: price save-on-blur → explicit confirm + clear role target; no blank/stuck spinner
- [ ] wholesaler card 6-action pile → tidy grouping; remove any header side-stripes
- [ ] fix shipped-order per-student order-link TODO
- [ ] off-palette green/red/amber/yellow → palette (profit green / loss red → ink + orange-ink + danger) in `admin/wholesalers/[id]/students`

## LANE 2 — Staff shell & lists  *(agent: staff — owns `app/staff/*` + `StaffSidebar` + `components/staff/*`)*
ROI: medium-high — fewer screens, but they were loud.
- [x] `StaffSidebar` — dark-ink shell + brand-gradient stripe + orange blob → surface; filter chips quiet/selectable
- [x] `OrderCard` + status pills — candy amber/blue/emerald/red → neutral/orange-ink/danger scheme
- [x] `.sash-stage` real-fabric render applied to staff `DesignViewer` (parity with editor)
- [ ] **error/loading/empty trio** on `staff` orders list + `staff/wholesalers` (+ `wholesalers/[id]/students`)
- [ ] off-palette colors in `staff/wholesalers/[id]/students` → palette
- [ ] RTL chevrons + ≥44px row controls; attachment thumbs get `sizes` + lazy
- [ ] confirm `SashGownPreview`/`SashFlat` already render correctly with the fabric stage

## LANE 3 — Designer chrome & motion  *(agent: designer — owns `app/design/*` + `components/designer/*`)*
ROI: signature screen — highest memorability per DESIGN.md §5.
- [x] gender hard-block dead-end removed from `useDesignDraft`
- [ ] **verify gender path** end-to-end: where is `gender` set, does `validateSelection` give a clear in-place message/path (no back-button hunting, no strand)?
- [ ] **De-orange chrome** — `design/page` header is a full `bg-brand-gradient` wash + `sash-shimmer-strip`; reduce to paper/ink with orange only on the active tool/selection. Strip ambient `bg-orange/10`, `border-orange/30-40` from step cards, toolbar, tashkeel/ornament/font chips (gold/navy *thread* swatches are product data — keep)
- [ ] larger Amiri (`.font-display-ar`) on designer headings; remove shimmer overuse
- [ ] designer micro-motion: tactile add/drag/select feedback (reuse `sash-float`/`edit-pop`/`pulse-ring`, don't over-animate)
- [x] confirm delete uses `Modal` (page already uses `Modal`, not `window.confirm` — verify TextEditor/Whiteboard deletes too)
- [ ] `prefers-reduced-motion` off-state on every designer animation
- [ ] `text-ink/70`-`/80` ambient alpha on copy → `text-ink-soft`

## LANE 4 — Storefront / shop polish  *(agent: storefront — owns `app/(student)/*`, `components/shop/*`, `components/lookbook/*`, `components/catalog/*`)*
ROI: the lookbook first-impression. **The real storefront is `app/(student)/*`; `app/shop/*` is a dead shell (see Phase 6).**
- [ ] **delete dead scrim landmines** in `components/shop` (`ShopProductCard`/`ShopPackageCard`/`ShopProductHeroCard` if unused); drop on-photo glass badges → caption-below
- [ ] `ProductTile` `sizes` → real responsive column count (was hardcoded 512 cap) — slow-network image weight
- [ ] **parallax depth** — `.parallax-photo`+`.parallax-frame` on hero photo + lookbook frames
- [ ] **choreographed headings** — key Arabic headings reveal (mask/word reveal); the one number counts up
- [ ] presentation rhythm — section pacing so scrolling reads like turning lookbook pages
- [ ] flatten resting `shadow-card` on gallery hero / breakdown / sizes table (flat-by-default)
- [ ] gallery + package + hero-thumb images: add `sizes`, lazy below-fold
- [ ] error/loading/empty trio on catalog/product fetches (`(student)/product/[id]`, `(student)/sizes`)

## LANE 5 — Cross-cutting a11y / perf / content  *(agent: cross-cutting — runs in Wave 2 after lanes 1-4 commit)*
ROI: ripples everywhere; touches many files so run LAST to avoid collisions. Owns shared `components/ui/StatCard`, sweeps, and the perf/content pass.
- [ ] body/secondary copy `ink/40`–`ink/60` alpha → `text-ink-soft` (AA); `muted` reserved for labels
- [ ] off-palette colors in `components/ui/StatCard` → palette
- [ ] remove `surface-glass` backdrop-blur from always-on sticky bars — low-end Android paint cost
- [ ] `.reveal`/`.scroll-reveal` opacity:0 reset under prefers-reduced-motion / no-JS (never invisible content)
- [ ] ≥44px tap targets (audit row checkboxes, option delete, swatch focus visible); sortable `th` keyboard + `aria-sort`; OTP cells grouped
- [ ] **CONTENT/COPY:** kill any lorem/placeholder/English-as-Arabic; real Arabic microcopy on every empty/error/loading state, button, label; tone = calm couture (no urgency/sales spam)
- [ ] **PERF BUDGET (low-end Android):** transform/opacity-only animations; no layout-thrash; `next/image` with correct `sizes`+lazy everywhere; audit `"use client"` island bundle; usable on Slow-4G + 4× CPU

## NEW — Global screens & share metadata  *(missed by both the audit and the prior plan — high ROI, cheap)*
50+ businessmen will mistype a URL, hit a transient API error, and share the link. Today those are
unstyled Next defaults / bare metadata — an instant "unfinished" tell.
- [ ] **`app/not-found.tsx`** — lookbook-styled 404 (paper, Amiri heading, calm Arabic, link home). RTL.
- [ ] **`app/error.tsx`** (+ segment-level for `admin`/`design` if useful) — styled error boundary with retry; never a white crash page.
- [ ] **`app/global-error.tsx`** — minimal branded fallback for root render failures.
- [ ] **Metadata/OG/PWA:** title template + Arabic description in root `layout` metadata; `theme-color`; verify `manifest.json` has Arabic `name`/`short_name` + brand colors; add an OG/share image so the CV link previews well.

## NEW — Conversion / onboarding / checkout walk-through
The audit graded screens in isolation; nobody walked the **retail student funnel** end-to-end.
- [ ] **Onboarding path:** join-link → approval → first design is clear; no dead-ends, every step has a next action
- [ ] **Designer gender path** (also LANE 3): must not strand the user; in-place switch or labelled continue
- [ ] **Cash checkout** (CASH ONLY — no gateway): order-review states price + cash terms in plain Arabic; server computes totals (Phase 6); confirmation reassures (what happens next)

---

## Phase 6 — Verify + security (NEVER SKIP)
- [ ] delete dead `app/shop/*` shell (no `product/[id]/page.tsx` page; orphan `loading.tsx`) + any `/shop` redirect; confirm nothing links to it
- [ ] reconcile `DESIGN.md` muted `#8a8377` (fails AA) → shipped `#6b6356`
- [ ] `npx tsc --noEmit` clean before every commit; commit per lane
- [ ] **VERIFY live (browser):** walk each flow at `localhost:3000` — login/join/OTP, approval, full designer save, admin order/profit view, staff design view, wholesaler batch. Before/after screenshots of key screens.
- [ ] **SECURITY (`security-review`):**
  - [ ] authz: every route under correct `requireRole`; no IDOR on order/design/student by id
  - [ ] **JWT verified server-side, `req.user` from DB** (the pattern in `middleware/auth.js`); confirm no route trusts a client-supplied role
  - [ ] **server-side totals** — order price/profit/cost computed in controller from DB, never trusted from client body
  - [ ] no secrets in client bundle/git (`.env.local` only); input validation server-side; uploads type/size-checked

## Known non-goal (documented, not missed)
- Frontend **notifications UI** is absent though a backend `notifications` router exists. Out of scope for this
  visual-polish session unless trivially surfaceable; noted so it isn't mistaken for an oversight.

## Execution order (ROI, given WIP)
1. **Wave 1 (parallel, disjoint dirs):** LANE 1 admin · LANE 2 staff · LANE 3 designer · LANE 4 storefront — finish each lane's WIP + remaining items. Agents edit only; orchestrator runs `tsc` + commits per-lane.
2. **Wave 2:** LANE 5 cross-cutting sweep + NEW global screens/metadata (after 1-4 are committed, to avoid file collisions).
3. **Onboarding/checkout walk-through** (NEW) — fix any dead-ends found.
4. **Phase 6** — dead-shell cleanup, verify flows in browser, security-review, before/after screenshots.
