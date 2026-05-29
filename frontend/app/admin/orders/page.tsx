"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import { getAdminOrders, getAdminWholesalers, updateOrderCost } from "@/lib/admin";
import { ORDER_STATUS_LABELS, ORDER_STATUS_OPTIONS } from "@/lib/constants";
import { formatDateShort, formatIQD } from "@/lib/format";
import type { AdminOrder, AdminWholesaler, OrderStatus } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";

type SortKey = "profit" | "cost" | "price" | null;
type SortDir = "asc" | "desc";

function profitColor(profit: number | null | undefined): string {
  if (profit == null) return "text-ink-soft";
  return profit < 0 ? "text-rose-700" : "text-emerald-700";
}

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [wholesalers, setWholesalers] = useState<AdminWholesaler[]>([]);
  const [loading, setLoading] = useState(true);
  const [wholesalerId, setWholesalerId] = useState("");
  const [status, setStatus] = useState<OrderStatus | "">("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [costDraftById, setCostDraftById] = useState<Record<string, string>>({});
  const [savingCostId, setSavingCostId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");

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
      setCostDraftById(
        Object.fromEntries(
          ordersData.map((o) => [o.id, o.cost != null ? String(o.cost) : ""])
        )
      );
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر تحميل الطلبات"));
    } finally {
      setLoading(false);
    }
  }, [wholesalerId, status, dateFrom, dateTo]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount / filters
    load();
  }, [load]);

  async function handleSaveCost(orderId: string) {
    const raw = (costDraftById[orderId] ?? "").trim().replace(/[^\d]/g, "");
    if (raw === "") {
      toast.error("أدخل رقماً للتكلفة (دينار عراقي)");
      return;
    }
    const cost = Number.parseInt(raw, 10);
    if (Number.isNaN(cost) || cost < 0) {
      toast.error("تكلفة غير صالحة");
      return;
    }
    setSavingCostId(orderId);
    try {
      await updateOrderCost(orderId, cost);
      toast.success("تم حفظ التكلفة");
      await load();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر حفظ التكلفة"));
    } finally {
      setSavingCostId(null);
    }
  }

  // Fix 4: strip non-digits on input and write the cleaned integer back so
  // what you see == what gets saved. IQD has no decimals.
  function handleCostInput(orderId: string, raw: string) {
    const digits = raw.replace(/[^\d]/g, "");
    setCostDraftById((p) => ({ ...p, [orderId]: digits }));
  }

  // Fix 3: toggle sort key / direction
  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function sortArrow(key: SortKey) {
    if (sortKey !== key) return <span className="ms-1 opacity-30">↕</span>;
    return (
      <span className="ms-1 opacity-80">{sortDir === "desc" ? "↓" : "↑"}</span>
    );
  }

  const sortedOrders = sortKey
    ? [...orders].sort((a, b) => {
        const av = (a[sortKey] as number | null) ?? -Infinity;
        const bv = (b[sortKey] as number | null) ?? -Infinity;
        return sortDir === "asc" ? av - bv : bv - av;
      })
    : orders;

  // Fix 2: totals for the current filtered (and sorted) set
  const totalPrice = sortedOrders.reduce((s, o) => s + (o.price ?? 0), 0);
  const totalCost = sortedOrders.reduce((s, o) => s + (o.cost ?? 0), 0);
  const totalProfit = sortedOrders.reduce((s, o) => s + (o.profit ?? 0), 0);

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

      <div className="surface-card mb-6 grid gap-3 rounded-2xl p-4 sm:grid-cols-2 lg:grid-cols-4">
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
          {/* ── Desktop table ── */}
          {/* Fix 6: scroll wrapper is keyboard-focusable */}
          <div
            className="surface-card hidden overflow-x-auto rounded-2xl md:block"
            tabIndex={0}
            role="region"
            aria-label="جدول الطلبات"
          >
            <table className="w-full min-w-[880px] text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-ink/10 bg-ink/[0.04] text-right text-xs uppercase tracking-wide text-[var(--shop-muted)]">
                  <th className="px-4 py-3 font-semibold">الاسم الكامل</th>
                  <th className="px-4 py-3 font-semibold">المنتج</th>
                  {/* Fix 3: sortable price header */}
                  <th
                    className="cursor-pointer select-none px-4 py-3 font-semibold hover:text-ink/90"
                    onClick={() => handleSort("price")}
                  >
                    السعر {sortArrow("price")}
                  </th>
                  {/* Fix 3: sortable cost header */}
                  <th
                    className="cursor-pointer select-none px-4 py-3 font-semibold hover:text-ink/90"
                    onClick={() => handleSort("cost")}
                  >
                    التكلفة {sortArrow("cost")}
                  </th>
                  {/* Fix 3: sortable profit header */}
                  <th
                    className="cursor-pointer select-none px-4 py-3 font-semibold hover:text-ink/90"
                    onClick={() => handleSort("profit")}
                  >
                    الربح {sortArrow("profit")}
                  </th>
                  <th className="px-4 py-3 font-semibold">الحالة</th>
                  <th className="px-4 py-3 font-semibold">الممثل</th>
                  <th className="px-4 py-3 font-semibold">تعديل التكلفة</th>
                </tr>
              </thead>
              <tbody>
                {sortedOrders.map((order) => (
                  <tr
                    key={order.id}
                    className="border-b border-ink/5 transition-colors odd:bg-cream/40 last:border-0 hover:bg-peach/25"
                  >
                    <td className="px-4 py-3 font-medium text-ink">{order.studentName}</td>
                    <td className="px-4 py-3 text-ink/80">
                      {order.productName}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-ink/80" dir="ltr">{formatIQD(order.price)}</td>
                    <td className="px-4 py-3 tabular-nums text-ink/80" dir="ltr">
                      {order.cost != null ? formatIQD(order.cost) : "—"}
                    </td>
                    {/* Fix 1: profit color driven by value */}
                    <td
                      className={`px-4 py-3 font-semibold tabular-nums ${profitColor(order.profit)}`}
                      dir="ltr"
                    >
                      {order.profit != null ? formatIQD(order.profit) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-full bg-ink/[0.06] px-2.5 py-1 text-xs font-medium text-ink/70">
                        {ORDER_STATUS_LABELS[order.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink/70">{order.wholesalerName}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Fix 4 + Fix 5: digits-only input, aria-label */}
                        <Input
                          type="text"
                          inputMode="numeric"
                          className="max-w-[8rem]"
                          value={costDraftById[order.id] ?? ""}
                          onChange={(e) => handleCostInput(order.id, e.target.value)}
                          placeholder="د.ع"
                          dir="ltr"
                          aria-label="التكلفة"
                        />
                        <Button
                          className="min-h-9 px-3 py-2 text-xs"
                          loading={savingCostId === order.id}
                          onClick={() => handleSaveCost(order.id)}
                        >
                          حفظ
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* Fix 2: totals footer row */}
              <tfoot>
                <tr className="border-t-2 border-ink/20 bg-ink/[0.04] font-semibold text-sm">
                  <td className="px-4 py-3 text-ink/70" colSpan={2}>
                    الإجمالي ({sortedOrders.length} طلب)
                  </td>
                  <td className="px-4 py-3 tabular-nums text-ink/80" dir="ltr">
                    {formatIQD(totalPrice)}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-ink/80" dir="ltr">
                    {formatIQD(totalCost)}
                  </td>
                  <td
                    className={`px-4 py-3 tabular-nums ${profitColor(totalProfit)}`}
                    dir="ltr"
                  >
                    {formatIQD(totalProfit)}
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* ── Mobile cards ── */}
          <div className="space-y-3 md:hidden">
            {sortedOrders.map((order) => (
              <article
                key={order.id}
                className="surface-card card-lift rounded-2xl p-4"
              >
                <p className="font-semibold text-ink">{order.studentName}</p>
                <p className="mt-1 text-sm text-ink-soft">
                  {order.productName} · {order.wholesalerName ?? "—"}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-[var(--shop-muted)]">السعر: </span>
                    <span className="tabular-nums" dir="ltr">{formatIQD(order.price)}</span>
                  </div>
                  <div>
                    <span className="text-[var(--shop-muted)]">التكلفة: </span>
                    <span className="tabular-nums" dir="ltr">{order.cost != null ? formatIQD(order.cost) : "—"}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-[var(--shop-muted)]">الربح: </span>
                    {/* Fix 1 (mobile): profit color driven by value */}
                    <span
                      className={`font-semibold tabular-nums ${profitColor(order.profit)}`}
                      dir="ltr"
                    >
                      {order.profit != null ? formatIQD(order.profit) : "—"}
                    </span>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink/10 pt-3">
                  <span className="text-sm text-[var(--shop-muted)]">تعديل التكلفة:</span>
                  {/* Fix 4 + Fix 5 (mobile): digits-only input, aria-label */}
                  <Input
                    type="text"
                    inputMode="numeric"
                    className="max-w-[7rem]"
                    value={costDraftById[order.id] ?? ""}
                    onChange={(e) => handleCostInput(order.id, e.target.value)}
                    placeholder="د.ع"
                    dir="ltr"
                    aria-label="التكلفة"
                  />
                  <Button
                    className="min-h-9 px-3 py-2 text-xs"
                    loading={savingCostId === order.id}
                    onClick={() => handleSaveCost(order.id)}
                  >
                    حفظ
                  </Button>
                </div>
                <p className="mt-2 text-xs text-[var(--shop-muted)]">
                  {ORDER_STATUS_LABELS[order.status]} · {formatDateShort(order.createdAt)}
                </p>
              </article>
            ))}

            {/* Fix 2 (mobile): summary card */}
            <div className="surface-card rounded-2xl border-2 border-ink/10 p-4 text-sm">
              <p className="mb-3 font-semibold text-ink">
                الإجمالي — {sortedOrders.length} طلب
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[var(--shop-muted)]">السعر: </span>
                  <span className="tabular-nums" dir="ltr">{formatIQD(totalPrice)}</span>
                </div>
                <div>
                  <span className="text-[var(--shop-muted)]">التكلفة: </span>
                  <span className="tabular-nums" dir="ltr">{formatIQD(totalCost)}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-[var(--shop-muted)]">الربح: </span>
                  <span
                    className={`font-semibold tabular-nums ${profitColor(totalProfit)}`}
                    dir="ltr"
                  >
                    {formatIQD(totalProfit)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
