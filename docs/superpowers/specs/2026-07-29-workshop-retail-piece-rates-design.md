# Workshop piece rates split by customer: ممثلين vs تجزئة

**Date:** 2026-07-29
**Status:** design approved, not yet implemented
**Module:** الورشة / Team B (Syrian workshop workers)

---

## 1. The report

> «the syrian workers the prices are different on wholesaler (that already built) and the
> retail students (not built) so just add a section for retail students working»

The workshop pays its Syrian crew **per piece**. A rate today is identified by
`(operation, product)` — قص روب = 500, خياطة الروب = 1000 — and that single number is
applied no matter who the finished garment is for. In reality the shop pays a different
piece rate for retail-student work than for ممثل (wholesaler) work, so every wage
recorded for retail work today is wrong.

## 2. Owner decisions (locked 2026-07-29)

| # | Decision |
|---|---|
| 1 | **Same jobs, second price.** Every existing operation×product keeps its ممثلين price and gains a تجزئة price. Retail does *not* get its own operation list, and there is **no fallback** — both prices are explicit values. |
| 2 | **The worker states the audience.** A «لمين هالشغل؟» toggle at the top of سجّل شغلك, tapped per submission. |
| 3 | **Labels + split totals.** The worker's حسابك shows أجور ممثلين and أجور تجزئة separately; each ledger line names its audience; the admin نظرة عامة gets a الكل/ممثلين/تجزئة filter. |

**Explicitly out of scope:** connecting workshop production to real `orders`. A worker
still types "20 روب · تجزئة" and nothing verifies that 20 retail robes exist. The module
has always been standalone bulk piecework with `orders` untouched (2026-07-10 spec §
"Team B completes its own chain and STOPS"), and this change keeps it that way.

## 3. Vocabulary

`audience` — who the finished piece is for. Two values, matching the vocabulary the rest
of the app already uses for the same distinction:

