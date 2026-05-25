"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getAdminOrders, getAdminWholesalers } from "@/lib/admin";
import { ORDER_STATUS_LABELS, ORDER_STATUS_OPTIONS } from "@/lib/constants";
import { formatDateShort, formatIQD } from "@/lib/format";
import type { AdminOrder, AdminWholesaler, OrderStatus } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [wholesalers, setWholesalers] = useState<AdminWholesaler[]>([]);
  const [loading, setLoading] = useState(true);
  const [wholesalerId, setWholesalerId] = useState("");
  const [status, setStatus] = useState<OrderStatus | "">("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ordersData, wholesalersData] = await Promise.all([
        getAdminOrders({
          wholesalerId: wholesalerId || undefined,
          status: status || undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
        }),
        getAdminWholesalers(),
      ]);
      setOrders(ordersData);
      setWholesalers(wholesalersData);
    } catch {
      toast.error("تعذر تحميل الطلبات");
    } finally {
      setLoading(false);
    }
  }, [wholesalerId, status, dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  const wholesalerOptions = [
    { value: "", label: "كل الممثلين" },
    ...wholesalers.map((w) => ({ value: w.id, label: w.name })),
  ];

  const statusOptions = [
    { value: "", label: "كل الحالات" },
    ...ORDER_STATUS_OPTIONS.map((s) => ({
      value: s,
      label: ORDER_STATUS_LABELS[s],
    })),
  ];

  return (
    <div dir="rtl" lang="ar">
      <PageHeader title="الطلبات" subtitle="جميع طلبات الطلاب مع الأرباح" />

      <div className="mb-6 grid gap-3 rounded-xl border border-ink/10 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          label="الممثل"
          options={wholesalerOptions}
          value={wholesalerId}
          onChange={(e) => setWholesalerId(e.target.value)}
        />
        <Select
          label="الحالة"
          options={statusOptions}
          value={status}
          onChange={(e) => setStatus(e.target.value as OrderStatus | "")}
        />
        <Input
          label="من تاريخ"
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
        />
        <Input
          label="إلى تاريخ"
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
        />
        <div className="flex items-end sm:col-span-2 lg:col-span-4">
          <Button onClick={load} loading={loading}>
            تطبيق الفلاتر
          </Button>
        </div>
      </div>

      {loading ? (
        <PageLoader />
      ) : orders.length === 0 ? (
        <EmptyState message="لا توجد طلبات مطابقة" />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-xl border border-ink/10 bg-white md:block">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="border-b border-ink/10 bg-ink/5 text-right">
                  <th className="px-4 py-3 font-semibold text-ink">الاسم الكامل</th>
                  <th className="px-4 py-3 font-semibold text-ink">المنتج</th>
                  <th className="px-4 py-3 font-semibold text-ink">السعر</th>
                  <th className="px-4 py-3 font-semibold text-ink">التكلفة</th>
                  <th className="px-4 py-3 font-semibold text-ink">الربح</th>
                  <th className="px-4 py-3 font-semibold text-ink">الحالة</th>
                  <th className="px-4 py-3 font-semibold text-ink">الممثل</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-b border-ink/5 last:border-0">
                    <td className="px-4 py-3">{order.studentName}</td>
                    <td className="px-4 py-3">
                      {order.productName}
                    </td>
                    <td className="px-4 py-3">{formatIQD(order.price)}</td>
                    <td className="px-4 py-3">
                      {order.cost != null ? formatIQD(order.cost) : "—"}
                    </td>
                    <td className="px-4 py-3 font-semibold text-emerald-700">
                      {order.profit != null ? formatIQD(order.profit) : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {ORDER_STATUS_LABELS[order.status]}
                    </td>
                    <td className="px-4 py-3 text-ink/70">{order.wholesalerName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 md:hidden">
            {orders.map((order) => (
              <article
                key={order.id}
                className="rounded-xl border border-ink/10 bg-white p-4"
              >
                <p className="font-semibold text-ink">{order.studentName}</p>
                <p className="mt-1 text-sm text-ink/60">
                  {order.productName} · {order.wholesalerName ?? "—"}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-ink/50">السعر: </span>
                    {formatIQD(order.price)}
                  </div>
                  <div>
                    <span className="text-ink/50">التكلفة: </span>
                    {order.cost != null ? formatIQD(order.cost) : "—"}
                  </div>
                  <div className="col-span-2">
                    <span className="text-ink/50">الربح: </span>
                    <span className="font-semibold text-emerald-700">
                      {order.profit != null ? formatIQD(order.profit) : "—"}
                    </span>
                  </div>
                </div>
                <p className="mt-2 text-xs text-ink/50">
                  {ORDER_STATUS_LABELS[order.status]} · {formatDateShort(order.createdAt)}
                </p>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
