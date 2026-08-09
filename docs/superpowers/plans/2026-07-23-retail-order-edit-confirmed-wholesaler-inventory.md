# Retail order editing + confirmed wholesaler inventory

**Date:** 2026-07-23  
**Status:** Implemented  
**Scope:** Admin and `manager` staff (“Production Manager”); retail student orders only for the editor; admin-only wholesaler inventory and account explanation.

## 1. Locked business decisions

1. The missing editor is specifically for **independent retail student orders**, not wholesaler orders.
2. Admin and Production Manager may edit a non-cancelled retail order at **any production stage**.
3. Saving option changes must re-run authoritative **retail pricing**. The UI must show the old price, new price, and difference before confirmation.
4. Existing recorded production cost must never be silently erased. The retail selling price and item price snapshots are recalculated; stored cost is preserved unless an existing cost rule supplies a replacement, and generated profit updates automatically.
5. A customer reference image is replaced by uploading another image. The current image remains visible until the replacement upload succeeds.
6. Wholesaler inventory counts only orders where:
   - `wholesaler_approval = 'approved'`
   - `status <> 'cancelled'`
7. The inventory appears inside that wholesaler’s existing **`الطلبات والحساب`** destination:
   `/staff/wholesalers/[wholesalerId]/students`, when opened by Admin. It does not belong
   on the general `/admin/wholesalers` list.
8. The inventory shows four piece totals per wholesaler:
   - Royal sash — `وشاح ملكي`
   - Normal sash — `وشاح عادي`
   - Royal cap — `قبعة ملكية`
   - Normal cap — `قبعة عادية`
9. The account explanation on this page must use the prices saved on each order/item.
   It must not guess from labels or hardcode a current pricing rule.

## 2. Current-state diagnosis

- `productionController.getOrder()` already returns `available_actions.can_edit` for Admin and Production Manager.
- The order page already intends to show `تعديل الطلب`, but pencils only exist for rows with `customer_text`.
- The retail edit page is deliberately limited to student information and text values. It cannot edit:
  - selected catalog options;
  - robe measurements;
  - customer reference images;
  - cap shape/type as a real catalog selection.
- Wholesaler orders already use `FullSetOrderForm`; that flow remains unchanged.
- `priceSelections()` is already the authoritative validator and retail price calculator and should remain the single pricing source.
- The existing wholesaler account explanation is unreliable:
  - it rebuilds categories from `label_snapshot` text;
  - it hardcodes the American-shawl admin share as 20,000 IQD;
  - it assumes other add-ons and single pieces give the representative zero profit;
  - those assumptions can disagree with the wholesaler’s dual admin/selling price snapshots.
- The account totals are currently recomputed from the production list after zone/search/status
  filters. The wholesaler’s account and inventory should remain whole-account totals and must
  not change when Admin filters the work queue.

## 3. User experience

### 3.1 Entry points

- Keep the main `تعديل الطلب` action on every retail order visible to Admin and Production Manager.
- Add an edit-pencil affordance to:
  - the “Order options” section;
  - each reference image;
  - the robe measurements section;
  - cap shape/type.
- Pencils navigate to the full retail editor and focus the relevant section. Dependent selections and pricing should not be changed in isolated text modals.
- Non-manager production staff continue to receive the copy-only action and no edit controls.

### 3.2 Retail editor

The edit page keeps the existing student-information section, then renders a product-aware editor:

- **Robe**
  - all current catalog option groups;
  - shoulder, chest, robe length, sleeve length, and tailor notes;
  - current customer images with `استبدال الصورة`.
- **Cap**
  - cap shape/type as a real single-select catalog option;
  - embroidery/text options;
  - current customer images with replacement upload.
- **Other retail pieces**
  - use the same generic option-group renderer so sash and future product types are not locked out.

The form is pre-filled from the saved order. A sticky save area shows:

- current price;
- recalculated price;
- price difference;
- current production stage;
- a warning that this order is already in production when applicable.

The final confirmation names the changed fields. Saving does not silently cancel or delete the order.

