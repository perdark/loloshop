"use client";

/**
 * «الربح الحقيقي» — the tab the whole page exists for. The dashboard's «دخل المحل» was
 * always revenue, never profit (see `retailCostMissing` on `/admin`); this receipt
 * subtracts every cost the admin has entered — materials, workshop wages, salaries, fixed
 * and one-off expenses, losses, the AI bill — down to «صافي الربح التقريبي».
 *
 * The word «تقريبي» (approximate) is load-bearing: nothing here is exact until the admin
 * confirms every cost item and expense on tabs 2–4. The confidence badge says how far along
 * that is, and every warning the server sends is shown as-is — never swallowed.
 */

import { useEffect, useMemo, useState } from "react";
import { formatIQD, toArabicDigits } from "@/lib/format";
import { getApiErrorMessage } from "@/lib/api";
import { getCostPnl, PRODUCT_TYPE_LABEL, SALARY_SOURCE_LABEL, type Pnl } from "@/lib/costs";

type Preset = "this" | "last" | "last3" | "fromStart";

const FROM_START = "2026-06";

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthKey(d);
}

function presetRange(preset: Preset): { from: string; to: string } {
  const now = monthKey(new Date());
  switch (preset) {
    case "this":
      return { from: now, to: now };
    case "last": {
      const last = addMonths(now, -1);
      return { from: last, to: last };
    }
    case "last3":
      return { from: addMonths(now, -2), to: now };
    case "fromStart":
      return { from: FROM_START, to: now };
  }
}

const MONTH_FORMAT = new Intl.DateTimeFormat("ar-IQ", { year: "numeric", month: "long" });

function formatMonthAr(month: string): string {
  if (month === "total") return "الإجمالي";
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return MONTH_FORMAT.format(new Date(y, m - 1, 1));
}

