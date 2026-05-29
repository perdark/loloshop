# REDESIGN — Portfolio-grade pass to ~95%

Master backlog from the verified multi-agent audit (102 findings, 5 critical / 41 high / 41 medium / 15 low).
Bar: agency portfolio piece judged by 50+ businessmen. Spec source of truth: `DESIGN.md`.
**Tracking:** check items as done. Update after every task.

## Execution order (evidence-based, by ripple, not by screen)

### Stage A — Shared primitives (fix once, ripples to ~30-40% of findings)
- [ ] `components/ui/Button.tsx` — danger variant: kill `bg-red-700` flood → quiet ink/ghost danger; ghost: opaque surface token (not `bg-white/60`); `sm` size → ≥44px; drop resting shadow
- [ ] `components/ui/Input.tsx` + Select — error styling → single warm `--color-danger` (ink-toned border + soft-ink message; no red ring/fill/`bg-red-50`); field bg → surface token (not `bg-white`); unify focus on `orange-ink`
- [ ] shared `EmptyState` — replace trash-can glyph with context icons; orange-dashed border → neutral hairline; soft-ink message; add title/description/action slots
- [ ] `globals.css` `.surface-card` — remove resting shadow (Flat-By-Default; hairline + tone only, shadow on state)
- [ ] CTAs: `bg-brand-gradient` → solid `bg-orange-ink` (fixes white-on-#f47b42 = 1.99:1 AA fail)
- [ ] add `.font-display-ar` (Amiri) utility so Arabic headings render at true display scale (stop Playfair fallback)
- [x] `globals.css` tokens unified: paper/ink palette, ink-toned shadows, neutralized `.text-gradient-brand`, reduced `.surface-glass` ✅

### Phase 1 — Sash designer (signature) — 22 findings
- [ ] **Render real sash in editor + staff viewer** — clip to `SASH_CLIP_PATH` V-tail + subtle fabric texture + stitch (visual only; export untouched). Shared across `TextEditor` / `SashGownPreview` / `DesignViewer`
- [ ] font picker chips → set each in its own typeface
- [ ] strip ambient orange across designer chrome/header/tashkeel/ornament/font chips; gold/navy off-palette swatches → palette
- [ ] `product/[id]/page.tsx` — orange is ambient on every fieldset/divider/breakdown/upload/bullet → earned ≤10%
- [ ] larger Amiri headings; remove header orange gradient + shimmer overuse

### Phase 2 — Storefront / shop layout — 18 findings
- [ ] `(student)/layout.tsx` — unlock from `max-w-lg` (512px) at every breakpoint → responsive md:/lg: container so story grids engage on desktop
- [ ] enforce caption-below / no-scrim; **delete dead scrim landmines** `ShopProductCard`/`ShopPackageCard`/`ShopProductHeroCard`; drop on-photo glass badge
- [ ] `ProductTile` `sizes` → real responsive column count (not hardcoded 512)
- [ ] staff `OrderCard` + student pills — off-palette amber/blue/emerald/red candy chips → palette
- [ ] `StaffSidebar` brand-gradient side-stripe + orange blur blob; filter chips as full primary Buttons → quiet chips

### Phase 3 — Wholesaler & auth — 17 findings
- [ ] `join/[code]/page.tsx` — off-spec (hero flood, dark ink header, gradient circles, blur orbs) → shared `AuthCard` language
- [ ] designer gender-gate dead-end → in-place gender control / clear path
- [ ] native `type=date` LTR pickers (4 spots: admin orders + wholesalers) → RTL-correct custom date input
- [ ] reversed prev/next chevrons in RTL pagination (wholesaler/staff/admin)
- [ ] status pills hardcode emerald/rose/amber → shared status token
- [ ] batch page: silent `list[0].id` localStorage bind → explicit choice + empty state for zero-student batch
- [ ] remove orphan `/verify-otp` duplicate flow; emoji success icons → real icons

### Phase 4 — Admin & staff shells — 14 findings
- [ ] `admin/layout.tsx main` — add max-width + editorial grid (kill skinny full-width bars + empty void)
- [ ] `AdminSidebar` — remove disabled `الإعدادات` + `قريباً` (Soon) stub from production nav
- [ ] replace `window.confirm` destructive deletes → in-app RTL confirm modal
- [ ] batches error/loading states (no blank/stuck spinner); price save-on-blur → explicit confirm + clear role target
- [ ] wholesaler card 6-action pile → tidy; brand-gradient side-stripes on headers → remove
- [ ] fix shipped TODO per-student order link

### Phase 5 — Cross-cutting a11y / perf / states — 27 findings (largest, mostly mechanical)
- [ ] **error/loading/empty trio on EVERY data screen** — distinct error panel + retry (never spin forever / errors-as-"no data"); content-shaped skeletons
- [ ] sweep body/secondary copy `ink/40`–`ink/60` alpha → `text-ink-soft` (AA); muted reserved for labels
- [ ] flatten resting `shadow-card` on gallery hero / breakdown / sizes table
- [ ] images: add `sizes`, optimize, lazy (gallery, package tiles, staff attachments, hero thumbs) — slow-network
- [ ] `.reveal` opacity:0 reset under prefers-reduced-motion / no-JS (avoid invisible content)
- [ ] remove `surface-glass` backdrop-blur from ~6 always-on sticky bars (low-end Android paint cost)
- [ ] ≥44px tap targets (sm Button, row checkboxes, option delete); swatch focus visible; sortable th keyboard + aria-sort; OTP cells grouped; AuthCard `main` landmark

### Phase 6 — Verify / cleanup / security — 4 findings + verification
- [ ] delete orphan `app/shop/product/[id]/loading.tsx` (no page) + dead `/shop` redirect shell
- [ ] reconcile `DESIGN.md` muted `#8a8377` (fails AA) → shipped `#6b6356`
- [ ] fix forgot-password OTP length guard (<4 vs stated 6-digit)
- [ ] **re-run every flow live** to verify phases 1–5
- [ ] `security-review` (RLS, getUser not getSession, server-side totals) — NOT covered by the design audit

## Top 10 highest-ROI (do in this order)
1. Shared primitives: Button + Input/Select + EmptyState + surface-card flatten
2. Sash real render (editor + staff viewer)
3. Storefront unlock from 512px column + ProductTile sizes
4. Caption-below / delete dead scrim components
5. error/loading/empty trio on every data screen
6. EmptyState rework
7. Earned-orange budget: solid orange-ink CTAs, quiet nav, strip ambient orange, recolor profit/status
8. Flatten elevation everywhere
9. Body text → soft-ink (AA) + `.font-display-ar` Amiri utility
10. (rolls into per-phase cleanup)
