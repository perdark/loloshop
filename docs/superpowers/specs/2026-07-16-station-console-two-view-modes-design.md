# Station work console: «عرض بالطلب» / «عرض بالقطع» — التطريز · الفصال · الكوي

**Date:** 2026-07-16 · **Status:** approved direction (Approach A), spec pending user review

## 1. Problem

The التطريز (محمد عماد), الفصال (ابو عبدو), and الكوي stations show a flat row per
order/item. A student owns 3–4 pieces (وشاح، روب، قبعة، شال), so the worker faces a
wall of rows and must open each order page to act. Real work happens in two modes the
UI supports badly:

- **طالب طالب** — finish one student's whole order before the next.
- **بالجملة** — enter a rep's دفعة and do all sashes' يمين, then all يسار, then all
  خلف (caps: all جانب then all أعلى); or for الفصال/الكوي, all robes then all sashes.

## 2. Decisions locked with the user (2026-07-16)

1. **التطريز includes the cap** (جانب + أعلى). The **شال امريكي stays excluded** from
   embroidery checklists (already true in `ZONE_DEFS` — keep it that way).
2. **الفصال stays a PARALLEL track** — ticking «تم الفصال» never moves `orders.status`.
3. **الفصال stays retail-only** (wholesaler garments come from الورشة/Team B) and keeps
   excluding caps.
4. **Scope: three stations** — التطريز، الفصال، الكوي. (التجهيز/preparer later, if wanted.)
5. **Approach A**: one shared console component configured per station — not per-page patches.
6. Naming: the mode switch is a view toggle — **«عرض بالطلب»** (grouped by student,
   default) and **«عرض بالقطع»** (flat work items).

## 3. What does NOT change

- The order state machine, `nextStageFor`, STAGE_AUTHZ, auto-advance on
  all-zones-done, and the mandatory-checklist gate for non-manager embroiderers.
- `markEmbroideryZone` semantics (per-zone tick, recompute, auto-advance via the same
  `canStaffTransition` guard).
- The manager/admin production console at `/staff/queue`.
- The order detail page and its per-station projections (`layout=presser`, tailor
  allow-list, embroiderer lean view).
- Tailor track schema (`tailor_status` + done_at/by), retail-only + no-caps filters.

## 4. UX design

One shared component **`components/staff/StationConsole.tsx`**, mobile-first RTL
(iPad primary for التطريز, phone for others), warm brand tokens.

### 4.1 Shared frame (both views)

- Sticky header: search (student name) · source tabs الكل/تجزئة/ممثلين · rep + دفعة
  select (hidden for الفصال — retail-only) · the view toggle
  **[عرض بالطلب | عرض بالقطع]** (segmented control, «عرض بالطلب» default).
- 15s silent polling (`usePolling`), client-side filtering after one queue fetch
  (same pattern as `/staff/queue`).
- Sorting: batch deadline ASC NULLS LAST, then created_at ASC. Overdue dot when past
  the batch deadline.

### 4.2 «عرض بالطلب» — grouped by student

- List rows = **students** (grouped by `student_id`): name · دفعة/تجزئة chip ·
  progress line:
  - التطريز: «N قطع · X/Y مناطق»
  - الفصال/الكوي: «X/Y قطع»
- Tap a student → **full-screen sheet** (portal, like Modal) with his pieces as cards:
  - Piece card header: product name + catalog thumbnail + «التفاصيل» link →
    `/staff/orders/[id]?from=<current path>`.
  - **التطريز:** the piece's zone checklist inline — each zone row shows the zone
    label + the content to stitch (customer_text, and a tappable thumbnail when a
    plate/photo exists) + a large checkbox (≥44px target). Tick calls the existing
    `POST /production/orders/:id/embroidery-zone`. When the last zone ticks, the
    backend auto-advances; the card flips to «انتقلت إلى الكوي ✓» (or التجهيز for caps)
    and greys out.
  - **الفصال:** one big «إكمال الفصال» button per piece (`tailor-complete`); reopen
    affordance on the done tab only (existing behavior).
  - **الكوي:** one big «إكمال الكوي» button per piece = the existing `advance`
    (pressing → preparing). Uses `available_actions`-equivalent guard from the queue
    payload (`can_advance`), never a client-derived rule.
  - A piece at `embroidery` with **0 detected zones** (designed retail sash — canvas
    embroidery) shows a single «إكمال التطريز» button = the manual advance, which the
    backend already allows in exactly this case.
- When every piece is done the sheet shows a completed state and the student row
  leaves the pending list.

### 4.3 «عرض بالقطع» — flat work items

- **التطريز:** chip row = zones with pending counts across the current filter
  (يمين ١٢ · يسار ٩ · خلف ١٤ · أمام · قبعة جانب · قبعة أعلى · ردن أيمن · ردن أيسر —
  only chips with ≥1 pending shown). Selecting a chip lists every piece still needing
  that zone: student name · product · the content to stitch (text + thumbnail) ·
  checkbox. Tap row = tick that zone. «تحديد الكل» + sticky bulk bar
  «إكمال المحدد (N)».