### 3.3 Production-stage behavior

- Editing is allowed for every non-cancelled stage, including ready/delivered.
- Text/image/option/measurement changes are audited with before/after values.
- The current main production status is preserved by default.
- If a change introduces embroidery/design work that the saved route did not previously require, the backend returns an impact flag and the confirmation explicitly states that the piece must return to the design queue. On confirmation, it is routed to `design_complete` so the new work cannot be skipped.
- A robe measurement change reopens the independent tailor track (`tailor_status = 'pending'`) when it had already been completed.
- The order detail refreshes immediately after save through the existing production event channel.

### 3.4 Wholesaler “Orders and Account” page

When Admin enters `الطلبات والحساب` for one wholesaler, the top of the existing Orders tab
becomes a stable account summary with two parts:

1. **`الجرد المؤكد`**
   - Royal sash
   - Normal sash
   - Royal cap
   - Normal cap
2. **`الحساب المؤكد`**
   - total collected from students;
   - total due to administration;
   - representative profit;
   - a clear receipt explaining exactly how the totals were produced.

These summaries always cover all approved, non-cancelled orders for this wholesaler. Zone,
completion, and student-search filters affect only the work list below them.

The explanation uses one row per saved pricing line:

- item;
- quantity;
- amount paid by students;
- administration share;
- representative profit.

The final row shows:

`Representative profit = student total − administration total`

Historical/manual differences appear as an explicit `تسوية / سجل قديم` row. The UI does not
hide or guess the difference.

## 4. Backend plan

### Task 1 — Extend the retail edit context

Update `backend/controllers/orderEditController.js`:

- Extend `GET /api/production/orders/:id/edit-context` with:
  - `mode: 'retail' | 'full_set'`;
  - order `product_id`, `product_type`, `status`, `price`, `cost`, `measurements`, and routing flags;
  - saved selections containing `group_id`, `option_id`, `qty`, `customer_text`, and `customer_image_url`;
  - current image URLs even when no text exists.
- Keep the existing full-set payload unchanged for wholesaler/admin-created bundles.
- Restrict the retail configuration payload to independent retail students and reject cancelled orders.

The frontend can load the current retail catalog configuration with the existing `getProductFull(productId, 'retail')`, avoiding a second catalog implementation.

### Task 2 — Add an atomic retail configuration endpoint

Add:

`PUT /api/production/orders/:id/retail-configuration`

behind the existing `requireStaffType()` manager/admin guard.

The endpoint must:

1. Load and lock the order.
2. Confirm it belongs to an independent retail student.
3. Keep `product_id` and `design_id` immutable.
4. Validate robe measurements using the same rules as retail checkout.
5. Validate selected options and required text/images by calling:
   `priceSelections({ productId, role: 'retail', selections, studentGender })`.
6. Calculate routing impact before writing.
7. In one transaction:
   - update `orders.price`;
   - preserve the existing recorded `orders.cost`;
   - update measurements and routing flags;
   - replace the order’s catalog `order_items` with the newly priced snapshots;
   - preserve the existing production status unless the confirmed routing rule requires design/tailor rework;
   - insert a detailed `staff_order_edit` audit record.
8. Publish the existing `order` event after commit.

The response returns old/new price, profit, resulting stage, and the saved normalized configuration.

### Task 3 — Share validation instead of copying it

- Extract the robe measurement validator currently embedded in `configureOrder()` into a small shared helper.
- Continue exporting/reusing `priceSelections()` as the only option and price validator.
- Do not trust labels, prices, product IDs, image requirement flags, or option ownership from the browser.
- Reject inactive, cross-product, inherited-group-invalid, or gender-incompatible options.

### Task 4 — Image replacement

- Reuse `POST /api/production/uploads/image` and its current size/type validation.
- Accept either the unchanged existing image URL or a newly returned upload URL.
- Never clear a required image unless a valid replacement is present.
- Keep the old stored file for audit/recovery in this pass; orphan-file cleanup is separate maintenance work.

## 5. Frontend plan

