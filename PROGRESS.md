# LoloShop — PROGRESS.md

## Status: 🟡 In Progress
## Last Updated: 2026-05-26 (student home + packages API + batch profit)

---

## ✅ Done
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