- **الفصال / الكوي:** chip row = piece types present (وشاح/روب/شال — caps never
  appear: tailor excludes them, and caps never reach pressing). Rows = pieces with
  checkbox; sticky bulk bar. This subsumes today's `/staff/tailor` list.
- Rows disappear as they're ticked; a piece whose zones all complete auto-advances
  and drops out of every remaining chip's list. Zone chip counts update live.

### 4.4 Mounting

- **التطريز:** `/staff` home — when the user's staff_types include `embroiderer` as
  the matched queue role, render `StationConsole` (embroiderer config) instead of the
  current flat queue section.
- **الكوي:** same on `/staff` for `presser`.
- **الفصال:** `/staff/tailor` page body replaced by `StationConsole` (tailor config);
  pure-tailor redirect to `/staff/tailor` stays.
- Multi-role staff who match a console role get the console for that role (first
  match in the existing QUEUE_META order); manager/admin may open any station console
  (auto-pass, useful for oversight/testing) but their default home stays `/staff/queue`.

## 5. Backend changes

All additive; no migration (uses existing `embroidery_zones` jsonb + spec lines).

1. **Queue enrichment** — `getQueue` (embroiderer/presser paths) and `tailorQueue`
   gain, per order:
   - `student_id` (grouping key; queue rows already carry `student_name`).
   - `zones: [{key, label, done, text, image_url}]` — **batched**: one
     `order_items` query over all returned order ids (`WHERE order_id = ANY($1)`),
     matched against `ZONE_DEFS` in JS (same content rule as
     `detectEmbroideryZones`; شال امريكي ignored). Zones only for orders at
     `embroidery`; `[]` otherwise. `text`/`image_url` come from the matched spec line
     (first content-bearing match per zone).
   - Presser/tailor rows need no zones — only `student_id` (+ existing fields).
   - Presser rows additionally get `can_advance`, `next_status`, and the edge-keyed
     advance label (derived server-side via `nextStageFor` + `canStaffTransition` +
     `ADVANCE_LABEL_AR`, same as `staffController.wholesalerOrders`) so the «إكمال
     الكوي» button is backend-granted, never client-derived.
   - Embroiderer lean rules hold: no price, no contact, no PII in the enrichment.
2. **Bulk zone tick** — NEW `POST /production/embroidery-zone-bulk`
   `{ items: [{order_id, zone}] }` (cap 200, mirrors `advanceBulk`): per item re-runs
   the exact `markEmbroideryZone` guards (status=embroidery, zone valid for that
   order, scope, authz), writes progress, auto-advances completed orders through
   `performAdvance` + `canStaffTransition`, returns per-item `{ok|reason}` +
   advanced order ids. Single ticks keep using the existing single endpoint.
3. **Reuse as-is:** `tailorComplete`/`tailorCompleteBulk` (فصال), `advance`/
   `advanceBulk` (كوي; the ready→delivered bulk skip is untouched — pressing rows
   never hit it).

## 6. Frontend structure

- NEW `components/staff/StationConsole.tsx` + small pieces
  (`StudentSheet`, `ZoneChecklistRow`, `BulkBar`) under `components/staff/station/`.
- Per-station config object: `{ role, fetchQueue, tick, bulkTick, zoned: boolean,
  showRepFilter: boolean, doneLabel, detailsFromPath }`.
- `lib/staff.ts` wrappers for the new/extended endpoints; types in
  `lib/staff-types.ts` (`zones` on `ProductionQueueItem`, bulk-zone payloads).
- Optimistic tick with rollback on error + the 15s poll as reconciliation.

## 7. Edge cases & errors

- **0-zone embroidery piece** (designed retail sash): single manual «إكمال» (§4.2).
- **Race:** two workers tick the same zone / an order advances mid-tick → backend
  returns the recomputed state or a 409-class Arabic error; the row updates from the
  response, never from assumption (state-machine-single-source rule).
- **Bulk partial failure:** show «تم N · تخطّى M» toast with reasons on tap, matching
  the advanceBulk pattern in the rep console.
- **Empty states:** per view + per chip («لا توجد قطع بانتظار هذه المنطقة») with the
  station's existing empty copy.
- **Auth:** endpoints keep their guards (requireStaffType / canTailor); the console
  never renders actions the payload didn't grant (`can_advance`, zone list presence).

## 8. Verification plan

- Backend: `node --check`; live controller e2e on Neon (self-cleaning) for the bulk
  zone endpoint + queue enrichment (zones match `detectEmbroideryZones` output for
  the same orders; no price/PII fields in embroiderer rows).
- Frontend: `tsc` 0 · `eslint` 0; browser drive as محمد عماد (both views: tick zones
  student-first, then batch-tick a zone across a دفعة, watch auto-advance), as
  ابو عبدو (student grouping + type chips + bulk), presser token for الكوي. Desktop +
  390px mobile, RTL, no console errors.
- Confirm the شال امريكي never appears as a tickable item in any view.

## 9. Out of scope

- التجهيز/preparer console (roll the same component later if wanted).
- Any pipeline/state-machine change; فصال gating; wholesaler فصال.
- Team-B workshop screens; calligraphy workbench.
