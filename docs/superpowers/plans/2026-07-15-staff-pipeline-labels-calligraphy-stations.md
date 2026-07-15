# Staff pipeline: labels · calligraphy workbench · stations · routing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the lying stage-1 label, turn the calligraphy tool into an order-grouped workbench with a state-machine-driven send action, give الكوي a real station + route every non-cap order through him, and surface the design images to later stages.

**Architecture:** Spec at `docs/superpowers/specs/2026-07-15-staff-pipeline-labels-calligraphy-stations-design.md`. All status logic stays in the backend state machine (`nextStageFor`/`performAdvance`) — the calligraphy send endpoint is a thin caller of it, and its label comes from the backend so a future removal of «التحويل» needs zero frontend rework. No new tables; one enum-value migration.

**Tech Stack:** Express 5 · PostgreSQL (Neon, shared dev+prod) · Next.js 16 + React 19 + Tailwind v4.

## Global Constraints

- Arabic RTL UI; error shape `{ error: <Arabic>, code: 'ERR_*' }`.
- Order-status rules live ONLY in the backend (memory: ghost buttons that 409).
- No browser testing by Claude — user tests with minted tokens + walkthrough.
- Commit locally per task; **NEVER push** (push auto-deploys prod).
- No test suite exists: gates are `node --check`, `tsc --noEmit`, `eslint`, plus self-cleaning
  controller e2e scripts against the dev (shared!) Neon DB.
- «إرسال» from calligraphy: admin / staff `designer`/`manager` only — `design_helper` 403s.

---

### Task 1: Migration 065 — `cap_side` calligraphy variant

**Files:**
- Create: `backend/db/migrations/065_calligraphy_cap_side.sql`
- Modify: `db/schema.sql` (calligraphy_variant enum, ~line 883)

- [ ] Migration file: `ALTER TYPE calligraphy_variant ADD VALUE IF NOT EXISTS 'cap_side';`
- [ ] Mirror in `db/schema.sql`: add `ALTER TYPE calligraphy_variant ADD VALUE IF NOT EXISTS 'cap_side';` after the enum create block.
- [ ] Apply: `cd backend && npm run migrate:file db/migrations/065_calligraphy_cap_side.sql`
- [ ] Verify: `SELECT unnest(enum_range(NULL::calligraphy_variant));` → 4 rows incl. cap_side.
- [ ] Commit.

### Task 2: Label rename «اكتمل التصميم» → «بانتظار التصميم»

**Files:**
- Modify: `backend/controllers/orderController.js:68` · `frontend/lib/constants.ts:6`

- [ ] Change both values to `'بانتظار التصميم'`.
- [ ] `grep -rn "اكتمل التصميم" frontend/app frontend/components frontend/lib backend --include='*.{ts,tsx,js}'` → fix stragglers (exclude .next/android/queue-mockups).
- [ ] Commit.

### Task 3: Routing — every plain non-cap piece starts at `pressing`

**Files:**
- Modify: `backend/controllers/orderController.js` (configureOrder ~557; configureFullSet itemFlags; configurePackage ~735)
- Modify: `backend/controllers/cartController.js` (~160–222)
- Modify: `backend/lib/fullSetOrder.js:307-309`
- Modify: `backend/controllers/productionController.js` `isFirstProductionStage`

**Interfaces:** plain fallback status = `type === 'cap' ? 'preparing' : 'pressing'`; `needs_pressing = type !== 'cap'` in ALL paths (cart + configureOrder currently say sash||robe).

- [ ] configureOrder: `needs_pressing = productType !== 'cap'`; else-branch `initialStatus = productType === 'cap' ? 'preparing' : 'pressing'`.
- [ ] configureFullSet itemFlags: sash/robe fallback `'pressing'`; cap fallback `'preparing'`.
- [ ] configurePackage: `pkgStatus = prodId === byType.sash ? 'designing' : prodId === byType.cap ? 'preparing' : 'pressing'`.
- [ ] cartController: `needs_pressing = ci.product_type !== 'cap'`; plain-status branch `status = ci.product_type === 'cap' ? 'preparing' : 'pressing'`.
- [ ] lib/fullSetOrder itemFlags: sash `sashHasDesign ? 'design_complete' : 'pressing'`; robe `robeHasEmb ? 'design_complete' : 'pressing'`; cap unchanged.
- [ ] `isFirstProductionStage` plain branch: `order.status === 'preparing' || order.status === 'pressing'`.
- [ ] `node --check` all touched files. Commit.

### Task 4: productionController — presser visibility + exports

**Files:**
- Modify: `backend/controllers/productionController.js`

- [ ] getOrder: in items mapping, STOP nulling `customer_image_url`/`customer_text` for presserOnly (delete the presser ternary).
- [ ] `canSeeMeasurements = frontDesk || tailorOnly || presserOnly`.
- [ ] Keep all other presser strips (contact/money/delivery/intake event-date-only, canSeeDesign false).
- [ ] Export from module: `loadAdvanceRow`, `performAdvance`, `ADVANCE_LABEL_AR` (hoist the map to module scope), and new `detectZonesWithImages(orderId)` → `[{key,label,has_image}]` (ZONE_DEFS regexes over order_items rows WITH content; has_image = customer_image_url present).
- [ ] `node --check`. Commit.

### Task 5: calligraphyController — order context · zones · send · cap_side

**Files:**
- Modify: `backend/controllers/calligraphyController.js`, `backend/routes/calligraphy.js`

