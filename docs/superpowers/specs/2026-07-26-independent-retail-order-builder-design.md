# «طلب مستقل بدون ممثل» → a real retail order builder

**Date:** 2026-07-26
**Status:** approved (owner, 2026-07-26)
**Scope:** admin + مدير الإنتاج «طلب مخصص» — the independent (no-rep) path only.

---

## 1. The report

> «still طلب مستقل بدون ممثل is not enough and bad, i want it like all informations of
> students and all products for retail students.»

Measured on the dev snapshot, «طالب جديد» + «طلب مستقل بدون ممثل» today:

- collects **one field** — اسم الطالب;
- renders `FullSetOrderForm`, the **rep** طقم model: piece-type toggles (وشاح/قبعة/روب),
  «نوع الوشاح عادي/ملكي», «شال نعم/لا», «تطريز أمام/خلف»;
- prices from `loadWholesalerPricing(null)` — the **default rep addon table**, not the retail
  catalog.

A retail student ordering the same وشاح ملكي on the storefront gets 5 catalog option groups
(اللون · لون التطريز · تطريز يسار · تطريز يمين · تطريز من الخلف), each with an optional
reference photo, priced from `product_price_roles(role='retail')`. The admin cannot reproduce
that order from the inside.

## 2. The finding that shapes the design

**The problem is the identity, not the form.**

`createCustomOrder` creates the independent student with `users.phone = NULL` and
`students.gender = NULL`. The eligibility predicate is

```js
const eligibleForFullSet = (s) => !!s && (s.wholesaler_id != null || s.phone == null);
```

so a name-only student is **permanently a طقم student**:

| path | routing for a name-only student |
|---|---|
| `editContext` | `edit_mode = 'full_set'` → the طقم editor |
| `saveRetailConfiguration` | **403** — «هذا المسار للطلبات المفردة فقط» |
| `students-search` | `full_set_eligible = true` → the طقم form |

So building a retail creation form alone would produce retail-priced orders that the **طقم
editor re-prices rep-style on the next edit** — the `project_order_write_paths_sync` money-bug
class (2026-07-16, +2.6M IQD phantom revenue).

The fix must give the independent student a **real تجزئة identity**, so one write path owns
them for life.

## 3. Design

### 3a. Identity

«مستقل بدون ممثل» now creates a genuine self-registered-shaped retail student.

**Required:** الاسم · رقم الهاتف · الجنس

- **phone** — flips `eligibleForFullSet` to `false`. Create, edit, swap and search then all
  route through the retail path. This is the load-bearing field: without it the order falls
  back into the طقم editor.
- **gender** — `groupVisibleForGender` hides gender-restricted groups and `priceSelections`
  **rejects** a gender-restricted option when `studentGender` is null. A null-gender student
  cannot be priced correctly.

**Optional:** انستغرام · الجامعة · القسم · نوع الدراسة · هاتف ثانٍ · المحافظة · أقرب نقطة دالة ·
تاريخ الحفلة · ملاحظات.

Phone is normalised with the existing `normalizeIqPhone` and validated with `isValidIqMobile`
(`backend/lib/otp.js`) — the same canonical form auth uses, so the number matches if the student
later logs in.

`users.phone` is `TEXT UNIQUE`. A number already in use returns **409 `ERR_PHONE_TAKEN`**
naming the existing student and carrying their `student_id`, so the admin switches to «طالب
موجود» instead of creating a duplicate person. The endpoint never silently attaches to an
existing account — that would let an admin bind an order to the wrong human.

*Accepted consequence:* the student now has a real account with a random password. Retail is in
the phone-OTP reset allow-list, so they can recover and see their own order. If they later try
to self-register on that number they are told it exists and should log in.

### 3b. One retail builder, two entry points

`RetailSingleOrderForm` grows into **`RetailOrderBuilder`**; the single-piece case is just
`pieces.length === 1`.