### Task 5 — Expand client contracts

Update:

- `frontend/lib/staff.ts`
- `frontend/lib/staff-types.ts`

Add typed retail edit context, normalized selections, price-impact response, and `saveRetailOrderConfiguration()`.

### Task 6 — Build the retail editor

Update `frontend/app/staff/orders/[orderId]/edit/page.tsx`:

- Replace the current retail text-only branch with a product-aware editor.
- Reuse:
  - `OptionGroupField`;
  - `CustomerImageUpload`;
  - the existing robe measurement controls/validation patterns;
  - `getProductFull(productId, 'retail')`;
  - existing price-breakdown utilities.
- Seed every control from saved `order_items`.
- Keep the existing student information and quick text-edit support.
- Disable save during upload/submission and prevent duplicate submissions.
- Show loading skeleton, retry state, upload error, validation error, price-change confirmation, and success feedback.

### Task 7 — Make editing discoverable

Update `frontend/app/staff/orders/[orderId]/page.tsx`:

- Ensure Admin and Production Manager always receive the main edit action for retail orders.
- Add labeled pencil buttons to options, images, cap shape, and measurements.
- Do not show a pencil that opens a text modal for a structured option; link to the corresponding full-editor section instead.
- Keep 44px targets, Arabic RTL labels, keyboard focus, and accessible `aria-label` text.

## 6. Confirmed wholesaler inventory and account explanation

### Task 8 — Return a stable account summary from the dedicated wholesaler endpoint

Extend `backend/controllers/staffController.js::wholesalerOrders()` so the **Admin route**
`GET /api/admin/wholesalers/:id/orders` returns the existing `data` list plus:

```json
{
  "data": [],
  "summary": {
    "scope": "approved_non_cancelled",
    "confirmed_inventory": {
      "sash_royal": 0,
      "sash_normal": 0,
      "cap_royal": 0,
      "cap_normal": 0
    },
    "money": {
      "student_total": 0,
      "admin_total": 0,
      "representative_profit": 0,
      "lines": [
        {
          "label": "طقم كامل",
          "qty": 1,
          "student_amount": 0,
          "admin_amount": 0,
          "representative_profit": 0,
          "kind": "saved"
        }
      ]
    }
  }
}
```

The `summary` query is independent of the optional production `zone` filter.

Inventory aggregation rules:

- count `orders` rows as pieces;
- join through `students.wholesaler_id`;
- include approved, non-cancelled orders only;
- classify by `products.type`;
- derive Royal/Normal from the saved type selection/snapshot, not the wholesaler’s current pricing settings;
- support both the structured full-set rows and older catalog-option rows;
- treat a genuinely missing legacy type as Normal only when no Royal indicator exists.

Account explanation rules:

- use `order_items.price_snapshot` for what students paid;
- use `order_items.admin_price_snapshot` for the administration share;
- compute each line’s representative profit as their difference;
- group only identical saved labels and price roles;
- reconcile line totals against `orders.price` and `orders.cost`;
- emit an explicit adjustment/history line for any difference;
- never read the wholesaler’s current price configuration to explain an old order;
- never hardcode the shawl price or assume that an add-on has zero representative profit.

Factor the existing order-money calculation into a shared backend helper so the admin order
page and wholesaler account page use the same arithmetic and reconciliation rules.

### Task 9 — Replace the current account explanation and add inventory in `الطلبات والحساب`

Update:

- `frontend/lib/staff.ts`
- `frontend/app/admin/wholesalers/page.tsx`
- `frontend/app/staff/wholesalers/[wholesalerId]/students/page.tsx`
- `frontend/components/admin/CalculationDetails.tsx` only if the shared receipt presentation
  can be reused without changing unrelated screens.

Keep the existing `/admin/wholesalers` action label `الطلبات والحساب`; do not place the four
counts in the general wholesaler cards.

Inside the selected wholesaler’s Orders tab:

