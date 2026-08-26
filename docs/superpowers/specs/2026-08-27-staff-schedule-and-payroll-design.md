# دوام الأسبوع، الإجازات، وصفحة «راتبي ونشاطي»

**Date:** 2026-08-27 · **Status:** approved, not implemented · **Owner decisions:** 2026-08-26/27

Two pieces in one spec because the second reads the first's data. Piece 4 gives the shop a
real weekly schedule and a holiday calendar; piece 5 shows a member of staff everything the
system knows about their own month.

---

## 1. The problem, measured

`staff_attendance_settings` holds **one** `start_time` / `end_time` pair
(`db/schema.sql:862-863`), and so does the per-user override table. There is **no weekday
logic anywhere in `backend/`** — a grep for `getDay`, `day_of_week`, `friday` or `جمعة`
returns nothing. `checkIn` computes

```js
const lateMinutes = Math.max(0, local.minutes - startMinutes - Number(settings.grace_minutes));
```
`backend/controllers/attendanceController.js:540`

against 09:00 every day of the week. The shop opens **3 م on Friday**, so every Friday
check-in is recorded as roughly six hours late.

**What that costs today, precisely.** Nothing is taken from anyone's balance. The only writer
of an attendance salary transaction is `backend/lib/attendanceBreak.js` — for breaks.
`staff_attendance_records.deduction_transaction_id` is only ever *cleared*
(`attendanceController.js:783`), never set. So the damage is a **record**, not a payment:
every Friday row carries `status = 'late'`, a wrong `late_minutes`, and a `deduction_amount`
that the staff page and the admin reports both display. It is wrong data that a human then
pays from — which is worse than a wrong number nobody reads, and is the reason this is piece 4
rather than a footnote.

There is also no notion of a **holiday**. `attendance_required` is a per-*user* boolean, not a
per-*date* one, so «اليوم عيد» cannot be expressed at all.

## 2. Decisions taken

| Question | Decision |
|---|---|
| Schedule shape | A row per weekday, global |
| Hours | السبت–الخميس **09:00 → 22:00**، الجمعة **15:00 → 00:00** |
| Time display | 12-hour, **ص/م** — inputs too. 24-hour stays in the DB |
| Holidays | A date list applying to **everyone**. No per-staff holiday |
| Old wrong Friday rows | A **read-only report**. A human decides. No code moves money |

## 3. Data model

