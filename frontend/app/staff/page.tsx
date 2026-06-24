"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { OrderCard } from "@/components/staff/OrderCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { StatCard } from "@/components/ui/StatCard";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { getQueue, getMonitor, getCompleted, revertOrder } from "@/lib/staff";
import { addStaffBonus, addStaffDeduction } from "@/lib/admin";
import { getApiErrorMessage } from "@/lib/api";
import {
  ORDER_STATUS_LABELS,
  ORDER_SCOPE_LABELS,
  ORDER_SOURCE_LABELS,
  STAFF_TYPE_LABELS,
  EMBROIDERY_ZONE_LABELS,
  EMBROIDERY_ZONE_ORDER,
  type EmbroideryZone,
} from "@/lib/constants";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useProductionEvents } from "@/hooks/useProductionEvents";
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
  digitizer: {
    title: "قائمة تحويل التطريز",
    subtitle: "طلبات جاهزة للتحويل",
    empty: "لا توجد طلبات تحويل حالياً",
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

// ─── Completed orders section (per-staff) ─────────────────────────────────────

function CompletedSection() {
  const [items, setItems] = useState<ProductionQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [revertingId, setRevertingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getCompleted();
      setItems(data);
    } catch {
      // Non-critical — don't toast on background fetch
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleReopen(orderId: string) {
    setRevertingId(orderId);
    try {
      await revertOrder(orderId);
      toast.success("تم إرجاع الطلب للمرحلة السابقة");
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر إرجاع الطلب"));
    } finally {
      setRevertingId(null);
    }
  }

  if (loading) {
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-hidden>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="skeleton h-28 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return <EmptyState message="لا توجد طلبات منجزة بعد" />;
  }

  return (
    <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <li key={item.id} className="relative">
          <OrderCard order={item} />
          <div className="mt-2 px-1">
            <Button
              variant="ghost"
              fullWidth
              loading={revertingId === item.id}
              disabled={revertingId !== null && revertingId !== item.id}
              onClick={() => handleReopen(item.id)}
            >
              إرجاع للتعديل
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─── Tabs: active queue + completed ──────────────────────────────────────────

type Tab = "active" | "completed";

function QueueView({
  staffType,
  showSourceFilter,
  orderScope,
}: {
  staffType: StaffType;
  showSourceFilter: boolean;
  orderScope?: StaffOrderScope;
}) {
  const [activeTab, setActiveTab] = useState<Tab>("active");
  const [items, setItems] = useState<ProductionQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("retail");
  const [zoneFilter, setZoneFilter] = useState<EmbroideryZone | "">("");

  const meta = QUEUE_META[staffType] ?? {
    title: "قائمة الطلبات",
    subtitle: "طلبات المرحلة الحالية",
    empty: "لا توجد طلبات حالياً",
  };

  const load = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!silent) setLoading(true);
      setFetchError(false);
      try {
        const data = await getQueue(undefined, sourceFilter || undefined, zoneFilter || undefined);
        setItems(data);
      } catch (err) {
        if (!silent) {
          toast.error(getApiErrorMessage(err, "تعذر تحميل الطلبات"));
          setFetchError(true);
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [sourceFilter, zoneFilter]
  );

  useEffect(() => {
    if (activeTab !== "active") return;
    load();
    // Backstop reconcile — SSE handles the live updates; this just heals any
    // missed event or stale (crashed-tab) presence the server's TTL has dropped.
    const interval = setInterval(() => load({ silent: true }), 60_000);
    return () => clearInterval(interval);
  }, [activeTab, load]);

  // Real-time: patch presence tags instantly; reload when an order moves stage
  // (it may enter/leave this queue) or a new order arrives.
  useProductionEvents((e) => {
    if (activeTab !== "active") return;
    if (e.type === "presence") {
      setItems((prev) =>
        prev.map((it) =>
          it.id === e.orderId
            ? {
                ...it,
                working_staff_name: e.working_staff_name ?? null,
                working_since: e.working_staff_id
                  ? new Date().toISOString()
                  : null,
              }
            : it
        )
      );
    } else {
      load({ silent: true });
    }
  }, activeTab === "active");

  return (
    <div dir="rtl" lang="ar">
      <PageHeader
        title={meta.title}
        subtitle={meta.subtitle}
        action={
          activeTab === "active" ? (
            <Button variant="ghost" onClick={() => load()} loading={loading}>
              تحديث
            </Button>
          ) : undefined
        }
      />

      {/* Tab switcher */}
      <div className="mb-4 flex gap-1 rounded-full border border-line bg-surface-sink p-1 w-fit">
        {(["active", "completed"] as Tab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={[
              "min-h-9 rounded-full px-5 text-sm font-medium transition-colors",
              activeTab === tab
                ? "bg-orange-ink text-white shadow-[var(--shadow-soft)]"
                : "text-ink-soft hover:text-ink",
            ].join(" ")}
          >
            {tab === "active" ? "النشطة" : "مكتملة / أنجزتها"}
          </button>
        ))}
      </div>

      {activeTab === "active" ? (
        <>
          {/* Scope badge / source filter */}
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

          {/* Embroidery-zone / pleat filter (sash R/L/back · cap side/top · robe pleats) */}
          <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="تصفية حسب التطريز">
            <button
              type="button"
              onClick={() => setZoneFilter("")}
              className={`min-h-9 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                zoneFilter === ""
                  ? "border-orange-ink bg-orange-ink/10 text-orange-ink"
                  : "border-line bg-surface-sink text-ink-soft hover:border-orange-ink/40"
              }`}
            >
              كل الطلبات
            </button>
            {EMBROIDERY_ZONE_ORDER.map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => setZoneFilter(z)}
                className={`min-h-9 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  zoneFilter === z
                    ? "border-orange-ink bg-orange-ink/10 text-orange-ink"
                    : "border-line bg-surface-sink text-ink-soft hover:border-orange-ink/40"
                }`}
              >
                {EMBROIDERY_ZONE_LABELS[z]}
              </button>
            ))}
          </div>

          {loading ? (
            <QueueSkeleton />
          ) : fetchError ? (
            <div className="rounded-2xl border border-danger/25 bg-[var(--shop-sink)] px-6 py-10 text-center">
              <p className="text-base font-semibold text-ink">تعذر تحميل الطلبات</p>
              <p className="mt-1 text-sm text-ink-soft">تحقق من اتصالك ثم أعد المحاولة.</p>
              <Button className="mt-4" onClick={() => load()}>إعادة المحاولة</Button>
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
        </>
      ) : (
        <CompletedSection />
      )}
    </div>
  );
}

// ─── Monitor dashboard ────────────────────────────────────────────────────────

const STAGE_ORDER: OrderStatus[] = [
  "design_complete",
  "converting",
  "embroidery",
  "pressing",
  "preparing",
  "ready",
];

// ─── Stars of the month («نجوم الشهر») ───────────────────────────────────────
// Top performers from the 30-day throughput window (status changes + design
// approvals), celebrated as a podium instead of buried in the table.

const RANK_LABELS = ["الأول", "الثاني", "الثالث"] as const;

/** «٤٨ إجراءً في آخر ٣٠ يوماً» with Arabic plural rules. */
function actionsArabic(n: number): string {
  if (n === 1) return "إجراء واحد";
  if (n === 2) return "إجراءان";
  if (n <= 10) return `${n} إجراءات`;
  return `${n} إجراءً`;
}

/** Extended MonitorData to include optional working[] array */
type MonitorDataExtended = MonitorData & {
  working?: {
    staff_id: string;
    staff_name: string;
    order_id: string;
    product_name: string;
    since: string;
  }[];
};

function MonitorDashboard({
  showSourceFilter,
  isAdmin,
}: {
  showSourceFilter: boolean;
  isAdmin: boolean;
}) {
  const [data, setData] = useState<MonitorDataExtended | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("retail");
  const [activeTab, setActiveTab] = useState<"monitor" | "completed">("monitor");

  // Quick bonus/deduction straight from the performance table (admin only —
  // the salary endpoints are admin-scoped).
  const [salaryModal, setSalaryModal] = useState<{
    userId: string;
    name: string;
    kind: "bonus" | "deduction";
  } | null>(null);
  const [salaryAmount, setSalaryAmount] = useState("");
  const [salaryReason, setSalaryReason] = useState("");
  const [salarySaving, setSalarySaving] = useState(false);

  function openSalary(userId: string, name: string, kind: "bonus" | "deduction") {
    setSalaryAmount("");
    setSalaryReason("");
    setSalaryModal({ userId, name, kind });
  }

  async function handleSalarySubmit() {
    if (!salaryModal) return;
    const amount = Number.parseInt(salaryAmount.replace(/[^\d]/g, ""), 10);
    if (Number.isNaN(amount) || amount <= 0) {
      toast.error("أدخل مبلغاً صحيحاً");
      return;
    }
    setSalarySaving(true);
    try {
      const reason = salaryReason.trim() || undefined;
      if (salaryModal.kind === "bonus") {
        await addStaffBonus(salaryModal.userId, amount, reason);
        toast.success("تم إضافة الحافز");
      } else {
        await addStaffDeduction(salaryModal.userId, amount, reason);
        toast.success("تم إضافة الخصم");
      }
      setSalaryModal(null);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر حفظ العملية"));
    } finally {
      setSalarySaving(false);
    }
  }

  const load = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!silent) setLoading(true);
      setFetchError(false);
      try {
        const d = await getMonitor(sourceFilter || undefined);
        setData(d as MonitorDataExtended);
      } catch (err) {
        if (!silent) {
          toast.error(getApiErrorMessage(err, "تعذر تحميل بيانات المتابعة"));
          setFetchError(true);
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [sourceFilter]
  );

  useEffect(() => {
    if (activeTab === "monitor") load();
  }, [activeTab, load]);

  // Real-time: the manager monitor reflects live presence + stage throughput, so
  // reload quietly on any production event while it's the active tab.
  useProductionEvents(() => {
    if (activeTab === "monitor") load({ silent: true });
  }, activeTab === "monitor");

  function stageHref(stage: OrderStatus): string {
    const params = new URLSearchParams({ stage });
    if (sourceFilter) params.set("source", sourceFilter);
    return `/staff/queue?${params.toString()}`;
  }

  const topStaff = useMemo(() => (data?.throughput ?? []).slice(0, 3), [data]);

  if (loading && activeTab === "monitor") {
    return (
      <div dir="rtl" lang="ar" className="space-y-6 animate-fade-page-in" aria-hidden>
        <div className="skeleton h-9 w-48" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-24 rounded-2xl" />
          ))}
        </div>
        <div className="skeleton h-48 rounded-2xl" />
        <div className="skeleton h-48 rounded-2xl" />
      </div>
    );
  }

  if (fetchError || (!data && activeTab === "monitor")) {
    return (
      <div dir="rtl" lang="ar" className="space-y-4">
        <PageHeader title="المتابعة" subtitle="مراقبة خط الإنتاج" />
        <div className="rounded-2xl border border-danger/25 bg-[var(--shop-sink)] px-6 py-10 text-center">
          <p className="text-base font-semibold text-ink">تعذر تحميل بيانات المتابعة</p>
          <Button className="mt-4" onClick={() => load()}>إعادة المحاولة</Button>
        </div>
      </div>
    );
  }

  const totalWip = STAGE_ORDER.reduce((s, st) => s + (data?.wip[st] ?? 0), 0);

  return (
    <div dir="rtl" lang="ar" className="space-y-6 animate-fade-page-in">
      <PageHeader
        title="المتابعة"
        subtitle={`${totalWip} طلب نشط في خط الإنتاج`}
        action={
          activeTab === "monitor" ? (
            <Button variant="ghost" onClick={() => load()} loading={loading}>
              تحديث
            </Button>
          ) : undefined
        }
      />

      {/* Tab switcher */}
      <div className="flex gap-1 rounded-full border border-line bg-surface-sink p-1 w-fit">
        {(["monitor", "completed"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={[
              "min-h-9 rounded-full px-5 text-sm font-medium transition-colors",
              activeTab === tab
                ? "bg-orange-ink text-white shadow-[var(--shadow-soft)]"
                : "text-ink-soft hover:text-ink",
            ].join(" ")}
          >
            {tab === "monitor" ? "المتابعة" : "مكتملة / أنجزتها"}
          </button>
        ))}
      </div>

      {activeTab === "completed" ? (
        <CompletedSection />
      ) : (
        <>
          {showSourceFilter && (
            <div>
              <SourceFilterControl value={sourceFilter} onChange={setSourceFilter} />
            </div>
          )}

          {data && (
            <>
              {/* WIP stat cards per stage */}
              <section>
                <h2 className="section-heading mb-4 font-display-ar text-base font-bold text-ink">
                  الطلبات حسب المرحلة
                </h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {STAGE_ORDER.map((stage) => (
                    <StatCard
                      key={stage}
                      label={ORDER_STATUS_LABELS[stage] ?? stage}
                      value={String(data.wip[stage] ?? 0)}
                    />
                  ))}
                </div>
              </section>

              {/* Active presence — who is working on what right now */}
              {data.working && data.working.length > 0 && (
                <section>
                  <h2 className="section-heading mb-4 font-display-ar text-base font-bold text-ink">
                    يعمل الآن
                  </h2>
                  <ul className="space-y-2">
                    {data.working.map((w) => (
                      <li key={`${w.staff_id}-${w.order_id}`}>
                        <Link
                          href={`/staff/orders/${w.order_id}`}
                          className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm transition-colors hover:border-orange-ink/30 hover:bg-surface-sink/50"
                        >
                          <span className="font-medium text-ink">
                            الموظف {w.staff_name} يعمل على {w.product_name}
                          </span>
                          <span className="shrink-0 rounded-full border border-orange-ink/25 bg-orange-ink/8 px-2.5 py-0.5 text-xs font-semibold text-orange-ink">
                            نشط
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Staff throughput */}
              <section>
                <h2 className="section-heading mb-4 font-display-ar text-base font-bold text-ink">
                  أداء الموظفين
                </h2>
                {data.throughput.length === 0 ? (
                  <EmptyState message="لا توجد بيانات أداء حتى الآن" />
                ) : (
                  <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-[var(--shadow-soft)]">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-line bg-surface-sink">
                          <th className="px-4 py-3 text-start font-semibold text-ink-soft">الموظف</th>
                          <th className="px-4 py-3 text-start font-semibold text-ink-soft">الدور</th>
                          {isAdmin && (
                            <th className="px-4 py-3 text-start font-semibold text-ink-soft">تعديل الراتب</th>
                          )}
                          <th className="px-4 py-3 text-end font-semibold text-ink-soft">الإجراءات</th>
                          <th className="px-4 py-3 text-start font-semibold text-ink-soft">آخر نشاط</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.throughput.map((row) => (
                          <tr
                            key={row.actor_id}
                            className="border-b border-line last:border-0 hover:bg-surface-sink/50 transition-colors"
                          >
                            <td className="px-4 py-3 font-medium text-ink">{row.name}</td>
                            <td className="px-4 py-3 text-ink-soft">
                              {(STAFF_TYPE_LABELS as Record<string, string>)[row.staff_type] ?? row.staff_type}
                            </td>
                            {isAdmin && (
                              <td className="px-4 py-3">
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => openSalary(row.actor_id, row.name, "bonus")}
                                    className="inline-flex min-h-8 items-center rounded-lg border border-orange-ink/30 bg-orange-ink/8 px-2.5 py-1 text-xs font-semibold text-orange-ink transition-colors hover:bg-orange-ink/15"
                                  >
                                    + حافز
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openSalary(row.actor_id, row.name, "deduction")}
                                    className="inline-flex min-h-8 items-center rounded-lg border border-danger/30 bg-danger/8 px-2.5 py-1 text-xs font-semibold text-danger transition-colors hover:bg-danger/15"
                                  >
                                    − خصم
                                  </button>
                                </div>
                              </td>
                            )}
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

              {/* Quick bonus/deduction modal (admin) */}
              <Modal
                open={!!salaryModal}
                onClose={() => setSalaryModal(null)}
                title={
                  salaryModal
                    ? `${salaryModal.kind === "bonus" ? "إضافة حافز" : "إضافة خصم"} — ${salaryModal.name}`
                    : ""
                }
                footer={
                  <>
                    <Button variant="ghost" onClick={() => setSalaryModal(null)}>
                      إلغاء
                    </Button>
                    <Button
                      variant={salaryModal?.kind === "deduction" ? "danger" : "primary"}
                      onClick={handleSalarySubmit}
                      loading={salarySaving}
                    >
                      {salaryModal?.kind === "deduction" ? "تطبيق الخصم" : "إضافة"}
                    </Button>
                  </>
                }
              >
                <div className="space-y-3">
                  <Input
                    label="المبلغ (د.ع)"
                    type="text"
                    inputMode="numeric"
                    dir="ltr"
                    value={salaryAmount}
                    onChange={(e) =>
                      setSalaryAmount(e.target.value.replace(/[^\d]/g, ""))
                    }
                    placeholder="0"
                  />
                  <Input
                    label="السبب (اختياري)"
                    value={salaryReason}
                    onChange={(e) => setSalaryReason(e.target.value)}
                    placeholder={
                      salaryModal?.kind === "bonus"
                        ? "مثال: أداء ممتاز هذا الشهر"
                        : "مثال: تأخير في التسليم"
                    }
                  />
                </div>
              </Modal>

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
                            <p className="text-xs text-muted">
                              {o.product_name}
                              {o.batch_name ? ` · ${o.batch_name}` : ""}
                            </p>
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

              {/* Stars of the month — top 3 by 30-day throughput */}
              {topStaff.length > 0 && (
                <section>
                  <h2 className="section-heading mb-4 font-display-ar text-base font-bold text-ink">
                    نجوم الشهر
                  </h2>
                  <div className="grid gap-3 md:grid-cols-3">
                    {topStaff.map((t, i) => (
                      <div
                        key={t.actor_id}
                        className={`relative flex flex-col gap-2 rounded-2xl border px-4 py-4 ${
                          i === 0
                            ? "border-orange-ink/30 bg-warm-veil"
                            : "border-line bg-surface"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                              i === 0
                                ? "bg-brand-gradient text-white"
                                : "border border-line bg-surface-sink text-ink-soft"
                            }`}
                          >
                            {i === 0 && (
                              <svg aria-hidden width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 2l2.9 6.26L21.5 9.27l-4.75 4.13L18.18 20 12 16.4 5.82 20l1.43-6.6L2.5 9.27l6.6-1.01L12 2z" />
                              </svg>
                            )}
                            {RANK_LABELS[i]}
                          </span>
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => openSalary(t.actor_id, t.name, "bonus")}
                              className="min-h-9 rounded-full border border-orange-ink/25 px-3 text-xs font-semibold text-orange-ink transition-colors hover:bg-orange-ink/10"
                            >
                              + حافز
                            </button>
                          )}
                        </div>
                        <div>
                          <p className="truncate font-display-ar text-base font-bold text-ink">
                            {t.name}
                          </p>
                          <p className="text-xs text-muted">
                            {STAFF_TYPE_LABELS[t.staff_type as StaffType] ?? t.staff_type}
                          </p>
                        </div>
                        <p className="text-sm">
                          <span className={`font-bold ${i === 0 ? "text-orange-ink" : "text-ink"}`}>
                            {actionsArabic(t.actions)}
                          </span>{" "}
                          <span className="text-xs text-muted">في آخر ٣٠ يوماً</span>
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Quick stage links */}
              <section>
                <h2 className="section-heading mb-4 font-display-ar text-base font-bold text-ink">
                  روابط سريعة
                </h2>
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
            </>
          )}
        </>
      )}
    </div>
  );
}

// ─── Root page ────────────────────────────────────────────────────────────────

function StaffPageContent() {
  const { user, loading } = useRequireAuth(["staff", "admin"]);

  if (loading || !user) {
    return <PageLoader />;
  }

  // Multi-role staff: staff_types[] is authoritative (the backend scopes off the union, not the
  // primary scalar). Landing on the wrong home was a real bug — a designer+manager lost the
  // dashboard, a tailor+embroiderer hit «الدور غير محدد».
  const myTypes = user.staff_types ?? (user.staff_type ? [user.staff_type] : []);
  const isManager = user.role === "admin" || myTypes.includes("manager");
  const showSourceFilter = isManager || user.order_scope === "both";

  if (isManager) {
    return (
      <MonitorDashboard
        showSourceFilter={showSourceFilter}
        isAdmin={user.role === "admin"}
      />
    );
  }

  // First role the staffer holds that has a queue view (falls through to the empty state if none).
  const staffType = myTypes.find((t) => t in QUEUE_META) ?? null;

  if (staffType && staffType in QUEUE_META) {
    return (
      <QueueView
        staffType={staffType}
        showSourceFilter={showSourceFilter}
        orderScope={user.order_scope}
      />
    );
  }

  return (
    <div dir="rtl" lang="ar">
      <PageHeader title="لوحة الطلبات" subtitle="الطلبات النشطة" />
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