- «القطع المطلوبة» — a list of piece cards + «أضف قطعة».
- Adding a piece opens the product picker over **all four families** from `getShopFeed()` — the
  same retail catalog, at the same retail prices, the storefront serves (admin and staff resolve
  to the `retail` price role in `priceRoleForUser`).
- Each piece renders the shared **`RetailPieceOptions`** — byte-identical to the storefront's
  option groups — plus `RobeMeasurementFields` for a robe.
- A piece card shows name · price · its filled options, with ✎ (expand) and ✕ (remove).
- **One** «بيانات التسليم» section and **one** price breakdown for the whole order.

Used by both «طالب جديد + مستقل» (student fields editable) and «طالب موجود + تجزئة» (student
prefilled). One component is what keeps the two retail surfaces from drifting.

Products the student already holds a live design-less piece of are **excluded from the picker**,
the same rule `swapCandidates` already applies — the picker must never offer a target that
`uq_orders_student_product_nodesign` would then refuse.

### 3c. Backend — one endpoint, one transaction

`POST /api/production/retail-orders`, mounted behind `requireStaffType()` so admin **and** مدير
الإنتاج both reach it (one endpoint serves both pages).

```
{ student:    { name, phone, gender, instagram?, university_name?, department?, study_type? }
  | student_id: uuid,
  pieces:     [ { product_id, selections[], measurements? } ],   // 1..10
  group:      { phone_primary?, phone_secondary?, governorate?,
                area_details?, event_date?, notes? } }
```

Rules, all enforced server-side against the DB and never from the client payload:

1. **Retail pricing only** — every piece goes through `priceSelections({ role: 'retail' })`, the
   same function the storefront uses. The rep addon table is never consulted.
2. **One bundle** — a single new `checkout_groups` row; one `orders` row per piece pointing at
   it. The student's existing orders are never read, re-priced, cancelled or re-bound.
3. **`wholesaler_approval = NULL`** — a direct admin order never enters the rep approval flow.
4. **Per-piece routing**, copied from the retail creation path: `has_embroidery` →
   `design_complete`; plain cap → `preparing`; plain anything else → `pressing`;
   `needs_pressing = type !== 'cap'`.
5. **Duplicate guard per piece** — `liveOrderForProduct` pre-check → 409 `ERR_DUPLICATE_PIECE`
   naming the existing order; a 23505 catch remains as the race backstop. Two pieces naming the
   same product in one payload are rejected up front.
6. **One `tx`** — student creation, the bundle and every piece commit together. A half-created
   student with no order, or 2 of 3 pieces, can never be left behind.
7. `wholesaler_only` and inactive products are refused; product identity is re-read from the DB.

The existing single-piece `POST /production/students/:studentId/retail-order` becomes a thin
adapter over the same core function — **one write path, not two**.

### 3d. Untouched

- «طالب جديد» **with a rep selected** → unchanged `FullSetOrderForm`, rep التسعيرة, approval
  flow, `persistFullSetOrder`. No rep money path is modified.
- «طالب موجود» rep-linked or name-only → unchanged طقم form.
- The order edit screen, product swap, keep-price and force-rework → unchanged.

## 4. Verification

**Backend tests** (extending `backend/test/retailOrderEdit.test.js`):

- N pieces produce ONE `checkout_group` with N orders, each priced at the retail book;
- a new independent student comes out `full_set_eligible = false` — i.e. the edit path opens the
  **retail** editor, not طقم (the invariant the whole design rests on);
- duplicate phone → 409 naming the existing student;
- two pieces of the same product in one payload → 400; a product the student already holds → 409;
- a gender-restricted option for the wrong gender → 403;
- the rep/طقم endpoints still 403 for these students;
- a failing piece rolls the whole thing back — no orphan user, no orphan bundle.

**Browser:** create a 3-piece order (وشاح + قبعة + روب) for a new independent student, then open
one piece in the edit screen and confirm it opens the **retail** editor with the swap picker —
that is what proves the identity fix worked.

## 5. Open questions

None. Phone-required was raised explicitly with the owner and accepted: it is what stops these
orders from falling back into the rep طقم editor.
