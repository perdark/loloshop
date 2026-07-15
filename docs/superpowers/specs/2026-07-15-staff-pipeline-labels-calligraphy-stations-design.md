# Staff pipeline: labels · calligraphy workbench · station views — Design

**Date:** 2026-07-15 · **Status:** approved in discussion, pending spec review
**Decided with user:** stage-1 label = «بانتظار التصميم»; stage-2 label unchanged; two-button
calligraphy flow (ربط ثم إرسال); plates ARE the design (multiple per order); grouped-grid +
sticky-bar calligraphy layout; الكوي gets a minimal station (name + product photo + sizes +
design + advance); التحويل keeps his page + gains the design gallery; التطريز/التجهيز/التسليم
unchanged; «إرسال للتحويل» is **designers/admin only** (design_helpers excluded).

## 1. Problems (as found in code)

1. `design_complete` renders «اكتمل التصميم» everywhere, but the status means "order received,
   waiting for the designer" — nothing is designed yet. Sources: backend
   `orderController.js STATUS_LABEL_AR` + frontend `lib/constants.ts ORDER_STATUS_LABELS`
   (all UI reads these two; `.next/` + `public/queue-mockups/` hits are build junk).
2. Calligraphy «ربط بالطلب» (`calligraphyController.linkToOrder`) only writes the plate PNG to
   `order_items.customer_image_url`. No status change, no path to push the order onward — the
   designer must find + open each order and advance it there. Plate cards lack student/order
   context; the page is one long column (controls → growing grid) = scrolling pain.
