# LoloShop — PLAN.md

## How to use this file
Each task is **small and self-contained**. Claude Code picks ONE task at a time, completes it fully, then updates PROGRESS.md.

> **2026-05-25 — Product & pricing model redefined (v2).** Products are no longer static variants. Everything a customer picks is an **admin-managed option** with admin-controlled price delta, required/optional flag, and optional illustrative image. See "PRODUCT & PRICING MODEL (v2)" below and Phases 8–11. Phase 5 (student retail) now depends on this engine.

---

## PRODUCT & PRICING MODEL (v2) — admin-managed

**Golden rule:** *Anything the user can mention/pick, the admin can add / edit / remove* — including its label, price, whether it's required or optional, and whether it shows an illustrative image. Build the data model so this is all DB-driven, not hardcoded.

### Entities (new — replaces static product_variants)
- **products** — `sash` | `robe` | `cap` | `shawl`. Has `base_price` (IQD) + `gender_restriction` (null | `male` | `female`).
- **option_groups** — a configurable field on a product. Fields:
  - `product_id`, `name_ar`, `input_type` (`single_select` | `toggle` | `counter`), `sort`
  - `required` (BOOL, **admin-editable**), `has_image` (BOOL, admin-editable — can remove image), `hint_ar` (TEXT, shown to student), `image_url` (admin upload — explanatory image)
  - `max_select` (e.g. sleeves = 2), `gender_restriction`
- **options** — a value inside a group. Fields: `group_id`, `label_ar`, `price_delta` (IQD, admin-editable), `image_url` (admin upload), `active`.
- **price overrides** — `price_delta` (and product `base_price`) can differ by **role** (`wholesaler` vs `retail`). e.g. shawl: wholesaler 20000, retail 30000.
- **packages** (wholesaler/rep students only) — bundle = **robe (one of 2 robe types) + sash + cap**, e.g. "ملكي" (royal sash + royal cap) / "عادي" (normal sash + normal cap). Package **tier is driven by the sash type**, but cap can be swapped independently (royal sash + normal cap allowed, and vice versa). Has a single package price (role = wholesaler). Retail students buy items à la carte (no packages).
- **batches / دفعات** — `name_ar` (e.g. "طب عام 2026"), `wholesaler_id`, `deadline`. Orders belong to a batch (rep students) or are independent (retail). Drives countdown + totals.
- **order_items** — snapshot of each chosen option + its price at order time, so the price breakdown is immutable and auditable.

### Per-product field map (initial seed — all admin-editable after)
**ROBE (روب)** — `base_price` per fabric type starts 25000 or 35000, rises with fabric + tailoring (pleats/jacket); this rise is baked into the fabric option's price.
- Fabric type (`single_select`, required, image) — 4 fabrics.
- Sleeve embroidery / ردان (`counter`, max 2, image **required**, admin sets req/opt) — **+5000 per embroidered sleeve**.
- Pleat / كسرة (`toggle`, **no image**, price delta) — yes/no.

**CAP (قبعة)** — `base_price` fixed **20000** (embroidery does NOT change price).
- Shape / شكل (`single_select`, **no image**) — عادية | مثلثة.
- Embroidery position / تطريز (`single_select` or `toggle`, hint: "الأدمن يرفع صورة توضيحية") — من الجانب | من الأعلى. Image via admin.

**SASH (وشاح)** — `base_price` fixed **30000**.
- Type / نوع الوشاح (`single_select`, **required**, image required) — مثلث | مثلث صغير | مثلث حاد | ملكي خماسي | عادي | منحني.
- Color / لون (`single_select`, optional, image) — ماروني + common colors.
- Frame / إطار (`toggle`, price delta **+5000**).
- Back design / من الخلف (`toggle`, optional).
- **Designer link:** the Fabric.js sash designer is reached via a link from the sash product page (student configures options → opens designer).

**SHAWL — شال أمريكي (`gender_restriction = female`)**
- Royal/American shawl. Price: wholesaler "شال ملكي" **20000**, retail **30000** (role-based).

### Pricing display (admin's main concern = clarity)
- Every price shows a **transparent breakdown**: `base_price` + each add-on line ("إطار +5000", "تطريز ردن +5000"...) = total.
- Student sees their full configured price clearly before confirm.
- Rep + admin see a **batch view**: countdown to deadline, list of each student (الاسم الثنائي) + their total, and the **batch grand total**.
- Admin sees independent retail orders too, plus profit/loss (price − admin-entered cost) per order and in aggregate — goal: replace the paper accounting ledger.

---

## PHASE 1 — Foundation (Database + Auth)

