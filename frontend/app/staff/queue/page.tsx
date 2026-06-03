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
  "converting",
  "embroidery",
  "pressing",
  "preparing",
  "ready",
];

type SourceFilter = "retail" | "wholesaler" | undefined;

// Status dot colour per stage — جاهز (ready) reads as done (green), active stages warm.
const STATUS_DOT: Partial<Record<OrderStatus, string>> = {
  design_complete: "bg-orange-ink",
  converting: "bg-orange-ink",
  embroidery: "bg-orange-ink",
  pressing: "bg-orange-ink/70",
  preparing: "bg-ink-soft",
  ready: "bg-emerald-500",
  delivered: "bg-muted",
  cancelled: "bg-danger",
};

// ─── Bundle grouping helpers ──────────────────────────────────────────────────

interface BundleGroup {
  /** null = ungrouped single order */
  groupId: string | null;
  studentName: string;
  universityName: string | null;
  source: "retail" | "wholesaler" | null;
  items: ProductionQueueItem[];
}

/** Groups queue items by checkout_group_id; null group_id items become singletons. */
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
          source: item.source ?? null,
          items: [item],
        });
      }
    } else {
      singletons.push({
        groupId: null,
        studentName: item.student_name,
        universityName: item.university_name,
        source: item.source ?? null,
        items: [item],
      });
    }
  }

  const bundles = Array.from(bundleMap.values()).sort(
    (a, b) =>
      new Date(b.items[0].created_at).getTime() -
      new Date(a.items[0].created_at).getTime()
  );

  return [...bundles, ...singletons];
}

// ─── Accordion row: student name → tap to reveal the full order(s) ─────────────

function QueueRow({ group }: { group: BundleGroup }) {
  const [open, setOpen] = useState(false);
  const isBundle = group.groupId !== null && group.items.length > 1;

  return (
    <li className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-soft)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-surface-sink min-h-[60px]"
      >
        {/* leading count / chevron slot */}
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
            isBundle ? "bg-orange-ink text-white" : "bg-surface-sink text-ink-soft"
          }`}
          aria-hidden
        >
          {isBundle ? group.items.length : "١"}
        </span>

        {/* student name + per-product name & stage (every product shown, none hidden) */}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-base font-bold text-ink">
            {group.studentName}
          </span>
          {group.universityName && (
            <span className="block truncate text-xs text-ink-soft">{group.universityName}</span>
          )}
          <span className="mt-1.5 flex flex-col gap-1">
            {group.items.map((it) => (
              <span key={it.id} className="flex items-center gap-1.5 text-xs">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[it.status] ?? "bg-ink-soft"}`}
                  aria-hidden
                />
                <span className="truncate font-semibold text-ink">{it.product_name}</span>
                <span className="shrink-0 text-muted">
                  · {ORDER_STATUS_LABELS[it.status] ?? it.status}
                </span>
              </span>
            ))}
          </span>
        </span>

        {/* source chip */}
        {group.source && (
          <span
            className={`hidden shrink-0 self-start rounded-full border px-2 py-0.5 text-xs font-medium sm:inline-flex ${
              group.source === "wholesaler"
                ? "border-orange-ink/25 bg-orange-ink/8 text-orange-ink"
                : "border-line bg-surface-sink text-ink-soft"
            }`}
          >
            {ORDER_SOURCE_LABELS[group.source]}
          </span>
        )}

        {/* chevron */}
        <svg
          className={`h-4 w-4 shrink-0 text-ink-soft transition-transform duration-300 ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {/* animated reveal */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="space-y-3 border-t border-line p-3">
            {group.items.map((item) => (
              <OrderCard key={item.id} order={item} />
            ))}
          </div>
        </div>
      </div>
    </li>
  );
}

// ─── Main content ─────────────────────────────────────────────────────────────

function QueueContent() {
  const searchParams = useSearchParams();
  const stage = (searchParams.get("stage") || undefined) as OrderStatus | undefined;
  const source = (searchParams.get("source") || undefined) as SourceFilter;

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

  const title = stage ? `${ORDER_STATUS_LABELS[stage] ?? stage}` : "جميع الطلبات";

  // Build a tab href from an explicit (stage, source) pair.
  function tabHref(nextStage: OrderStatus | undefined, nextSource: SourceFilter): string {
    const params = new URLSearchParams();
    if (nextStage) params.set("stage", nextStage);
    if (nextSource) params.set("source", nextSource);
    const qs = params.toString();
    return qs ? `/staff/queue?${qs}` : "/staff/queue";
  }

  const groups = groupByBundle(items);

  const sourceTabs: { key: SourceFilter; label: string }[] = [
    { key: undefined, label: "الكل" },
    { key: "retail", label: ORDER_SOURCE_LABELS.retail },
    { key: "wholesaler", label: ORDER_SOURCE_LABELS.wholesaler },
  ];

  const pill = (active: boolean) =>
    `inline-flex min-h-11 items-center rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
      active
        ? "border-orange-ink bg-orange-ink text-white"
        : "border-line bg-surface text-ink-soft hover:border-orange-ink/40 hover:text-ink"
    }`;

  return (
    <div dir="rtl" lang="ar">
      <PageHeader
        title={title}
        subtitle={source ? `خط الإنتاج — ${ORDER_SOURCE_LABELS[source]}` : "خط الإنتاج — عرض المدير"}
        action={
          <Button variant="ghost" onClick={load} loading={loading}>
            تحديث
          </Button>
        }
      />

      {/* Source separation: retail vs wholesaler */}
      <div className="mb-3 flex flex-wrap gap-2">
        {sourceTabs.map((t) => (
          <Link key={t.label} href={tabHref(stage, t.key)} className={pill(source === t.key)}>
            {t.label}
          </Link>
        ))}
      </div>

      {/* Stage filter tabs */}
      <div className="mb-6 flex flex-wrap gap-2">
        <Link href={tabHref(undefined, source)} className={pill(!stage)}>
          كل المراحل
        </Link>
        {STAGES.map((s) => (
          <Link key={s} href={tabHref(s, source)} className={pill(stage === s)}>
            {ORDER_STATUS_LABELS[s]}
          </Link>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3" aria-hidden>
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
      ) : items.length === 0 ? (
        <EmptyState message="لا توجد طلبات في هذه المرحلة حالياً" />
      ) : (
        <ul className="space-y-3">
          {groups.map((group) => (
            <QueueRow key={group.groupId ?? group.items[0].id} group={group} />
          ))}
        </ul>
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
