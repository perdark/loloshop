"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import type { OrderStatus } from "@/lib/types";
import {
  getTailorQueue,
  tailorCompleteBulk,
  tailorReopen,
  type TailorOrderRow,
} from "@/lib/staff";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useRequireAuth } from "@/hooks/useRequireAuth";

// ─── Pipeline status pill (warm brand — context only, never an action) ────────
const STATUS_PILL: Partial<Record<OrderStatus, string>> = {
  pending_approval: "bg-ink/5 text-muted",
  designing: "bg-ink/5 text-muted",
  design_complete: "bg-peach/70 text-orange-ink",
  converting: "bg-orange/15 text-orange-ink",
  staff_review: "bg-ink/5 text-muted",
  printing: "bg-ink/5 text-muted",
  embroidery: "bg-orange-ink/15 text-orange-ink",
  pressing: "bg-amber-100 text-amber-800",
  preparing: "bg-ink/8 text-ink-soft",
  ready: "bg-emerald-100 text-emerald-700",
  delivered: "bg-ink/10 text-ink-soft",
  cancelled: "bg-[var(--color-danger)]/10 text-[var(--color-danger)]",
};
function statusPill(s: OrderStatus): string {
  return STATUS_PILL[s] ?? "bg-ink/5 text-muted";
}

// Module-scope so the React purity rule doesn't flag Date.now() in render.
function isOverdue(o: TailorOrderRow): boolean {
  if (o.deadline == null || o.tailorStatus === "done") return false;
  return new Date(o.deadline).getTime() < Date.now();
}

type Tab = "pending" | "done";