### Task 1.1 — Database Schema — DONE
> Actual schema is in `db/schema.sql` (source of truth) — differs from this early sketch: no `referral_links` table (code lives on `wholesalers`); designs use `left_canvas`/`right_canvas` JSONB (not `text_ar/font_choice`); products/variants tables added. The v2 option/pricing tables come in **Task 8.1**.
**Don't:** Add payment fields — cash only

### Task 1.2 — JWT Auth Middleware
**Files:** `backend/middleware/auth.js`
**Do:**
- JWT verify middleware
- Role-check middleware: `requireRole('admin')`, `requireRole('staff')` etc.
- Phone-based login (no email)
**Don't:** Use third-party auth libraries except jsonwebtoken

### Task 1.3 — Auth API Routes
**Files:** `backend/routes/auth.js`, `backend/controllers/authController.js`
**Do:**
- POST `/api/auth/login` — phone + password → JWT
- POST `/api/auth/register` — admin creates staff/wholesaler manually
- GET `/api/auth/me` — return current user info
**Don't:** Allow self-registration for wholesalers (WhatsApp only → admin creates)

---

## PHASE 2 — Admin Dashboard

### Task 2.1 — Admin Layout + Sidebar
**Files:** `frontend/app/admin/layout.tsx`, `frontend/components/AdminSidebar.tsx`
**Do:**
- Responsive sidebar (collapsible on mobile)
- Links: Dashboard, Orders, Wholesalers, Staff, Settings
- Show logged-in admin name
- Arabic RTL layout
**Don't:** Use any pre-built admin UI libraries

### Task 2.2 — Admin Orders Page
**Files:** `frontend/app/admin/orders/page.tsx`
**Do:**
- Table: student full name | product | price | cost | profit (colored green)
- Filter by wholesaler, status, date
- Mobile: card view instead of table
**Don't:** Add payment/invoice UI

### Task 2.3 — Admin Analytics Dashboard
**Files:** `frontend/app/admin/page.tsx`
**Do:**
- Total revenue, total cost, total profit (big numbers at top)
- Orders count by status
- Chart: daily orders (simple line or bar)
- Top wholesalers by order count
**Don't:** Use heavy chart libraries — use recharts or simple SVG

### Task 2.4 — Wholesaler Management
**Files:** `frontend/app/admin/wholesalers/page.tsx`
**Do:**
- List all wholesalers: name, phone, student count, deadline, referral link
- Button: extend deadline (input days)
- Button: copy referral link
- Button: view students under this wholesaler
- Button: create new wholesaler
**Don't:** Allow wholesaler to self-register

### Task 2.5 — Admin API Routes (orders + analytics)
**Files:** `backend/routes/admin.js`, `backend/controllers/adminController.js`
**Do:**
- GET `/api/admin/orders` — all orders with profit/cost
- GET `/api/admin/analytics` — totals + daily breakdown
- GET `/api/admin/wholesalers` — list + stats
- POST `/api/admin/wholesalers` — create wholesaler
- PATCH `/api/admin/wholesalers/:id/deadline` — extend deadline

---

## PHASE 3 — Wholesaler Panel

### Task 3.1 — Wholesaler Home (mobile-first)
**Files:** `frontend/app/wholesaler/page.tsx`
**Do:**
- Show: deadline countdown, student count, pending approvals count
- Pending students list with Approve / Reject buttons
- Their referral link with copy button
- Big bold deadline date (not countdown — actual date admin set)
**Don't:** Desktop-first layout — phone only

### Task 3.2 — Student Approval System
**Files:** `backend/routes/wholesaler.js`
**Do:**
- GET `/api/wholesaler/pending-students` — students who joined via link but not approved
- POST `/api/wholesaler/approve/:studentId`
- POST `/api/wholesaler/reject/:studentId`
**Don't:** Auto-approve anyone

### Task 3.3 — Referral Link Registration Flow
**Files:** `frontend/app/join/[code]/page.tsx`
**Do:**
- Student opens link → sees LoloShop registration form
- Fields: name, phone, password
- On submit → creates account with status "pending approval"
- Shows message: "طلبك بانتظار موافقة الممثل"
**Don't:** Let student use the platform before wholesaler approves

---

## PHASE 4 — Sash Designer (flat 2D, Fabric.js) — DONE
> NOT 3D. Flat 2D left/right panels (decision locked). Phase implemented — see PROGRESS.