- add `الجرد المؤكد` above the work filters;
- use a 4-column row on laptop and a 2×2 layout on narrow screens;
- label these as piece counts, not students or bundles;
- show all four zeroes for an empty confirmed inventory;
- show a concise `الحساب المؤكد` equation;
- replace the current hardcoded `MoneyBreakdown` reconstruction with the server-provided
  saved-snapshot receipt;
- keep the details readable in Arabic RTL without requiring horizontal scrolling on phone
  (stack each receipt row on narrow screens; use a table on laptop).

The account and inventory summary remains unchanged while Admin uses zone, completion, or
student-name filters on the production list below.

## 7. Audit and safety

Every retail save records:

- actor and role;
- order/student/product IDs;
- production stage before/after;
- measurements before/after;
- selected option IDs before/after;
- image URLs before/after;
- price and profit before/after;
- whether design or tailor rework was triggered.

The transaction must be all-or-nothing. A failed image, option, measurement, or pricing validation leaves the original order untouched.

## 8. Verification

### Backend tests

- Admin can edit a retail robe and Production Manager can edit a retail cap.
- A non-manager staff member receives `403`.
- Wholesaler orders cannot enter the retail endpoint.
- Foreign/inactive option IDs are rejected.
- Required image/text rules still apply.
- Robe measurement validation matches checkout.
- A replacement image is saved and returned.
- Price and item snapshots are recalculated with retail pricing.
- Existing recorded cost is not erased and profit changes correctly.
- A failed request rolls back all fields and order items.
- Edits work in early, in-production, ready, and delivered states.
- New embroidery work triggers the confirmed safe route.
- Measurement changes reopen completed tailor work.
- Audit details contain the full field diff.
- Inventory includes approved/non-cancelled pieces and excludes pending, rejected, and cancelled pieces.
- Royal/Normal classification works for structured and legacy rows without double-counting.
- Account totals and inventory are unaffected by zone/search/completion filters.
- Every receipt line uses saved student/admin snapshots.
- Configuring new prices for the wholesaler does not rewrite the explanation of old orders.
- A historical/manual mismatch appears as an explicit adjustment row and all columns reconcile.
- No shawl price or zero-profit add-on assumption is hardcoded.

### Frontend checks

- Main edit action and pencils appear for Admin and Production Manager on retail orders.
- They do not appear for other staff roles.
- Existing options, measurements, and images pre-fill correctly.
- Cap shape is editable as a selection.
- Image replacement previews before save.
- Price difference and production warning are shown before confirmation.
- Arabic RTL layout works on laptop, iPad, and phone widths.
- The selected wholesaler’s `الطلبات والحساب` page renders four correct confirmed totals,
  including the all-zero state.
- The general wholesaler list does not display the inventory.
- The saved-snapshot receipt clearly reconciles student total, administration share, and
  representative profit.

### Commands

- Backend targeted tests and `node --check` for changed controllers/routes.
- Frontend lint/typecheck/build.
- Browser verification with Admin, Production Manager, and ordinary staff accounts.

## 9. Acceptance criteria

1. Admin and Production Manager can fully edit options, measurements, cap shape, text, and customer images on an independent retail order.
2. The saved price always matches current authoritative retail pricing.
3. Editing never silently clears recorded cost or corrupts profit.
4. Editing remains possible after production starts, with explicit impact warning and audit history.
5. Required design/tailor work cannot be skipped after a manufacturing-affecting edit.
6. Every relevant field on the order detail has a discoverable edit affordance.
7. Admin sees confirmed-only Royal/Normal sash and cap totals inside each wholesaler’s
   `الطلبات والحساب` page.
8. The account explanation contains no hardcoded price assumptions and reconciles exactly
   to saved student price, administration share, and representative profit.

## 10. Out of scope

- Replacing the existing wholesaler full-set editor.
- Letting wholesalers or retail students use this privileged staff endpoint.
- Changing product identity on an existing order.
- Editing cancelled orders.
- Deleting old uploaded files immediately after image replacement.
- Building warehouse stock movements, purchases, or physical on-hand inventory; this “inventory” is an approved-order piece summary.
- Showing the inventory on the general wholesaler list.
