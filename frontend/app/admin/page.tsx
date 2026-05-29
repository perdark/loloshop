"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { getAdminAnalytics, getAdminAccounting } from "@/lib/admin";
import { ORDER_STATUS_LABELS } from "@/lib/constants";
import { formatIQD } from "@/lib/format";
import type { AdminAccounting, AdminAnalytics } from "@/lib/types";

const DailyOrdersChart = dynamic(
  () =>
    import("@/components/admin/DailyOrdersChart").then((m) => m.DailyOrdersChart),
  { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-2xl bg-ink/5" /> }
);

/* Latin → Arabic-Indic digits, for counts rendered outside formatIQD. */
const toArabicDigits = (n: number | string) =>
  String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);

/* ── Editorial money: big numeral, quiet unit ──
   formatIQD returns "<number> د.ع"; we split the unit so the figure reads as
   a magazine number with a muted currency tag rather than a wall of text. */
function Money({ amount, className = "" }: { amount: number; className?: string }) {
  const formatted = formatIQD(amount);
  const unit = " د.ع";
  const num = formatted.endsWith(unit)
    ? formatted.slice(0, -unit.length)
    : formatted;
  return (
    <span dir="ltr" className={`tabular-nums ${className}`}>
      {num}
      <span className="ms-1.5 align-baseline text-[0.42em] font-semibold tracking-wide text-ink/45">
        د.ع
      </span>
    </span>
  );
}

/* A single ledger figure: small label over a large numeral. The whole
   dashboard speaks in these instead of bordered stat cards. */
function Figure({
  label,
  value,
  hint,
  accent,
  size = "lg",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  accent?: boolean;
  size?: "lg" | "sm";
}) {
  return (
    <div className="px-5 py-6 sm:px-7 lg:py-7">
      <dt className="text-sm font-medium text-[var(--shop-muted)]">{label}</dt>
      <dd
        className={`mt-3 font-bold leading-none ${
          size === "lg"
            ? "text-[1.7rem] lg:text-[2.1rem]"
            : "text-2xl lg:text-[1.75rem]"
        } ${accent ? "text-orange-ink" : "text-ink"}`}
      >
        {value}
      </dd>
      {hint && (
        <dd className="mt-2.5 text-xs font-medium text-[var(--shop-muted)]">
          {hint}
        </dd>
      )}
    </div>
  );
}

/* Editorial section header: display-serif title + thin warm rule. */
function SectionHead({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="section-heading mb-7">
      <h2 className="shrink-0 font-display text-xl font-bold tracking-tight text-ink lg:text-2xl">
        {title}
      </h2>
      {meta && (
        <span className="order-last shrink-0 text-sm font-medium text-[var(--shop-muted)]">
          {meta}
        </span>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div dir="rtl" lang="ar" className="mx-auto max-w-6xl animate-fade-page-in">
      <div className="mb-10 space-y-3">
        <div className="skeleton h-9 w-52" />
        <div className="skeleton h-4 w-64" />
      </div>
      <div className="grid grid-cols-2 border-y border-ink/10 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="px-5 py-7 sm:px-7">
            <div className="skeleton h-4 w-24" />
            <div className="skeleton mt-4 h-8 w-32" />
          </div>
        ))}
      </div>
      <div className="mt-14 space-y-4">
        <div className="skeleton h-6 w-40" />
        <div className="skeleton h-56 w-full rounded-2xl" />
      </div>
    </div>
  );
}

