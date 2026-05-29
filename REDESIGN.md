# REDESIGN — Portfolio-grade pass to ~95%

Master backlog from the verified multi-agent audit (102 findings, 5 critical / 41 high / 41 medium / 15 low).
Bar: agency portfolio piece judged by 50+ businessmen. Spec source of truth: `DESIGN.md`.
**Tracking:** check items as done. Update after every task.

## Stage M — Cinematic motion & scroll choreography (NEW — the "video/presentation" feel)
The motion primitives already exist in `globals.css` (`.reveal`, `ken-burns`, view-transitions, splash, sash shimmer) but are barely wired up; the 512px storefront cage also kills the reveal grids on desktop. Goal: the site plays like a fashion film as you scroll.
- [x] **Scroll-choreography system** — `.scroll-reveal`/`.scroll-reveal-soft`/`.parallax-photo` via CSS `animation-timeline: view()` (GPU, no JS); `@supports` fallback shows content; reduced-motion off. Verified: opacity ramps 0→1 on scroll. ✅
- [x] **Cinematic hero** — full-bleed `min-h-82svh`, Amiri display, staggered line reveal, scroll cue, drifting script flourish. ✅
- [x] **Per-section scroll reveals** — storefront story sections + tile grids reveal + auto-stagger on scroll. ✅
- [ ] **Parallax depth** on lookbook photos (`.parallax-photo` util built; apply to hero photo + lookbook frames)
- [ ] **Choreographed headings** — key Arabic headings reveal (mask/word-by-word), numbers count up
- [ ] **Designer micro-motion** — tactile feedback on add/drag/select (sash float, edit-pop already exist)
- [ ] **Presentation rhythm** — section pacing so scrolling feels like turning lookbook pages
- [ ] Perf budget: transform/opacity only, test Slow-4G + 4× CPU on a phone; every effect has a `prefers-reduced-motion` off-state
- [ ] (decision pending) scroll-snap "slide" sections / pinned scrub — see flavor choice

## Execution order (evidence-based, by ripple, not by screen)

### Stage A — Shared primitives (fix once, ripples to ~30-40% of findings)
- [x] `components/ui/Button.tsx` — danger variant: killed `bg-red-700` flood → quiet warm-brick, fills on hover; ghost → surface token; `sm` → 44px; resting shadow softened ✅
- [x] `components/ui/Input.tsx` + Select — error → warm `--color-danger` (no red flood); field bg → surface token; unified `orange-ink` focus ✅
- [x] shared `EmptyState` — neutral inbox icon (was trash); hairline border; soft-ink message; title/icon/action slots ✅
- [x] `globals.css` `.surface-card` — removed resting shadow (Flat-By-Default) ✅
- [ ] CTAs: `bg-brand-gradient` → solid `bg-orange-ink` (fixes white-on-#f47b42 = 1.99:1 AA fail) — per-screen, in phases
- [x] add `.font-display-ar` (Amiri) utility so Arabic headings render at true display scale (stop Playfair fallback) ✅
- [x] `globals.css` tokens unified: paper/ink palette, ink-toned shadows, neutralized `.text-gradient-brand`, reduced `.surface-glass` ✅

### Phase 1 — Sash designer (signature) — 22 findings
- [x] **Render real sash in EDITOR** (`TextEditor`) — `.sash-stage` frame: fabric-color selvedge, embroidered stitch line, weave+sheen overlay, hem tail. Text never clipped (inset by padding). ✅
- [ ] apply the same sash render to staff `DesignViewer` (+ confirm `SashGownPreview`/`SashFlat` already good)
- [x] font picker chips already set in own typeface (`fontFamily` per chip) — was a screenshot artifact ✅
- [x] designer delete button off-palette red → danger token ✅
- [ ] strip ambient orange across designer chrome/header/tashkeel/ornament/font chips; gold/navy thread swatches are product data (keep)
- [ ] `product/[id]/page.tsx` — orange is ambient on every fieldset/divider/breakdown/upload/bullet → earned ≤10%
- [ ] larger Amiri headings; remove header orange gradient + shimmer overuse

### Phase 2 — Storefront / shop layout — 18 findings
- [x] `(student)/layout.tsx` — unlocked from `max-w-lg`; responsive `md:max-w-3xl lg:max-w-6xl` so editorial grids engage on desktop ✅
- [x] product + package + lookbook grids → responsive `md:grid-cols-3 lg:grid-cols-4` (was locked 2-col) ✅
- [ ] enforce caption-below / no-scrim; **delete dead scrim landmines** `ShopProductCard`/`ShopPackageCard`/`ShopProductHeroCard`; drop on-photo glass badge
- [ ] update `ProductTile` `sizes` to the real responsive column count (was hardcoded to 512 cap)
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