```sql
-- migration 093
CREATE TABLE staff_schedule_days (
  weekday    SMALLINT PRIMARY KEY CHECK (weekday BETWEEN 0 AND 6),  -- 0 = الأحد … 6 = السبت
  start_time TIME NOT NULL,
  end_time   TIME NOT NULL,
  is_off     BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE staff_holidays (
  work_date  DATE PRIMARY KEY,
  label_ar   TEXT NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

`weekday` uses **Postgres `EXTRACT(DOW)` numbering** (0 = Sunday) so a query can join on it
without a translation table. الجمعة is 5.

Seeded exactly once, in `db/schema.sql` as well as the numbered migration — `scripts/deploy.sh`
runs `npm run migrate`, which applies **`schema.sql` and never the numbered migrations**. The
seed is `ON CONFLICT DO NOTHING` so an admin edit is never overwritten on the next deploy. This
is the same pattern migrations 077 and 080 already use, and the same reason.

`staff_attendance_settings.start_time` / `end_time` are **left in place and left being read as
the fallback** when a weekday row is somehow missing. Deleting them would be a wider change
than this work needs, and they are what every existing test binds to.

## 4. Resolution order — one function, `lib/staffSchedule.js`

`effectiveShiftFor(userId, shopDate)` returns `{ start, end, isOff, holiday }`, resolved:

1. a `staff_holidays` row for that date → `isOff: true, holiday: label_ar`
2. a `staff_attendance_user_settings` row for that user → its times (unchanged behaviour: a
   personal override still wins over the shop's weekday)
3. the `staff_schedule_days` row for `EXTRACT(DOW FROM shopDate)`
4. `staff_attendance_settings` — the pre-093 single pair

Everything that needs to know "when was this person due" calls this and nothing else, the way
`lib/shopTime.js` is the only answer to "what date is it at the shop" and `lib/counts.js` is
the only answer to "what is money". A second copy of this rule is how the Friday bug happens
again.

## 5. Shifts that cross midnight

الجمعة is **15:00 → 00:00**, so `end <= start`. Three places see this and only one of them is
already right:

- ✅ `scheduledMinutes` (`attendanceController.js:56-61`) already does `if (end <= start) end
  += 24*60`. **Unchanged.**
- ✅ `checkOut` finds the open record by `check_out_at IS NULL ORDER BY check_in_at DESC`, not
  by date, so stamping out at 00:10 closes the Friday record correctly. **Unchanged.**
- ❌ **Which day's shift a stamp belongs to.** A check-in at 00:10 on Saturday is Friday's
  shift. Rule: *if yesterday's shift ends after midnight and the current shop-local time is
  before that end time, use yesterday's weekday and file `work_date` as yesterday.* Applied
  inside `effectiveShiftFor`, so no caller repeats it.

`late_minutes` is then computed against the resolved start, and is **0 on a holiday or an
`is_off` day, always** — with `status = 'present'`, not `'late'`.

## 6. Admin screen — `/admin/attendance`

Two additions above the existing settings:

- **جدول الدوام** — seven rows, each with a start, an end, and «مغلق». Times in **ص/م**.
- **أيام الإجازات** — add a date + a label, list them, delete one.

A new `frontend/lib/format.ts` helper `formatTime12(value)` renders `"09:00"` as `«٩:٠٠ ص»`
… actual digit style to match `fmtShopDate`'s existing decision (Latin digits, for scanning
speed). Used by both attendance screens; the DB keeps 24-hour `TIME`.

## 7. The retrospective report

`backend/scripts/friday-deduction-report.js`, run as `npm run friday-deduction-report` — the
same shape as the existing `photo-recovery` script: **reads, prints, deletes nothing, writes
nothing.** For every `staff_attendance_records` row whose `work_date` is a Friday and whose
`late_minutes > 0`: the staff name, the date, the recorded check-in, the late minutes, the
`deduction_amount`, and whether a salary transaction is linked (it will be `NULL` for every
row — that is the point, and the report says so rather than leaving the reader to assume).

The owner reads it and decides. Nothing in this piece writes a salary transaction.

## 8. Piece 5 — `راتبي ونشاطي`

### The defect it starts from

`buildSalarySummary` filters `AND source_type <> 'attendance'`
(`backend/controllers/salaryController.js:46`). Break deductions **do** hit the balance and
**are** hidden from the list, so a member of staff sees a balance that is smaller than the
reasons shown to them add up to, with nothing to explain the gap. Removing that filter is the
core of «الخصومات وليش». Check every other caller of `buildSalarySummary` before removing it —
if an admin surface depends on the exclusion, it takes a flag, not a second query.

### The endpoint

`GET /api/payroll/me/summary?month=YYYY-MM` — one call, one screen. Defaults to the current
shop month (`lib/shopTime.js`, not the server's UTC month).

```
{ month, schedule: [7 rows],
  days:    [{ date, weekday, is_off, holiday_ar, expected_start, expected_end,
              check_in_at, check_out_at, worked_minutes, late_minutes,
              deduction_amount, status }],
  breaks:  { count, minutes, free_minutes, deducted_minutes, deduction_amount,
             allowance_minutes, remaining_minutes,
             rows: [{ date, minutes, approval, reason_ar, deduction_amount }] },
  salary:  { base, transactions: [ …including source_type='attendance'… ], balance },
  goal:    { … existing getMyGoal shape … },
  work:    { pieces_this_month, days_worked, by_day: [{ date, pieces }] },
  expected_net }
```

`work` comes from `staff_activity_log` — the same row-per-piece count `getMyGoal` already
uses, so the two screens cannot print different numbers for the same month.

### The page

`frontend/app/staff/me/page.tsx`, rebuilt around a month picker, mobile-first (staff are on
iPad and phone). Five sections: **الملخص** (base, deductions, bonuses, expected net) ·
**الحضور** (a day-by-day list — worked, off, holiday, absent, late) · **التأخير والخصومات**
(one line per deduction: date, minutes, amount, reason) · **الفتحات** (count, minutes,
free/deducted, remaining allowance) · **الحوافز والإنجاز**.

Every deduction line must carry its own reason. A number with no sentence next to it is the
thing this page exists to remove.

## 9. Testing

- `effectiveShiftFor`: Friday returns 15:00–00:00; a holiday returns `isOff`; a per-user
  override still wins; a 00:10 stamp resolves to the previous day's Friday shift.
- `checkIn` on a Friday at 15:05 with a 15-minute grace → `late_minutes = 0`,
  `status = 'present'` — the red/green of the whole bug.
- `checkIn` on a holiday → no lateness whatever the hour.
- `buildSalarySummary` includes an `attendance` transaction, and the returned `balance`
  equals base + bonuses − deductions over the **same list that is displayed**.
- The report script names a seeded bad Friday row and reports `transaction: null` for it.

## 10. Deploy notes

- Migration 093 must be in `db/schema.sql` too, or the deploy applies nothing.
- A push to `main` **auto-deploys** (`.github/workflows/ci.yml:46-58`). Land pieces 4 and 5
  separately and open the screen between them.
- No new npm dependency — a new one would have to clear `npm audit` in the deploy gate.
