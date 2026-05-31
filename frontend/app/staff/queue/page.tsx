"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { OrderCard } from "@/components/staff/OrderCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { getQueue } from "@/lib/staff";
import { getApiErrorMessage } from "@/lib/api";
import { ORDER_SOURCE_LABELS, ORDER_STATUS_LABELS } from "@/lib/constants";
import type { ProductionQueueItem } from "@/lib/staff-types";
import type { OrderStatus } from "@/lib/types";
import Link from "next/link";

const STAGES: OrderStatus[] = [
  "design_complete",
  "embroidery",
  "pressing",
  "preparing",
  "ready",
];

// ─── Bundle grouping helpers ──────────────────────────────────────────────────

interface BundleGroup {
  /** null = ungrouped single order */
  groupId: string | null;
  /** First order's student info (all siblings share same student) */
  studentName: string;
  universityName: string | null;
  items: ProductionQueueItem[];
}

/**
 * Groups queue items by checkout_group_id.
 * Items with null group_id each become their own single-item group.
 */
function groupByBundle(items: ProductionQueueItem[]): BundleGroup[] {
  const bundleMap = new Map<string, BundleGroup>();
  const singletons: BundleGroup[] = [];

  for (const item of items) {
    if (item.checkout_group_id) {
      const existing = bundleMap.get(item.checkout_group_id);
      if (existing) {
        existing.items.push(item);
      } else {
        bundleMap.set(item.checkout_group_id, {
          groupId: item.checkout_group_id,
          studentName: item.student_name,
          universityName: item.university_name,
          items: [item],
        });
      }
    } else {
      singletons.push({
        groupId: null,
        studentName: item.student_name,
        universityName: item.university_name,
        items: [item],
      });
    }
  }

  // Bundles first, then singletons — sorted by earliest created_at within each group
  const bundles = Array.from(bundleMap.values()).sort(
    (a, b) =>
      new Date(b.items[0].created_at).getTime() -
      new Date(a.items[0].created_at).getTime()
  );

  return [...bundles, ...singletons];
}

// ─── Bundle group card ────────────────────────────────────────────────────────

function BundleGroupCard({ group }: { group: BundleGroup }) {
  const isBundle = group.groupId !== null && group.items.length > 1;

  if (!isBundle) {
    // Single item — render the normal OrderCard
    return <OrderCard order={group.items[0]} />;
  }

  return (
    <div
      dir="rtl"
      className="rounded-2xl border-2 border-orange-ink/20 bg-surface shadow-[var(--shadow-card)]"
    >
      {/* Bundle header */}
      <div className="flex items-center gap-2 rounded-t-2xl border-b border-orange-ink/15 bg-orange-ink/5 px-4 py-3">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-ink text-xs font-bold text-white"
          aria-hidden
        >
          {group.items.length}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-sm font-bold text-ink">
            {group.studentName}
          </p>
          {group.universityName && (
            <p className="truncate text-xs text-ink-soft">
              {group.universityName}
            </p>
          )}
        </div>
        <span className="shrink-0 rounded-full border border-orange-ink/25 bg-orange-ink/8 px-2.5 py-0.5 text-xs font-semibold text-orange-ink">
          باقة
        </span>
      </div>

      {/* Component cards */}
      <div className="divide-y divide-line">
        {group.items.map((item) => (
          <div key={item.id} className="p-3">
            <OrderCard order={item} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main content ─────────────────────────────────────────────────────────────

function QueueContent() {
  const searchParams = useSearchParams();
  const stage = (searchParams.get("stage") || undefined) as OrderStatus | undefined;
  const source = (searchParams.get("source") || undefined) as "retail" | "wholesaler" | undefined;

  const [items, setItems] = useState<ProductionQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(false);
    try {
      const data = await getQueue(stage, source);
      setItems(data);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر تحميل الطلبات"));
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [stage, source]);

  useEffect(() => {
    load();
  }, [load]);

  const title = stage
    ? `${ORDER_STATUS_LABELS[stage] ?? stage}`
    : "جميع الطلبات";

  // Build a tab href, preserving the source param when present.
  function tabHref(s?: OrderStatus): string {
    const params = new URLSearchParams();
    if (s) params.set("stage", s);
    if (source) params.set("source", source);
    const qs = params.toString();
    return qs ? `/staff/queue?${qs}` : "/staff/queue";
  }

  const groups = groupByBundle(items);
  const bundleCount = groups.filter((g) => g.groupId !== null && g.items.length > 1).length;

  return (
    <div dir="rtl" lang="ar">
      <PageHeader
        title={title}
        subtitle={
          source
            ? `خط الإنتاج — ${ORDER_SOURCE_LABELS[source]}`
            : "خط الإنتاج — عرض المدير"
        }
        action={
          <Button variant="ghost" onClick={load} loading={loading}>
            تحديث
          </Button>
        }
      />

      {/* Stage filter tabs */}
      <div className="mb-6 flex flex-wrap gap-2">
        <Link
          href={tabHref(undefined)}
          className={`inline-flex min-h-11 items-center rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
            !stage
              ? "border-orange-ink bg-orange-ink text-white"
              : "border-line bg-surface text-ink-soft hover:border-orange-ink/40 hover:text-ink"
          }`}
        >
          الكل
        </Link>
        {STAGES.map((s) => (
          <Link
            key={s}
            href={tabHref(s)}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
              stage === s
                ? "border-orange-ink bg-orange-ink text-white"
                : "border-line bg-surface text-ink-soft hover:border-orange-ink/40 hover:text-ink"
            }`}
          >
            {ORDER_STATUS_LABELS[s]}
          </Link>
        ))}
      </div>

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-28 w-full rounded-2xl" />
          ))}
        </div>
      ) : fetchError ? (
        <div className="rounded-2xl border border-[var(--color-danger)]/25 bg-[var(--shop-sink)] px-6 py-10 text-center">
          <p className="text-base font-semibold text-ink">تعذر تحميل الطلبات</p>
          <p className="mt-1 text-sm text-ink-soft">تحقق من اتصالك ثم أعد المحاولة.</p>
          <Button className="mt-4" onClick={load}>إعادة المحاولة</Button>
        </div>
      ) : items.length === 0 ? (
        <EmptyState message="لا توجد طلبات في هذه المرحلة حالياً" />
      ) : (
        <>
          {bundleCount > 0 && (
            <p className="mb-4 text-sm text-ink-soft">
              <span className="font-semibold text-orange-ink">{bundleCount}</span>
              {" "}باقة متعددة المكونات مجمّعة
            </p>
          )}
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {groups.map((group) => (
              <li key={group.groupId ?? group.items[0].id}>
                <BundleGroupCard group={group} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default function StaffQueuePage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <QueueContent />
    </Suspense>
  );
}