export function PnlTab() {
  const [preset, setPreset] = useState<Preset>("last3");
  const [range, setRange] = useState(() => presetRange("last3"));
  const [pnl, setPnl] = useState<Pnl | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getCostPnl(range.from, range.to)
      .then((data) => {
        if (!cancelled) setPnl(data);
      })
      .catch((e) => {
        if (!cancelled) setError(getApiErrorMessage(e, "تعذّر تحميل تقرير الربح"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  function choosePreset(p: Preset) {
    setPreset(p);
    setRange(presetRange(p));
  }

  const perProductSorted = useMemo(() => {
    if (!pnl) return [];
    return [...pnl.per_product].sort((a, b) => b.contribution - a.contribution);
  }, [pnl]);

  return (
    <div className="space-y-8">
      {/* Month range */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="المدة الزمنية">
        {(
          [
            ["this", "هذا الشهر"],
            ["last", "الشهر الماضي"],
            ["last3", "آخر ٣ أشهر"],
            ["fromStart", "من البداية"],
          ] as [Preset, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => choosePreset(key)}
            aria-pressed={preset === key}
            className={`min-h-11 rounded-full border px-4 text-sm font-semibold transition-colors ${
              preset === key
                ? "border-orange-ink bg-orange-ink text-white"
                : "border-line bg-surface text-ink hover:border-ink/35"
            }`}
          >
            {label}
          </button>
        ))}
        <div className="flex w-full items-center gap-2 text-sm text-ink-soft sm:w-auto" dir="ltr">
          <input
            type="month"
            aria-label="من شهر"
            value={range.from}
            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-beige px-3 text-sm text-ink outline-none focus:border-orange-ink sm:flex-none"
          />
          <span>إلى</span>
          <input
            type="month"
            aria-label="إلى شهر"
            value={range.to}
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-beige px-3 text-sm text-ink outline-none focus:border-orange-ink sm:flex-none"
          />
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          <div className="skeleton h-48 rounded-2xl" />
          <div className="skeleton h-40 rounded-2xl" />
        </div>
      ) : error || !pnl ? (
        <div className="rounded-2xl border border-danger/25 bg-surface px-6 py-12 text-center">
          <p className="font-bold text-ink">{error || "تعذّر تحميل التقرير"}</p>
        </div>
      ) : (
        <PnlReport pnl={pnl} perProductSorted={perProductSorted} />
      )}
    </div>
  );
}

function PnlReport({
  pnl,
  perProductSorted,
}: {
  pnl: Pnl;
  perProductSorted: Pnl["per_product"];
}) {
  const { total } = pnl;
  const itemsConfirmed = pnl.confidence.items_confirmed + pnl.confidence.expenses_confirmed;
  const itemsTotal = pnl.confidence.items_total + pnl.confidence.expenses_total;
  const netPositive = total.net >= 0;

  const rows: { label: string; amount: number; hint?: string }[] = [
    { label: "مواد الإنتاج التقديرية", amount: total.costs.materials },
    { label: "أجور الورشة بالقطعة", amount: total.costs.workshop_wages },
    { label: "رواتب الموظفين", amount: total.costs.salaries },
    { label: "مصاريف شهرية ثابتة", amount: total.costs.fixed_expenses },
    { label: "مصاريف لمرة واحدة", amount: total.costs.one_off_expenses },
    { label: "خسائر", amount: total.costs.losses },
    {
      label: "الذكاء الاصطناعي",
      amount: total.costs.ai,
      hint: `$${pnl.ai_usd.toFixed(2)} × ${toArabicDigits(pnl.usd_iqd)}`,
    },
  ];

  return (
    <div className="space-y-8">
      {/* The waterfall receipt */}
      <section className="max-w-[560px] rounded-2xl border border-line bg-surface p-6 sm:p-7">
        <div className="flex items-center justify-between gap-3 border-b-2 border-ink pb-3">
          <h2 className="font-display text-xl font-bold text-ink">دخل المحل → صافي الربح</h2>
          <span
            className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-900"
            title="الأرقام تقديرية حتى تُؤكَّد كل البنود من تبويبي «بنود التكلفة» و«المصاريف والخسائر»"
          >
            تقديري — {toArabicDigits(itemsConfirmed)} من {toArabicDigits(itemsTotal)} بند مؤكد
          </span>
        </div>

        <ul className="mt-3 list-none space-y-1.5 p-0">
          <li className="flex items-baseline justify-between gap-4 py-1.5">
            <span className="text-[0.92rem] font-semibold text-ink">دخل المحل</span>
            <span className="font-bold tabular-nums text-ink" dir="ltr">
              {formatIQD(total.income.shop_income)}
            </span>
          </li>
          {rows.map((row) => (
            <li key={row.label} className="flex items-baseline justify-between gap-4 py-1">
              <span className="text-[0.88rem] text-ink-soft">
                − {row.label}
                {row.hint && (
                  <span className="ms-1.5 text-[0.72rem] text-[var(--shop-muted)]">
                    ({row.hint})
                  </span>
                )}
              </span>
              <span className="tabular-nums text-ink-soft" dir="ltr">
                {formatIQD(row.amount)}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-3 flex items-center justify-between gap-4 border-t-2 border-ink pt-4">
          <div>
            <p className="font-display text-lg font-bold text-ink">صافي الربح التقريبي</p>
            {total.margin_pct != null && (
              <p className="text-xs text-ink-soft">هامش {toArabicDigits(Math.round(total.margin_pct))}٪</p>
            )}
          </div>
          <span
            className={`text-[1.9rem] font-bold tabular-nums ${netPositive ? "text-green-700" : "text-danger"}`}
            dir="ltr"
          >
            {formatIQD(total.net)}
          </span>
        </div>

        {total.income.rep_margin > 0 && (
          <p className="mt-3 text-xs text-[var(--shop-muted)]">
            ربح الممثلين (مو إلنا): <span dir="ltr">{formatIQD(total.income.rep_margin)}</span>
          </p>
        )}
      </section>

      {/* Warnings */}
      {pnl.warnings.length > 0 && (
        <ul className="space-y-2">
          {pnl.warnings.map((w) => (
            <li
              key={w.code}
              className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900"
            >
              {w.text_ar}
            </li>
          ))}
        </ul>
      )}

      {/* Per-month table */}
      <section>
        <h3 className="mb-3 text-base font-bold text-ink">حسب الشهر</h3>
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="border-b border-line text-ink-soft">
              <tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:text-start">
                <th>الشهر</th>
                <th>دخل المحل</th>
                <th>التكاليف</th>
                <th>الصافي</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {pnl.months.map((m) => (
                <tr key={m.month} className="[&>td]:px-4 [&>td]:py-3">
                  <td className="font-semibold text-ink">
                    {formatMonthAr(m.month)}
                    {m.partial && (
                      <span className="ms-1.5 text-xs font-normal text-[var(--shop-muted)]">
                        (لحد اليوم)
                      </span>
                    )}
                  </td>
                  <td dir="ltr">{formatIQD(m.income.shop_income)}</td>
                  <td dir="ltr">{formatIQD(m.total_costs)}</td>
                  <td
                    className={`font-bold ${m.net >= 0 ? "text-green-700" : "text-danger"}`}
                    dir="ltr"
                  >
                    {formatIQD(m.net)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Per-product table */}
      <section>
        <h3 className="mb-3 text-base font-bold text-ink">حسب المنتج</h3>
        {perProductSorted.length === 0 ? (
          <p className="rounded-2xl border border-line bg-surface px-5 py-8 text-center text-sm text-ink-soft">
            لا توجد بيانات منتجات لهذه المدة.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-line text-ink-soft">
                <tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:text-start">
                  <th>المنتج</th>
                  <th>القطع</th>
                  <th>دخل المحل للقطعة</th>
                  <th>تكلفة المواد للقطعة</th>
                  <th>هامش القطعة</th>
                  <th>المساهمة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {perProductSorted.map((row) => {
                  const margin = row.income_per_piece - row.material_cost_per_piece;
                  const low = margin <= 0;
                  const warn = !low && row.income_per_piece > 0 && margin / row.income_per_piece < 0.2;
                  return (
                    <tr
                      key={row.product_id}
                      className={`[&>td]:px-4 [&>td]:py-3 ${low ? "bg-danger/5" : warn ? "bg-amber-50" : ""}`}
                    >
                      <td className="font-semibold text-ink">
                        {row.name_ar}
                        <span className="ms-1.5 text-xs text-ink-soft">
                          ({PRODUCT_TYPE_LABEL[row.product_type]})
                        </span>
                      </td>
                      <td dir="ltr">{toArabicDigits(row.pieces)}</td>
                      <td dir="ltr">{formatIQD(row.income_per_piece)}</td>
                      <td dir="ltr">{formatIQD(row.material_cost_per_piece)}</td>
                      <td className={`font-semibold ${low ? "text-danger" : warn ? "text-amber-800" : "text-ink"}`} dir="ltr">
                        {formatIQD(margin)}
                      </td>
                      <td className="font-bold text-ink" dir="ltr">
                        {formatIQD(row.contribution)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Salaries detail */}
      <section>
        <h3 className="mb-3 text-base font-bold text-ink">تفصيل الرواتب</h3>
        {pnl.salaries_detail.length === 0 ? (
          <p className="rounded-2xl border border-line bg-surface px-5 py-8 text-center text-sm text-ink-soft">
            لا توجد رواتب محتسبة لهذه المدة.
          </p>
        ) : (
          <div className="divide-y divide-line rounded-2xl border border-line bg-surface">
            {pnl.salaries_detail.map((row) => (
              <div key={row.user_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{row.name}</p>
                  <p className="text-xs text-ink-soft">
                    {SALARY_SOURCE_LABEL[row.source]}
                    {row.note_ar ? ` · ${row.note_ar}` : ""}
                  </p>
                </div>
                <span className="font-bold tabular-nums text-ink" dir="ltr">
                  {formatIQD(row.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Losses detail */}
      {(pnl.losses_detail.manual > 0 || pnl.losses_detail.cancelled_after_work.pieces > 0) && (
        <section>
          <h3 className="mb-3 text-base font-bold text-ink">تفصيل الخسائر</h3>
          <div className="space-y-1.5 rounded-2xl border border-line bg-surface p-4 text-sm text-ink-soft">
            <p>خسائر مُدخلة يدوياً: <span dir="ltr">{formatIQD(pnl.losses_detail.manual)}</span></p>
            {pnl.losses_detail.cancelled_after_work.pieces > 0 && (
              <p>
                طلبات أُلغيت بعد بدء العمل عليها: {toArabicDigits(pnl.losses_detail.cancelled_after_work.pieces)} قطعة ·
                تقدير خسارة المواد{" "}
                <span dir="ltr">{formatIQD(pnl.losses_detail.cancelled_after_work.material_estimate)}</span>
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
