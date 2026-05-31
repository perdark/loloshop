"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import {
  getAdminOrders,
  getAdminOrderBundles,
  getAdminWholesalers,
  updateOrderCost,
} from "@/lib/admin";
import type { AdminBundle } from "@/lib/admin";
import { ORDER_SOURCE_LABELS, ORDER_STATUS_LABELS, ORDER_STATUS_OPTIONS } from "@/lib/constants";
import { formatDateShort, formatIQD } from "@/lib/format";
import type { AdminOrder, AdminWholesaler, OrderStatus } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewMode = "item" | "bundle";
type SortKey = "profit" | "cost" | "price" | null;
type SortDir = "asc" | "desc";

const PRODUCT_TYPE_CHIPS: { value: string; label: string }[] = [
  { value: "", label: "الكل" },
  { value: "sash", label: "وشاح" },
  { value: "robe", label: "روب" },
  { value: "cap", label: "كاب" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function profitColor(profit: number | null | undefined): string {
  if (profit == null) return "text-ink-soft";
  return profit < 0 ? "text-danger" : "text-ink";
}

function OrdersTableSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="skeleton h-10 w-full rounded-xl" />
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="skeleton h-14 w-full rounded-xl" />
      ))}
    </div>
  );
}

function BundlesSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="skeleton h-40 w-full rounded-2xl" />
      ))}
    </div>
  );
}

// ─── Bundle card ──────────────────────────────────────────────────────────────