3. الكوي (presser) order view: sash color swatch only, student bio card (جامعة/قسم/نوع دراسة),
   **no design images** (backend nulls `customer_image_url`/`customer_text` on items for
   presser; final-design preview only renders inside the upload widget presser doesn't get).
4. Calligraphy queue covers 3 zones (وشاح أمام/خلف، قبعة أعلى) but «تطريز القبعة من الجانب» is
   a real named line (`lib/fullSetOrder.js:330`) → cap-side names never enter the queue.

## 2. Scope

- **A** — rename stage-1 label to «بانتظار التصميم» (label only, no enum/schema change).
- **B** — calligraphy backend: order context on plates, per-order zone summary, send-to-التحويل
  endpoint, cap-side queue zone.
- **C** — calligraphy UI: grouped-by-order grid, order-level send, sticky compact bar + filters.
- **D** — الكوي minimal station (backend visibility + frontend layout).
- **E** — shared `DesignGallery` component; added to the full order view (التحويل et al.).
- **Not in scope:** التطريز station (verified: zone checkboxes already capped sash≤3 · cap≤2 ·
  robe≤2, content-driven, auto-advance on all-ticked, server-enforced), التجهيز/التسليم views,
  design-team desk approve flow.
- **Migrations:** exactly one, trivial — `065_calligraphy_cap_side.sql`:
  `ALTER TYPE calligraphy_variant ADD VALUE IF NOT EXISTS 'cap_side';` (+ `schema.sql` mirror).
  Safe standalone (the migration never USES the new value; PG allows ADD VALUE in its own file).

## 3. A — Label rename

- `backend/controllers/orderController.js` `STATUS_LABEL_AR.design_complete` → `'بانتظار التصميم'`.
- `frontend/lib/constants.ts` `ORDER_STATUS_LABELS.design_complete` → `'بانتظار التصميم'`.
- Implementation greps the repo for remaining literal «اكتمل التصميم» (excluding `.next/`,
  `android/`, `public/queue-mockups/`) and fixes any straggler. Notifications/queue/TV inherit
  automatically since they read the two constants.

## 4. B — Calligraphy backend

### 4.1 Order context on plates
New helper `attachOrderContext(plates)` in `calligraphyController.js`: batch query over the
distinct `order_item_id`s →

```
order_item_id → { order_id, order_status, zone_label (label_snapshot),
                  student_name, product_name, product_type }
```

Applied in `getJob`, `recentPlates`, `processNext`, `reroll`, `composePlate` responses (one
query per response, `WHERE oi.id = ANY($1)`). Plates with `order_item_id IS NULL` get
`order_id: null` (manual/typed plates).

### 4.2 Per-order zone summary (send-readiness)
New `GET /api/calligraphy/orders/:orderId/zones` → `{ order_id, order_status, zones: [{ key,
label, has_image }] }`, computed from `order_items` rows that carry content, matched with the
same zone regexes as `productionController.ZONE_DEFS` (export `ZONE_DEFS` or a
`detectZonesWithImages(orderId)` helper from productionController — single source, no fork).
`has_image = customer_image_url IS NOT NULL`. Batch variant `GET /orders-zones?ids=a,b,c`
(comma-separated, cap 100) so the grouped grid loads in one round trip.

### 4.3 Send to التحويل
`POST /api/calligraphy/orders/:orderId/send-to-converting`:
- **Gate (stricter than the router-level `allowCalligraphyUser`):** admin, or staff with
  `manager`/`designer` in `staff_types`. `design_helper` → 403 (their path stays: desk upload →
  محمد هيثم approves). Inline middleware on this route only.
- Loads via `productionController.loadAdvanceRow`; requires `status === 'design_complete'` and
  `nextStageFor(row) === 'converting'` (design-bearing legacy orders pending approval return
  null → 409 with a clear Arabic error). Reuses `performAdvance(order, req.user)` — same
  transaction, audit log, notifications, SSE events as the normal advance button. **Export
  `loadAdvanceRow` + `performAdvance` from productionController; no duplicate state machine.**
- Response `{ ok: true, order_id, status: 'converting' }`. Errors: 404 unknown, 409 wrong
  status (`ERR_BAD_STATUS`, «الطلب ليس بانتظار التصميم»), 403 role.
- Zone-completeness warning is **client-side only** (a confirm dialog); the server does not
  block on missing images — designers/admins are trusted, matching the manual advance button.

### 4.4 Cap-side queue zone
- `CAP_SIDE_LABEL = 'تطريز القبعة من الجانب'`; `VARIANTS = ['front','back','cap','cap_side']`;
  `ZONE_LABEL.cap_side`; `LABEL_VARIANT[CAP_SIDE_LABEL] = 'cap_side'`.
- `wholesalerNames` ALL_LABELS + ordering array gain the side label.
- Prompt builders (`buildSheetPrompt`/`buildSinglePrompt`) are called with `'cap'` for
  `cap_side` plates (same name+element style) — no prompt-lib change; DB stores
  `variant='cap_side'` via migration 065 (`calligraphy_variant` enum gains the value).
- Frontend `VARIANT_LABEL` + queue cards gain «القبعة — من الجانب».

## 5. C — Calligraphy UI (grouped grid + sticky bar)

`frontend/components/calligraphy/CalligraphyTool.tsx` (+ `lib/calligraphy.ts` types/wrappers):

1. **Grouping.** Plates render grouped by `order_id`; groups sorted newest-first; plates
   without an order fall into a trailing «لوحات بدون طلب» group. Group header: student name ·
   product name · order-status pill · «فتح الطلب» link to `/staff/orders/[id]`
   (admin/staff only — hidden for `design_helper`, who cannot open staff routes).
2. **Zone chips** per group from the batch zones endpoint: e.g. «الأعلى ✓ · الجانب ✗» (✓ =
   line has an image). Chips refresh after every successful ربط.
3. **Per-plate actions** unchanged: معاينة، إعادة التوليد، تحرير/صورة، تنزيل، ربط بالطلب.
4. **Order-level send button** «إرسال للتحويل / التطريز» in the group header:
   - Rendered only for admin / staff designer / manager (mirror of the server gate).
   - Shown while `order_status === 'design_complete'`; disabled with tooltip otherwise.
   - If any zone has `has_image: false` → confirm modal listing the missing zones
     («مواضع بلا صورة: القبعة — من الجانب. إرسال على أي حال؟»).
   - On success: toast + group pill flips to «قيد التحويل», button becomes a ✓ state.
5. **Sticky compact bar.** Once any plates are on screen, the top controls collapse into a
   sticky bar (`position: sticky; top: 0`): mode label + «توليد المزيد» (re-expands the full
   controls) + filter chips + search. Filters: الكل / غير مربوط / مربوط / جاهز للإرسال
   (= at design_complete with all zones imaged) — filtering hides whole groups/plates
   client-side. Search matches student name or plate text, RTL, debounced.
6. Mobile-first: groups stack, plates 2-up on phone; sticky bar stays one row (chips scroll
   horizontally inside it, no page h-scroll).

## 6. D — الكوي station

**Backend (`productionController.getOrder`):**
- presserOnly: **stop nulling** `customer_image_url`/`customer_text` on items (he needs the
  design images + typed values); `canSeeMeasurements` gains `presserOnly` (robe sizes).
- Unchanged strips: price/money, phone/instagram, delivery PII, intake (event date only),
  design canvas (`can_see_design` stays false — gallery images come from items +
  `final_design_url`, not the Fabric canvas). `view.layout` already returns `'presser'`.

**Frontend (`app/staff/orders/[orderId]/page.tsx`):** new `isPresserOnly` branch (pattern of
the embroidery station): back link → PageHeader (student name · status · product) →
`ProductPhotoCard` → **`DesignGallery`** → sizes/spec card (size selections + spec lines with
text, like the tailor's «تفاصيل الطلب») → قياسات الروب card when measurements exist → primary
advance button («إنهاء الكوي، نقل للتجهيز» from `available_actions`) + revert if allowed.
**No** student-bio card, no batch/rep/source rows, no intake, no bundle.

## 7. E — DesignGallery (shared)

New `frontend/components/staff/DesignGallery.tsx`:
- Props: `items` (order items), `finalDesignUrl?`. Builds entries = every item with
  `customer_image_url` (title = `label_snapshot`) + optional «التصميم النهائي» entry.
  Renders nothing when there are no entries.
- Card grid (2-up phone / 3-up desktop), each: image (object-contain), zone title, «تنزيل».
  Tap → fullscreen lightbox via `createPortal(document.body)` (the Modal/plate-preview
  pattern — Esc/backdrop/✕ close).
- Mounted in: (a) the presser station (§6); (b) the **full layout** as a «صور التصميم» card at
  the top of the design column — التحويل asked for it, and manager/admin/التجهيز benefit; the
  embroidery + tailor stations are NOT changed (user: التطريز is fine).

## 7b. F — المكوجي gets everything except caps (routing)

User (2026-07-15): «المكوجي orders he get everything else the cap, from wholesalers students
or even retail students». Today a plain (no-embroidery) piece enters at `preparing`, skipping
الكوي — only embroidered sash/robe pass through `pressing`. Change:

- **Initial status for plain pieces:** `cap` → `preparing` (unchanged) · every other type
  (sash/robe/shawl) → **`pressing`**. Applied at every order-creation choke point
  (`orderController.configureOrder` / `configureFullSet` / `configurePackage`,
  `cartController` checkout, `lib/fullSetOrder.js persistFullSetOrder` — the same 5 paths that
  set `needs_pressing`). Embroidered/designed pieces keep entering at `design_complete`.
- `needs_pressing` unified to `product_type !== 'cap'` in all 5 paths (today the cart path
  says sash/robe only — a plain shawl would differ per path).
- `productionController.isFirstProductionStage`: a plain piece's first stage is now
  `pressing` OR `preparing` (legacy rows + caps) — keeps «إرجاع للزبون» offered correctly.
- The presser queue (`QUEUE_STAGES.presser = ['pressing']`) then naturally contains every
  non-cap order, retail + wholesaler, plain + embroidered. His advance stays
  «إنهاء الكوي، نقل للتجهيز».
- **Existing in-flight plain orders at `preparing` are NOT migrated** (same decision as the
  2026-06-24 كوي backfill: old orders keep their routing; only new/edited orders get the new
  entry point). Admin can revert an individual order to pressing if needed.

## 8. Error handling

- Send endpoint: Arabic errors with codes (`ERR_BAD_STATUS`, `ERR_FORBIDDEN`, `ERR_NOT_FOUND`);
  UI surfaces via `getApiErrorMessage`, button re-enables on failure.
- Zones endpoint returns `zones: []` for orders with no content lines (send button then skips
  the warning — nothing to check).
- Grouped grid tolerates plates whose order was deleted/cancelled (`order_id` resolves null →
  «لوحات بدون طلب» group; send button absent).

## 9. Verification

- Gates: `node --check` on touched backend files · `tsc --noEmit` 0 · `eslint` 0 errors.
- Backend e2e on the dev DB (self-cleaning, like prior sessions): send endpoint happy path
  (design_complete → converting, audit row written), 409 on wrong status, 403 for a
  design_helper JWT; zones endpoint shape; presser getOrder now returns item images +
  measurements but still no phone/price.
- **No browser testing by Claude** (user instruction). Deliverable instead: minted JWTs
  (via `signToken`) for admin + designer + presser (+ digitizer), and a click-by-click Arabic
  walkthrough: label check on the queue rail → generate/link/send from the calligraphy page →
  open a pressing-stage order as الكوي → confirm gallery + sizes and the absent bio/contact →
  التحويل page shows the gallery → التطريز checkbox caps (sash 3 / cap 2 / robe 2, auto-advance).

## 10. Files touched (expected)

- BE: `controllers/orderController.js` (label) · `controllers/productionController.js`
  (presser visibility, exports) · `controllers/calligraphyController.js` (context, zones,
  send, cap_side) · `routes/calligraphy.js` (2 routes + role gate).
- FE: `lib/constants.ts` (label) · `lib/calligraphy.ts` (types/wrappers) ·
  `components/calligraphy/CalligraphyTool.tsx` (grouped grid, sticky bar, send) ·
  NEW `components/staff/DesignGallery.tsx` · `app/staff/orders/[orderId]/page.tsx`
  (presser branch + gallery in full layout).
- DB: NEW `db/migrations/065_calligraphy_cap_side.sql` + `db/schema.sql` mirror (enum value
  only). Apply to the shared Neon DB before deploy (dev+prod share it).
- No student-facing changes beyond the label (students see «بانتظار التصميم» on their order
  status too — correct there as well).
