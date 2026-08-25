# Starting a discount round · the app console · admin push

**Date:** 2026-08-25 · **Status:** approved, implementing

Three deliverables, in this order. Part 1 is the one blocking the owner today.

---

## Why

**Part 1.** The admin can END a discount round («إنهاء الخصومات», `lib/discountRestore.js`,
shipped 2026-08-22) but there is no way to START one. Starting means hand-editing every product
on `/admin/products`: lower `base_price`, then retype the old price into «السعر قبل الخصم». Two
edits × 51 products, no preview, no undo. So every discount round has needed a developer. Owner's
words: «admin can't do خصومات without me, the prices aren't go down».

**Parts 2–3.** Both app binaries carry push, but the admin has no screen that shows how the app
is doing on either platform and no way to send a notification a human typed. Every push in the
system today is emitted by code.

---

## Part 1 — «ابدأ الخصومات»

### Model

A round is applied per product as:

```
compare_at_price ← the price it has right now      (this is what draws «السعر قبل الخصم»)
base_price       ← that price − amount             (retail cells only, by default)
```

That is precisely the shape `discountRestore` already knows how to reverse, so **ending keeps
working untouched** — the two halves are inverses over the same two columns.

### Rules (all three write live prices, so all three refuse loudly)

1. **A product already carrying a `compare_at_price` is refused, never silently skipped.**
   Applying a round to it would overwrite the old price with the *discounted* one and the real
   price would be gone for good — the exact loss `discount_restore_log` was created to prevent.
   The panel marks these «مخصوم أصلاً — أنهِ الخصم أولاً».
2. **`amount >= price` is refused.** No free or negative products.
3. **Every old value is logged** to `discount_restore_log` under a fresh `batch_id`, so a wrong
   press is one UPDATE away from undone — same ledger, same rollback, as ending.

### Scope default: retail only

`products.base_price` + the `retail` row of `product_price_roles`. سعر الجملة is a **visible,
unticked** checkbox carrying the warning from `discountRestore.js`: a wholesale price already
sits below retail by the normal margin, so discounting it again cuts the shop's margin on every
ممثل order.

### Staleness

Same contract as `planFrom`: the client sends back the numbers it displayed
(`expected_price` per cell); if any has moved, the whole round is refused with `ERR_STALE`
rather than applied to data nobody looked at.

### Surface

- `backend/lib/discountRound.js` — `buildCandidates()`, `planStart()`, `applyStart()`.
- `GET /admin/discounts/candidates` · `POST /admin/discounts/start` (admin-only, on the router
  that already carries `authRequired` + `requireRole('admin')`).
- Both drop `memoCache` `settings:promo` and `cat:` — the storefront bakes discounts into a
  120 s cached payload, so without this a new round is invisible for two minutes.
- **Migration 086** — `discount_restore_log.direction TEXT NOT NULL DEFAULT 'end'` ('start' |
  'end'), so one ledger holds both directions and the existing rows keep their meaning.
- `frontend/components/admin/DiscountStartPanel.tsx`, beside `DiscountRestorePanel` in
  **الإعلانات والعروض** on `/admin`.

### UI

Amount box (defaults 5,000 — the uniform delta of every real round to date) · four type chips
(أوشحة · روبات · قبعات · شالات) plus «الكل» · per-product ticks · a live preview table:
الاسم · السعر الآن · بعد الخصم · السعر قبل الخصم. One confirm summarising «X منتج · خصم 5,000».
A «شغّل شريط العروض» toggle, on by default, reusing `PATCH /admin/promo`.

This also lets the owner fix the four cells left open by the August round (وشاح · روب فصال بشت ·
وشاح عدل · وشاح منحني) without a developer.

---

## Part 2 — `/admin/app` · إحصائيات التطبيق على المنصتين

### The gap

App usage is tracked for **staff only** (`staff_app_opens`, migration 084). Students and reps
have nothing. The only cross-role signal is `device_tokens` (platform · created_at ·
last_seen_at), which counts people who installed *and* allowed notifications *while signed in* —
a floor on installs, not a count of them. `site_visits` carries neither user nor platform.

### Fix

**Migration 087** adds `app_opens`, the all-roles twin of `staff_app_opens`:
`(user_id, work_date)` PK · `opens` · `first_seen_at` / `last_seen_at` · `platform`
(`android` | `ios` | `web`). Role is joined from `users`, never snapshotted.

`staff_app_opens` is left **completely untouched** — the nightly staff report and the admin
console read it, and migration 084's «opening the app is not attendance» semantics are
load-bearing. Duplicating staff rows across two tables is the accepted cost of not moving them.

**One beacon, not two.** `StaffAppBeacon` becomes `AppBeacon` and fires for any signed-in user;
the endpoint writes `app_opens` always and `staff_app_opens` additionally when the user is staff.
Staff therefore still cost exactly one request. The 30-minute session window and the 60-second
foreground debounce are unchanged.

### The page

أجهزة مسجلة split android/ios · جديدة هذا الأسبوع · نشطة آخر ٧ و ٣٠ يوم (from `last_seen_at`) ·
a 30-day daily-opens chart split by platform · مستخدمون نشطون يومياً · a role breakdown
(طلاب / ممثلين / موظفين).

⚠️ **Two honest zeroes, both explained on the page rather than left looking broken:**
- **iOS reads 0 everywhere** until someone installs 1.0.4 from TestFlight and grants the prompt.
  There are no iOS device tokens at all today.
- **Nothing is retroactive.** Opens data starts the day this deploys.

---

## Part 3 — the push composer

`POST /admin/push` writes **one `notifications` row per recipient** and lets the existing
`lib/pushOutbox.js` deliver it. No second send path: the outbox's claim query, flood guard and
dead-token handling all apply unchanged, and every blast also lands in the in-app bell — so a
missed push is not a lost message.

`GET /admin/push/audience` returns «N شخص · M جهاز» *before* the send button is live.

### Audiences

الكل · by role (طلاب / ممثلين / موظفين) · by university or ممثل · one person by name/phone.

### Guards — a push cannot be recalled

- `link` must be a **relative in-app path from an allowlist**. Never an external URL: a
  broadcast that can carry an arbitrary link is a phishing vector aimed at 1,100+ accounts.
- A send to **الكل** requires typing the recipient count shown.
- 5 broadcasts per hour.
- Every send recorded in a new `push_broadcasts` table: sender, audience, copy, recipients,
  devices.

Plus the small finding from the same session: `<NotificationBell />` goes into the admin header.
Admin `notifications` rows are written today (the assistant's budget warning, the nightly staff
report) and there is no screen to read them on — if the push is missed, the message is gone.

---

## Testing

`node --test test/*.test.js`, run **from `backend/`** (see the HANDOFF landmine — every other
form misbehaves on Node 26).

- `discountRound`: plan math · the already-discounted refusal · `amount >= price` · `ERR_STALE`
  · ledger round-trip (start → end returns every price to where it began).
- `app_opens`: the 30-minute session window increments `opens` once, not per ping · a staff ping
  writes both tables · a student ping writes only `app_opens`.
- push: audience resolution counts · the link allowlist rejects an absolute URL · the الكل guard
  rejects a wrong count.

## Out of scope

Percentage and per-product-price discount shapes (owner chose fixed-amount only) · in-app screen
analytics · any change to `staff_app_opens` or the nightly report · backfilling app data.
