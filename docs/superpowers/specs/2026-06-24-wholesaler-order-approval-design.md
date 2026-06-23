# Wholesaler Two-Stage Approval — Design Spec

_Date: 2026-06-24 · Status: **approved, building** · Scope: Project 2 of 2 (the calligraphy batch tool is a SEPARATE, already-shipped spec)._

## 1. Goal

Add a **second approval stage** for wholesaler (ممثل جامعة) orders. Today a wholesaler approves each **student** (stage 1, already built), but the student's **order** flows straight into production. This adds: the rep must also **approve each student's order** before it reaches staff + the admin dashboard. Approved orders surface to the workshop; pending/rejected ones are held.

## 2. Context — what already exists (recon 2026-06-24)

- **Stage 1 (student approval) — DONE.** `students.status student_status('pending_approval','approved','rejected')`; `POST /api/wholesaler/approve/:studentId` + `/reject/:studentId` + `POST /api/wholesaler/students/bulk` (`wholesalerController.setStatus`/`bulkSetStatus`); notifications + audit_log emitted. `getWholesalerId(req.user.id)` resolves the rep. Order creation already guards `student.status === 'approved'`.
- **Orders skip approval.** A wholesaler student's order is a **bundle of 3 linked orders** (sash/robe/cap) sharing one `orders.checkout_group_id`, created by **`backend/lib/fullSetOrder.js persistFullSetOrder`** — the single path used by BOTH the rep-fill (`wholesalerController.createFullSetOrder` → `POST /api/wholesaler/students/:studentId/full-set-order`) and the student self-fill (`orderController` rep-full-set → `POST /api/orders/rep-full-set`). Orders are created directly at `design_complete`/`preparing` (via `itemFlags`), never `pending_approval`.
- **Production state machine** lives ONLY in the backend (`orderController` TRANSITIONS/STAGE_AUTHZ; `productionController`). It must NOT be modified by this feature (state-machine-single-source rule). There is already a precedent for an **orthogonal parallel column**: `orders.tailor_status` (migration 036) — independent of `orders.status`.
- **Surfacing today:** staff production queue = `productionController.getQueue`; staff rep-orders console = `staffController.wholesalerOrders` (`GET /api/staff/wholesalers/:id/orders`); admin orders = `orderController.listOrders` (`GET /api/orders`, `GET /api/admin/orders`, flat + bundle modes); admin dashboard = `adminController` + `app/admin/page.tsx`.
- **Notifications:** `INSERT INTO notifications (user_id, type, title_ar, body_ar, link)` + `eventBus.publish({type,...})` + `audit_log`.

## 3. In scope / out of scope

**In:** orthogonal order-approval column + migration (with backfill); set `pending` at creation; rep approve/reject/bulk endpoints (per-bundle); admin override endpoints; gate staff queue + staff rep-console + admin views; rep approval UI; student `/my-order` state + lock; admin filter/badge/count + override buttons; notifications.

**Out:** retail orders (untouched — `wholesaler_approval` stays NULL); any change to the production state machine / statuses; new production stages; redesigning the existing student-approval (stage 1) UI; gating non-full-set wholesaler orders (assumed not to exist — see §10).

## 4. Architecture — orthogonal approval column (mirrors `tailor_status`)

```
Migration 044: enum wholesaler_approval_status + 4 columns on orders + backfill
  orders.wholesaler_approval = NULL (retail) | 'pending' | 'approved' | 'rejected'
        │
Order creation  lib/fullSetOrder.js persistFullSetOrder → sets 'pending' on all 3 bundle rows (create AND update)
        │
Approval API (per-bundle = checkout_group_id):
  wholesaler: GET /api/wholesaler/orders?approval=…   POST .../orders/:cgid/approve|reject   POST .../orders/bulk
  admin:      POST /api/admin/orders/:cgid/approve|reject   (override, no ownership check)
        │
Gate (visibility):  getQueue · wholesalerOrders · listOrders  →  show only (wholesaler_approval IS NULL OR 'approved')
  except admin listOrders, which can also filter to pending/rejected and shows the state + count.
```

