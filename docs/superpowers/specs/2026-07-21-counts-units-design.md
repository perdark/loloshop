# قطعة · طلب · طالب — one unit vocabulary for every number

**Date:** 2026-07-21
**Scope of this pass:** admin dashboard + TV board only. Rep and staff screens keep their
current wording until pass 2.

---

## 1. The problem (measured, not assumed)

An `orders` row is **one piece**. Pieces bought together share a `checkout_group_id`; that
group is what a human calls a student's order. Live dev DB, `status <> 'cancelled'`:

| unit | count |
|---|---|
| piece rows | **1727** |
| bundles (`checkout_group_id`) | **578** |
| students | **553** |

The same shop is "1727 طلب" or "578 طلب" depending on the screen. An audit of 56 counts
found ~25 where the Arabic label disagrees with the SQL.

### 1.1 The structural error: a bundle has no status

```
bundles spanning 1 status:  141  (24%)
bundles spanning 2 statuses: 417
bundles spanning 3 statuses:  20  (76% span multiple stages)

sum of per-stage bundle counts: 1035
real bundle total:               578   ← overcounts by 79%
```

A student's طقم routinely has the وشاح at التطريز while the قبعة is at بانتظار التصميم.
Any stage funnel counted in bundles double-counts students and can never sum to its own
total. Piece counts sum exactly (1023+475+107+107+9+6 = 1727 ✓).

**Rule: only pieces have a stage. Bundles and students never get a stage breakdown.**

### 1.2 The pipeline has no exit

```
pieces created since 2026-06-23:  1727
reached «جاهز»:                      6
«مُسلَّم»:                            0
delivery rows in audit_log:          0
```

`delivered` exists in the enum with `delivered_at` / `delivered_by` columns, and has never
been used. Every TV panel measuring delivery is permanently zero, including the هدف اليوم
goal bar.

**Decision:** «جاهز» is the finish line for now. Panels that measure مُسلَّم are **deleted**,
not relabelled — a permanent zero is worse than an absent tile.

---

## 2. Locked vocabulary

| unit | word | used by |
|---|---|---|
| `orders` row | **قطعة** | production, stage funnel, workload, thresholds |
| `checkout_group` | **طلب** | admin totals, money, rank ladder |
| student | **طالب** | people counts |

The bare word «طلب» may never label a piece count. Numbers never render naked — the unit
noun is part of the number («١٠٢٣ قطعة»).

**No clarification notes.** Where a number was previously ambiguous the fix is a precise
label or a corrected query, never a footnote. The existing disclaimer at
`app/admin/page.tsx:462-463` is deleted rather than reworded.

---

## 3. Architecture

### 3.1 `backend/lib/counts.js` — one owner for every number

```
buildScope(filters)          → { where, params }   live-only + dates + rep + audience
countPieces(scope)           → int
countBundles(scope)          → int
countStudents(scope)         → int
countBundlesInProgress(scope)→ int   bundles with any piece not yet جاهز
stageFunnel(scope)           → [{ stage, pieces, students }]
retailBundles(scope)         → int   feeds the rank ladder
```

`COALESCE(checkout_group_id, id)` appears in exactly one file instead of the ~15 it is
copy-pasted across today. Controllers call these; they stop writing `COUNT(*)` by hand.

Money and settlement queries are **not** touched in this pass.

### 3.2 `frontend/components/ui/Count.tsx`

```tsx
<Count value={1023} unit="piece" />   → «١٠٢٣ قطعة»
<Count value={578}  unit="order" />   → «٥٧٨ طلب»
<Count value={553}  unit="student" /> → «٥٥٣ طالب»
```

`unit` is a required prop — TypeScript rejects a unitless count. This is the guardrail that
prevents pass 3 from inventing a fourth meaning.

---

## 4. Admin dashboard

- **Hero:** «N طلب قيد التنفيذ» — bundles with any piece not yet جاهز. Secondary line:
  «٥٧٨ إجمالاً · ١٧٢٧ قطعة».
