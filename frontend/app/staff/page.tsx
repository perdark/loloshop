"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { OrderCard } from "@/components/staff/OrderCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { StatCard } from "@/components/ui/StatCard";
import { getQueue, getMonitor } from "@/lib/staff";
import { getApiErrorMessage } from "@/lib/api";
import { ORDER_STATUS_LABELS, ORDER_SCOPE_LABELS, ORDER_SOURCE_LABELS, STAFF_TYPE_LABELS } from "@/lib/constants";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import type { ProductionQueueItem, MonitorData } from "@/lib/staff-types";
import type { StaffOrderScope, StaffType, OrderStatus } from "@/lib/types";
import Link from "next/link";

// ─── Skeletons ────────────────────────────────────────────────────────────────

function QueueSkeleton() {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="skeleton h-28 w-full rounded-2xl" />
      ))}
    </div>
  );
}

// ─── Per-type metadata ────────────────────────────────────────────────────────

const QUEUE_META: Partial<Record<StaffType, { title: string; subtitle: string; empty: string }>> = {
  designer: {
    title: "مراجعة التصاميم",
    subtitle: "تصاميم مكتملة بانتظار الموافقة أو الرفض",
    empty: "لا توجد تصاميم بانتظار المراجعة حالياً",
  },
  embroiderer: {
    title: "قائمة التطريز",
    subtitle: "طلبات جاهزة للتطريز",
    empty: "لا توجد طلبات تطريز حالياً",
  },
  presser: {
    title: "قائمة الكوي",
    subtitle: "طلبات جاهزة للكوي",
    empty: "لا توجد طلبات كوي حالياً",
  },
  preparer: {
    title: "قائمة التجهيز",
    subtitle: "طلبات قيد التجهيز أو جاهزة",
    empty: "لا توجد طلبات تجهيز حالياً",
  },
};

// ─── Source filter (segmented pill control) ───────────────────────────────────

type SourceFilter = "" | "retail" | "wholesaler";

interface SourceFilterProps {
  value: SourceFilter;
  onChange: (v: SourceFilter) => void;
}