### Task 4.1 — Sash Flat Preview (Left + Right panels)
**Files:** `frontend/components/designer/SashViewer.tsx`
**Do:**
- Show sash unfolded: left panel + right panel side by side (like real sash laid flat)
- Student clicks LEFT panel → editor opens for left side
- Student clicks RIGHT panel → editor opens for right side
- Each side editable independently
- Sash color comes from the admin-managed "color" option group (v2) — NOT a hardcoded list (ماروني + common colors w/ images).
- Highlight active side with subtle border glow
**Don't:** Use Three.js or any 3D — flat 2D mockup is the goal

### Task 4.2 — Text Editor Panel (Whiteboard-style)
**Files:** `frontend/components/designer/TextEditor.tsx`
**Do:**
- Whiteboard-like canvas (Fabric.js or vanilla canvas)
- Student writes text freely
- Font choice: Arabic custom fonts loaded from server (النسخ، الكوفي، الرقعة، الثلث، وأي خط يضيفه الأدمن) + English (Serif, Bold, Script)
- Fonts stored as .ttf/.otf files in `/public/fonts/` — loaded via FontFace API on canvas
- Decorations: flourishes, borders — student can drag, resize, position
- "تم" button → places text on the sash flat view
**Don't:** Limit to one text area — full freedom

### Task 4.3 — Sash Flat Preview
**Files:** `frontend/components/designer/SashFlat.tsx`
**Do:**
- Show sash unfolded: left panel + right panel
- Student sees exactly what will be printed
- Can add: university logo (upload from device), custom image (upload from device), text
- Download preview as image (optional)
**Don't:** Make it editable after finalization — confirm button ends design

### Task 4.4 — Design Save API — DONE
**Files:** `backend/routes/designs.js` (actual implemented paths)
- POST `/api/designs/save` — save design (left_canvas/right_canvas JSON, sash_color, logo, image, fonts, notes)
- GET `/api/designs/me` — student's own design; GET `/api/designs/student/:studentId` — staff/admin view
- POST `/api/designs/complete` — mark completed (creates/advances order)
- POST `/api/designs/uploads/logo` + `/uploads/image` — multer uploads

---

## PHASE 5 — Student (Retail) Pages
> **SUPERSEDED by v2 Phase 9** (option configurator). Product detail/ordering = Task 9.1. Only the home/listing below remains.

### Task 5.1 — Student Home + product listing (mobile-first)
**Files:** `frontend/app/(student)/page.tsx`  *(Cursor — FE)*
**Do:**
- List all products from API: **sash, robe, cap, shawl** (not just sash/robe) — gender-filtered (shawl female-only).
- Big "صمم وشاحك" CTA → sash; each product → its Phase 9 configurator.
- Clean, premium look — Arabic RTL, brand-tokens.css.
**Don't:** Add cart/checkout — cash only. Don't hardcode product list.

### Task 5.2 — Product ordering → see Task 9.1
Configurator (dynamic options + price breakdown + designer link) replaces the old "pick color → design" flow.

---

## PHASE 6 — Staff Panel — DONE
> Status API now live: `GET /api/orders` + `PATCH /api/orders/:id/status` (staff+admin). Cursor: point `staff.ts` at these (was mock fallback).

### Task 6.1 — Staff Orders View (iPad-first)
**Files:** `frontend/app/staff/page.tsx`
**Do:**
- List all orders with design status
- Click order → see full design: colors, text, fonts, logo, uploaded images
- Mark as "تم الطباعة" (printed) via PATCH status
- Filter: pending, completed, wholesaler name
**Don't:** Allow staff to edit prices or profits

---

## PHASE 7 — Polish + Deployment — files DONE (not yet deployed)
> `nginx.conf` + `ecosystem.config.js` + prod env examples written for lolo_shop96.com. Deploy after local complete.

### Task 7.1 — Nginx Config
**Files:** `nginx.conf`
- Reverse proxy to Next.js (port 3000) and Express (port 4000)
- SSL ready (certbot)

### Task 7.2 — PM2 Config
**Files:** `ecosystem.config.js`
- Run frontend + backend with PM2
- Auto-restart on crash

### Task 7.3 — Environment Variables
**Files:** `.env.example`
- List all required env vars

---

## PHASE 8 — Product Config Engine (schema + admin CRUD)