export default function AdminDashboardPage() {
  const [data, setData] = useState<AdminAnalytics | null>(null);
  const [accounting, setAccounting] = useState<AdminAccounting | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const [analytics, acct] = await Promise.all([
        getAdminAnalytics(),
        getAdminAccounting(),
      ]);
      setData(analytics);
      setAccounting(acct);
    } catch {
      toast.error("تعذر تحميل الإحصائيات");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
  }, [load]);

  if (loading || !data || !accounting) {
    return <DashboardSkeleton />;
  }

  const margin =
    data.totalRevenue > 0
      ? `هامش الربح ${Math.round((data.totalProfit / data.totalRevenue) * 100)}٪`
      : undefined;

  // Breakdown groups for the accounting receipt; empty groups are dropped.
  const accountingGroups = [
    { title: "حسب الدفعة", rows: accounting.byBatch },
    { title: "حسب الممثل", rows: accounting.byWholesaler },
    { title: "تجزئة مستقلة", rows: [accounting.independentRetail] },
  ].filter((g) => g.rows.length > 0);

  return (
    <div dir="rtl" lang="ar" className="mx-auto max-w-6xl animate-page-in">
      {/* Editorial masthead */}
      <header className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold leading-tight tracking-tight text-ink lg:text-4xl">
            لوحة التحكم
          </h1>
          <p className="mt-2 text-base text-ink-soft">
            نظرة عامة على الأرباح والطلبات
          </p>
        </div>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={refreshing}
          className="group inline-flex shrink-0 items-center gap-2 self-start rounded-full border border-ink/15 bg-beige px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:border-orange/40 hover:text-orange-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-ink disabled:opacity-50 sm:self-auto"
        >
          <svg
            aria-hidden
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform duration-500 ${
              refreshing ? "animate-spin" : "group-hover:rotate-180"
            }`}
          >
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            <path d="M3 21v-5h5" />
          </svg>
          تحديث
        </button>
      </header>

      {/* Headline ledger — the four figures that define the business */}
      <dl className="grid grid-cols-2 divide-x divide-y divide-ink/10 border-y border-ink/10 [&>*]:border-ink/10 lg:grid-cols-4 lg:divide-y-0">
        <Figure label="إجمالي الإيرادات" value={<Money amount={data.totalRevenue} />} />
        <Figure label="إجمالي التكلفة" value={<Money amount={data.totalCost} />} />
        <Figure
          label="إجمالي الربح"
          value={<Money amount={data.totalProfit} />}
          accent
          hint={margin}
        />
        <Figure label="عدد الطلبات" value={String(data.orderCount)} />
      </dl>

      {/* Daily orders */}
      <section className="mt-14">
        <SectionHead title="الطلبات اليومية" />
        <div className="rounded-2xl bg-beige p-5 shadow-[var(--shadow-soft)]">
          <DailyOrdersChart data={data.dailyOrders} />
        </div>
      </section>

      {/* Orders by status — compact ledger row */}
      <section className="mt-16">
        <SectionHead title="الطلبات حسب الحالة" />
        <dl className="grid grid-cols-2 divide-x divide-y divide-ink/10 border-y border-ink/10 [&>*]:border-ink/10 sm:grid-cols-4 lg:divide-y-0">
          {Object.entries(data.ordersByStatus).map(([status, count]) => (
            <Figure
              key={status}
              size="sm"
              label={
                ORDER_STATUS_LABELS[status as keyof typeof ORDER_STATUS_LABELS] ??
                status
              }
              value={String(count)}
            />
          ))}
        </dl>
      </section>

      {/* Accounting — system receipt */}
      <section className="mt-16">
        <div className="max-w-[560px] rounded-2xl border border-[var(--color-neutral)] bg-[var(--shop-sink)] p-7 sm:p-8">
          <div className="flex items-baseline justify-between gap-3 border-b-2 border-ink pb-4">
            <h2 className="font-display text-2xl font-bold text-ink">محاسبة النظام</h2>
            <span className="text-xs tracking-[0.06em] text-[var(--shop-muted)]">
              إيصال النظام
            </span>
          </div>
          <ul className="mt-3.5 list-none p-0">
            <li className="flex items-baseline justify-between gap-4 py-1.5">
              <span className="text-[0.92rem] text-ink-soft">الإيراد</span>
              <span className="text-[0.95rem] font-bold tabular-nums text-ink" dir="ltr">
                {formatIQD(accounting.totals.revenue)}
              </span>
            </li>
            <li className="flex items-baseline justify-between gap-4 py-1.5">
              <span className="text-[0.92rem] text-ink-soft">التكلفة</span>
              <span className="text-[0.95rem] font-bold tabular-nums text-ink" dir="ltr">
                {formatIQD(accounting.totals.cost)}
              </span>
            </li>
            <li className="flex items-baseline justify-between gap-4 py-1.5">
              <span className="text-[0.92rem] text-ink-soft">عدد الطلبات</span>
              <span className="text-[0.95rem] font-bold tabular-nums text-ink" dir="ltr">
                {toArabicDigits(accounting.totals.orders)}
              </span>
            </li>
            {accountingGroups.map((group) => (
              <Fragment key={group.title}>
                <li className="pt-4 pb-0.5 text-[0.74rem] font-bold tracking-[0.04em] text-[var(--shop-muted)]">
                  {group.title}
                </li>
                {group.rows.map((row) => (
                  <li
                    key={row.label}
                    className="flex items-baseline justify-between gap-4 py-1.5"
                  >
                    <span className="text-[0.92rem] text-ink-soft">
                      {row.label}
                      <span className="text-xs text-[var(--shop-muted)]">
                        {" · "}
                        {toArabicDigits(row.orders)} طلب
                      </span>
                    </span>
                    <span
                      className="text-[0.95rem] font-bold tabular-nums text-ink"
                      dir="ltr"
                    >
                      {formatIQD(row.profit)}
                    </span>
                  </li>
                ))}
              </Fragment>
            ))}
          </ul>
          <div className="mt-3.5 flex items-center justify-between gap-4 border-t-2 border-ink pt-4">
            <span className="font-display text-xl font-bold text-ink">صافي الربح</span>
            <span
              className="text-[2rem] font-bold tabular-nums text-orange-ink"
              dir="ltr"
              style={{ fontFamily: "var(--font-amiri)" }}
            >
              {formatIQD(accounting.totals.profit)}
            </span>
          </div>
        </div>
      </section>

      {/* Top wholesalers — ranked editorial list */}
      <section className="mt-16 mb-4">
        <SectionHead
          title="أفضل الممثلين"
          meta={data.topWholesalers.length ? `${data.topWholesalers.length} ممثل` : undefined}
        />
        {data.topWholesalers.length ? (
          <ol className="border-t border-ink/10">
            {data.topWholesalers.map((w, i) => (
              <li
                key={w.id}
                className="flex items-center gap-5 border-b border-ink/8 py-4 transition-colors hover:bg-[var(--shop-sink)]"
              >
                <span
                  className={`w-8 shrink-0 text-center font-display text-2xl font-bold tabular-nums ${
                    i === 0 ? "text-orange-ink" : "text-ink/30"
                  }`}
                >
                  {i + 1}
                </span>
                <span className="flex-1 truncate font-medium text-ink">
                  {w.name}
                </span>
                <span className="shrink-0 text-sm text-ink-soft">
                  <span className="font-bold tabular-nums text-ink">
                    {w.orderCount}
                  </span>{" "}
                  طلب
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="py-10 text-center text-sm text-[var(--shop-muted)]">
            لا يوجد ممثلون بعد
          </p>
        )}
      </section>
    </div>
  );
}