function SourceFilterControl({ value, onChange }: SourceFilterProps) {
  const options: { v: SourceFilter; label: string }[] = [
    { v: "", label: "الكل" },
    { v: "retail", label: ORDER_SOURCE_LABELS.retail },
    { v: "wholesaler", label: ORDER_SOURCE_LABELS.wholesaler },
  ];
  return (
    <div
      role="group"
      aria-label="تصفية حسب المصدر"
      className="inline-flex rounded-full border border-line bg-surface-sink p-1 gap-1"
    >
      {options.map(({ v, label }) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={[
            "min-h-9 rounded-full px-4 text-sm font-medium transition-colors",
            value === v
              ? "bg-orange-ink text-white shadow-[var(--shadow-soft)]"
              : "text-ink-soft hover:text-ink",
          ].join(" ")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ─── Simple queue view (designer / embroiderer / presser / preparer) ──────────

function QueueView({
  staffType,
  showSourceFilter,
  orderScope,
}: {
  staffType: StaffType;
  showSourceFilter: boolean;
  orderScope?: StaffOrderScope;
}) {
  const [items, setItems] = useState<ProductionQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("");

  const meta = QUEUE_META[staffType] ?? {
    title: "قائمة الطلبات",
    subtitle: "طلبات المرحلة الحالية",
    empty: "لا توجد طلبات حالياً",
  };

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(false);
    try {
      const data = await getQueue(
        undefined,
        sourceFilter || undefined
      );
      setItems(data);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر تحميل الطلبات"));
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [sourceFilter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div dir="rtl" lang="ar">
      <PageHeader
        title={meta.title}
        subtitle={meta.subtitle}
        action={
          <Button variant="ghost" onClick={load} loading={loading}>
            تحديث
          </Button>
        }
      />

      {/* Scope badge for scoped staff, source filter for managers/both */}
      {showSourceFilter ? (
        <div className="mb-4">
          <SourceFilterControl value={sourceFilter} onChange={setSourceFilter} />
        </div>
      ) : orderScope && orderScope !== "both" ? (
        <div className="mb-4">
          <span className="inline-flex items-center rounded-full border border-orange-ink/25 bg-orange-ink/8 px-3 py-1 text-sm font-medium text-orange-ink">
            نطاقك: {ORDER_SCOPE_LABELS[orderScope]}
          </span>
        </div>
      ) : null}

      {loading ? (
        <QueueSkeleton />
      ) : fetchError ? (
        <div className="rounded-2xl border border-danger/25 bg-[var(--shop-sink)] px-6 py-10 text-center">
          <p className="text-base font-semibold text-ink">تعذر تحميل الطلبات</p>
          <p className="mt-1 text-sm text-ink-soft">تحقق من اتصالك ثم أعد المحاولة.</p>
          <Button className="mt-4" onClick={load}>إعادة المحاولة</Button>
        </div>
      ) : items.length === 0 ? (
        <EmptyState message={meta.empty} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <li key={item.id}>
              <OrderCard order={item} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Manager dashboard ────────────────────────────────────────────────────────

const STAGE_ORDER: OrderStatus[] = [
  "design_complete",
  "embroidery",
  "pressing",
  "preparing",
  "ready",
];

function MonitorDashboard({ showSourceFilter }: { showSourceFilter: boolean }) {
  const [data, setData] = useState<MonitorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("");

  // Re-fetch the whole dashboard (WIP / overdue / stale) when the source filter changes.
  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(false);
    try {
      const d = await getMonitor(sourceFilter || undefined);
      setData(d);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر تحميل بيانات المتابعة"));
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [sourceFilter]);

  useEffect(() => {
    load();
  }, [load]);

  // Build queue link href — appends ?source= when a filter is selected.
  function stageHref(stage: OrderStatus): string {
    const params = new URLSearchParams({ stage });
    if (sourceFilter) params.set("source", sourceFilter);
    return `/staff/queue?${params.toString()}`;
  }

  if (loading) {
    return (
      <div dir="rtl" lang="ar" className="space-y-6 animate-fade-page-in" aria-hidden>
        <div className="skeleton h-9 w-48" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton h-24 rounded-2xl" />
          ))}
        </div>
        <div className="skeleton h-48 rounded-2xl" />
        <div className="skeleton h-48 rounded-2xl" />
      </div>
    );
  }

  if (fetchError || !data) {
    return (
      <div dir="rtl" lang="ar" className="space-y-4">
        <PageHeader title="المتابعة" subtitle="مراقبة خط الإنتاج" />
        <div className="rounded-2xl border border-danger/25 bg-[var(--shop-sink)] px-6 py-10 text-center">
          <p className="text-base font-semibold text-ink">تعذر تحميل بيانات المتابعة</p>
          <Button className="mt-4" onClick={load}>إعادة المحاولة</Button>
        </div>
      </div>
    );
  }

  const totalWip = STAGE_ORDER.reduce((s, st) => s + (data.wip[st] ?? 0), 0);

  return (
    <div dir="rtl" lang="ar" className="space-y-8 animate-fade-page-in">
      <PageHeader
        title="المتابعة"
        subtitle={`${totalWip} طلب نشط في خط الإنتاج`}
        action={
          <Button variant="ghost" onClick={load} loading={loading}>
            تحديث
          </Button>
        }
      />

      {showSourceFilter && (
        <div>
          <SourceFilterControl value={sourceFilter} onChange={setSourceFilter} />
        </div>
      )}

      {/* WIP stat cards per stage */}
      <section>
        <h2 className="section-heading mb-4 font-display-ar text-base font-bold text-ink">الطلبات حسب المرحلة</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {STAGE_ORDER.map((stage) => (
            <StatCard
              key={stage}
              label={ORDER_STATUS_LABELS[stage] ?? stage}
              value={String(data.wip[stage] ?? 0)}
            />
          ))}
        </div>
      </section>

      {/* Staff throughput */}
      <section>
        <h2 className="section-heading mb-4 font-display-ar text-base font-bold text-ink">أداء الموظفين</h2>
        {data.throughput.length === 0 ? (
          <EmptyState message="لا توجد بيانات أداء حتى الآن" />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-[var(--shadow-soft)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-sink">
                  <th className="px-4 py-3 text-start font-semibold text-ink-soft">الموظف</th>
                  <th className="px-4 py-3 text-start font-semibold text-ink-soft">الدور</th>
                  <th className="px-4 py-3 text-end font-semibold text-ink-soft">الإجراءات</th>
                  <th className="px-4 py-3 text-start font-semibold text-ink-soft">آخر نشاط</th>
                </tr>
              </thead>
              <tbody>
                {data.throughput.map((row) => (
                  <tr key={row.actor_id} className="border-b border-line last:border-0 hover:bg-surface-sink/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-ink">{row.name}</td>
                    <td className="px-4 py-3 text-ink-soft">
                      {(STAFF_TYPE_LABELS as Record<string, string>)[row.staff_type] ?? row.staff_type}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <span className="inline-flex items-center justify-center rounded-full bg-orange-ink/10 px-2.5 py-0.5 text-xs font-bold text-orange-ink">
                        {row.actions}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {row.last_action
                        ? new Intl.DateTimeFormat("ar-IQ", {
                            timeZone: "Asia/Baghdad",
                            year: "numeric",
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          }).format(new Date(row.last_action))
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Overdue orders */}
      {data.overdue.length > 0 && (
        <section>
          <h2 className="section-heading mb-4 font-display-ar text-base font-bold text-danger">
            طلبات متأخرة ({data.overdue.length})
          </h2>
          <ul className="space-y-2">
            {data.overdue.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/staff/orders/${o.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 transition-colors hover:bg-danger/10"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{o.student_name}</p>
                    <p className="text-xs text-muted">{o.product_name}{o.batch_name ? ` · ${o.batch_name}` : ""}</p>
                  </div>
                  <div className="shrink-0 text-end">
                    <span className="text-xs font-semibold text-danger">
                      {ORDER_STATUS_LABELS[o.status] ?? o.status}
                    </span>
                    <p className="text-xs text-muted">{o.deadline}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Stale orders */}
      {data.stale.length > 0 && (
        <section>
          <h2 className="section-heading mb-4 font-display-ar text-base font-bold text-ink">
            متأخر في المرحلة ({data.stale.length})
          </h2>
          <ul className="space-y-2">
            {data.stale.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/staff/orders/${o.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 transition-colors hover:border-orange-ink/30 hover:bg-surface-sink/50"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{o.student_name}</p>
                    <p className="text-xs text-muted">{ORDER_STATUS_LABELS[o.status] ?? o.status}</p>
                  </div>
                  <span className="shrink-0 rounded-full border border-orange-ink/25 bg-orange-ink/8 px-2.5 py-0.5 text-xs font-semibold text-orange-ink">
                    {Math.round(o.hours_in_stage)} ساعة
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* All-stages link for manager */}
      <section>
        <h2 className="section-heading mb-4 font-display-ar text-base font-bold text-ink">روابط سريعة</h2>
        <div className="flex flex-wrap gap-2">
          {STAGE_ORDER.map((stage) => (
            <Link
              key={stage}
              href={stageHref(stage)}
              className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-soft transition-colors hover:border-orange-ink/40 hover:text-orange-ink"
            >
              {ORDER_STATUS_LABELS[stage]}
              {data.wip[stage] ? (
                <span className="ms-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-orange-ink text-[10px] font-bold text-white">
                  {data.wip[stage]}
                </span>
              ) : null}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

// ─── Root page — reads user from hook and branches ───────────────────────────

function StaffPageContent() {
  const { user, loading } = useRequireAuth(["staff", "admin"]);

  if (loading || !user) {
    return <PageLoader />;
  }

  // Admin has full manager-level visibility over the production pipeline.
  const isManager = user.role === "admin" || user.staff_type === "manager";
  // Show source filter for managers/admins and for both-scope staff.
  const showSourceFilter = isManager || user.order_scope === "both";

  if (isManager) {
    return <MonitorDashboard showSourceFilter={showSourceFilter} />;
  }

  const staffType = user.staff_type;

  if (staffType && staffType in QUEUE_META) {
    return (
      <QueueView
        staffType={staffType}
        showSourceFilter={showSourceFilter}
        orderScope={user.order_scope}
      />
    );
  }

  // Fallback for staff without a type assigned (legacy / unset)
  return (
    <div dir="rtl" lang="ar">
      <PageHeader
        title="لوحة الطلبات"
        subtitle="الطلبات النشطة"
      />
      <EmptyState
        title="الدور غير محدد"
        message="لم يتم تعيين دور إنتاج لهذا الحساب بعد. يرجى التواصل مع المدير."
      />
    </div>
  );
}

export default function StaffPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <StaffPageContent />
    </Suspense>
  );
}