Why orthogonal column (not a new status, not a side table): keeps the production state machine untouched (single-source rule), 1:1 with the order, exactly the proven `tailor_status` pattern. Rejected alternatives: routing through `pending_approval` order_status (invasive, mixes concerns); separate approvals table (needless joins).

## 5. Data model — migration `db/migrations/044_wholesaler_order_approval.sql`

```sql
DO $$ BEGIN
  CREATE TYPE wholesaler_approval_status AS ENUM ('pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS wholesaler_approval     wholesaler_approval_status;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS wholesaler_approved_at  TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS wholesaler_approved_by  UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS wholesaler_reject_reason TEXT;

-- Backfill: grandfather EXISTING wholesaler orders to 'approved' so live work doesn't vanish.
UPDATE orders o SET wholesaler_approval = 'approved'
  FROM students s
 WHERE s.id = o.student_id AND s.wholesaler_id IS NOT NULL AND o.wholesaler_approval IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_wholesaler_approval ON orders(wholesaler_approval);
```

- NULL = retail / not-applicable (always visible). New wholesaler orders → `pending`. Mirror the same `ADD COLUMN IF NOT EXISTS` + enum guard + index into `db/schema.sql` (idempotent). **Apply:** `node migrate.js ../db/migrations/044_wholesaler_order_approval.sql` from `backend/` (NOT `npm run migrate:file`).

## 6. Order creation — set `pending`

In `backend/lib/fullSetOrder.js persistFullSetOrder`, when inserting/updating the 3 bundle orders, set `wholesaler_approval='pending'` on every row (create AND the idempotent re-save/update path). This is the single choke point for both rep-fill and student self-fill, so every wholesaler order is gated. (Retail `configureFullSet` is a different function and is left alone → NULL.)

## 7. Approval API

**Key = `checkout_group_id`** (the bundle). Approve/reject flips all rows sharing that `checkout_group_id`.

**Rep (`routes/wholesaler.js`, `wholesalerController`):**
- `GET /api/wholesaler/orders?approval=pending|approved|rejected|all` — the rep's students' bundles, grouped by `checkout_group_id`: `{ checkout_group_id, student_id, student_name, product_summary, total_price, submitted_at, approval, reject_reason }`. Scoped to `s.wholesaler_id = getWholesalerId(req.user.id)`.
- `POST /api/wholesaler/orders/:checkoutGroupId/approve` — verify the bundle belongs to this rep; `UPDATE orders SET wholesaler_approval='approved', wholesaler_approved_at=NOW(), wholesaler_approved_by=req.user.id, wholesaler_reject_reason=NULL WHERE checkout_group_id=$1 AND student_id IN (rep's students)`; notify student + audit + `publish({type:'order_approved'})`. 404 if not owned/empty.
- `POST /api/wholesaler/orders/:checkoutGroupId/reject` body `{reason}` — set `wholesaler_approval='rejected'`, `wholesaler_reject_reason=reason`; notify student with reason.
- `POST /api/wholesaler/orders/bulk` body `{checkoutGroupIds:[], action:'approve'|'reject', reason?}` — per-bundle re-guard, mirrors `bulkSetStatus`.

**Admin override (`routes/admin.js`, shared controller fn):**
- `POST /api/admin/orders/:checkoutGroupId/approve` and `/reject` — same logic, **no rep-ownership check** (any bundle); notify BOTH the student and the owning rep.

Shared helper does the UPDATE + notify; rep wrappers add the ownership clause, admin wrappers omit it.

## 8. Surfacing (the gate)

