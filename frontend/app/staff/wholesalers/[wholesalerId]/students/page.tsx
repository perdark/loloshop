"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { api, getApiErrorMessage } from "@/lib/api";
import type { OrderStatus, StudentApprovalStatus, WholesalerStudentRow } from "@/lib/types";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

interface ApiRow {
  id: string;
  name: string;
  phone: string;
  status: StudentApprovalStatus;
  university_name: string | null;
  department: string | null;
  order_status: string | null;
  is_completed?: boolean;
}

const ORDER_STATUS_SET = new Set<OrderStatus>([
  "pending_approval",
  "designing",
  "design_complete",
  "staff_review",
  "printing",
  "ready",
  "delivered",
  "cancelled",
]);

function parseOrderStatus(v: string | null): OrderStatus | null {
  if (!v) return null;
  return ORDER_STATUS_SET.has(v as OrderStatus) ? (v as OrderStatus) : null;
}

function statusLabel(s: StudentApprovalStatus): string {
  if (s === "approved") return "موافق عليه";
  if (s === "rejected") return "مرفوض";
  return "بانتظار الموافقة";
}

/**
 * Approval status pill — palette tokens only (no emerald/red/amber).
 * Scheme follows OrderCard:
 *   approved  → orange-ink accent (active state)
 *   pending   → neutral surface-sink
 *   rejected  → danger
 */
function statusPillClass(s: StudentApprovalStatus): string {
  if (s === "approved") return "border-orange-ink/30 bg-orange-ink/10 text-orange-ink";
  if (s === "rejected") return "border-[var(--color-danger)]/25 bg-[var(--color-danger)]/8 text-[var(--color-danger)]";
  return "border-line bg-surface-sink text-ink-soft";
}

type CompletionFilter = "" | "completed" | "not_completed";

const PAGE_SIZE = 25;

/** Content-shaped skeleton: mimics the student card grid */
function StudentSkeleton() {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="skeleton h-28 w-full rounded-2xl" />
      ))}
    </div>
  );
}

export default function StaffWholesalerStudentsPage() {
  const { wholesalerId } = useParams<{ wholesalerId: string }>();
  const [rows, setRows] = useState<WholesalerStudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  // filter state
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | StudentApprovalStatus>("");
  const [completion, setCompletion] = useState<CompletionFilter>("");
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    if (!wholesalerId) return;
    setLoading(true);
    setFetchError(false);
    api
      .get<{ data: ApiRow[] }>(`/staff/wholesalers/${wholesalerId}/students`)
      .then(({ data }) => {
        setRows(
          (data.data || []).map((r) => ({
            id: r.id,
            name: r.name,
            phone: r.phone,
            status: r.status,
            universityName: r.university_name,
            department: r.department,
            orderStatus: parseOrderStatus(r.order_status),
            isCompleted: Boolean(r.is_completed),
          }))
        );
      })
      .catch((err) => {
        toast.error(getApiErrorMessage(err, "تعذر تحميل الطلاب"));
        setFetchError(true);
      })
      .finally(() => setLoading(false));
  }, [wholesalerId]);

  useEffect(() => {
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wholesalerId]);

  // reset page whenever filters change (adjust state during render — no effect)
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
    if (statusFilter) {
      out = out.filter((r) => r.status === statusFilter);
    }
    if (completion) {
      const wantCompleted = completion === "completed";
      out = out.filter((r) => r.isCompleted === wantCompleted);
    }
    return out;
  }, [rows, search, statusFilter, completion]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div dir="rtl" lang="ar" className="space-y-6">
      <Link
        href="/staff/wholesalers"
        className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-orange-ink transition-colors hover:text-orange"
      >
        <span aria-hidden>→</span> الممثلون
      </Link>

      <PageHeader title="طلاب الممثل" subtitle="حالة الموافقة وإكمال الطلب لكل طالب" />

      {loading ? (
        <StudentSkeleton />
      ) : fetchError ? (
        <div className="rounded-2xl border border-[var(--color-danger)]/25 bg-[var(--shop-sink)] px-6 py-10 text-center">
          <p className="text-base font-semibold text-ink">تعذر تحميل بيانات الطلاب</p>
          <p className="mt-1 text-sm text-ink-soft">تحقق من اتصالك ثم أعد المحاولة.</p>
          <Button className="mt-4" onClick={load}>إعادة المحاولة</Button>
        </div>
      ) : (
        <>
          {/* Search + filters */}
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
                        <p className="text-sm text-ink-soft" dir="ltr">
                          {s.phone}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          {s.universityName || "—"}
                          {s.department ? ` — ${s.department}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        {/* Approval status pill — palette tokens */}
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusPillClass(s.status)}`}>
                          {statusLabel(s.status)}
                        </span>
                        {/* Completion pill: orange-ink when done, neutral otherwise */}
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

              {/* RTL-correct pagination: in RTL layout "next page" is ← and "prev page" is → */}
              {totalPages > 1 && (
                <nav
                  className="mt-4 flex items-center justify-between gap-3 text-sm"
                  aria-label="التنقل بين صفحات الطلاب"
                >
                  <span className="text-ink-soft">
                    {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} من {filtered.length}
                  </span>
                  <div className="flex gap-2">
                    {/* "Previous page" = go to lower number; chevron → (start/right in RTL) */}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={page === 1}
                      onClick={() => setPage((p) => p - 1)}
                      aria-label="الصفحة السابقة"
                    >
                      →
                    </Button>
                    {/* "Next page" = go to higher number; chevron ← (end/left in RTL) */}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={page === totalPages}
                      onClick={() => setPage((p) => p + 1)}
                      aria-label="الصفحة التالية"
                    >
                      ←
                    </Button>
                  </div>
                </nav>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