### Task 8.1 — Schema migration for option model
**Files:** `db/schema.sql` (new migration block)
**Do:**
- Add `gender_restriction` to `products` (null/male/female); add `shawl`,`cap` to `product_type` enum.
- Add `gender` to `students` (male/female) — required to enforce shawl female-only.
- New tables: `option_groups` (product_id, name_ar, input_type, sort, required, has_image, hint_ar, image_url, max_select, gender_restriction), `options` (group_id, label_ar, price_delta, image_url, active).
- Role-based pricing: `option_price_roles` (option_id, role, price_delta) + `product_price_roles` (product_id, role, base_price) — fall back to base when no role row.
- `order_items` (order_id, group_id, option_id, label_snapshot, price_snapshot).
- `batches` (name_ar, wholesaler_id, deadline, created_at) + `orders.batch_id` FK (nullable = independent retail).
- `packages` (name_ar, role, price) + `package_rules` mapping sash_type_option → package, with cap swappable.
**Don't:** Drop existing tables — additive migration. Keep `price`/`cost`/`profit` on orders (profit stays generated).

### Task 8.2 — Admin product/option CRUD API
**Files:** `backend/routes/catalog.js`, `backend/controllers/catalogController.js`
**Do:**
- CRUD products, option_groups, options (admin only).
- PATCH toggles: `required`, `has_image`, upload/remove `image_url`, edit `price_delta` (+ per-role override).
- Reorder groups (`sort`).
**Don't:** Let staff/customers write.

### Task 8.3 — Admin catalog UI (laptop-first)
**Files:** `frontend/app/admin/products/page.tsx` (+ option editors)  *(Cursor — FE)*
**Do:**
- List products; per product edit option groups + options inline.
- Each field: toggle required/optional, toggle/upload illustrative image, set price delta (per role), edit Arabic label + hint.
- Live preview of student-facing price breakdown.
**Don't:** Hardcode any option — all from API.

---

## PHASE 9 — Option-based ordering + price breakdown (customer)

### Task 9.1 — Product configurator (mobile-first)
**Files:** `frontend/app/(student)/product/[id]/page.tsx`  *(Cursor — FE)*
**Do:**
- Render option groups dynamically (single_select / toggle / counter), show illustrative image + hint when present, enforce `required` + `max_select`.
- Honor `gender_restriction` (shawl female-only) based on student profile.
- Sash page: "صمّم وشاحك" link → Fabric designer, returns to config.
- Live **price breakdown** panel (base + each add-on line = total) using role-correct prices.
**Don't:** Show price without itemized breakdown.

### Task 9.2 — Order pricing API (snapshot)
**Files:** `backend/controllers/orderController.js`, `backend/routes/orders.js`
**Do:**
- POST create/configure order: validate options, compute role-based total server-side, write `order_items` snapshots, set `orders.price`.
- GET order returns full breakdown for student/staff/admin.
**Don't:** Trust client-sent prices — recompute on server.

---

## PHASE 10 — Packages + role-based pricing (wholesaler students)

### Task 10.1 — Package selection
**Files:** backend catalog/order controllers; `frontend/.../package` *(Cursor — FE)*
**Do:**
- Rep students pick a package (robe + sash + cap); package tier determined by **sash type**, cap independently swappable (royal sash + normal cap allowed).
- Apply package price (role = wholesaler) instead of summed item price where a package applies.
**Don't:** Lock cap to sash — they're mixable.

### Task 10.2 — Role price resolution
**Do:** Central helper: resolve price = role override → product/option base. Used everywhere prices render (shawl 20k wholesaler / 30k retail is the canonical test).

---

## PHASE 11 — Batches (دفعات) + accounting dashboard

### Task 11.1 — Batch model + countdown
**Files:** backend batch routes; `frontend/app/admin/batches/...`, wholesaler batch view *(Cursor — FE)*
**Do:**
- Admin/rep create batch (e.g. "طب عام 2026") with deadline; assign rep's students.
- Batch view: deadline **countdown**, each student (الاسم الثنائي) + total, **batch grand total**. Visible to rep + admin.
**Don't:** Use countdown of days only — show actual deadline date too.

### Task 11.2 — Accounting / profit dashboard (admin)
**Files:** `frontend/app/admin/page.tsx` accounting widgets *(Cursor — FE)*; backend analytics
**Do:**
- Admin enters cost per order → profit auto. Aggregate revenue / cost / profit by batch, by wholesaler, and for independent retail.
- Clear, simple tables — goal: replace the paper ledger.
**Don't:** Expose cost/profit to wholesaler or student.

---

## OPEN QUESTION (deferred — user will answer later)
- Admin's concern re packages/pricing clarity — confirm exact package rules + which combos are allowed/blocked before building Phase 10.

---

## Notes
- All deadlines are stored in UTC, displayed in Iraq time (UTC+3)
- All amounts in Iraqi Dinar (IQD)
- Arabic is primary language for all student/wholesaler UI
- English can appear in admin/staff UI
