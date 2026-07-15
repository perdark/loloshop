# Workshop (الورشة / Team B) — bulk piecework production + wage ledger

**Date:** 2026-07-10 · **Status:** approved design, in build · **Scope:** Team B standalone (no Team-A handoff)

## 1. Problem

LoloShop's garments are physically built by a second, separate crew — the **Syrian workshop
workers** (حمزة، محمود، بهاء, …), "Team B" — who work in **bulk quantities** and are paid **per
piece**. Today none of this is tracked in software: quantities, who did what, and wages are all
informal. We need to track garment quantities through the workshop's operations and pay each
worker for the pieces they complete.

This is **distinct** from "Team A" (the existing `role='staff'` production pipeline: designers,
محمد عماد the embroiderer, ابو عبدو the فصال, pressers). Team A works **per student order** through
the `orders` state machine. Team B works in **bulk counts** with no student identity. The two must
NOT be conflated (the existing `orders.tailor_status` boolean cannot model quantities, multiple
workers, or wages).

## 2. Scope (locked with the user)

- **Build Team B only, standalone.** The workshop completes its own chain and **stops**. There is
  **no auto-handoff into Team A / التطريز** in this version (deferred — neither the "signal" nor the
  "hard gate" option is built now). The `orders` table and Team-A pipeline are **untouched**.
- **Primary surface = the admin view**, plus **Syrian-dialect (اللهجة السورية)** worker screens.
- Admin is **omnipotent**: create/edit/delete workers, runs, assignments, rates, payments; override
  any quantity anywhere.

## 3. The teams & the flow (for context)

Real garment journey (only stages 1–3 are in scope):

| # | Stage | Team | Who | Identity |
|---|-------|------|-----|----------|
| 1 | قص / فصال (cut) | **B** | ابو عبدو cuts; حمزة/admin records the qty | 🔵 bulk |
| 2 | أوفرلوك + خياطة القبعة | **B** | حمزة | 🔵 bulk |
| 3 | خياطة الروب + تسكير الشال/السكارف (شال امريكي = بهاء) | **B** | محمود، بهاء | 🔵 bulk |
| 4 | تطريز / تصميم (نص AI/إنترنت + نص شغل يد) | A | محمد عماد | 🟢 becomes the student's — **OUT OF SCOPE** |
| 5 | كوي / تجهيز | A | Team A | 🟢 OUT OF SCOPE |
| 6 | تسليم | — | — | OUT OF SCOPE |

Everything Team B does is **bulk** (counts, no student names). The seam to Team A (at التطريز) is
deliberately not wired yet.

## 4. People / identity

- **New Syrian workers** (حمزة، محمود، بهاء) = `users` rows with a **new `role='worker'`**, phoneless,
  login via a **secret workshop-portal URL** (`WORKSHOP_PORTAL_KEY`) with **name + password, no OTP**
  — mirrors the existing staff portal (`staffPortalLogin`). Reusing `users` gives us `signToken`,
  `authRequired`, the axios session layer, and 401 handling for free.
- **ابو عبدو** = his **existing `staff` user** is linked into the roster (`workshop_workers.user_id`)
  **without** changing his role or his فصال screen. He **never** logs into the workshop; his cutting
  is recorded **on his behalf** by حمزة/admin.
- **`workshop_workers.is_lead`** (حمزة) → may start runs + record the cut quantity + record on behalf.
- **Admin** (`role='admin'`) can do/override everything.

## 5. Data model (Migration 060 — all `workshop_*`, nothing in the orders machine)

| Table | Purpose |
|---|---|
| `workshop_workers` | roster: `user_id` (→ a worker or staff user), `is_lead`, `active` |
| `workshop_piece_rates` | **operation × product → per-piece IQD** (admin-editable — the real wages get filled in here, not hardcoded) |
| `workshop_runs` | one bulk run: `source` (wholesale/retail/manual) · `batch_id` · `product` · `total_qty` (cut count) · `planned_qty` (hint) · `status` (open/closed) |
| `workshop_assignments` | `run × operation × worker → assigned_qty` |
| `workshop_ledger` | append-only `completion`/`damage`/`adjustment` events; `qty` (signed) · **`rate` frozen per row** · `amount`; `created_by` NULL = self-recorded. `completed = SUM(qty) WHERE kind='completion'` |
| `workshop_payments` | cash paid to a worker; `unpaid = SUM(ledger.amount) − SUM(payments.amount)` |

