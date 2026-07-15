# Order actions · rep pricing · money reveal · admin visitors — design

**Date:** 2026-07-11
**Status:** approved via clarifying Q&A; ready for implementation
**Branch:** work sits uncommitted on `main`, on top of the in-flight Workshop (060) +
dual-pricing (061) uncommitted changes.

## Context

Five user-requested changes on the live app (`lolo-shop96.com`, dev+prod share one
Neon DB). Three are *finish/fix* on the half-built dual-pricing + money-gate work;
two (visitors card, unified order action bar) are net-new UI. All amounts are IQD,
cash only. RTL Arabic, mobile-first.

Locked decisions (from Q&A):
- Return-to-customer works **before production only**; button visible everywhere but
  disabled once work has started.
- Permanent delete is allowed for **all staff + admin** (confirm dialog required).
- Rep pricing model: **base price carries the rep's entire margin; every optional
  add-on is 100% pass-through to admin** (no rep profit on add-ons).

---

## A + B — Unified order action bar (order detail screen)

Replaces the current advance/revert buttons with **three** actions, shown on every
order at every stage, for all staff + admin:

1. **تقدم للمرحلة التالية** — advance. Uses existing `available_actions.advance`
   (already gated by the state machine + embroidery-zone checklist). Hidden when no
   next stage exists.
2. **ارجاع للزبون لتعديله** — return to customer to edit.
   - Backend `productionController.returnToCustomer`: **remove the retail-only 409**
     so wholesaler orders can be returned too. Keep the `isFirstProductionStage`
     gate (before-production-only). For wholesaler orders the notified party is the
     **student** (order `user_id`); they edit at `/my-order` and resubmit.
   - `persistFullSetOrder` on resubmit already re-enters `wholesaler_approval='pending'`;
     also reset `returned_to_customer=FALSE`, `returned_reason=NULL` there.
   - `getOrder.available_actions` gains `return_to_customer: { enabled }` — enabled
     only when `isFirstProductionStage` && not already returned. Button rendered at
     all stages; disabled with a hint («بدأ التنفيذ — لا يمكن الإرجاع») otherwise.
3. **حذف** — permanent delete of the whole checkout-group (backend `deleteOrder`
   already deletes group + staff_activity_log + audit row + emits `order_deleted`).
   - **Loosen the guard:** `productionController.deleteOrder` currently `isManager`-only
     → allow all staff (route already `requireRole('admin','staff')`). Keep the audit
     row (`source:'staff_workspace'`) so every deletion is traceable.
   - Frontend: red button → confirm dialog («سيُحذف الطلب وكل قطعه نهائياً») → on
     success navigate back to the queue. Available to all staff + admin.

The old "revert one stage back" button is dropped. Delete is **not** a queue-list
bulk action — it lives on each order's detail screen only.

Files: `backend/controllers/productionController.js` (returnToCustomer gate,
deleteOrder guard, getOrder available_actions), `backend/lib/fullSetOrder.js` (reset
returned flag on resubmit), `frontend/app/staff/orders/[orderId]/page.tsx` (action
bar), `frontend/lib/staff.ts` (returnToCustomer + deleteOrder wrappers). Admin orders
page reuses the same wrappers if an admin opens an order there.

## C — التسعيرة corrected to the base-margin model

The rep's margin lives **only** in the base price spread. Add-ons pass fully to admin.

- **Base (per rep):** `admin_price` (admin's due, e.g. 40,000) + `wholesaler_price`
  (student-facing, e.g. 50,000). Rep collects the student price, hands `admin_price`
  to admin, keeps the difference. (Columns already exist.)
- **Optional add-ons** (ردن الروب، شال، تطريز إضافي…): **one price each**, added to
  **both** the student total **and** the admin due → 0 rep profit on add-ons. In the
  existing `{admin, selling}` storage this means `admin == selling` for every add-on;
  `fullSetOrder.js` already adds selling→price and admin→cost, so equal values give
  the intended pass-through automatically. Collapse the shawl default split
  (20k/25k) to a single value.
- **Admin التسعيرة editor** (`frontend/app/admin/wholesalers/page.tsx`): base = two
  fields (admin / student); each add-on = **one** field (not an admin+selling pair).
  Add a short **description** of the model («الممثل يجمع سعر الطالب ويسلّم للإدارة سعر
  الإدارة؛ الفرق ربحه. كل إضافة اختيارية سعرها كامل يذهب للإدارة»). On save, store the
  single value as `{admin:X, selling:X}` for each add-on.
- **Rep dashboard** (`frontend/app/wholesaler/page.tsx`): show only **«ما تجمعه من
  الطلاب»** (Σ order selling) and **«ما تسلّمه للإدارة»** (Σ admin due, from
  `admin_due`). No "cost"/"profit" wording. Keep a plain student-price reference list
  (base + optional add-on prices) so the rep knows what to charge; drop the admin
  column from that table.
- **Wrong-totals audit:** verify `earned_commission = SUM(profit)` and
  `admin_due = SUM(cost)` against real orders on Neon; correct any mismatch. Confirm
  migration 061 (`admin_price_snapshot`, `{admin,selling}` JSON) is applied before
  relying on it.

Single-piece (non-package) prices keep their current config unless the user asks to
apply the same rule.

## D — Money reveal on /admin (keep the gate)

No backend bug (`lolo2026` verifies; trigger renders; mask flips). Friction is the
in-memory-only unlock. Fix in `frontend/hooks/useMoneyGate.ts`: persist `revealed`
to **sessionStorage** so it survives refresh/navigation within the tab and clears on
tab close; soften/extend the idle auto-hide on the dashboard; make the 🎓 reveal
affordance findable. TV (`/tv`) is untouched (server-gated).

## E — Visitors on /admin

New admin endpoint reusing the TV board's `site_visits` dedup logic → a «الزوّار» card
on `frontend/app/admin/page.tsx` showing **الآن (آخر ٣٠ دقيقة) · اليوم · الكلي**.
Order counts / non-money metrics stay visible (not behind the money gate).

Files: `backend/controllers/adminController.js` (+ route in `routes/admin.js`),
`frontend/app/admin/page.tsx`, `frontend/lib/admin.ts`.

---

## Verification (live, per project norm)

- Backend e2e on Neon: return-to-customer on a **wholesaler** order (retail-block
  gone, first-stage gate holds); delete by a non-manager staff token; rep pricing
  math (base spread = rep margin, add-on = pass-through) on a real order.
- Browser (desktop + phone): the 3-button action bar per stage; delete confirm →
  back to queue; return disabled after production starts; التسعيرة editor single
  add-on field + description; rep dashboard two amounts; money reveal persists across
  refresh; visitors card populates.
- Gates: BE `node --check`, FE `tsc` + `eslint`.

## Risks / notes

- **Permanent delete by any staff role** is destructive and irreversible — mitigated
  by a confirm dialog + audit_log row only. User accepted this scope.
- Collapsing add-on pairs may need a one-time normalization of existing rep
  `pricing_addons` rows if 061 already seeded split values (esp. american_shawl).
- Work stays uncommitted on `main` (matches this repo's session workflow) unless the
  user asks to commit.
