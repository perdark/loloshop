# Piece-only Delete + Admin/Manager Order Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** حذف deletes a single piece (not the whole bundle); admin + مدير الإنتاج can fully edit a student's طقم order, quick-edit spec lines/IG on any order, and place a custom order for an existing student.

**Architecture:** Delete becomes single-row (+empty-group cleanup) in both delete endpoints. All edit/create paths reuse `persistFullSetOrder`/`readFullSetOrder` (single source of truth) behind a new `orderEditController` mounted in `routes/production.js` (admin role + `manager` staff both pass `requireStaffType()`); approval state is captured before the save and restored after, so an admin edit never flips a bundle back to `pending`. Custom-order controller gains `student_id` mode and staff-manager mirror routes.

**Tech Stack:** Express 5 · pg (Neon) · Next.js 16 / React 19 / Tailwind v4 · JWT roles (`admin`, staff `manager` via `requireStaffType()`).

## Global Constraints

- Error shape: `{ error: <Arabic msg>, code: 'ERR_*' }`. Arabic UI copy, RTL.
- Order-status state machine lives ONLY in the backend; never touch `orders.status` outside existing paths.
- No schema migration needed (verified: no new columns).
- Repo carries unrelated uncommitted cross-session work on main → **code stays uncommitted** (docs-only commits), matching the 2026-07-17 money-session precedent. Final state documented in HANDOFF.md.
- Verification: `node --check` per backend file · FE `tsc` 0 · `eslint` 0 · live self-cleaning HTTP e2e on Neon (backend restarted: plain `node server.js` on :4000). No browser test by Claude (owner tests; steps go to TESTING-WALKTHROUGH.md, untracked).
- Full-set-edit eligibility discriminator (safety: never re-price retail bundles): order `design_id IS NULL` AND (student is wholesaler-linked OR the student's user has `phone IS NULL` — i.e. an admin-created name-only student). Self-registered retail students are excluded from the full form (per-piece quick edit still applies).

---

### Task 1: Backend piece-only delete

**Files:**
- Modify: `backend/controllers/productionController.js:1456-1482` (deleteOrder)
- Modify: `backend/controllers/adminController.js:778-804` (deleteOrder)

**Interfaces:**
- Produces: `DELETE /api/production/orders/:id` and `DELETE /api/admin/orders/:id` now return `{ data: { deleted: 1, remaining: <n>, checkout_group_deleted: <bool> } }`.

- [ ] Rewrite `productionController.deleteOrder` body: single-row delete; siblings query AFTER delete; delete `checkout_groups` row only when 0 siblings remain; audit details `{piece_only:true, remaining_order_ids, checkout_group_id, student_id, source:'staff_workspace'}`; publish one `order_deleted`.

```js
// Permanent PIECE deletion from the staff workspace. Managers/admin only.
// Deletes ONLY the given order row (its order_items cascade); sibling pieces of the
// bundle survive. The empty checkout_group is removed when the last piece goes.
async function deleteOrder(req, res) {
  const id = String(req.params.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'طلب غير صحيح', code: 'ERR_VALIDATION' });
  const result = await tx(async (client) => {
    const found = await client.query(`SELECT id,checkout_group_id,student_id FROM orders WHERE id=$1 FOR UPDATE`, [id]);
    if (!found.rows.length) return null;
    const order = found.rows[0];
    await client.query(`DELETE FROM staff_activity_log WHERE order_id=$1`, [id]);
    await client.query(`DELETE FROM orders WHERE id=$1`, [id]);
    let remaining = [];
    let groupDeleted = false;
    if (order.checkout_group_id) {
      const sib = await client.query(`SELECT id FROM orders WHERE checkout_group_id=$1`, [order.checkout_group_id]);
      remaining = sib.rows.map((r) => r.id);
      if (!remaining.length) {
        await client.query(`DELETE FROM checkout_groups WHERE id=$1`, [order.checkout_group_id]);
        groupDeleted = true;
      }
    }
    await client.query(
      `INSERT INTO audit_log(actor_id,action,entity,entity_id,details) VALUES($1,'delete_order','order',$2,$3)`,
      [req.user.id, order.id, JSON.stringify({ piece_only: true, remaining_order_ids: remaining, checkout_group_id: order.checkout_group_id, student_id: order.student_id, source: 'staff_workspace' })]
    );
    return { remaining, groupDeleted };
  });
  if (!result) return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  publish({ type: 'order_deleted', orderId: id });
  res.json({ data: { deleted: 1, remaining: result.remaining.length, checkout_group_deleted: result.groupDeleted } });
}
```

- [ ] Same rewrite in `adminController.deleteOrder` (no `publish` there today — keep parity with its current imports; `source` omitted).
- [ ] `node --check` both files.

### Task 2: Frontend delete copy → قطعة

**Files:**
- Modify: `frontend/app/staff/queue/page.tsx:739-745` + row buttons `443`/`568`
- Modify: `frontend/app/staff/orders/[orderId]/page.tsx` (both delete modals ~1182-1196 and ~2003-2016, buttons 1158/1439/1936, toast ~712)

- [ ] Queue: confirm text → `"سيُحذف هذه القطعة فقط نهائياً — بقية قطع الطلب (إن وجدت) تبقى كما هي. هل أنت متأكد؟"`; success toast → `` `تم حذف القطعة` `` (drop the count); row/card button labels «حذف» stay (small), card button «حذف الطلب» → «حذف القطعة».
- [ ] Order page: modal title «حذف القطعة نهائياً», body «سيُحذف هذه القطعة فقط (وشاح أو روب أو قبعة) نهائياً ولا يمكن التراجع — بقية قطع الطلب تبقى. هل أنت متأكد؟», buttons «حذف القطعة», toast «تم حذف القطعة نهائياً». Navigation after delete unchanged (back to queue).
- [ ] `lib/staff.ts` `deleteProductionOrder` return shape: keep `Promise<number>` reading `data.deleted` (still valid).

### Task 3: New `orderEditController` + production routes

**Files:**
- Create: `backend/controllers/orderEditController.js`
- Modify: `backend/routes/production.js` (mount 4 routes, all `requireStaffType()`)

**Interfaces (produces):**
- `GET /api/production/orders/:id/edit-context` → `{ data: { student: {id,name,phone,instagram_username,university_name,department,wholesaler_id,rep_name}, group: {id,phone_primary,phone_secondary,notes}|null, existing: FullSetExistingOrder|null, pricing: {base, addons}, can_edit_full_set } }`
- `POST /api/production/students/:studentId/full-set-order` body = `CreateFullSetPayload & { student_info?: {name?, instagram_username?, phone_primary?, phone_secondary?} }` → persist + approval restore + info writes → same 201 shape as persist.
- `PATCH /api/production/orders/:id/details` body = `{ items?: [{item_id, customer_text}], student?: {name?, instagram_username?}, group?: {phone_primary?, phone_secondary?, notes?} }` → `{ data: { ok: true } }`
- `GET /api/production/students-search?q=` → `{ data: [{id,name,phone,university_name,rep_name,wholesaler_id,has_full_set}] }` (limit 20)

Key logic (complete in controller):
- `loadStudent(studentId)`: students JOIN users JOIN wholesalers(u2) → id, name, phone, instagram_username, university_name, department, wholesaler_id, rep_name.
- `eligibleForFullSet(student)` = `student.wholesaler_id != null || student.phone == null`.
- `captureApproval(studentId)`: latest non-cancelled design-less row → `{exists, state, at, by, reason}`.
- `restoreApproval(client-less, cgId, cap, {isRepLinked, actorUserId})`:
  - no prior bundle → target = isRepLinked ? approved(now, actor) : NULL
  - prior → restore exact state (`approved` restores at/by; `rejected` restores reason; `NULL` nulls all; `pending` = no-op since persist already set it).
- POST flow: load student → 404; eligibility → 403 `ERR_FORBIDDEN` «لا يمكن تعديل هذا الطلب من هنا»; apply `student_info.name` (users.name + students.full_name_third) and IG (students) BEFORE persist; persist with `student.name/phone` (phone stays users.phone; name-only students pass `phone:''`); restoreApproval; then group UPDATE for instagram_username/phone_primary(if provided)/phone_secondary; audit `staff_order_edit`.
- PATCH flow: load order (+student). Items guard: each `item_id` must belong to this order AND already have `customer_text IS NOT NULL` (typed content lines only — no option/price mutation), new text `clean(...,200)` required non-empty → else 400. Student/group writes same dual-write rules. Audit `staff_order_edit` with changed fields.
- students-search: `q` min 2 chars → ILIKE over u.name, u.phone, s.full_name_third; LEFT JOIN wholesalers/users for rep_name; `has_full_set` = EXISTS design-less non-cancelled order.

- [ ] Write controller; mount routes AFTER `router.delete('/orders/:id', ...)` in production.js:

```js
// Admin/مدير الإنتاج order editing (full طقم re-save + per-piece quick edits) — manager/admin only.
const edit = require('../controllers/orderEditController');
router.get('/students-search', requireStaffType(), edit.studentsSearch);
router.get('/orders/:id/edit-context', requireStaffType(), edit.editContext);
router.post('/students/:studentId/full-set-order', requireStaffType(), edit.saveFullSetOrder);
router.patch('/orders/:id/details', requireStaffType(), edit.patchOrderDetails);
```

- [ ] `productionController.getOrder`: `available_actions` gains `can_edit: isManager(u)` and `can_edit_full_set` (isManager && !order.design_id && eligibility query). `node --check`.

### Task 4: Custom order → existing student + staff manager mirrors

**Files:**
- Modify: `backend/controllers/adminCustomOrderController.js` (accept `student_id`)
- Modify: `backend/routes/staff.js` (manager mirrors)
- Modify: `backend/routes/admin.js` (students-search alias under /custom-order)

- [ ] `createCustomOrder`: if `req.body.student_id` → load existing student (via orderEditController.loadStudent, exported); skip user creation + cleanup; capture approval before persist, restore after (same helper, exported from orderEditController); audit `admin_custom_order_create` with `{existing_student:true}`. Else current name-only path unchanged.
- [ ] `routes/staff.js` additions (managers only — `requireStaffType()` after the existing `requireRole('staff')`):

```js
const { requireStaffType } = require('../middleware/auth');
const customOrders = require('../controllers/adminCustomOrderController');
const { imageUpload } = require('../lib/upload');
const edit = require('../controllers/orderEditController');
router.get('/custom-order/config', requireStaffType(), customOrders.customOrderConfig);
router.post('/custom-order', requireStaffType(), customOrders.createCustomOrder);
router.post('/custom-order/uploads/image', requireStaffType(), imageUpload.single('file'), customOrders.uploadImage);
router.get('/custom-order/students-search', requireStaffType(), edit.studentsSearch);
```

- [ ] `routes/admin.js`: `router.get('/custom-order/students-search', edit.studentsSearch);`
- [ ] `node --check` all touched.

### Task 5: FE lib wrappers

**Files:**
- Modify: `frontend/lib/staff.ts` (+types in `frontend/lib/staff-types.ts` if needed)
- Modify: `frontend/lib/admin.ts`

- [ ] `lib/staff.ts`: `getOrderEditContext(orderId)`, `saveStudentFullSetOrder(studentId, payload)`, `patchOrderDetails(orderId, body)`, `searchStudents(q, base: 'production')`, staff custom-order fns (`getStaffCustomOrderConfig`, `createStaffCustomOrder`, `uploadStaffCustomOrderImage`) hitting `/staff/custom-order/*`. Reuse `FullSetExistingOrder`/`FullSetPricing`/`CreateFullSetPayload` types from `lib/wholesaler.ts`.
- [ ] `lib/admin.ts`: `AdminCustomOrderPayload` gains `student_id?: string | null`; add `searchCustomOrderStudents(q)` → `/admin/custom-order/students-search`.
- [ ] `available_actions` type gains `can_edit` / `can_edit_full_set` (in `lib/staff-types.ts`).

### Task 6: Shared CustomOrderForm + /staff/custom-order

**Files:**
- Create: `frontend/components/staff/CustomOrderForm.tsx` (extracted from admin page body)
- Modify: `frontend/app/admin/custom-order/page.tsx` (thin wrapper)
- Create: `frontend/app/staff/custom-order/page.tsx` (manager-guarded wrapper)
- Modify: `frontend/components/staff/StaffSidebar.tsx` («طلب مخصص» for managers)

- [ ] Shared component props: `{ config, submitting, onSubmit(payload), onUploadImage, onSearchStudents }`. Adds mode toggle «طالب جديد» / «طالب موجود»: existing mode = debounced search input → result rows (name·rep·university·«لديه طقم» chip) → picked card; submit sends `{student_id}` instead of `{student_name, wholesaler_id}`. Pricing for a picked rep-linked student = their rep's entry in `config.wholesalers`, else `config.pricing`.
- [ ] Admin page wrapper keeps its API fns; staff page uses the `/staff` fns + `useRequireAuth` guard to manager staff (`staff_types`/`staff_type` includes `manager`; else «غير مصرّح» EmptyState).
- [ ] StaffSidebar: link `/staff/custom-order` visible when manager.

### Task 7: FE edit page + order-page affordances

**Files:**
- Create: `frontend/app/staff/orders/[orderId]/edit/page.tsx`
- Modify: `frontend/app/staff/orders/[orderId]/page.tsx` (full/default layout only)

- [ ] Edit page: load `getOrderEditContext(orderId)` → header (student name), student-info section (الاسم، يوزر الانستا، هاتف أول/ثاني — controlled inputs seeded from context), `FullSetOrderForm(initial=existing, pricing)` → submit `saveStudentFullSetOrder(student.id, {...payload, student_info})` → toast + `router.push` back to the order. `can_edit_full_set=false` → EmptyState «لا يمكن تعديل هذا الطلب من هنا (طلب تجزئة)».
- [ ] Order page (manager/admin full view): «تعديل الطلب» Link → `/staff/orders/${id}/edit` shown when `available_actions.can_edit_full_set`; quick-edit (✎) on each spec line with `customer_text` + on يوزر الانستا when `available_actions.can_edit` → small Modal (Input, 200 max) → `patchOrderDetails` → reload; keep station layouts untouched.
- [ ] Gates: `tsc` 0 · `eslint` 0.

### Task 8: Live e2e on Neon (self-cleaning) + walkthrough

- [ ] Restart backend (`node server.js`, :4000). Script in scratchpad (signed JWTs via `signToken` for admin + a manager staff + a non-manager staff): throwaway rep+students; assert: piece delete keeps siblings+group (remaining=2), last delete removes group; edit-context shape; saveFullSet preserves approval for each prior state (NULL / approved / pending) + writes IG/name; PATCH guards (foreign item 400, non-manager 403, empty text 400) + applies text/IG; students-search finds by name+phone; custom order `student_id` mode (fresh student = create, second call = upsert not duplicate); staff-manager token passes `/staff/custom-order/config`, non-manager staff 403. Clean every row created.
- [ ] Append click-steps to `TESTING-WALKTHROUGH.md` (untracked).

### Task 9: Docs

- [ ] Update `PROGRESS.md` + prepend `HANDOFF.md` entry (what/why/how/verified/follow-ups). Code left uncommitted (rides next deploy push); commit docs? No — HANDOFF/PROGRESS ride the code commit later; leave uncommitted with the code.