Audit ("who changed which quantity when") = the append-only `workshop_ledger` + existing `audit_log`.

**Enums:** `workshop_run_source('wholesale','retail','manual')`, `workshop_ledger_kind('completion','damage','adjustment')`. New `user_role` value `'worker'`.

### Operations & product chains (app constants — editable; the user confirms exact rates/splits during build)

- **operations:** `cut · overlock · cap_sew · robe_sew · shawl_close · american_shawl`
- **product → ordered ops (display/flow):** `robe: [cut, overlock, robe_sew]` · `cap: [cut, cap_sew]` ·
  `shawl: [cut, shawl_close]` · `sash: [cut]`. (Refine with the user — flagged "confirm during implementation.")

## 6. Core mechanic — assign → complete → reconcile

For a run of `total_qty` pieces, per operation:
- `assigned = Σ workshop_assignments.assigned_qty`
- `completed = Σ ledger.qty WHERE kind='completion'` · `damaged = Σ ledger.qty WHERE kind='damage'`
- `remaining = assigned − completed − damaged` · `unassigned = total_qty − assigned`

**Warnings (dashboard):** `assigned > total_qty` (over-assigned) · `completed + damaged > assigned`
(over-completed) · `total_qty ≠ planned_qty` (cut vs order-count mismatch) · high `damaged`.

**Earnings:** a completion writes a ledger row with the rate **frozen at that moment** (so later rate
edits never rewrite history), `amount = qty × rate`. Worker earnings = `Σ ledger.amount`. Damage pays 0.
`unpaid = earnings − Σ payments`.

## 7. Screens

- **Worker (Syrian dialect, phone-first):** `شو عندك اليوم` → job cards (`استلمت ٦٠ · خلّصت ٤٠ · باقي
  ٢٠`), tap → `كم قطعة خلّصت؟` (number pad + quick +5) + `تالف`. `حسابك`: `خلّصت هالأسبوع … · إلك عنا …
  · اندفع … · الباقي إلك …`.
- **Admin dashboard (`/admin/workshop`):** run totals + shortage warnings · worker progress · create
  run / assign / record-on-behalf · **rates config** · **payments + unpaid balance** · audit.
- **حمزة (lead):** start run + record cut qty; self-records his own overlock/cap like any worker.

## 8. API (`/api/workshop`)

- **Portal (key-gated, no OTP):** `GET /workshop/portal/members?key`, `POST /workshop/portal-login`.
- **Worker (self):** `GET /workshop/me/jobs`, `POST /workshop/me/complete`, `GET /workshop/me/ledger`.
- **Admin/lead:** workers CRUD · rates list/upsert · runs list/create/get/close · assignments
  create/update · record-on-behalf complete/damage/adjust · payments list/create · dashboard/warnings.

Gating: admin = `requireRole('admin')`; worker self = `authRequired` + role `worker` (own rows only);
lead actions = `is_lead` OR admin.

## 9. Explicitly NOT doing (YAGNI)

No per-student tracking inside Team B (bulk by nature) · no auto-handoff to Team A · no fabric/material
inventory · no Team-B attendance (Team-A has its own) · no automatic rate guesses (admin types real rates).

## 10. Build order (phased)

1. **Foundation** — Migration 060 (6 tables + enums + `worker` role) + schema mirror. ✅ applied+verified.
2. **Backend** — `workshopController.js` + `routes/workshop.js` + mount; portal auth; reconciliation
   aggregates; earnings/payments.
3. **Worker portal (Syrian)** — secret-URL login + `شو عندك اليوم` + `حسابك`.
4. **Admin dashboard** — runs/assignments/rates/payments/warnings + sidebar link.
5. **Verify** — backend e2e on Neon (create worker → run → assign → complete → balance → pay) + browser
   click-through desktop+mobile.

## 11. Open items to confirm with the user during build

- Exact **per-piece rates** for cut/overlock/cap_sew/robe_sew/shawl_close/american_shawl (admin fills).
- Exact **operation → product** chains and the محمود/بهاء split (assignment is per-run, so flexible).
- Whether ابو عبدو ever needs a login here (currently: no — recorded on his behalf).