- **`productionController.getQueue`** — add `AND (o.wholesaler_approval IS NULL OR o.wholesaler_approval = 'approved')` to the WHERE → pending/rejected never enter any staff stage queue.
- **`staffController.wholesalerOrders`** — same predicate added to its WHERE (staff rep-orders console shows only approved).
- **`orderController.listOrders`** (admin) — add `o.wholesaler_approval` to the SELECT (flat + bundle); accept an `approval` query filter (`pending|approved|rejected|all`, default all); when no filter, show everything with the state available for a badge. Bundle mode exposes the bundle's approval state.
- **Admin dashboard** (`adminController` analytics/accounting or a small new count + `app/admin/page.tsx`) — a «بانتظار موافقة الممثل» pending-bundle count card.

## 9. Frontend

- **Rep `/wholesaler`** — new «الطلبات» view (tab/page): pending/approved/rejected filter, per-student cards (name · product summary · price · submitted time · reject reason if any) with **Approve** / **Reject (reason modal)** + **bulk approve**. Reuse the wholesaler UI conventions + `lib/wholesaler.ts` wrappers.
- **Student `/my-order`** — show the approval state banner: «بانتظار موافقة الممثل» (read-only-ish), «تمت الموافقة — قيد الإنتاج» (**locked**, form read-only), «أعاد الممثل الطلب: <reason>» (editable; saving re-submits → back to `pending`). 
- **Admin** — orders page: `approval` filter + per-order/bundle badge + **Approve/Reject override** buttons; dashboard: pending count.

## 10. Locking & resubmit

- `persistFullSetOrder` sets `wholesaler_approval='pending'` on any save (create or edit) — any content change requires (re)approval.
- **Student self-save** (`POST /api/orders/rep-full-set`): if the student's current bundle is `approved` → **403** «الطلب تمت الموافقة عليه ولا يمكن تعديله» (the lock). If `pending`/`rejected`/none → allowed; the save sets `pending` (resubmit) and notifies the rep.
- **Rep save** on behalf: always allowed; the save sets `pending` (re-approval needed). Rep then approves again.

## 11. Notifications

- Student submits/edits an order (→ pending): notify the **rep** «طلب جديد بانتظار موافقتك من <student>», link to the rep orders view.
- Approve: notify the **student** «تمت الموافقة على طلبك — طلبك الآن قيد الإنتاج».
- Reject: notify the **student** «أعاد الممثل طلبك: <reason> — يرجى التعديل وإعادة الإرسال».
- Admin override approve/reject: notify **both** the student and the owning rep.
- All via the existing `notifications` insert + `eventBus.publish` + `audit_log`.

## 12. Error handling

- Approve/reject a bundle not owned by the rep → 404 `{error:'الطلب غير موجود', code:'ERR_NOT_FOUND'}` (no enumeration).
- Reject with empty reason → 400 `{error:'سبب الإرجاع مطلوب', code:'ERR_VALIDATION'}`.
- Student editing an approved order → 403 (see §10).
- Bulk: per-item re-guard, skip+report items not owned/!pending (mirror `bulkSetStatus`).
- All responses keep `{error:<Arabic>, code:'ERR_*'}`.

## 13. Acceptance tests

1. New wholesaler full-set order (rep-fill AND student-fill) → created with `wholesaler_approval='pending'`; does NOT appear in `getQueue` or `wholesalerOrders`. (Migration backfilled pre-existing wholesaler orders to `approved` — they still appear.)
2. Rep `GET /orders?approval=pending` lists it (one row per bundle). Rep approve → all 3 rows `approved`; now appears in staff queue; student notified.
3. Rep reject `{reason}` → `rejected` + student notified; student edits `/my-order` + saves → back to `pending`; rep re-approves.
4. Student tries to save an `approved` order → 403 locked.
5. Admin sees pending bundles (filter + count); admin override approve works without ownership; both student + rep notified.
6. Retail orders: `wholesaler_approval` stays NULL, always visible to staff/admin — unaffected.
7. Bulk approve N bundles → all flip; non-owned/non-pending skipped + reported.

## 14. Known edge (not handled now)

Wholesaler orders are assumed to be created only via `persistFullSetOrder` (the طقم path; confirmed by recon). If a wholesaler-linked student ever places a plain retail-cart order (different creation path), it would be created with NULL approval and bypass the gate. Out of scope; note for future.