export default function StaffTailorPage() {
  const { user } = useRequireAuth(["staff", "admin"]);
  const [tab, setTab] = useState<Tab>("pending");
  const [rows, setRows] = useState<TailorOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [reopeningId, setReopeningId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setFetchError(false);
    getTailorQueue(tab === "done")
      .then((data) => {
        setRows(data);
        setSelected(new Set()); // selection is invalid after a refetch / tab change
      })
      .catch((err) => {
        toast.error(getApiErrorMessage(err, "تعذر تحميل الطلبات"));
        setFetchError(true);
      })
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => {
    if (!user) return;
    load();
  }, [user, load]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter((o) => o.studentName.toLowerCase().includes(q));
  }, [rows, search]);

  // Only the pending tab is batch-completable.
  const selectableIds = useMemo(
    () => (tab === "pending" ? filtered.map((o) => o.id) : []),
    [filtered, tab]
  );
  const allSelectableChecked =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) => {
      if (allSelectableChecked) {
        const next = new Set(prev);
        selectableIds.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...prev, ...selectableIds]);
    });

  const selectedCount = selected.size;

  async function doBulkComplete() {
    if (selectedCount === 0) return;
    setBulkLoading(true);
    try {
      const res = await tailorCompleteBulk([...selected]);
      if (res.done > 0) {
        toast.success(
          res.skipped > 0
            ? `تم إنهاء فصال ${res.done} طلب · تخطّي ${res.skipped}`
            : `تم إنهاء فصال ${res.done} طلب`
        );
      } else {
        toast.error("لم يكن بالإمكان إنهاء أي طلب من المحدد");
      }
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر إنهاء الفصال"));
    } finally {
      setBulkLoading(false);
    }
  }

  async function doReopen(id: string) {
    setReopeningId(id);
    try {
      await tailorReopen(id);
      toast.success("تم إرجاع الطلب لقيد الفصال");
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر إرجاع الطلب"));
    } finally {
      setReopeningId(null);
    }
  }

  return (
    <div dir="rtl" lang="ar" className="space-y-6 pb-28">
      <PageHeader
        title="الفصال"
        subtitle="فصال أوشحة طلبات التجزئة — يعمل بالتوازي مع خط الإنتاج"
      />

      {/* Tabs — big tap targets, full-width on mobile */}
      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-surface-sink p-1">
        {([
          { id: "pending", label: "قيد الفصال" },
          { id: "done", label: "تم الفصال" },
        ] as { id: Tab; label: string }[]).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={`min-h-11 rounded-xl px-4 text-sm font-bold transition-colors ${
              tab === t.id
                ? "bg-orange-ink text-white shadow-[var(--shadow-soft)]"
                : "text-ink-soft hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="surface-card rounded-2xl p-3.5">
        <Input
          type="search"
          placeholder="بحث باسم الطالب…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full"
          aria-label="بحث باسم الطالب"
        />
      </div>

      {loading ? (
        <div className="space-y-2.5" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-16 w-full rounded-2xl" />
          ))}
        </div>
      ) : fetchError ? (
        <div className="rounded-2xl border border-[var(--color-danger)]/25 bg-[var(--shop-sink)] px-6 py-10 text-center">
          <p className="text-base font-semibold text-ink">تعذر تحميل الطلبات</p>
          <p className="mt-1 text-sm text-ink-soft">تحقق من اتصالك ثم أعد المحاولة.</p>
          <Button className="mt-4" onClick={load}>إعادة المحاولة</Button>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          message={
            tab === "pending"
              ? "لا توجد طلبات قيد الفصال حالياً."
              : "لا توجد طلبات منتهية الفصال بعد."
          }
        />
      ) : (
        <>
          {/* Select-all (pending tab only) */}
          {selectableIds.length > 0 && (
            <button
              type="button"
              onClick={toggleAll}
              className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink-soft transition-colors hover:border-orange-ink/30"
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-md border-2 ${
                  allSelectableChecked
                    ? "border-orange-ink bg-orange-ink text-white"
                    : "border-ink/30"
                }`}
                aria-hidden
              >
                {allSelectableChecked ? "✓" : ""}
              </span>
              تحديد الكل ({selectableIds.length})
            </button>
          )}

          <ul className="space-y-2.5">
            {filtered.map((o) => (
              <TailorRow
                key={o.id}
                order={o}
                selectable={tab === "pending"}
                checked={selected.has(o.id)}
                onToggle={() => toggleOne(o.id)}
                reopening={reopeningId === o.id}
                onReopen={tab === "done" ? () => doReopen(o.id) : undefined}
              />
            ))}
          </ul>
        </>
      )}

      {/* Sticky bulk-action bar — clears the desktop sidebar via lg:ms-64 */}
      {selectedCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur lg:ms-64">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="min-h-11 px-2 text-sm font-medium text-ink-soft hover:text-ink"
            >
              إلغاء التحديد ({selectedCount})
            </button>
            <Button onClick={doBulkComplete} loading={bulkLoading} className="min-w-[9rem]">
              تم الفصال ({selectedCount})
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function TailorRow({
  order,
  selectable,
  checked,
  onToggle,
  reopening,
  onReopen,
}: {
  order: TailorOrderRow;
  selectable: boolean;
  checked: boolean;
  onToggle: () => void;
  reopening: boolean;
  onReopen?: () => void;
}) {
  const overdue = isOverdue(order);

  return (
    <li className="flex items-stretch gap-1 rounded-2xl border border-line bg-surface shadow-[var(--shadow-soft)]">
      {selectable && (
        <button
          type="button"
          onClick={onToggle}
          aria-label="تحديد الطلب"
          aria-pressed={checked}
          className="flex w-14 shrink-0 items-center justify-center rounded-s-2xl transition-colors hover:bg-surface-sink"
        >
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-md border-2 text-sm ${
              checked ? "border-orange-ink bg-orange-ink text-white" : "border-ink/30"
            }`}
            aria-hidden
          >
            {checked ? "✓" : ""}
          </span>
        </button>
      )}

      {/* Body — tap opens the full (tailor read-only) order */}
      <Link
        href={`/staff/orders/${order.id}?from=${encodeURIComponent("/staff/tailor")}`}
        className={`flex min-w-0 flex-1 items-center justify-between gap-3 py-3 pe-4 ${
          selectable ? "ps-1" : "ps-4 rounded-s-2xl"
        }`}
      >
        <div className="min-w-0">
          <p className="truncate font-display text-[15px] font-bold text-ink">
            {order.studentName}
          </p>
          <p className="mt-0.5 truncate text-xs text-ink-soft">
            {order.productName}
            {order.batchName ? ` · ${order.batchName}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {/* Pipeline status — context only */}
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${statusPill(order.status)}`}>
            {order.statusLabel}
          </span>
          {overdue && (
            <span className="rounded-full bg-[var(--color-danger)]/10 px-2 py-0.5 text-[10px] font-bold text-[var(--color-danger)]">
              متأخر
            </span>
          )}
        </div>
      </Link>

      {/* Done tab: reopen affordance */}
      {onReopen && (
        <button
          type="button"
          onClick={onReopen}
          disabled={reopening}
          className="flex shrink-0 items-center rounded-e-2xl border-s border-line px-3 text-xs font-semibold text-ink-soft transition-colors hover:bg-surface-sink hover:text-orange-ink disabled:opacity-50"
        >
          {reopening ? "…" : "إرجاع"}
        </button>
      )}
    </li>
  );
}
