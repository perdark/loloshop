# الخروج المؤقت — temporary leave during a shift

**Date:** 2026-07-30 · **Migration:** 075 · **Status:** built, browser walkthrough pending

## The report

> «can we add another button beside the بصمة button for staff — some staff need to get out of the
> shop for like an hour or 5 min or 15 min etc. So everyone has 10 hours in a month to get out
> safely and any other time no.»

## Owner decisions (locked 2026-07-30)

1. **Free only if approved AND within the allowance.** Anything else is a salary deduction.
2. **The admin must approve first** — but the worker can leave anyway via an explicit
   «خرجت بدون موافقة», recorded and flagged. That is what makes «deducted if the admin didn't
   allow it» expressible: software cannot stop someone walking out, so it records the truth.
3. **Break time is not worked time** — `worked_minutes` subtracts it, and overtime follows.
4. **A break ends when the worker taps «رجعت»**; the quota is charged on real elapsed time.
5. **Deducted minutes cost the existing `deduction_per_minute`** (1,000 IQD/min live, per-staff
   overrides honoured) — no separate rate to maintain.
6. **Unapproved minutes still consume the allowance.** The balance measures time out of the shop,
   so skipping the request can never buy extra free time. A minute is deducted once, never twice.

## The money rule

Lives in `backend/lib/attendanceBreak.js` and nowhere else:

```
the monthly balance always decrements by the FULL real minutes of a break
free     = approved ? min(minutes, remaining_before_this_break) : 0
deducted = minutes - free
amount   = deducted * deduction_per_minute      (frozen on the row at return time)
```

| case | result |
|---|---|
| approved, inside the allowance | مجانًا |
| approved, crosses the allowance | only the excess minutes deducted |
| pending / rejected / left without approval | every minute deducted |

Because a later admin decision changes how the allowance was spent, **any change re-runs the whole
month** for that worker in chronological order (`recomputeMonth`) rather than patching one row.
That is what keeps the sum of the parts equal to the balance regardless of the order the admin acts
in. Approving a returned break therefore cancels its deduction; the transaction is **soft-deleted**
(`deleted_at` + `delete_reason_ar`), never erased.

The **rate is frozen per row** — editing the shop rate later never rewrites past charges (same rule
as the workshop wage ledger). The **allowance is read live**, so raising it forgives past
deductions and lowering it can create them; that is what changing a policy means, and both
settings endpoints re-price the current month immediately instead of letting it drift.

## Data (migration 075)

- `staff_attendance_settings.break_monthly_minutes` — default **600** (10 hours).
- `staff_attendance_user_settings.break_monthly_minutes` — nullable per-staff override
  (NULL = inherit), mirroring the existing two-layer settings shape.
- `staff_attendance_breaks` — linked to both `user_id` and the day's `staff_attendance_records`
  row, plus `month_key` ('YYYY-MM' in Baghdad tz — the quota bucket), `left_at`/`returned_at`/
  `minutes`, `state` (`requested|out|returned|cancelled`), `approval`
  (`pending|approved|rejected`), `left_without_approval`, the frozen rate and the computed
  `free_minutes`/`deducted_minutes`/`deduction_amount`/`deduction_transaction_id`, and
  `auto_closed`.
- **`uq_attendance_break_open`** — a partial unique index giving one live break per worker,
  enforced by the DB and not only by a JS pre-check.

## Flow

```
[ خروج مؤقت ] → optional reason + 15/30/60/120 chips (declared intent, NOT charged)
      ↓                                     → notification to all admins
بانتظار موافقة المدير…
      ↓ approved                            ↓ admin silent
[ طلعت الآن ] ← the clock starts here       [ خرجت بدون موافقة ] ⚠ warns about the deduction
      ↓                                     → louder notification to admins
أنت خارج المحل — 00:23  (live timer)
      ↓
[ رجعت ] → minutes frozen, month re-priced, deduction row written if any
```

The clock starts when the worker actually leaves, not at approval — otherwise an
approved-but-still-working minute would cost them money.

## Endpoints

**Staff** (`/api/staff/attendance/…`, scoped to `req.user.id`): `POST /breaks` ·
`POST /breaks/:id/leave` · `POST /breaks/:id/return` · `DELETE /breaks/:id` ·
`GET /breaks/mine?month=`. Every attendance response (`today`, `check-in`, `check-out`) now also
carries `break` + `break_balance`, so one round-trip refreshes the whole card.

**Admin** (`/api/admin/attendance/…`): `GET /breaks` · `GET /breaks/balances?month=` ·
`POST /breaks/:id/approve` · `POST /breaks/:id/reject` · `PATCH /breaks/:id` (correct a duration).
The two existing settings endpoints gained `break_monthly_minutes`.

## Guards and edge cases

- **A forgotten «رجعت» is the biggest footgun** (1,000/min → 8 forgotten hours = 480,000 IQD).
  Three guards: **بصمة الخروج auto-closes any open break** at the checkout moment
  (`auto_closed`), breaks open past 4 hours are flagged, and the admin can correct the duration.
- A request nobody acted on is **cancelled** when the shift ends — the shift it belonged to is over.
- A break requires an open بصمة دخول (409 `ERR_NO_OPEN_ATTENDANCE`); staff exempt from بصمة get
  no breaks (400).
- Leaving while `pending`/`rejected` requires the explicit `without_approval` flag (409 otherwise).
- **Notifications run after the transaction commits**, never inside it: an error inside a Postgres
  tx aborts the whole tx, so a deleted recipient account would otherwise take the worker's break
  down with it. The admin screen lists pending requests regardless, so the notification is an
  accelerator, not the only channel.
- No location/GPS gate on breaks — `verification_mode` is `'none'` live and GPS is parked per the
  2026-07-24 footgun.
- Month bucketing is by `left_at` in Baghdad tz, so a break starting 22:30 UTC on the 31st counts
  against the next month.

## Known inconsistency (NOT changed here)

**Lateness deductions never reach the salary balance.** `staff_attendance_records.deduction_amount`
is computed and displayed, but nothing ever inserts the matching transaction, and both
`salaryController.js:47` and `payoutController.js:182` explicitly exclude `source_type='attendance'`.
Break deductions use `source_type='attendance_break'` and therefore **do** reduce the salary balance
and the payout suggestion — which is what the owner asked for. Whether lateness should behave the
same way is a separate owner decision.
