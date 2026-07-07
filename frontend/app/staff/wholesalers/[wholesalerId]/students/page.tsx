"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { api, getApiErrorMessage } from "@/lib/api";
import type { OrderStatus, StudentApprovalStatus, WholesalerStudentRow } from "@/lib/types";
import {
  FULLSET_ZONE_LABELS,
  FULLSET_ZONE_ORDER,
  type FullSetZone,
} from "@/lib/constants";
import {
  advanceBulk,
  getWholesalerOrders,
  type WholesalerOrderRow,
} from "@/lib/staff";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useRequireAuth } from "@/hooks/useRequireAuth";

// ─── Shared status pill (warm brand palette, no blue/purple) ──────────────────
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

// Module-scope (not in render) so the React purity rule doesn't flag Date.now().
function isOverdueOrder(o: WholesalerOrderRow): boolean {
  if (o.deadline == null || o.isDone) return false;
  return new Date(o.deadline).getTime() < Date.now();
}

type Tab = "orders" | "roster";

export default function StaffWholesalerStudentsPage() {
  const { wholesalerId } = useParams<{ wholesalerId: string }>();
  const { user } = useRequireAuth(["staff", "admin"]);
  const isAdmin = user?.role === "admin";
  const [tab, setTab] = useState<Tab>("orders");

  return (
    <div dir="rtl" lang="ar" className="space-y-6 pb-28">
      <Link
        href="/staff/wholesalers"
        className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-orange-ink transition-colors hover:text-orange"
      >
        <span aria-hidden>→</span> الممثلون
      </Link>

      <PageHeader title="طلبات الممثل" subtitle="طلبات طلاب الممثل — صمّم، طرّز، وأكمل دفعةً واحدة" />

      {/* Tabs — big tap targets, full-width on mobile */}
      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-surface-sink p-1">
        {([
          { id: "orders", label: "الطلبات" },
          { id: "roster", label: "الطلاب" },
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

      {tab === "orders" ? (
        <OrdersTab wholesalerId={wholesalerId} isAdmin={isAdmin} ready={!!user} />
      ) : (
        <RosterTab wholesalerId={wholesalerId} isAdmin={isAdmin} ready={!!user} />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Orders tab — the rep-scoped order-working console
// ══════════════════════════════════════════════════════════════════════════════

type CompletionView = "all" | "actionable" | "done";

function OrdersTab({
  wholesalerId,
  isAdmin,
  ready,
}: {
  wholesalerId: string;
  isAdmin: boolean;
  ready: boolean;
}) {
  const [orders, setOrders] = useState<WholesalerOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [zone, setZone] = useState<FullSetZone | "">("");
  const [view, setView] = useState<CompletionView>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  // Zone is the only server-side filter (refetches); completion/search are client-side.
  const load = useCallback(() => {
    if (!wholesalerId) return;
    setLoading(true);
    setFetchError(false);
    getWholesalerOrders(wholesalerId, { zone: zone || undefined, isAdmin })
      .then((rows) => {
        setOrders(rows);
        setSelected(new Set()); // selection is invalid after a refetch
      })
      .catch((err) => {
        toast.error(getApiErrorMessage(err, "تعذر تحميل الطلبات"));
        setFetchError(true);
      })
      .finally(() => setLoading(false));
  }, [wholesalerId, zone, isAdmin]);

  useEffect(() => {
    if (!ready) return;
    load();
  }, [ready, load]);

  const filtered = useMemo(() => {
    let out = orders;
    if (view === "actionable") out = out.filter((o) => o.canAdvance);
    else if (view === "done") out = out.filter((o) => o.isDone);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((o) => o.studentName.toLowerCase().includes(q));
    }
    return out;
  }, [orders, view, search]);

  // Only advanceable rows in the current view can be batch-completed.
  const selectableIds = useMemo(
    () => filtered.filter((o) => o.canAdvance).map((o) => o.id),
    [filtered]
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
      const res = await advanceBulk([...selected]);
      if (res.advanced > 0) {
        toast.success(
          res.skipped > 0
            ? `تم إكمال ${res.advanced} طلب · تخطّي ${res.skipped}`
            : `تم إكمال ${res.advanced} طلب`
        );
      } else {
        toast.error("لم يكن بالإمكان إكمال أي طلب من المحدد");
      }
      load(); // refresh statuses + can_advance
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر إكمال الطلبات"));
    } finally {
      setBulkLoading(false);
    }
  }

  const counts = useMemo(
    () => ({
      total: orders.length,
      actionable: orders.filter((o) => o.canAdvance).length,
      done: orders.filter((o) => o.isDone).length,
    }),
    [orders]
  );

  // Opening an order should return to THIS rep's page (not the generic /staff home).
  const backFrom = `/staff/wholesalers/${wholesalerId}/students`;

  return (
    <div className="space-y-4">
      {/* Zone chips — horizontal scroll on mobile */}
      <nav
        aria-label="تصفية حسب مكان التطريز"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <ZoneChip label="الكل" active={zone === ""} onClick={() => setZone("")} />
        {FULLSET_ZONE_ORDER.map((z) => (
          <ZoneChip
            key={z}
            label={FULLSET_ZONE_LABELS[z]}
            active={zone === z}
            onClick={() => setZone(z)}
          />
        ))}
      </nav>

      {/* Completion segmented control + search */}
      <div className="surface-card space-y-3 rounded-2xl p-3.5">
        <div className="flex flex-wrap gap-2">
          {([
            { id: "all", label: `الكل (${counts.total})` },
            { id: "actionable", label: `يخصّني الآن (${counts.actionable})` },
            { id: "done", label: `منجز (${counts.done})` },
          ] as { id: CompletionView; label: string }[]).map((o) => (
            <Button
              key={o.id}
              size="sm"
              variant={view === o.id ? "primary" : "ghost"}
              onClick={() => setView(o.id)}
            >
              {o.label}
            </Button>
          ))}
        </div>
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
        <EmptyState message="لا توجد طلبات مطابقة لهذا التصفية." />
      ) : (
        <>
          {/* Select-all-completable affordance */}
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
              تحديد كل القابل للإكمال ({selectableIds.length})
            </button>
          )}

          <ul className="space-y-2.5">
            {filtered.map((o) => (
              <OrderRow
                key={o.id}
                order={o}
                checked={selected.has(o.id)}
                onToggle={() => toggleOne(o.id)}
                pill={statusPill(o.status)}
                backFrom={backFrom}
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
            <Button onClick={doBulkComplete} loading={bulkLoading} className="min-w-[8rem]">
              إكمال ({selectedCount})
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ZoneChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-pill px-4 text-sm font-semibold transition-colors ${
        active
          ? "bg-orange-ink text-white"
          : "bg-surface text-ink-soft ring-1 ring-ink/10 hover:bg-surface-sink"
      }`}
    >
      {label}
    </button>
  );
}

function OrderRow({
  order,
  checked,
  onToggle,
  pill,
  backFrom,
}: {
  order: WholesalerOrderRow;
  checked: boolean;
  onToggle: () => void;
  pill: string;
  backFrom: string;
}) {
  const overdue = isOverdueOrder(order);

  return (
    <li className="flex items-stretch gap-1 rounded-2xl border border-line bg-surface shadow-[var(--shadow-soft)]">
      {/* Checkbox — disabled when this staff can't advance the order (no ghost 409s) */}
      <button
        type="button"
        onClick={onToggle}
        disabled={!order.canAdvance}
        aria-label={order.canAdvance ? "تحديد الطلب" : "لا يمكنك إكمال هذا الطلب الآن"}
        aria-pressed={checked}
        className={`flex w-14 shrink-0 items-center justify-center rounded-s-2xl transition-colors ${
          order.canAdvance ? "hover:bg-surface-sink" : "cursor-not-allowed opacity-40"
        }`}
      >
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-md border-2 text-sm ${
            !order.canAdvance
              ? "border-ink/15"
              : checked
                ? "border-orange-ink bg-orange-ink text-white"
                : "border-ink/30"
          }`}
          aria-hidden
        >
          {checked && order.canAdvance ? "✓" : ""}
        </span>
      </button>

      {/* Body — tap opens the full order */}
      <Link
        href={`/staff/orders/${order.id}?from=${encodeURIComponent(backFrom)}`}
        className="flex min-w-0 flex-1 items-center justify-between gap-3 py-3 pe-4 ps-1"
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
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${pill}`}>
            {order.statusLabel}
          </span>
          {overdue && (
            <span className="rounded-full bg-[var(--color-danger)]/10 px-2 py-0.5 text-[10px] font-bold text-[var(--color-danger)]">
              متأخر
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Roster tab — approval + completion status per student (the original view)
// ══════════════════════════════════════════════════════════════════════════════

interface RosterApiRow {
  id: string;
  name: string;
  phone: string;
  status: StudentApprovalStatus;
  university_name: string | null;
  department: string | null;
  order_status: string | null;
  is_completed?: boolean;
}

type CompletionFilter = "" | "completed" | "not_completed";
const PAGE_SIZE = 25;

function statusLabel(s: StudentApprovalStatus): string {
  if (s === "approved") return "موافق عليه";
  if (s === "rejected") return "مرفوض";
  return "بانتظار الموافقة";
}
function statusPillClass(s: StudentApprovalStatus): string {
  if (s === "approved") return "border-orange-ink/30 bg-orange-ink/10 text-orange-ink";
  if (s === "rejected") return "border-[var(--color-danger)]/25 bg-[var(--color-danger)]/8 text-[var(--color-danger)]";
  return "border-line bg-surface-sink text-ink-soft";
}

function RosterTab({
  wholesalerId,
  isAdmin,
  ready,
}: {
  wholesalerId: string;
  isAdmin: boolean;
  ready: boolean;
}) {
  const [rows, setRows] = useState<WholesalerStudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | StudentApprovalStatus>("");
  const [completion, setCompletion] = useState<CompletionFilter>("");
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    if (!wholesalerId) return;
    setLoading(true);
    setFetchError(false);
    const endpoint = isAdmin
      ? `/admin/wholesalers/${wholesalerId}/students`
      : `/staff/wholesalers/${wholesalerId}/students`;
    api
      .get<{ data: RosterApiRow[] }>(endpoint)
      .then(({ data }) => {
        setRows(
          (data.data || []).map((r) => ({
            id: r.id,
            name: r.name,
            phone: r.phone,
            status: r.status,
            universityName: r.university_name,
            department: r.department,
            orderStatus: (r.order_status as OrderStatus | null) ?? null,
            isCompleted: Boolean(r.is_completed),
          }))
        );
      })
      .catch((err) => {
        toast.error(getApiErrorMessage(err, "تعذر تحميل الطلاب"));
        setFetchError(true);
      })
      .finally(() => setLoading(false));
  }, [wholesalerId, isAdmin]);

  useEffect(() => {
    if (!ready) return;
    load();
  }, [ready, load]);

  const filtersKey = `${search}|${statusFilter}|${completion}`;
  const [prevFiltersKey, setPrevFiltersKey] = useState(filtersKey);
  if (prevFiltersKey !== filtersKey) {
    setPrevFiltersKey(filtersKey);
    setPage(1);
  }

  const filtered = useMemo(() => {
    let out = rows;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((r) => r.name.toLowerCase().includes(q));
    }
    if (statusFilter) out = out.filter((r) => r.status === statusFilter);
    if (completion) {
      const wantCompleted = completion === "completed";
      out = out.filter((r) => r.isCompleted === wantCompleted);
    }
    return out;
  }, [rows, search, statusFilter, completion]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (loading) {
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-hidden>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton h-28 w-full rounded-2xl" />
        ))}
      </div>
    );
  }
  if (fetchError) {
    return (
      <div className="rounded-2xl border border-[var(--color-danger)]/25 bg-[var(--shop-sink)] px-6 py-10 text-center">
        <p className="text-base font-semibold text-ink">تعذر تحميل بيانات الطلاب</p>
        <p className="mt-1 text-sm text-ink-soft">تحقق من اتصالك ثم أعد المحاولة.</p>
        <Button className="mt-4" onClick={load}>إعادة المحاولة</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="surface-card space-y-3 rounded-2xl p-3.5">
        <Input
          type="search"
          placeholder="بحث باسم الطالب…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full"
          aria-label="بحث باسم الطالب"
        />
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted">حالة الموافقة</p>
          <div className="flex flex-wrap gap-2">
            {[
              { id: "", label: "الكل" },
              { id: "pending_approval", label: "بانتظار" },
              { id: "approved", label: "موافق" },
              { id: "rejected", label: "مرفوض" },
            ].map((o) => (
              <Button
                key={o.id}
                size="sm"
                variant={statusFilter === (o.id as "" | StudentApprovalStatus) ? "primary" : "ghost"}
                onClick={() => setStatusFilter(o.id as "" | StudentApprovalStatus)}
              >
                {o.label}
              </Button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted">حالة الاكتمال</p>
          <div className="flex flex-wrap gap-2">
            {[
              { id: "", label: "الكل" },
              { id: "completed", label: "مكتمل" },
              { id: "not_completed", label: "غير مكتمل" },
            ].map((o) => (
              <Button
                key={o.id}
                size="sm"
                variant={completion === (o.id as CompletionFilter) ? "primary" : "ghost"}
                onClick={() => setCompletion(o.id as CompletionFilter)}
              >
                {o.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState message="لا يوجد طلاب مطابقون لمعايير البحث." />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {paginated.map((s) => (
              <article
                key={s.id}
                className="rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-soft)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-display text-base font-bold text-ink">{s.name}</p>
                    <p className="text-sm text-ink-soft" dir="ltr">{s.phone}</p>
                    <p className="mt-1 text-xs text-muted">
                      {s.universityName || "—"}
                      {s.department ? ` — ${s.department}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusPillClass(s.status)}`}>
                      {statusLabel(s.status)}
                    </span>
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${
                        s.isCompleted
                          ? "border-orange-ink/30 bg-orange-ink/10 text-orange-ink"
                          : "border-line bg-surface-sink text-muted"
                      }`}
                    >
                      {s.isCompleted ? "مكتمل" : "غير مكتمل"}
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </div>

          {totalPages > 1 && (
            <nav className="mt-4 flex items-center justify-between gap-3 text-sm" aria-label="التنقل بين صفحات الطلاب">
              <span className="text-ink-soft">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} من {filtered.length}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" disabled={page === 1} onClick={() => setPage((p) => p - 1)} aria-label="الصفحة السابقة">→</Button>
                <Button size="sm" variant="ghost" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)} aria-label="الصفحة التالية">←</Button>
              </div>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
