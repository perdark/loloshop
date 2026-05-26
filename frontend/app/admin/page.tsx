"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { getAdminAnalytics, getAdminAccounting } from "@/lib/admin";
import { ORDER_STATUS_LABELS } from "@/lib/constants";
import { formatIQD } from "@/lib/format";
import type { AdminAccounting, AdminAnalytics } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Button } from "@/components/ui/Button";
import { PageLoader } from "@/components/ui/Spinner";

const DailyOrdersChart = dynamic(
  () =>
    import("@/components/admin/DailyOrdersChart").then((m) => m.DailyOrdersChart),
  { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-xl bg-ink/5" /> }
);

function AccountingTable({
  title,
  rows,
}: {
  title: string;
  rows: AdminAccounting["byBatch"];
}) {
  if (!rows.length) return null;
  return (
    <div className="mt-6">
      <h3 className="mb-3 font-display text-base font-bold text-ink">{title}</h3>
      <div className="overflow-x-auto rounded-xl border border-ink/10 bg-white">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-b border-ink/10 bg-ink/5 text-right">
              <th className="px-4 py-3 font-semibold text-ink">الجهة</th>
              <th className="px-4 py-3 font-semibold text-ink">إيراد</th>
              <th className="px-4 py-3 font-semibold text-ink">تكلفة</th>
              <th className="px-4 py-3 font-semibold text-ink">ربح</th>
              <th className="px-4 py-3 font-semibold text-ink">طلبات</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-ink/5 last:border-0">
                <td className="px-4 py-3">{row.label}</td>
                <td className="px-4 py-3" dir="ltr">
                  {formatIQD(row.revenue)}
                </td>
                <td className="px-4 py-3" dir="ltr">
                  {formatIQD(row.cost)}
                </td>
                <td className="px-4 py-3 font-semibold text-emerald-700" dir="ltr">
                  {formatIQD(row.profit)}
                </td>
                <td className="px-4 py-3">{row.orders}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AdminDashboardPage() {
  const [data, setData] = useState<AdminAnalytics | null>(null);
  const [accounting, setAccounting] = useState<AdminAccounting | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
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
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
  }, [load]);

  if (loading || !data || !accounting) {
    return <PageLoader />;
  }

  return (
    <div dir="rtl" lang="ar">
      <PageHeader
        title="لوحة التحكم"
        subtitle="نظرة عامة على الأرباح والطلبات"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="إجمالي الإيرادات" value={formatIQD(data.totalRevenue)} />
        <StatCard label="إجمالي التكلفة" value={formatIQD(data.totalCost)} />
        <StatCard
          label="إجمالي الربح"
          value={formatIQD(data.totalProfit)}
          accent="profit"
        />
        <StatCard label="عدد الطلبات" value={String(data.orderCount)} />
      </div>

      <section className="mt-8">
        <h2 className="mb-4 font-display text-lg font-bold text-ink">
          محاسبة — إجمالي النظام
        </h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <StatCard
            label="إيراد المحاسبة"
            value={formatIQD(accounting.totals.revenue)}
          />
          <StatCard
            label="تكلفة المحاسبة"
            value={formatIQD(accounting.totals.cost)}
          />
          <StatCard
            label="ربح المحاسبة"
            value={formatIQD(accounting.totals.profit)}
            accent="profit"
          />
          <StatCard
            label="طلبات المحاسبة"
            value={String(accounting.totals.orders)}
          />
        </div>
        <AccountingTable title="حسب الدفعة" rows={accounting.byBatch} />
        <AccountingTable title="حسب الممثل" rows={accounting.byWholesaler} />
        <AccountingTable
          title="تجزئة مستقلة"
          rows={[accounting.independentRetail]}
        />
      </section>

      <section className="mt-8">
        <h2 className="mb-4 font-display text-lg font-bold text-ink">
          الطلبات حسب الحالة
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-4">
          {Object.entries(data.ordersByStatus).map(([status, count]) => (
            <div
              key={status}
              className="rounded-lg border border-ink/10 bg-white px-4 py-3 text-center"
            >
              <p className="text-2xl font-bold text-ink">{count}</p>
              <p className="mt-1 text-xs text-ink/60">
                {ORDER_STATUS_LABELS[status as keyof typeof ORDER_STATUS_LABELS]}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8 rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="mb-4 font-display text-lg font-bold text-ink">
          الطلبات اليومية
        </h2>
        <DailyOrdersChart data={data.dailyOrders} />
      </section>

      <section className="mt-8">
        <h2 className="mb-4 font-display text-lg font-bold text-ink">
          أفضل الممثلين
        </h2>
        <div className="overflow-x-auto rounded-xl border border-ink/10 bg-white">
          <table className="w-full min-w-[400px] text-sm">
            <thead>
              <tr className="border-b border-ink/10 bg-ink/5 text-right">
                <th className="px-4 py-3 font-semibold text-ink">الاسم</th>
                <th className="px-4 py-3 font-semibold text-ink">الطلبات</th>
              </tr>
            </thead>
            <tbody>
              {data.topWholesalers.map((w) => (
                <tr key={w.id} className="border-b border-ink/5 last:border-0">
                  <td className="px-4 py-3">{w.name}</td>
                  <td className="px-4 py-3">{w.orderCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-6">
        <Button variant="ghost" onClick={load}>
          تحديث
        </Button>
      </div>
    </div>
  );
}