function BundleCard({ bundle }: { bundle: AdminBundle }) {
  const isSingle = bundle.items.length === 1 && bundle.checkout_group_id === null;

  return (
    <article className={`surface-card rounded-2xl p-4 shadow-[var(--shadow-card)] ${isSingle ? "border border-line" : "border-2 border-orange-ink/20"}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-display-ar font-bold text-ink">
            {bundle.student_name}
          </p>
          {bundle.university_name && (
            <p className="text-sm text-ink-soft">{bundle.university_name}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!isSingle && (
            <span className="rounded-full border border-orange-ink/25 bg-orange-ink/8 px-2.5 py-0.5 text-xs font-semibold text-orange-ink">
              باقة ({bundle.items.length})
            </span>
          )}
          <span className="text-xs text-muted">{formatDateShort(bundle.created_at)}</span>
        </div>
      </div>

      {/* Items */}
      <ul className="mt-3 space-y-2">
        {bundle.items.map((item) => (
          <li
            key={item.order_id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border border-line bg-surface-sink px-3 py-2 text-sm"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Link
                href={`/staff/orders/${item.order_id}`}
                className="font-medium text-orange-ink hover:underline"
              >
                {item.product_name}
              </Link>
              <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-xs text-ink-soft">
                {ORDER_STATUS_LABELS[item.status] ?? item.status}
              </span>
            </div>
            <div className="flex items-center gap-4 tabular-nums text-xs">
              <span className="text-ink-soft" dir="ltr">{formatIQD(item.price)}</span>
              <span className={profitColor(item.profit)} dir="ltr">
                {item.profit != null ? formatIQD(item.profit) : "—"}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {/* Bundle totals */}
      <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl border border-orange-ink/15 bg-orange-ink/5 px-3 py-2 text-xs">
        <div>
          <p className="text-muted">الإجمالي</p>
          <p className="font-semibold tabular-nums text-ink" dir="ltr">
            {formatIQD(bundle.total_price)}
          </p>
        </div>
        <div>
          <p className="text-muted">التكلفة</p>
          <p className="font-semibold tabular-nums text-ink-soft" dir="ltr">
            {formatIQD(bundle.total_cost)}
          </p>
        </div>
        <div>
          <p className="text-muted">الربح</p>
          <p className={`font-semibold tabular-nums ${profitColor(bundle.total_profit)}`} dir="ltr">
            {formatIQD(bundle.total_profit)}
          </p>
        </div>
      </div>
    </article>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminOrdersPage() {
  // Shared filters
  const [wholesalerId, setWholesalerId] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"retail" | "wholesaler" | "">("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Item-mode-only
  const [status, setStatus] = useState<OrderStatus | "">("");
  const [typeFilter, setTypeFilter] = useState("");

  // View mode
  const [viewMode, setViewMode] = useState<ViewMode>("item");

  // Data
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [bundles, setBundles] = useState<AdminBundle[]>([]);
  const [wholesalers, setWholesalers] = useState<AdminWholesaler[]>([]);

  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  // Item mode extras
  const [costDraftById, setCostDraftById] = useState<Record<string, string>>({});
  const [savingCostId, setSavingCostId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(false);
    try {
      const wholesalersData = await getAdminWholesalers();
      setWholesalers(wholesalersData);

      if (viewMode === "bundle") {
        const bundlesData = await getAdminOrderBundles({
          wholesalerId: wholesalerId || undefined,
          source: sourceFilter || undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
        });
        setBundles(bundlesData);
      } else {
        const ordersData = await getAdminOrders({
          wholesalerId: wholesalerId || undefined,
          status: status || undefined,
          source: sourceFilter || undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          type: typeFilter || undefined,
        });
        setOrders(ordersData);
        setCostDraftById(
          Object.fromEntries(
            ordersData.map((o) => [o.id, o.cost != null ? String(o.cost) : ""])
          )
        );
      }
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر تحميل الطلبات"));
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [viewMode, wholesalerId, status, sourceFilter, dateFrom, dateTo, typeFilter]);

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

  function handleCostInput(orderId: string, raw: string) {
    const digits = raw.replace(/[^\d]/g, "");
    setCostDraftById((p) => ({ ...p, [orderId]: digits }));
  }

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

  const isEmpty =
    viewMode === "bundle" ? bundles.length === 0 : orders.length === 0;

  return (
    <div dir="rtl" lang="ar">
      <PageHeader title="الطلبات" subtitle="جميع طلبات الطلاب مع الأرباح" />

      {/* ── View mode toggle ── */}
      <div className="mb-5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setViewMode("item")}
          className={`inline-flex min-h-[44px] items-center rounded-full border px-5 py-2 text-sm font-semibold transition-colors ${
            viewMode === "item"
              ? "border-orange-ink bg-orange-ink text-white"
              : "border-line bg-surface text-ink-soft hover:border-orange-ink/40 hover:text-ink"
          }`}
        >
          عرض كقطع
        </button>
        <button
          type="button"
          onClick={() => setViewMode("bundle")}
          className={`inline-flex min-h-[44px] items-center rounded-full border px-5 py-2 text-sm font-semibold transition-colors ${
            viewMode === "bundle"
              ? "border-orange-ink bg-orange-ink text-white"
              : "border-line bg-surface text-ink-soft hover:border-orange-ink/40 hover:text-ink"
          }`}
        >
          عرض كباقات
        </button>
      </div>

      {/* ── Shared filters ── */}
      <div className="surface-card mb-4 grid gap-3 rounded-2xl p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          label="الممثل"
          options={wholesalerOptions}
          value={wholesalerId}
          onChange={(e) => setWholesalerId(e.target.value)}
        />
        {viewMode === "item" && (
          <Select
            label="الحالة"
            options={statusOptions}
            value={status}
            onChange={(e) => setStatus(e.target.value as OrderStatus | "")}
          />
        )}
        <Select
          label="المصدر"
          options={[
            { value: "", label: "الكل" },
            { value: "retail", label: ORDER_SOURCE_LABELS.retail },
            { value: "wholesaler", label: ORDER_SOURCE_LABELS.wholesaler },
          ]}
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as "retail" | "wholesaler" | "")}
        />
        <div dir="rtl" className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-muted">من تاريخ</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="min-h-11 w-full rounded-xl border border-line bg-beige px-3 py-2 text-end text-sm text-ink focus:border-orange-ink focus:outline-none focus:ring-2 focus:ring-orange-ink/15"
          />
        </div>
        <div dir="rtl" className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-muted">إلى تاريخ</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="min-h-11 w-full rounded-xl border border-line bg-beige px-3 py-2 text-end text-sm text-ink focus:border-orange-ink focus:outline-none focus:ring-2 focus:ring-orange-ink/15"
          />
        </div>
        <div className="flex items-end sm:col-span-2 lg:col-span-4">
          <Button onClick={load} loading={loading}>
            تطبيق الفلاتر
          </Button>
        </div>
      </div>

      {/* ── Component type chips — item mode only ── */}
      {viewMode === "item" && (
        <div className="mb-5 flex flex-wrap gap-2">
          {PRODUCT_TYPE_CHIPS.map((chip) => (
            <button
              key={chip.value}
              type="button"
              onClick={() => setTypeFilter(chip.value)}
              className={`inline-flex min-h-[44px] items-center rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                typeFilter === chip.value
                  ? "border-orange-ink bg-orange-ink text-white"
                  : "border-line bg-surface text-ink-soft hover:border-orange-ink/40 hover:text-ink"
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Content ── */}
      {loading ? (
        viewMode === "bundle" ? <BundlesSkeleton /> : <OrdersTableSkeleton />
      ) : fetchError ? (
        <div className="rounded-2xl border border-danger/25 bg-[var(--shop-sink)] px-6 py-10 text-center">
          <p className="text-base font-semibold text-ink">تعذر تحميل الطلبات</p>
          <p className="mt-1 text-sm text-ink-soft">تحقق من اتصالك ثم أعد المحاولة.</p>
          <Button className="mt-4" onClick={load}>إعادة المحاولة</Button>
        </div>
      ) : isEmpty ? (
        <EmptyState
          title="لا توجد طلبات"
          message="لا توجد طلبات مطابقة للفلاتر المحددة."
          action={
            <Button
              variant="ghost"
              onClick={() => {
                setWholesalerId("");
                setStatus("");
                setSourceFilter("");
                setDateFrom("");
                setDateTo("");
                setTypeFilter("");
              }}
            >
              مسح الفلاتر
            </Button>
          }
        />
      ) : viewMode === "bundle" ? (
        /* ── Bundle view ── */
        <div className="space-y-4">
          {bundles.map((b, idx) => (
            <BundleCard key={b.checkout_group_id ?? `single-${idx}`} bundle={b} />
          ))}
        </div>
      ) : (
        /* ── Item view ── */
        <>
          {/* Desktop table */}
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
                  <th
                    className="cursor-pointer select-none px-4 py-3 font-semibold hover:text-ink/90"
                    onClick={() => handleSort("price")}
                  >
                    السعر {sortArrow("price")}
                  </th>
                  <th
                    className="cursor-pointer select-none px-4 py-3 font-semibold hover:text-ink/90"
                    onClick={() => handleSort("cost")}
                  >
                    التكلفة {sortArrow("cost")}
                  </th>
                  <th
                    className="cursor-pointer select-none px-4 py-3 font-semibold hover:text-ink/90"
                    onClick={() => handleSort("profit")}
                  >
                    الربح {sortArrow("profit")}
                  </th>
                  <th className="px-4 py-3 font-semibold">الحالة</th>
                  <th className="px-4 py-3 font-semibold">الممثل</th>
                  <th className="px-4 py-3 font-semibold">المصدر</th>
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
                    <td className="px-4 py-3 text-ink-soft">{order.productName}</td>
                    <td className="px-4 py-3 tabular-nums text-ink-soft" dir="ltr">{formatIQD(order.price)}</td>
                    <td className="px-4 py-3 tabular-nums text-ink-soft" dir="ltr">
                      {order.cost != null ? formatIQD(order.cost) : "—"}
                    </td>
                    <td
                      className={`px-4 py-3 font-semibold tabular-nums ${profitColor(order.profit)}`}
                      dir="ltr"
                    >
                      {order.profit != null ? formatIQD(order.profit) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-full bg-ink/[0.06] px-2.5 py-1 text-xs font-medium text-muted">
                        {ORDER_STATUS_LABELS[order.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{order.wholesalerName ?? "—"}</td>
                    <td className="px-4 py-3">
                      {order.source ? (
                        order.source === "wholesaler" ? (
                          <span className="inline-flex rounded-full border border-orange-ink/25 bg-orange-ink/8 px-2.5 py-0.5 text-xs font-medium text-orange-ink">
                            {ORDER_SOURCE_LABELS.wholesaler}
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full border border-line bg-surface-sink px-2.5 py-0.5 text-xs font-medium text-ink-soft">
                            {ORDER_SOURCE_LABELS.retail}
                          </span>
                        )
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
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
              <tfoot>
                <tr className="border-t-2 border-ink/20 bg-ink/[0.04] font-semibold text-sm">
                  <td className="px-4 py-3 text-muted" colSpan={2}>
                    الإجمالي ({sortedOrders.length} طلب)
                  </td>
                  <td className="px-4 py-3 tabular-nums text-ink-soft" dir="ltr">
                    {formatIQD(totalPrice)}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-ink-soft" dir="ltr">
                    {formatIQD(totalCost)}
                  </td>
                  <td
                    className={`px-4 py-3 tabular-nums ${profitColor(totalProfit)}`}
                    dir="ltr"
                  >
                    {formatIQD(totalProfit)}
                  </td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {sortedOrders.map((order) => (
              <article
                key={order.id}
                className="surface-card card-lift rounded-2xl p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-ink">{order.studentName}</p>
                  {order.source && (
                    order.source === "wholesaler" ? (
                      <span className="shrink-0 inline-flex rounded-full border border-orange-ink/25 bg-orange-ink/8 px-2 py-0.5 text-xs font-medium text-orange-ink">
                        {ORDER_SOURCE_LABELS.wholesaler}
                      </span>
                    ) : (
                      <span className="shrink-0 inline-flex rounded-full border border-line bg-surface-sink px-2 py-0.5 text-xs font-medium text-ink-soft">
                        {ORDER_SOURCE_LABELS.retail}
                      </span>
                    )
                  )}
                </div>
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

            {/* Summary card */}
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