- **Stage funnel:** two columns, sourced from `stageFunnel()`.

  | المرحلة | القطع | طلاب لديهم قطعة هنا |
  |---|---|---|
  | بانتظار التصميم | ١٠٢٣ | ٥٠١ |
  | التجهيز | ٤٧٥ | ٣٦٤ |
  | التطريز | ١٠٧ | ٥٨ |
  | الكوي | ١٠٧ | ١٠٢ |
  | **المجموع** | **١٧٢٧** | ٥٧٨ طلب · ٥٥٣ طالب |

  The student column header states it is a membership count, so it cannot be mistakenly
  summed. No footnote.
- `DashboardCharts.tsx:169` hint «{n} طلب» → «{n} قطعة»; series/tooltip labels likewise.
- Disclaimer at `app/admin/page.tsx:462-463` **deleted**.
- Rank ladder added to admin (see §6).

## 5. TV board

~17 counts re-sourced through `counts.js`. Per the audit:

| what | today | after |
|---|---|---|
| `lifetime.total_orders` «طلب على الإطلاق» | pieces | bundles |
| `lifetime.delivered_total` «طلب مُسلَّم» | pieces, always 0 | **panel deleted** |
| `kpis.orders_today` «طلبات اليوم» | pieces | bundles |
| `kpis.delivered_today` / هدف اليوم | always 0 | **deleted** |
| `records.best_day/​best_month` | pieces | bundles |
| `growth.this_year/last_year` | pieces | bundles |
| universities / governorate charts | pieces labelled طلبات | bundles, labelled طلب |
| `deadlines[].open_orders` | pieces | bundles |
| `graphs.orders_in / done` | pieces | bundles |
| `pipeline.wip` «قطعة قيد العمل» | pieces ✓ | unchanged (already correct) |
| `settings.bottleneck_threshold` | pieces vs طلب label | pieces, **label → قطعة** |

**Stored settings keep their values.** حد الاختناق and هدف اليوم genuinely measure
production load, so they continue comparing against piece counts and only their labels are
corrected. Nothing stored changes; no alert re-tuning needed after deploy.

## 6. Rank ladder — rebuilt on retail orders

Today `rankFor(lifetime.total_orders)` is fed **pieces**, inflating rank ~3×.

Baseline: **218 retail bundles** (193 students, 704 pieces); rep side is 360 bundles.
Retail growth 30 (June) → 189 (July).

The ladder now measures **retail طلب** — direct student orders, the growth the owner is
actually chasing — with the top rank at the stated goal of **3000**:

```
٠ · ٥٠ · ١٠٠ · ٢٥٠ · ٥٠٠ · ٧٥٠ · ١٠٠٠ · ١٥٠٠ · ٢٠٠٠ · ٢٥٠٠ · ٣٠٠٠
                 ↑ current 218
```

Displayed on **both** the TV and the admin dashboard, labelled «طلب تجزئة» so it is never
confused with the total order count.

---

## 6b. Two scopes of «طلب» on one page — named, not hidden

Verification surfaced a second ambiguity that is NOT a unit problem but reads like one:

- `totals.orders` = **492** — the SETTLEMENT count (retail + rep-approved only).
- `headline.bundles` = **578** — the OPERATIONAL count (everything not cancelled).

Both are bundles; they differ by the 86 pending/rejected rep bundles. Rather than pick
one, the money-ledger figure is labelled **«طلبات محتسبة»** so the two numbers read as
different questions instead of a contradiction.

## 6c. Known limitation — monthly/record bundle counts

Date-bucketed bundle counts (best day, best month, the YoY climbing graph) count a bundle
once per bucket its pieces fall into. A طقم whose sash was created in June and whose cap
was added in July counts in both months, so the monthly series sums to **592** against a
true total of **578** (~2.4% skew).

Correcting it means dating each bundle by its first piece (`DISTINCT ON … ORDER BY
created_at`) in four separate queries. Deferred, not forgotten — it does not affect any
headline figure, only the shape of the trend line.

## 7. Out of scope (pass 2+)

- Rep and staff screens (`/wholesaler`, `/staff/queue`, `/staff` home) — they keep the
  current wording, so «طلب» briefly means something looser there than on `/admin`.
- List *rows*: `/admin/orders` still renders one row per piece.
- `batchController.js` ships `order_count` twice with different units (`:48` bundles,
  `:97` pieces) in one response — latent, no UI consumer today.
- `wholesalerController.js:36` `pending_count` counts students but reads as orders.
- Money and settlement logic — untouched.