- [ ] Constants: `CAP_SIDE_LABEL='تطريز القبعة من الجانب'`; add to `LABEL_VARIANT`, `VARIANTS`, `ZONE_LABEL`; `wholesalerNames` ALL_LABELS + array_position list. Prompt builders receive `'cap'` when variant is `'cap_side'` (in `processNext` + `reroll`).
- [ ] `attachOrderContext(plates)`: one query `SELECT oi.id AS order_item_id, oi.order_id, oi.label_snapshot, o.status::text AS order_status, u.name AS student_name, p.name_ar AS product_name, p.type AS product_type FROM order_items oi JOIN orders o ... WHERE oi.id = ANY($1)`; merge into plate objects (`order_id`, `order_status`, `zone_label`, `student_name`, `product_name`, `product_type`). Apply in getJob, recentPlates, processNext, reroll, composePlate.
- [ ] `GET /orders-zones?ids=<csv≤100>`: per order → `{ order_id, order_status, zones:[{key,label,has_image}], can_send, send_label, next_stage }` using `detectZonesWithImages` + `nextStageFor` + `ADVANCE_LABEL_AR` from productionController. `can_send = order_status==='design_complete' && next_stage != null`.
- [ ] `POST /orders/:orderId/send`: inline gate (admin OR staff manager/designer — 403 otherwise incl. design_helper); `loadAdvanceRow` → require `status==='design_complete'` && `nextStageFor(row)` non-null (else 409 `ERR_BAD_STATUS` «الطلب ليس بانتظار التصميم») && `canStaffTransition(user, 'design_complete', to)`; `performAdvance(row, req.user)`; respond `{ok:true, order_id, status: to}`.
- [ ] Routes: `router.get('/orders-zones', c.ordersZones); router.post('/orders/:orderId/send', requireDesignerOrAdmin, c.sendOrder);`
- [ ] `node --check` both files. Commit.

### Task 6: lib/calligraphy.ts — types + wrappers

- [ ] `CalVariant` += `"cap_side"`; `VARIANT_LABEL.cap_side = "قبعة — جانب"`; `CalQueue.cap_side`.
- [ ] `CalPlate` += `order_id/order_status/zone_label/student_name/product_name/product_type` (nullable).
- [ ] New: `CalOrderZones` interface + `getOrdersZones(ids: string[])` + `sendCalOrder(orderId: string)`.
- [ ] Commit with Task 9 (compiles only once UI uses it — run tsc at Task 9).

### Task 7: DesignGallery shared component

**Files:** Create `frontend/components/staff/DesignGallery.tsx`

**Interfaces:** `<DesignGallery items={OrderItem[]} finalDesignUrl={string|null} />` — renders null when no images; grid cards (label + image + تنزيل); fullscreen lightbox via `createPortal(document.body)` with Esc/backdrop/✕ (Modal pattern); `resolveImageUrl` for item URLs.

- [ ] Build component. Commit with Task 8.

### Task 8: Staff order page — presser station + gallery in full layout

**Files:** Modify `frontend/app/staff/orders/[orderId]/page.tsx`

- [ ] `isPresserOnly = layout === "presser"` branch (after tailor/embroidery branches): back link → PageHeader(name, status·product) → ProductPhotoCard → DesignGallery → sizes/spec card (tailor's «تفاصيل الطلب» pattern) → قياسات الروب card when measurements → primary advance + revert buttons (from available_actions). NO bio/intake/bundle/batch rows.
- [ ] Full layout: add `<DesignGallery …/>` card («صور التصميم») at top of the design column.
- [ ] `tsc --noEmit` 0 · `eslint` 0. Commit.

### Task 9: CalligraphyTool — grouped grid + sticky bar + send

**Files:** Modify `frontend/components/calligraphy/CalligraphyTool.tsx` (+ lib from Task 6)

- [ ] Group plates by `order_id` (null → trailing «لوحات بدون طلب» group). Group card header: student_name · product_name · status pill · «فتح الطلب» link `/staff/orders/[id]` (hidden for design_helper) · zone chips from `getOrdersZones` (✓/✗ per zone) · send button.
- [ ] Send button: rendered only for admin/staff designer/manager (read `getUser()` role/staff_types); label = backend `send_label`; visible while `can_send`; if any zone `has_image===false` → confirm modal listing missing zones; on success toast + refresh zones/status (pill flips).
- [ ] Sticky bar (`sticky top-0 z-30`): appears when plates exist; collapses the controls card (toggle «توليد المزيد» re-expands); filter chips الكل/غير مربوط/مربوط/جاهز للإرسال + debounced name search; filters hide groups client-side. Batch-load zones for visible order ids (chunked ≤100).
- [ ] Queue panel: 4th `QueueZoneCard` for `cap_side`.
- [ ] `tsc --noEmit` 0 · `eslint` 0. Commit (includes Task 6 files).

### Task 10: Verify end-to-end + deliverables

- [ ] Gates: `node --check` (all BE touched) · `tsc` · `eslint` — 0 errors.
- [ ] Self-cleaning e2e script (scratchpad, controller-level against dev DB): ① plain robe/sash order → status `pressing`; plain cap → `preparing`. ② send endpoint: design_complete order → converting (+audit row), wrong-status → 409, design_helper JWT → 403. ③ orders-zones shape + has_image flips after link. ④ presser getOrder: items keep images/text, measurements present, phone/price absent. Clean up all rows.
- [ ] Mint JWTs via `signToken` for admin + designer + presser + digitizer (real users; find via users table).
- [ ] Write walkthrough (Arabic labels, exact URLs, what to verify per role) in final reply; update `PROGRESS.md` + `HANDOFF.md`. Commit.