- `wholesale` → **ممثلين** (a ممثل جامعة's students)
- `retail` → **تجزئة** (a self-registered student)

The stored values are English (`wholesale`/`retail`) to match `students.wholesaler_id IS
NULL` semantics used across the codebase; the Arabic labels live in the existing
`*_LABEL_AR` maps in `workshopController.js`.

## 4. Data model

**Chosen approach: `audience` becomes part of the rate key.**

Considered and rejected:

- **Second column** (`amount` + `retail_amount` on one row). Smaller migration, but it
  encodes the dimension in *column names*: every split total in decision 3 becomes a
  hand-written `SUM(CASE WHEN …)` instead of a `GROUP BY audience`, and
  `workshop_production_entries` needs a real `audience` column regardless — leaving the
  same concept modelled two different ways in two tables.
- **Separate `workshop_retail_piece_rates` table.** Two tables to keep in sync, duplicated
  controller and admin-screen code, no upside.

### Migration `db/migrations/072_workshop_rate_audience.sql`

```sql
ALTER TABLE workshop_piece_rates
  ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'wholesale'
  CHECK (audience IN ('wholesale','retail'));

-- verified live 2026-07-29: the CREATE TABLE UNIQUE(operation,product) is named
-- workshop_piece_rates_operation_product_key
ALTER TABLE workshop_piece_rates
  DROP CONSTRAINT IF EXISTS workshop_piece_rates_operation_product_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_workshop_rate
  ON workshop_piece_rates(operation, product, audience);

-- Day-one safety: seed every retail rate from its current wholesaler amount so no job
-- is ever worth 0 the moment this ships. The admin then edits only what differs.
INSERT INTO workshop_piece_rates (operation, product, audience, amount)
SELECT operation, product, 'retail', amount
  FROM workshop_piece_rates WHERE audience = 'wholesale'
ON CONFLICT DO NOTHING;

ALTER TABLE workshop_production_entries
  ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'wholesale'
  CHECK (audience IN ('wholesale','retail'));
```

`DEFAULT 'wholesale'` is the backfill: every rate and every already-recorded entry becomes
ممثلين, which is what they in fact were. Idempotent and additive — safe to run against a
database the current code is still serving.

`db/schema.sql` is updated to match. Its example-rate seed block needs two changes, or a
fresh database comes up with no retail rates at all: each seeded row names its `audience`
explicitly, the block seeds **both** audiences, and the conflict target becomes
`ON CONFLICT (operation, product, audience)`. Existing admin-edited values still win.

**Dev DB state (measured 2026-07-29):** 0 rows in `workshop_production_entries`, 10 rows
in `workshop_piece_rates` (admin-edited: robe cut 500 / overlock 300 / robe_sew 1000).
Production may hold real entries — the default handles them either way.

## 5. Backend

`backend/controllers/workshopController.js`:

- `AUDIENCES = ['wholesale','retail']` + `AUDIENCE_LABEL_AR = { wholesale: 'ممثلين', retail: 'تجزئة' }`.
- `validatePiece` rejects a missing or unknown `audience` with «حدد لمين هالشغل: ممثلين أو تجزئة».
  There is no default — an unstated audience is a validation error, never a guess.
- `insertProduction` resolves the rate with `WHERE operation=$1 AND product=$2 AND audience=$3`
  and stamps `audience` onto the inserted entry. This is the **single choke point** for
  both recording surfaces (worker self-service and admin record-on-behalf), so neither can
  drift from the other.
- The rate stays **frozen per entry** — `rate` and `amount` are already copied onto the row
  at insert time, so editing a تجزئة price later never rewrites past wages. This is the
  ledger rule the module already follows and it is unchanged.
- `ratesMatrix()` returns one row per `(operation, product, audience)` — 20 rows where it
  returned 10 — each carrying `audience` and `audience_label_ar`.
- `upsertRate` accepts `audience` and writes against the new three-column conflict target.
- `ledgerFor` returns `production_wholesale` and `production_retail` alongside the existing
  `production` total; `payable` is unchanged (`production + bonuses − deductions`) because
  it is what actually gets paid.
- `dashboard` returns the same split (`production_wholesale`/`production_retail`,
  `pieces_wholesale`/`pieces_retail`) in `totals`. **There is deliberately no `?audience=`
  query parameter:** حوافز and خصومات are not audience-scoped, so a server-side filter
  would return a المستحق that doesn't reconcile with its own parts. The admin filter is
  presentation only — it picks which returned numbers to show, and المستحق appears only
  under الكل.

`backend/routes/workshop.js` — no new routes. Existing endpoints carry the extra field.

## 6. Frontend

**Worker — `frontend/app/workshop/page.tsx` (`ProductionForm`)**

A «لمين هالشغل؟» two-button toggle above the job picker, **with no pre-selection**;
سجّل stays disabled until one is tapped. This is deliberate: the 2026-07-26 session lost
an order to a `<select>` Chrome silently autofilled, and this field decides the wage. A
toggle is also one tap on a phone, which is the only device these workers use.

The live price line under العدد recomputes from the selected audience, so the worker sees
`700 × 20 = 14,000` before submitting.

**Worker — حسابك (`Account`)**

`أجور ممثلين` and `أجور تجزئة` join حوافز/خصومات as metrics; المستحق stays the single
combined figure. Each ledger line gains its audience: `قص · روب × 20 · تجزئة`.

**Admin — `frontend/app/admin/workshop/page.tsx`**

- **أسعار القطع tab:** two amount inputs per job row (ممثلين | تجزئة) saved together.
- **تسجيل القطع tab:** the same audience toggle as the worker form — this surface records
  on a worker's behalf through `insertProduction`, so it needs the same required choice.
- **نظرة عامة tab:** a الكل/ممثلين/تجزئة filter over the القطع and أجور القطع tiles,
  driven entirely client-side from the split totals. المستحق renders only under الكل,
  because حوافز/خصومات belong to no audience and a sliced المستحق would not add up.

The per-worker table in نظرة عامة is **not** split — decision 3 chose split totals, not a
per-worker breakdown. `listWorkers` is untouched.

`frontend/lib/workshop.ts` — `RateRow` gains `audience` + `audience_label_ar`;
`WorkshopLedgerEntry` gains `audience`; `WorkerSummary` gains the two split totals;
`recordMyProduction` and the admin record body carry `audience`.

## 7. Testing

Backend (`node --test test/`), extending the existing workshop coverage:

1. A `retail` entry is priced from the retail rate, a `wholesale` entry from the wholesale
   rate, for the same operation×product.
2. Recording with a missing or unknown `audience` is rejected — no silent default.
3. Editing a rate does not change the `amount` already stored on past entries.
4. `production_wholesale + production_retail == production`.
5. The migration leaves pre-existing entries and rates at `wholesale`.

Browser walkthrough (the module's screens are phone-first and have historically hidden
bugs that code review did not catch): record one تجزئة and one ممثلين entry as a worker,
confirm the two totals and the ledger labels, then confirm the admin overview filter.

## 8. Risks

- **Retail rates start equal to wholesale.** After the migration every تجزئة price matches
  its ممثلين price until an admin edits the أسعار القطع tab. Wages are *plausible* but not
  yet correct — the real retail rates must be entered before the split means anything.
  This is the deliberate trade against shipping zeros.
- **Nothing verifies the audience a worker claims.** A worker could record retail work as
  wholesale (or the reverse) and be paid the wrong rate. Inherent to self-reported bulk
  piecework — the same open exposure already noted for `qty` in the 2026-07-15 handoff
  («no qty upper bound — a worker could inflate their own payable»).
- **Pre-existing, not fixed here:** an unset rate resolves to `0` and records a
  zero-wage entry silently (`n(rate.rows[0]?.amount)`). The seeding step in §4 keeps this
  from biting on day one, but the underlying behaviour is untouched.

## 9. Deploy

Standard: `scripts/deploy.sh` runs `npm run migrate` before the pm2 reload, so 072 applies
ahead of the code that reads `audience`. The migration is additive and backward compatible
— the currently deployed code ignores the new columns — so the ordering is safe either way.
