# Piece-only delete · admin/مدير الإنتاج order edit + custom order to existing student — design

Date: 2026-07-17 · Approved by owner in-session ("go")

## Problem
1. «حذف الطلب» (staff queue + staff order page → `DELETE /api/production/orders/:id`, and the
   unused admin twin `DELETE /api/admin/orders/:id`) permanently deletes the **entire
   checkout-group bundle** (all linked وشاح/روب/قبعة rows + the group). Owner wants deleting a
   piece to delete **only that piece**.
2. Admin and مدير الإنتاج (staff `manager` type) cannot edit a student's order (e.g. fix يوزر
   الانستا or a color) and cannot place a custom order **for an existing student** — the admin
   custom-order page always creates a fresh name-only student, and is admin-only.

## Decisions (locked with owner)
- Delete = **piece-only** (no whole-bundle delete button remains). Deleting the last piece also
  removes the empty `checkout_groups` row.
- Edit = **both** levels: full طقم edit form (same `FullSetOrderForm` reps use, pre-filled) AND
  per-piece quick edits (spec-line typed text, student info) on the staff order page.
- Custom order page gains **طالب موجود** mode (search existing students) alongside طالب جديد;
  page + endpoints opened to staff managers.

## 1) Piece-only delete
Backend — `productionController.deleteOrder` + `adminController.deleteOrder` (kept in parity):
- Delete ONLY `orders.id = :id` (its `order_items` cascade). Manual
  `staff_activity_log` cleanup stays but scoped to the single id.
- After delete: if the order had `checkout_group_id` and **no sibling orders remain**, delete the
  `checkout_groups` row.
- Audit `delete_order` details gain `{piece_only: true, remaining_order_ids, checkout_group_id}`.
- Publish `order_deleted` for the single id. Gating unchanged (`requireStaffType()` = manager/admin).

Frontend (`app/staff/queue/page.tsx`, `app/staff/orders/[orderId]/page.tsx`):
- Dialog copy: «سيُحذف هذه القطعة فقط نهائياً — بقية قطع الطلب (إن وجدت) تبقى كما هي.»
- Buttons «حذف القطعة» / toast «تم حذف القطعة». Order page still navigates back to the queue after
  deletion.

Accepted edge (inherent to the data model, surfaced in the dialog): the طقم price rides the sash
row (robe/cap price 0), so deleting only the sash removes the bundle's priced row.

## 2) Order edit for admin + مدير الإنتاج
### 2a. Full طقم edit (design-less bundle orders)
- New endpoints in `routes/production.js` (both admin role and manager staff pass
  `requireStaffType()`):
  - `GET /api/production/orders/:id/edit-context` → resolves the order → student; returns
    `readFullSetOrder(studentId)` payload + pricing (`loadWholesalerPricing(student.wholesaler_id)`)
    + student info (name, instagram, group phones) + `can_edit_full_set` flag
    (design_id NULL bundle).
  - `POST /api/production/students/:studentId/full-set-order` → `persistFullSetOrder` with
    **approval-state preservation**: capture the bundle's `wholesaler_approval` BEFORE the save and
    restore it exactly AFTER (`pending`→`pending`, `approved`→`approved` incl. approved_at/by,
    `NULL`→`NULL`). Never let an admin/manager edit flip a visible order back to pending (it would
    vanish from the staff queue) and never let it flip an admin direct order (`NULL`) into the
    approval flow. If no prior bundle exists (create-for-existing): rep-linked student → `approved`
    (actor = admin/manager), independent → `NULL`.
  - Student-info updates ride the same POST: `users.name` + `students.full_name_third` +
    `checkout_groups.customer_name` together for renames; `students.instagram_username` +
    `checkout_groups.instagram_username` together for IG; `checkout_groups.phone_primary/secondary`.
    `users.phone` is NOT editable here (login identity / uniqueness).
- New page `app/staff/orders/[orderId]/edit/page.tsx`: `FullSetOrderForm` pre-filled + student-info
  section. Entry: «تعديل الطلب» button on the staff order detail (admin/manager only, shown when
  backend says `can_edit_full_set`). Audit action `staff_order_edit`.

### 2b. Per-piece quick edit (any order, incl. retail cart)
- `PATCH /api/production/orders/:id/details` (manager/admin):
  `{ items?: [{item_id, customer_text}], student?: {name?, instagram_username?},
     group?: {phone_primary?, phone_secondary?, notes?} }`
  - `items[]` may only touch spec lines belonging to this order that already carry typed content
    (`customer_text IS NOT NULL` or `requires_customer_text` group) — no option/price changes.
  - Same name/IG dual-write rule as 2a. Audit `staff_order_edit` with a field diff.
- Frontend: pencil affordance on the order page spec lines + student info block (admin/manager
  only) → inline input/modal → PATCH → reload.

## 3) Custom order → existing student + manager access
- `adminCustomOrderController.createCustomOrder` accepts `student_id` XOR `student_name`:
  - `student_id`: load student + rep; skip user creation; `persistFullSetOrder` for that student
    (idempotent upsert — if they already own a طقم bundle this edits it). Approval: prior bundle →
    preserve (per 2a rule); fresh bundle → rep-linked `approved`, independent `NULL`.
  - `student_name`: current behavior unchanged.
- New `GET students-search?q=` (name/phone ILIKE, limit ~20) returning id, name, phone, university,
  rep name, `has_full_set` flag — mounted for both admin and staff manager.
- Staff mirrors in `routes/staff.js` (after `requireRole('staff')`, add `requireStaffType()` so only
  managers pass): `GET /custom-order/config`, `POST /custom-order`,
  `POST /custom-order/uploads/image`, `GET /students-search` → same controller fns.
- Frontend: extract the admin custom-order page body into a shared component
  (`components/staff/CustomOrderForm.tsx`) with an API adapter prop; admin page becomes a thin
  wrapper; new `/staff/custom-order` page (manager-guarded client-side); StaffSidebar gains
  «طلب مخصص» for managers. Mode toggle طالب جديد / طالب موجود (search picker).
- Managers see rep pricing config through this — acceptable: managers already see money
  (listOrders/monitor precedent).

## Non-goals
- No editing of priced option selections (size swaps etc.) — spec-line text + student info only.
- No editing of canvas-designed orders via the full form (design_id NOT NULL → per-piece only).
- No change to rep/student-facing forms or the approval workflow itself.
- Known pre-existing edge left alone: `prevGroup` in `fullSetOrder.js` can bind a طقم to a retail
  cart checkout_group (documented 2026-07-17 handoff).

## Verification
- `node --check` on touched backend files · FE `tsc` 0 · `eslint` 0.
- Live self-cleaning e2e on Neon: piece delete (middle piece → siblings + group survive; last piece
  → group gone), edit-context read-back, full-set edit preserves each approval state
  (pending/approved/NULL), per-piece PATCH guards (foreign item id → 400, non-manager staff → 403),
  custom order to existing student (fresh + upsert), students-search.
- No browser test by Claude (owner tests) — walkthrough steps appended to TESTING-WALKTHROUGH.md.
