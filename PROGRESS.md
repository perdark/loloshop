# LoloShop — PROGRESS.md

## Status: 🟡 In Progress
## Last Updated: 2026-05-31 (Order bundle / package-visibility UI — staff queue clustering, order detail bundle panel, admin bundle view)

---

## ✅ Done
- **Order bundle / package-visibility UI (2026-05-31)** — Implements the checkout_group_id "bundle" contract across staff + admin surfaces. (A) `lib/staff-types.ts`: `ProductionQueueItem` gains `checkout_group_id: string | null`; new `BundleItem` type `{id,status,price,product_name,product_type,is_current}`; `ProductionOrderDetail` gains `bundle: BundleItem[] | null` (preferred field) alongside existing `package_orders` backward-compat alias. (B) `app/staff/queue/page.tsx`: `groupByBundle()` clusters items sharing a non-null `checkout_group_id` into `BundleGroup`s; `BundleGroupCard` renders a 2-border orange grouped card with a component-count badge and student header — multi-item bundles get the card treatment, singletons fall through to the existing `OrderCard`; a summary note counts multi-item bundles in the current view. Stage tabs and source filter are fully preserved. (C) `app/staff/orders/[orderId]/page.tsx`: destructures `bundle` from `detail`; renders "الباقة الكاملة" panel (orange-ink bordered) when `bundle` is present — each row is a 44px+ touch target, `is_current` item gets an orange highlighted row + "الحالي" badge (no link to self), siblings link to `/staff/orders/<id>`; falls back to old `package_orders` panel when `bundle` is null. (D) `lib/admin.ts`: `OrdersFilters` gains `type?: string`; `getAdminOrders` passes `type` param to backend; new `AdminBundleItem`, `AdminBundle` types + `getAdminOrderBundles()` wrapper calling `?group=bundle`. (E) `app/admin/orders/page.tsx`: `ViewMode` toggle (عرض كقطع / عرض كباقات); component-type chips (الكل/وشاح/روب/كاب) visible only in item mode, pass `?type=` to backend; bundle mode calls `getAdminOrderBundles` and renders `BundleCard` grid (student + university + date header, per-item rows with status + price + profit, orange totals footer, single-item null-group bundles render with plain border); item mode is existing table+mobile-cards unchanged. Lint: 0 errors; build: passes.
- **Retail graduation-look cart flow (2026-05-31)** — (1) `lib/designer.ts`: added `is_rep_student?: boolean` to `MyDesignResponse`. (2) `lib/cart.ts`: `CartItem.designId: string | null` (mapped from `raw.design_id`); `addToCart` 3rd param changed from bare `qty?` to `opts?: { qty?: number; designId?: string }` (back-compat — existing callers pass no 3rd arg); POST body includes `design_id` when `opts.designId` is set. (3) `hooks/useDesignDraft.ts`: `isRepStudent` state loaded from `my.is_rep_student`; `confirmDesign` branches — rep-students keep direct `configureOrder` → `completeDesign` → `/` flow; retail students call `addToCart(..., { designId })` then `router.replace("/cart")` (no `configureOrder`, no `completeDesign`). (4) `app/(student)/cart/page.tsx`: `PackageSuggestionCard` replaced with `MissingPiecesCard` — computes `["sash","robe","cap"]` minus cart `productType`s; if missing: warm-veil card "ينقصك: X" linking to `/?need=sash,robe,...`; if complete: quiet "إطلالتك مكتملة ✓" note. (5) `app/(student)/page.tsx`: `NeedParamReader` inner component uses `useSearchParams()` inside a `<Suspense fallback={null}>` (Next 16 requirement); on mount sets `filter` to first requested type and smooth-scrolls to catalog `<section>` via `catalogSectionRef` + `scrollIntoView({ behavior: "smooth" })` guarded for `prefers-reduced-motion`. Lint: 0 errors; tsc: clean.
- **LANE 1 — Admin shell & lists (2026-05-29)** — Completed all remaining LANE 1 checklist items. (1) `admin/orders`: `fetchError` wired — now clears on each load attempt and renders a danger-bordered retry panel on failure; inline `OrdersTableSkeleton` (5 rows + header) replaces the lone spinner during load; `EmptyState` with "مسح الفلاتر" ghost CTA when zero results; `text-ink/NN` alpha on table cells → `text-ink-soft`/`text-muted`. (2) `admin/products`: full skeleton (3-column layout shapes) + `listError` panel + retry; `window.confirm` on product/group/option delete → 3 separate `<Modal variant danger>` with specific Arabic copy naming the deleted item; off-palette `hover:bg-red-50 hover:text-red-700` → `hover:bg-danger/10 hover:text-danger`; `EmptyState` on empty product rail; content-shaped product-editor skeleton (replaces `PageLoader`). (3) `admin/staff`: skeleton (3 staff-card rows) + `fetchError` panel + retry; `window.confirm` delete → `<Modal>` with `variant="danger"` confirm button naming the staff member; `PageLoader` import removed. (4) `admin/hero-slides`: skeleton (3 slide-row shapes) + `fetchError` panel + retry; bare `confirm()` → `<Modal>` with danger confirm naming the slide title; `PageLoader` import removed. (5) `admin/wholesalers`: skeleton (3 card rows) + `fetchError` panel + retry; `window.confirm` delete → `<Modal>` with danger confirm + clear consequence copy; two `type="date"` inputs (create deadline + extend deadline) replaced with RTL-aligned `dir="rtl" text-end` inputs styled to match Input primitive. (6) `admin/wholesalers/[id]/students`: content-shaped skeleton + `fetchError` panel (retry uses `retryKey` counter to re-trigger the `useEffect`); `bg-emerald-500/12 text-emerald-700` completed badge → `bg-orange-ink/10 text-orange-ink`; `text-ink/70` on table cells → `text-ink-soft`; `bg-brand-gradient` side-stripe on heading → flat `bg-orange-ink 3px`; RTL pagination reversed (next = ← / prev = →); `PageLoader` removed. (7) `admin/batches/[id]`: `text-ink/70`/`text-ink/80` on table cells → `text-ink-soft`. tsc clean.
- **LANE 3 — Sash Designer chrome redesign (2026-05-29)** — (1) Gender path: `useDesignDraft.pickGender()` exposed (persists to `localStorage`); step 1 now renders an in-place gender selector when `gender === null`, giving users a clear in-place path rather than a silent options mismatch. (2) De-orange: `bg-brand-gradient` + `sash-shimmer-strip` header replaced with flat `bg-surface border-line` ink header + `font-display-ar` wordmark; saveFailed alert now uses `border-danger/30` instead of `border-orange/40`; editable-side note uses `border-line bg-surface`; single-side checkbox uses `accent-orange-ink`; confirm modal price list `text-ink-soft`. (3) TextEditor: dark-ink header switched to surface/ink; undo/redo/close buttons now ink on surface-sink hover; font picker active state uses `border-orange-ink bg-orange-ink/8 ring-orange-ink` (not ambient orange fill); alignment active state uses `bg-surface-sink text-orange-ink`; all `border-ink/10` / `border-ink/15` → `border-line`; footer `bg-surface`. (4) Whiteboard: header → surface/ink; tashkeel + ornament chips hover changed from `hover:bg-orange/10 hover:border-orange` to `hover:bg-surface-sink hover:border-neutral-dark`; font picker active = `border-orange-ink ring-orange-ink`; color swatch selected = `ring-orange-ink` with scale; all `text-ink/70` → `text-ink-soft` or `text-muted`. (5) DesignerStepper: active number = `bg-orange-ink text-cream ring-orange-ink`; done = ink fill with SVG checkmark; connector `bg-orange-ink` / `bg-line`. (6) Tactile micro-motion: `animate-edit-pop` fires on the `.sash-stage` wrapper for 350ms whenever an element is added to the Fabric canvas; reuses existing keyframe, no new globals. (7) `prefers-reduced-motion`: all existing `animate-*` classes are governed by the global 0.001ms block; `sash-shimmer-strip` removal means no more infinite shimmer sweep in the header at all. (8) All `window.confirm` absent — TextEditor delete is inline danger button ≥44px; Whiteboard delete uses `<Button variant="danger">`. tsc clean.
- **Wholesaler area redesign (2026-05-29)** — All 5 wholesaler files brought fully onto the unified palette: removed all off-palette hex codes (#ffb100, #f47b42, emerald, rose, amber, peach), gradient text, brand-gradient side-stripes, and orange blur blobs. Status pills follow the consistent 3-state scheme (neutral default / orange-ink active / danger overdue). Batch page now has an explicit batch selector (no silent auto-select of list[0]), empty state for zero-student batches, and error state with retry. Package page has real load-error + empty states with retry actions. Students page has error state + smarter empty message (distinguishes search vs no data). `text-ink/N` on real text replaced with `text-ink-soft` / `text-[var(--shop-muted)]` throughout. Layout nav: brand-gradient top stripe replaced with flat `bg-orange-ink` hairline; logout button text fixed.
- **Sash designer Fabric.js v6 bug fixes (2026-05-29)** — 7 targeted fixes to `TextEditor.tsx` and `Whiteboard.tsx`: (1) `usedFontsRef` now seeded from `fontIdsFromCanvasJson(initialJson)` on load so re-save emits correct `fontsUsed` instead of empty array. (2) Pinch-to-zoom (two-finger) added to the editor canvas element via `touchstart`/`touchmove`/`touchend` listeners using `canvas.zoomToPoint` (Fabric v6 API); listener refs stored for proper cleanup. (3) Whiteboard `TEXT_COLORS` purged of off-brand navy `#0b1e3f` and gold `#c9a961`; `#ff8c00` replaced with brand token `#f47b42`. (4) `addGlyph` now registers `currentFont` in `usedFontsRef` so tashkeel/ornament additions include the font in `fontsUsed`. (5) Image upload downscales large phone photos (≤1200px longest edge) via an offscreen canvas before passing to Fabric; max upload size lowered to 5 MB for images / 3 MB for logos. (6) Whiteboard remount `key` changed from `` `${side}-${fonts.length}` `` to `side` — font loading no longer discards in-progress text. (7) Sequential `for…await` font preload in both `TextEditor` and `Whiteboard` replaced with `Promise.all` for parallel loading.
- **Auth flow a11y + UX fixes (2026-05-29)** — (1) `join/[code]/page.tsx`: bare `<Input type="tel">` replaced with `+964` prefix chip + `inputMode="numeric"` + `dir="ltr"` + non-digit stripping, matching login exactly. (2) `login/page.tsx` phone field: `aria-invalid` on error, `+964` span gets `id="phone-country"` + `aria-label`, input `aria-describedby` chains country + error ids. (3) Login OTP step: `otpError` state drives a `role="alert"` `<p id="otp-error">` below the digit boxes; digit inputs carry `aria-describedby` + `aria-invalid`; border colour flips to red on error; `otpError` cleared on resend. (4) `VerifyOtpForm.tsx`: aligned to login — paste handler + auto-submit on 6th digit added, `scale-110` removed, `border-2` → `border`, `otpError` state + `role="alert"` error region wired. (5) `forgot-password/page.tsx`: phone/email toggle (default = phone); phone path shows a WhatsApp support message (backend endpoint `POST /auth/forgot-password-phone` not yet implemented — TODO comment left in file and `auth-api.ts` has no matching call); email path unchanged. Missing backend: `POST /auth/forgot-password-phone { phone }` needed for full OTP-reset via WhatsApp.
- **Staff order detail fixes (2026-05-29)** — (1) Infinite spinner: guard changed from `!design` to just `!order`; design null is now handled inline with an Arabic empty-state card. `getDesignByStudent` and `listFonts` both wrapped in `.catch(() => null/[])` so a missing design never rejects the whole load. (2) Download affordances: logo + extra image each get a `<a href download>` "تنزيل الشعار/الصورة" button below the preview; customer-upload photos in `StaffOrderBreakdown` get a "تنزيل الصورة" button under each photo — all using raw `/uploads` URL, not next/image. (3) Font files: "الخطوط المستخدمة" now renders a list with a "تنزيل الخط" link per font; font catalogue fetched from `listFonts()` at load time so IDs resolve to Arabic display names. All current fonts are Google Fonts so links point to the Google Fonts specimen page (`fonts.google.com/specimen/Family+Name`) for download — **a local `file_url` field on `FontDef` would be needed if self-hosted fonts are added to `/uploads/fonts`** (see comment in code). Files: `app/staff/orders/[orderId]/page.tsx`, `components/staff/StaffOrderBreakdown.tsx`.
- **Per-wholesaler sash side lock (2026-05-29)** — Wholesaler-joined students may design only ONE sash side; the OTHER side is locked to an admin/wholesaler-drawn default. **Config lives on `wholesalers`** (not `batches`) because the designing student is tied via `students.wholesaler_id` — read directly in `designController.getMyDesign` — whereas batches only link post-order via nullable `orders.batch_id` (no reliable batch at design time). Migration `db/migrations/009_wholesaler_sash_side_lock.sql` (+ mirror in `db/schema.sql`): `wholesalers.editable_sash_side TEXT` (CHECK `IN ('left','right')` or NULL = both editable) + `wholesalers.locked_side_design JSONB`. Backend: admin `GET/PUT /admin/wholesalers/:id/sash-config` + wholesaler self-service `GET/PUT /wholesaler/sash-config` (validate side, whitelist fields, clear design when unlocking, audit log); `designs/me` now returns `editable_sash_side` + `locked_side_design` for wholesaler students (null for retail). Frontend: `useDesignDraft` loads the lock, seeds the locked side with the admin default (overriding saved content), forces editing onto the allowed side, `previewReady` only needs the editable side, and `persist`/`confirmDesign` always write the locked side's default so orders/staff get a complete sash. `design/page.tsx` blocks taps/modal on the locked side + shows an Arabic note; `SashGownPreview` gained a `lockedSide` prop (🔒 badge, non-clickable). New reusable `components/designer/SashSideLockEditor.tsx` (side picker + draws locked side via existing `TextEditor`) wired into admin wholesalers page modal AND wholesaler dashboard modal. NOTE: image upload disabled inside the lock editor (the `/designs/uploads/*` endpoints are retail-only — admin/wholesaler draw with text/decoration; shows Arabic toast if attempted). Migration NOT yet applied to Neon — run `npm run migrate` / apply 009. Checks: backend `require('./server.js')` loads, `npm run lint` 0 errors, `tsc --noEmit` clean.
- **Wholesaler-only product visibility (2026-05-29)** — Products can be flagged so they appear ONLY to rep-linked students (e.g. «الشال الامريكي»). Migration `db/migrations/008_product_wholesaler_only.sql` (+ mirror in `db/schema.sql`): `products.wholesaler_only BOOLEAN NOT NULL DEFAULT FALSE`. **Viewer signal = `students.wholesaler_id IS NOT NULL`** (same signal used by `priceRoleForUser`); new `canSeeWholesalerOnly(user)` returns TRUE for admin/staff/wholesaler roles + rep-linked students, FALSE for retail + anonymous. Backend: `getShop` + `getProductFull` filter via `($n = TRUE OR wholesaler_only = FALSE)` (detail returns 404 «المنتج غير موجود» for disallowed viewers); `listProductsAdmin` returns the flag; `updateProduct` whitelists `wholesaler_only`. Legacy `/api/products` (`productsController.list`/`getOne`) also hardened with `optionalAuth` + same filter (dead-but-public endpoint, no leak). Catalog routes already used `optionalAuth` so the viewer is known. Frontend: `CatalogProduct.wholesalerOnly?` + `CatalogProductSummary.wholesalerOnly` types + mappers in `lib/catalog.ts`; admin `products/page.tsx` adds «خاص بطلاب الممثل فقط» CheckRow wired to `updateCatalogProduct({ wholesaler_only })`. Migration NOT yet applied to Neon — run `npm run migrate` or apply 008. Lint: 0 errors; controllers load clean.
- **Locked option groups (2026-05-29)** — Admin can lock a (child) product's option group to one fixed option so students can't change it (e.g. «نوع الوشاح» → «مثلث»). Migration `db/migrations/007_product_locked_options.sql` (+ mirror in `db/schema.sql`): `product_locked_options(product_id, group_id, option_id)` keyed by child so inherited parent groups can be locked per-child. Backend: `getProductFull` attaches `locked_option_id` per group; `PUT /catalog/products/:id/lock-group-option` (upsert) + `DELETE /catalog/products/:id/lock-group-option/:groupId` (admin-only). Frontend: `CatalogOptionGroup.lockedOptionId` + mapper, `lockGroupOption`/`unlockGroupOption` in `lib/catalog.ts`. Admin `products/page.tsx` GroupBlock: per-option «قفل هذا الخيار للطلاب» radio + «مثبّت» banner with clear. Student `OptionGroupField`: locked group renders read-only with «مثبتة» badge and auto-selects the option into selection state so price + order payload (`buildConfigureSelections`) include it unchanged.
- **Impeccable design context (2026-05-29)** — `PRODUCT.md` (register `brand`, storefront-led) + `DESIGN.md` ("The Graduation Lookbook": warm paper + ink + earned burnt-orange ≤10%, Amiri display, flat tonal elevation) + `.impeccable/design.json` sidecar + `.impeccable/live/config.json` (live mode → `frontend/app/layout.tsx`). Legacy `.impeccable.md` superseded.
- **LANE 4 storefront polish (2026-05-29)** — Scrim card audit: `ShopProductCard`/`ShopPackageCard`/`ShopProductHeroCard` are DEAD (only `app/shop/*` shell imports them; `(student)/*` uses `ProductTile`/`PackageTile` from `ProductTile.tsx` which already had caption-below). Changes: (1) `ProductTile.tsx` — fixed `sizes` from hardcoded 512px cap to real responsive column widths `44vw/30vw/22vw`; flattened resting `shadow-soft` on figure → hover-only `shadow-float`; moved `PackageTile` badge out of the photo and into `<figcaption>` below. (2) `ShopCover.tsx` — hero photo now wrapped in `parallax-frame`/`parallax-photo` for scroll-driven depth. (3) `BrandStory.tsx` — editorial frames: `parallax-frame` class added to both `AtelierStory` and `MilestoneStory` image wrappers; `loading="lazy"` on below-fold images. (4) `SpotlightReel.tsx` — `sizes` corrected to `32rem` max; explicit `loading="eager"` on slide 0 / `"lazy"` on rest. (5) `(student)/page.tsx` — sections now alternate `surface-sink`/paper bands (lookbook page-turn rhythm), `space-y-0` + explicit section padding, footer as `full-bleed surface-sink` colophon; `RevealHeading` component (IntersectionObserver + `.reveal`/`.reveal-in`) used on all `SectionHeading`s; Amiri used on section h2s. (6) `(student)/product/[id]/page.tsx` — full STATE TRIO: `ProductPageSkeleton` (shaped like the 2-col layout), `EmptyState`+retry error panel, proper `loadError` state; back-link + "متابعة التسوق" redirected from dead `/shop` to `/`. (7) `ProductMediaGallery.tsx` — flattened resting `shadow-card` → hover `shadow-float`; `loading="lazy"` on thumbnails. (8) `PriceBreakdown.tsx` — flattened `surface-card` (carried resting shadow) → `border-line bg-surface`. (9) `OrderBreakdownCard.tsx` — removed resting `shadow-card`. (10) `sizes/page.tsx` — removed resting `shadow-card` from table wrapper; replaced `surface-card` (resting shadow) with flat `border-line bg-surface`. tsc clean.
- **Student home lookbook craft (2026-05-29)** — `components/shop/ShopCover.tsx`: cinematic full-bleed photo cover from `getHeroSlides()` (Amiri overlay + bottom legibility veil + single earned-orange CTA → `/design`), graceful type-led fallback when no slide. `(student)/page.tsx` reworked: parallel feed+hero load (`Promise.allSettled`, hero never blocks catalog), cover + "إطلالات كاملة" packages + "القطع" filtered grid + close. **Student-scoped `.shop-paper` token override in `globals.css`** flips the storefront to the locked paper/ink palette + ink-toned shadows without touching admin/staff/wholesaler. NOTE: PhotoCover path not browser-verified (no hero slide in dev DB); type fallback verified. Some product `image_url`s 404 in dev → broken-img on tiles with non-null bad URLs (data, not code).
- Project spec written (CLAUDE.md)
- Task breakdown written (PLAN.md)
- Open questions answered (open.md)
- Database schema (db/schema.sql)
- **Frontend Phase 0** — RTL, Amiri/Cairo fonts, Tailwind @theme colors, lib/api + lib/auth, PWA manifest, shared UI components
- **Frontend Phase 2** — Admin layout/sidebar, analytics dashboard, orders page, wholesalers page
- **Frontend Phase 3** — Wholesaler mobile panel, join/[code] registration
- **Frontend Phase 1** — Login, forgot-password, reset-password, verify-otp
- **Backend Phase 1+2+3** — auth, admin API, wholesaler API, join referral flow, notifications
- **Phase 4 — Sash Designer (DONE)** — Fabric.js v6 flat 2D canvas, color picker, font picker (12 Arabic+Latin fonts via Google), text editor (drag/resize/rotate/edit-in-place), logo + image uploads, 3-step flow, live preview, save/auto-save/complete, status-gated (pending students blocked)
- **Design pipeline sprint (2026-05-26)** — `lib/render-sash-panel.ts` unified horizontal→vertical panel render for gown preview, staff `DesignViewer`, and `HighResExporter`; font preload in `FabricPanelPreview`; step-1 draft in sessionStorage + save health UI; gown empty-state CTAs; side-aware Whiteboard; design row `ORDER BY updated_at` on save
- **Admin + retail funnel polish (2026-05-26)** — Admin orders: per-order **تكلفة** (IQD) draft + **حفظ** via `PATCH /admin/orders/:id/cost` (`lib/admin.updateOrderCost`). Shop home: login-aware sash CTA, gender from `localStorage` without effect churn, friendly load errors (no raw API URL). Student product page: load error vs missing product, retry + link to `/`, login hint for sash-only path; ESLint `react-hooks/set-state-in-effect` handled with targeted disables / lazy `localStorage` state.
- **Wire frontend APIs (2026-05-26)** — Student home at `/` via `app/(student)/page.tsx` (`getShopFeed`, packages + products by type, sash CTA → `/design`, gender filter for shawl, `/shop` redirects). Wholesaler packages: `lib/packages.ts` (`listPackages`, `confirmPackage`), real cap options from catalog, removed `lib/mocks/catalog.ts`. Admin batch detail: per-student **تكلفة** / **ربح** columns; backend `GET /batches/:id` aggregates `cost` + `profit`; `POST /orders/configure-package` supports wholesaler + retail with `cap_option_id`.
- **Phase 6 — Staff Panel (DONE)** — `/staff` orders list (filters: review / printing / done), `/staff/orders/[orderId]` read-only design viewer, PNG 300 DPI + PDF export (jspdf), status actions with TODO fallback for `PATCH /orders/:id/status`
- Backend: products + variants endpoint, fonts endpoint, designs save/get/complete, multer uploads (logo/image), staff-view of student designs
- Backend: auth/register now creates `students` row (pre-approved for pure retail), join referral creates pending student
- Fixed: Neon IPv6 → IPv4 forced in lib/db.js
- **Docs** — root CLAUDE.md: added init header, Commands (dev/build/lint/migrate/seed), version warnings (Next 16/React 19, Express 5, Tailwind v4, Neon), Architecture section. Fixed Three.js→Fabric.js contradiction in feature list.
- **Backend — Orders status API (DONE)** — new `orderController.js` + `routes/orders.js` mounted at `/api/orders` (staff+admin): `GET /api/orders` (filters wholesaler_id/status/from/to; rows now include `student_id`, `university_name`, `department`) and `PATCH /api/orders/:id/status` (staff limited to staff_review/printing/ready/delivered; writes audit_log + student notification; sets delivered_at). `/api/admin/orders` now reuses orderController.listOrders. Removed dup from adminController. → Cursor: point `staff.ts` to `/orders` + `/orders/:id/status` (mismatch TODO resolved on backend).
- **Brand identity (from official PNG)** — `frontend/brand-tokens.css` written (warm orange #F47B42 / amber→peach gradient, ink #1A1A1A, cream #FAEBD7, peach/blush accents; fonts: Great Vibes script + Playfair display + Cairo/Amiri Arabic). Includes @theme block + class-migration map (navy→ink, gold→orange). CLAUDE.md Design Language updated to match (old navy/green/gold was WRONG). → Cursor: apply brand-tokens.css into globals.css + wire Playfair/Great Vibes in layout.tsx + migrate classes.
- **Phase 7 — Deploy files (DONE, not yet deployed)** — `nginx.conf` (loloshop96.com, /api + /uploads → :4000, rest → :3000, client_max_body_size 15m, certbot-ready), `ecosystem.config.js` (PM2: loloshop-api + loloshop-web), prod env examples wired to domain (CORS_ORIGIN, PUBLIC_URL, NEXT_PUBLIC_API_URL).

---

- **PLAN v2 — Product & pricing model redefined (2026-05-25)** — PLAN.md now has admin-managed option engine: products+option_groups+options, admin toggles required/optional + image + price-delta per field, role-based pricing (wholesaler vs retail), packages (sash-driven, cap swappable), batches (دفعات) w/ countdown + totals, transparent price breakdown, profit/loss accounting. New Phases 8–11 + "PRODUCT & PRICING MODEL (v2)" spec. Robe(4 fabrics,sleeves +5k×2,pleat), Cap(20k fixed,shape,embroidery pos), Sash(30k,6 types,+5k frame,color,back,designer link), Shawl(girls-only,20k/30k). Big schema migration pending (Task 8.1).

- **Task 8.1 — v2 schema (DONE, migration NOT yet applied to Neon)** — `db/migrations/001_v2_product_pricing.sql` (additive, IF NOT EXISTS) + folded into `db/schema.sql` for fresh installs. Adds: enums gender/price_role/option_input, cap+shawl to product_type, students.gender, products.gender_restriction, tables option_groups, options, option_price_roles, product_price_roles, batches (+orders.batch_id), order_items, packages, package_rules. ✅ **APPLIED to Neon** 2026-05-25 (8 v2 tables + product_type now sash/robe/cap/shawl).
- **Task 8.1b — v2 seed (DONE)** — `seed-v2.js` (npm run seed:v2, idempotent). Seeded 4 active products with real batch prices: sash 30000 (type×6 req+img, color×5, إطار +5000 toggle, back toggle), cap 20000 (shape×2, تطريز×3 free + admin-image hint), robe 25000 (4 fabrics +0/5k/10k/15k, ردان counter +5000 max 2, كسرة +5000), shawl female-only 30000 retail / 20000 wholesaler (product_price_roles). 2 packages (بكج ملكي/عادي) seeded INACTIVE price=0 pending open question; package_rules map sash type→tier. Legacy seed.js products (classic sash 50k, robe 75k) set active=FALSE to avoid dupes. Verified role pricing resolves correctly.
- **Task 8.2 — Catalog CRUD API (DONE)** — `backend/controllers/catalogController.js` + `routes/catalog.js` mounted `/api/catalog`. Public `GET /catalog/products/:id/full` (role-aware prices: rep-linked student=wholesaler else retail; `?role=` override for admin preview). Admin CRUD: products/groups/options, toggle required/has_image, edit price_delta, `PUT .../price-role` upsert/clear (option + product), `POST /catalog/uploads/image`. Loads clean.

- **Task 9.2 — Order configure + pricing API (DONE)** — `POST /api/orders/configure` (retail): validates product+selections (required groups, max_select, gender, option∈group), computes role-resolved total server-side, writes order + `order_items` snapshots in tx, status='design_complete'. `GET /api/orders/:id/breakdown` (owner/staff/admin) returns itemized lines. orders.js now per-route guards (retail can configure). Verified pricing: sash+frame=35000, robe loaded=50000.

- **Task 11.1 — Batches API (DONE)** — `/api/batches` (admin write, admin+wholesaler read; wholesaler scoped to own): create/update batch, list (w/ grand_total + order_count), GET detail (per-student name+full_name_third + order total within batch, grand_total). `batchController.js` + `routes/batches.js`.
- **Task 11.2 — Accounting analytics (DONE)** — `GET /api/admin/accounting`: totals + revenue/cost/profit grouped by batch, by wholesaler, and independent retail (wholesaler_id IS NULL). Server boots + health OK with all routes.

- **Catalog admin list + DB hardening (DONE)** — `GET /api/catalog/products` (admin, all incl inactive, with group_count) for the 8.3 editor. `lib/db.js`: connectionTimeoutMillis 15000 + keepAlive (fixes Neon cold-start ETIMEDOUT); strip sslmode/channel_binding from URL (kills pg SSL deprecation warning).

- **Order/design/gender reconciliation (DONE)** — `configureOrder` now: (1) reconciles instead of duplicating — sash designer's auto-created order (keyed by design_id) gets UPDATED with real option price + order_items; non-design products upsert by (student,product); (2) auto-assigns rep orders to their wholesaler's most recent batch when batch_id omitted; (3) independent retail (no wholesaler) skip approval check. Registration (`auth/register`) + join (`join/:code`) now accept optional `gender` (male/female) → stored on students (needed for shawl). → Cursor: (a) sash order = `POST /api/orders/configure` { product_id=sash, design_id, selections:[type/color/إطار/back] } AFTER design complete — don't price sash client-side; (b) add gender select to register + join forms.

- **E2E smoke test PASSED (2026-05-25)** — 14/14: admin+student login, catalog full (price_role=wholesaler for rep student), design save → sash configure reconciles to 35000 with NO duplicate order + auto-batched, robe loaded=50000, shawl=20000 (wholesaler/female), order breakdown lines, batch grand_total=105000 + per-student row, accounting wholesaler revenue=105000. Temp test file removed after run.
- **DB resilience (DONE)** — `lib/db.js` query() retries transient connection errors (ETIMEDOUT/ENETUNREACH/ECONNRESET/ECONNREFUSED, 3 tries, backoff) + connectionTimeoutMillis 20000. Fixes Neon cold-start failures (was crashing login intermittently).

- **Catalog media + shop feed (DONE backend)** — migration 002 (applied): products.image_url/featured/sort, product_images gallery, packages.image_url/sort. Catalog API: public `GET /api/catalog/shop` (packages-first + products grouped by_type, role-aware price), product gallery `POST /api/catalog/products/:id/images` + `DELETE /api/catalog/images/:id`, updateProduct now accepts image_url/featured/sort, getProductFull returns image_url+images[], listProductsAdmin returns image_count. Shop endpoint verified.
- **Brand colors v2 (DONE)** — `brand-tokens.css` updated to official hex: orange #FF8C00, light #FFA07A, peach #FFDAB9, blush #FFE4E1, ink #1A1A1A/#333, cream #FAEBD7, beige #F5F5DC, neutrals #E0E0E0/#BDBDBD. amber/offwhite kept as back-compat aliases. → Cursor re-apply to globals.css.

- **Design page hardening (DONE 2026-05-26)** — Merged UX/a11y/tech critique fixes: `useDesignDraft` hook, `FabricPanelPreview` + `designer-colors.ts`, stepper labels (mobile-visible), step 3 uses `SashFlat` readOnly (WYSIWYG), responsive sash layout, accessible `Modal` confirm w/ recap, `await persist` before preview, gender from API (`GET /designs/me` + `student_gender`), `edit_exception` unlock, empty-panel CTAs, auto-open Whiteboard on empty side, live portrait mini-preview in editor, color swatches in step 1, 8s autosave, safe-area sticky bar, dynamic import TextEditor/DesignPreview, removed dead ColorPicker/Uploader/OrientationModal.

- **Designer v2 rewrite (DONE)** — `/design` is now the full v2 sash flow: Step 1 = real option groups (نوع الوشاح/اللون/إطار/خلف via OptionGroupField + live PriceBreakdown + CustomerImageUpload for مثلث), Step 2 = canvas (SashFlat, color from selected option), Step 3 = preview + confirm. **Confirm now: saveDesign → configureOrder(productId,designId,selections) → completeDesign** — fixes the old bug where sash priced at base only + no order_items. Brand header (script logo), autosave indicator, sticky action bar, total shown on confirm. Sash `/product/[id]` now delegates to designer (hides duplicate configurator). Legacy ColorPicker unused. tsc + build pass. ماروني added to SashFlat color map.
- **Staff system + wholesaler student tracking (DONE 2026-05-26)** — Admin can manage staff accounts (`/admin/staff` + `/api/admin/staff` CRUD). Admin + wholesaler + staff can view all students under a wholesaler with **مكتمل/غير مكتمل** derived from `order_status >= design_complete` (new pages: `/wholesaler/students`, `/admin/wholesalers/[id]/students`, `/staff/wholesalers` + `/staff/wholesalers/[id]/students`; new staff API: `GET /api/staff/wholesalers/:id/students`; student list APIs now also return `is_completed`).
- **Gown WYSIWYG preview + staff composite export (DONE 2026-05-26)** — Shared `lib/gown-hotspots.ts` + `lib/render-gown-composite.ts`; `SashGownPreview` + `GownPanelImage` on gown hotspots. **Fix (2026-05-26):** `rasterizePanelCanvas` renders horizontal board then rotates with 2D matrix (Fabric viewport PNG export was blank). Editor: no live gown strip; gown preview on step 2/3 after **حفظ الجانب**. **Staff**: gown + flat panel PNG export.

- **Package API (DONE 2026-05-26)** — `GET /api/catalog/packages` (public/role-aware, joins sash_type_label from package_rules); Admin CRUD `POST/PATCH/DELETE /api/catalog/packages` + `PUT /packages/:id/rule` (sash type link); `POST /api/orders/configure-package` (retail, wholesaler-linked only): validates student approval, resolves batch, creates 3 orders (sash at package price + robe+cap at 0) in tx, snapshots package name in order_items. Migration 004 (`orders.package_id`) applied to Neon. → Cursor: wire `wholesaler/package/page.tsx` + `(student)/page.tsx` + batch detail columns.

## 🔄 Current Task
**Order bundle system (checkout_group_id) DONE (2026-05-31)**
- Migration `db/migrations/011_order_bundles.sql`: `ALTER TABLE orders ADD COLUMN IF NOT EXISTS checkout_group_id UUID` + index. Applied to live Neon DB — column confirmed.
- **C1 schema fix**: In `db/schema.sql`, `CREATE TABLE packages` + `CREATE TABLE package_rules` moved to BEFORE `ALTER TABLE orders ADD COLUMN package_id` (fresh `npm run migrate` previously failed because the FK target didn't exist yet). `checkout_group_id` column + index also added to schema.sql in the same section.
- `cartController.js`: `const crypto = require('crypto')` added. In `checkout()`, `bundleId = lines.length > 1 ? crypto.randomUUID() : null` generated before the tx loop. All four order paths (design INSERT, design UPDATE, non-design INSERT, non-design UPDATE) now stamp `checkout_group_id = bundleId`. Response: `{ data: { orders, count, bundle_id } }`.
- `productionController.js` — `getQueue`: `o.checkout_group_id` added to SELECT so frontend can cluster sibling rows. `getOrder`: (a) SECURITY FIX — after loading order but before any further queries, non-managers are scope-checked against `order.source` to prevent IDOR; (b) `o.checkout_group_id` added to base SELECT; (c) sibling block replaced with generalized bundle lookup querying siblings sharing `checkout_group_id` OR `package_id` — visible to all staff types (not just preparer); result in `bundle` field + `package_orders` alias for back-compat. `bundle = null` when 0 or 1 sibling rows.
- `orderController.js` — `listOrders`: added `type` filter (validated against `VALID_PRODUCT_TYPES`; invalid values silently ignored) and `group=bundle` mode returning `{ data: { bundles: [ { checkout_group_id, student_name, university_name, created_at, total_price, total_cost, total_profit, items: [ { order_id, product_name, product_type, status, price, cost, profit } ] } ] } }`. Flat mode also now returns `product_type` and `checkout_group_id` per row.
- Smoke tests: all 5 pass (flat orders, bundle grouping, type filter, invalid-type safety, production queue with checkout_group_id).

**Staff per-type dashboards + production pipeline UI DONE (2026-05-31)**
- `lib/staff-types.ts` — added `ProductionQueueItem`, `ProductionOrderDetail`, `PackageOrderSibling`, `ProductionOrderItem`, `MonitorData` interfaces for the production pipeline API.
- `lib/staff.ts` — added `getQueue(stage?)`, `getProductionOrder(id)`, `advanceOrder(id)`, `approveDesign(id)`, `rejectDesign(id, reason)`, `getMonitor()` wrappers for `/production/*` endpoints. Kept all legacy exports.
- `lib/admin.ts` — `getAdminStaff` now returns `staff_type`; added `updateStaffType(id, type)` for `PATCH /admin/staff/:id/type`; `CreateStaffPayload` now includes optional `staff_type`; `createStaff` sends it to backend.
- `components/staff/StaffSidebar.tsx` — rewritten to be staff-type-aware: shows type-appropriate nav links per role (designer→مراجعة التصاميم, embroiderer/presser/preparer→their queue, manager→المتابعة + all-stages + wholesalers), displays the Arabic type label badge in sidebar + footer.
- `components/staff/OrderCard.tsx` — extended to accept both `StaffOrder` and `ProductionQueueItem` (snake_case/camelCase normalised). New approval_status badge shown for design_complete items. Fixed TypeScript narrowing issue with type casts.
- `app/staff/page.tsx` — replaced the flat filter-based view with a staff-type-aware dispatcher: designer/embroiderer/presser/preparer → `QueueView` (fetches `/production/queue`, role-appropriate title/empty text); manager → `MonitorDashboard` (WIP stat cards per stage, throughput table, overdue list, stale list, quick-stage links with counts); unset role → Arabic guidance empty state.
- `app/staff/queue/page.tsx` (NEW) — manager-only filtered queue with stage tabs.
- `app/staff/orders/[orderId]/page.tsx` — fully rewritten to use `getProductionOrder(id)`. Respects `can_see_design`: presser sees only sash color + options (no canvas); others see full DesignViewer + exports. Approve/reject buttons (designer/manager, design_complete only) with reject-reason modal. Stage-advance button labelled per-stage (تم التطريز ← الكوي etc). Package siblings list for preparer. Rejection reason card if design was rejected.
- `app/admin/staff/page.tsx` — `staff_type` select in create-staff modal; inline role `<select>` in each staff row (calls `updateStaffType` on change); type badge displayed per row.
- `npm run lint`: 0 errors (10 pre-existing warnings in files outside scope). `npx tsc --noEmit`: clean.

**Student shop gating + retail cart DONE (2026-05-31)**
- `lib/cart.ts` (NEW) — `getCart`, `addToCart`, `updateCartItem`, `removeCartItem`, `checkout` typed wrappers for `/api/cart/*`.
- `lib/catalog.ts` — `getShopFeed` now surfaces `audience` field from the backend.
- `lib/packages.ts` — `listPackages` now accepts `role` param (wholesaler|retail).
- `app/(student)/page.tsx` — detects `audience === "wholesaler_student"` → `router.replace("/package")`; packages no longer shown on home feed for retail (they surface via cart suggestion only); converted `loadShop` to `useCallback` to satisfy `react-hooks/exhaustive-deps`.
- `app/(student)/package/page.tsx` (NEW) — shared package form (wholesaler-students + retail). Tries wholesaler packages first, falls back to retail. Shows what's included (cap+robe+sash tags), cap-shape picker, price, sticky confirm CTA → `confirmPackage` → `/design`.
- `app/(student)/cart/page.tsx` (NEW) — cart items with qty stepper + remove, live total, single "أكمل باكج التخرّج" suggestion card linking to `/package`, checkout button. After checkout: customizable items → `/design`, otherwise success state.
- `app/(student)/product/[id]/page.tsx` — non-customizable products now show "أضف إلى السلة" → `addToCart`; post-add shows "عرض السلة" + "متابعة التسوق". Customizable non-sash products keep the old confirm flow. Sash products keep the designer flow.
- `app/wholesaler/package/page.tsx` — replaced with a redirect to `/package`.
- `components/StudentNav.tsx` — cart icon with item-count badge; fetches `getCart()` on auth to show live count.
- Lint: 0 errors in files I own; 0 TypeScript errors in my files. One pre-existing TS error in `components/staff/OrderCard.tsx` (parallel agent's file, outside my scope).

Parent-child products + catalog bug fix DONE (2026-05-26).

- **Admin can create/delete products, groups, options** — `lib/catalog.ts` + `admin/products/page.tsx` wired to `POST/DELETE /catalog/products|groups|options`.
- **Product page auto-selects single-option required groups** — if admin creates "وشاح مثلث" with only 1 option in نوع الوشاح, it auto-selects on load. Applies to all product types.
- **Sash → Designer preset flow** — clicking "صمّم وشاحك" on a sash product page saves `{productId, selections}` to sessionStorage (`loloshop_sash_preset`). Designer (`useDesignDraft`) reads it: loads that specific product instead of always sash[0], pre-fills selections, persists productId across refreshes.
- **Sizes page** — `(student)/sizes/page.tsx` (S/M/L/XL/XXL robe chart + cap sizing).
- **Home page** — INITIAL_PER_TYPE raised 4→6, sizes link added.

Workflow for admin adding 20 sash products:
1. Go to `/admin/products` → click "إضافة منتج+" → type=sash, name="وشاح مثلث", price=30000
2. Inside that product → "إضافة مجموعة خيارات+" → name="نوع الوشاح", type=single_select, required=true
3. "+ خيار" → label="مثلث", price_delta=0
4. Repeat for each sash type → student home shows all 20 as cards.

---

## ⏳ Up Next
1. **Phase 8.1 — Schema migration** (Claude/backend) — option_groups, options, role pricing, order_items, batches, packages. Blocks 8.2/9/10/11.
2. **Phase 8.2 — Admin catalog CRUD API** (Claude/backend).
3. Wire FE to real API + apply brand-tokens.css + Phases 8.3/9/10/11 FE (Cursor).
4. Backend `PATCH /orders/:id/status` + staff order list — **DONE** (`/api/orders`). Cursor: point staff.ts to it.
5. Deploy when local done: build FE → nginx.conf → certbot → `pm2 start ecosystem.config.js`. NOTE: `NEXT_PUBLIC_API_URL` baked at build — set before `npm run build`.
6. Capacitor wrap (Play + App Store) — after web + brand stable.

---

## ❌ Blocked / Issues
None

---

## 📝 Decisions Made

### Stack
- Canvas editor: **Fabric.js v6** (locked — drag/resize/JSON serialize built-in)
- Renderer: **Flat 2D only** — Three.js removed
- Storage: **Local VPS disk** `/uploads/{logos,images,fonts}` (revisit if scale grows)
- PWA: **enabled** (manual manifest.json + layout meta)

### Frontend theme
- Tailwind v4 `@theme` in globals.css (not tailwind.config.ts) — colors: navy, gold, cream, ink
- Fonts: Amiri (display), Cairo (UI)
- Mock API fallbacks until backend live; dev login: `07700000001` / `123456` (admin), `07700000002` / `123456` (wholesaler), `07700000003` / `123456` (staff)

### Business
- Payments: CASH ONLY
- Currency: IQD
- Timezone: UTC+3 (Iraq)
- Language: **Arabic only** for ALL UI (admin/staff/wholesaler/student)
- Pricing: **per-product variable** — admin sets price per sash/robe. Wholesaler prices communicated via WhatsApp, not displayed in app to wholesalers
- Cost: admin enters **single number** per order manually
- Commission: **NOT tracked** — out of scope
- Delivery: **Pickup only** — no address field, no delivery cost
- Refund: **default no** — admin can flag specific student as "edit allowed" exception. After printing = hard no
- Inventory: **none** — everything shown is available, no stock tracking

### Auth
- Phone-based primary login
- Email field **required** (for password reset)
- Phone OTP via **Zentramsg WhatsApp** (or Google Sign-In fallback)
- Password reset via email
- Wholesalers: NO self-register — admin creates after WhatsApp contact
- Students: register via referral link, status `pending_approval`

### Orders
- States: `pending_approval` → `designing` → `design_complete` → `staff_review` → `printing` → `ready` → `delivered`. Also `cancelled`.
- Transitions: **auto** based on system events (student confirms = `design_complete`; staff marks printed = `printing`; etc.)
- Audit log table tracks all transitions + who triggered

### Products
- **Sash**: customizable (designer flow). Multiple sizes — size chart page needed
- **Robe**: buy-only product (pick size + color). NO design flow. Sizes S/M/L/XL/XXL
- Different price per color/material allowed

### Designer
- Free-text university name (not dropdown)
- Pre-made templates per university planned (P3, post-MVP)
- No image moderation (real names + phone + email = accountability)
- Free Arabic fonts only: Amiri, Cairo, Reem Kufi, Aref Ruqaa, etc. NO paid/cracked fonts
- Custom fonts loaded via FontFace API into Fabric.js canvas

### Print Output
- Staff exports: **PDF (proof) + PNG @ 300 DPI**
- High-res render from Fabric.js JSON state

### Notifications
- **In-app only** for MVP (no SMS/WhatsApp push)
- Triggers: student joined, approval result, deadline approaching, order status change

### Security
- Rate limit `/api/join/:code` per IP (prevent flood if link leaks)
- Wholesaler approves each student manually one-by-one
- Soft delete: **deferred** decision

### Referral Codes
- Format: **human-readable slug** e.g. `baghdad-cs-2026`
- Unique per wholesaler, generated by admin

### Hosting
- Domain: **TBD** (no decision yet)
- SSL: **TBD** (Let's Encrypt later)

---

## 🗂️ File Tracker
| File | Status |
|------|--------|
| db/schema.sql | ✅ |
| API.md | ✅ |
| backend/server.js | ✅ |
| backend/seed.js | ✅ |
| backend/.env.example | ✅ |
| backend/lib/db.js (Neon-ready SSL) | ✅ |
| backend/lib/otp.js (Zentramsg) | ✅ |
| backend/lib/email.js (nodemailer) | ✅ |
| backend/middleware/auth.js | ✅ |
| backend/controllers/authController.js | ✅ |
| backend/controllers/joinController.js | ✅ |
| backend/controllers/wholesalerController.js | ✅ |
| backend/controllers/adminController.js | ✅ |
| backend/controllers/notificationController.js | ✅ |
| backend/routes/auth.js | ✅ |
| backend/routes/join.js | ✅ |
| backend/routes/wholesaler.js | ✅ |
| backend/routes/admin.js | ✅ |
| backend/routes/notifications.js | ✅ |
| backend/controllers/productsController.js | ✅ |
| backend/routes/products.js | ✅ |
| backend/controllers/designController.js | ✅ |
| backend/routes/designs.js | ✅ |
| backend/routes/fonts.js | ✅ |
| backend/lib/upload.js (multer) | ✅ |
| frontend/lib/designer.ts | ✅ |
| frontend/lib/fonts-loader.ts | ✅ |
| frontend/components/designer/DesignerStepper.tsx | ✅ |
| frontend/components/designer/ColorPicker.tsx | ✅ |
| frontend/components/designer/Uploader.tsx | ✅ |
| frontend/components/designer/TextEditor.tsx | ✅ |
| frontend/components/designer/SashFlat.tsx | ✅ |
| frontend/components/designer/DesignPreview.tsx | ✅ |
| frontend/app/design/page.tsx | ✅ |
| frontend/app/layout.tsx | ✅ |
| frontend/app/globals.css | ✅ |
| frontend/lib/api.ts | ✅ |
| frontend/lib/auth.ts | ✅ |
| frontend/public/manifest.json | ✅ |
| frontend/app/admin/layout.tsx | ✅ |
| frontend/app/admin/page.tsx | ✅ |
| frontend/app/admin/orders/page.tsx | ✅ |
| frontend/app/admin/wholesalers/page.tsx | ✅ |
| frontend/app/wholesaler/page.tsx | ✅ |
| frontend/app/wholesaler/layout.tsx | ✅ |
| frontend/app/join/[code]/page.tsx | ✅ |
| frontend/app/login/page.tsx | ✅ |
| frontend/app/forgot-password/page.tsx | ✅ |
| frontend/app/reset-password/[token]/page.tsx | ✅ |
| frontend/app/verify-otp/page.tsx | ✅ |
| frontend/components/designer/SashFlat.tsx | ⏳ |
| frontend/components/designer/TextEditor.tsx (Fabric.js) | ⏳ |
| frontend/app/(student)/page.tsx | ✅ |
| frontend/app/(student)/sizes/page.tsx | ⏳ |
| frontend/app/staff/layout.tsx | ✅ |
| frontend/app/staff/page.tsx | ✅ |
| frontend/app/staff/orders/[orderId]/page.tsx | ✅ |
| frontend/components/staff/StaffSidebar.tsx | ✅ |
| frontend/components/staff/OrderCard.tsx | ✅ |
| frontend/components/staff/DesignViewer.tsx | ✅ |
| frontend/components/staff/HighResExporter.ts | ✅ |
| frontend/components/staff/PdfExportButton.tsx | ✅ |
| frontend/components/staff/ExportPngButton.tsx | ✅ |
| frontend/lib/staff.ts | ✅ |
| frontend/lib/staff-types.ts | ✅ |
