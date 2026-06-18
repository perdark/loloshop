"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { api, getApiErrorMessage } from "@/lib/api";
import type { OrderStatus, StudentApprovalStatus, WholesalerStudentRow } from "@/lib/types";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatCard } from "@/components/ui/StatCard";
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

type CompletionFilter = "" | "completed" | "not_completed";

const PAGE_SIZE = 25;

export default function AdminWholesalerStudentsPage() {
  const { wholesalerId } = useParams<{ wholesalerId: string }>();
  const [rows, setRows] = useState<WholesalerStudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  // filter state
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | StudentApprovalStatus>("");
  const [completion, setCompletion] = useState<CompletionFilter>("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!wholesalerId) return;
     
    setLoading(true);
    setFetchError(false);
    api
      .get<{ data: ApiRow[] }>(`/admin/wholesalers/${wholesalerId}/students`)
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
  }, [wholesalerId, retryKey]);

  // reset page whenever filters change (adjust state during render — no effect)
  const filtersKey = `${search}|${statusFilter}|${completion}`;
  const [prevFiltersKey, setPrevFiltersKey] = useState(filtersKey);
  if (prevFiltersKey !== filtersKey) {
    setPrevFiltersKey(filtersKey);
    setPage(1);
  }

  const stats = useMemo(() => {
    let completed = 0;
    let pending = 0;
    for (const r of rows) {
      if (r.isCompleted) completed += 1;
      if (r.status === "pending_approval") pending += 1;
    }
    return { total: rows.length, pending, completed };
  }, [rows]);

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

  if (loading) return (
    <div dir="rtl" lang="ar" className="space-y-5 animate-fade-page-in">
      <div className="skeleton h-5 w-24 rounded-full" />
      <div className="skeleton h-10 w-48" />
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="skeleton h-20 rounded-2xl" />
        ))}
      </div>
      <div className="skeleton h-64 w-full rounded-2xl" />
    </div>
  );

  if (fetchError) return (
    <div dir="rtl" lang="ar" className="space-y-5">
      <Link
        href="/admin/wholesalers"
        className="inline-flex items-center gap-1 text-sm font-medium text-orange-ink transition-colors hover:text-orange"
      >
        <span aria-hidden>←</span> الممثلون
      </Link>
      <div className="rounded-2xl border border-danger/25 bg-[var(--shop-sink)] px-6 py-10 text-center">
        <p className="text-base font-semibold text-ink">تعذر تحميل الطلاب</p>
        <p className="mt-1 text-sm text-ink-soft">تحقق من اتصالك ثم أعد المحاولة.</p>
        <Button className="mt-4" onClick={() => setRetryKey((k) => k + 1)}>
          إعادة المحاولة
        </Button>
      </div>
    </div>
  );

  return (
    <div dir="rtl" lang="ar" className="space-y-5">
      <Link
        href="/admin/wholesalers"
        className="inline-flex items-center gap-1 text-sm font-medium text-orange-ink transition-colors hover:text-orange"
      >
        <span aria-hidden>←</span> الممثلون
      </Link>

      <div className="relative ps-3.5">
        <span
          aria-hidden
          className="absolute bottom-1 start-0 top-1 w-[3px] rounded-full bg-orange-ink"
        />
        <h1 className="font-display text-2xl font-bold leading-tight text-ink lg:text-3xl">طلاب الممثل</h1>
        <p className="mt-1 text-sm text-ink-soft">قائمة الطلاب وحالات الموافقة والاكتمال</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="الكل" value={String(stats.total)} />
        <StatCard label="بانتظار" value={String(stats.pending)} />
        <StatCard label="مكتمل" value={String(stats.completed)} accent="profit" />
      </div>

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
          <p className="text-xs font-medium text-[var(--shop-muted)]">حالة الموافقة</p>
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
          <p className="text-xs font-medium text-[var(--shop-muted)]">حالة الاكتمال</p>
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
        <EmptyState message="لا يوجد طلاب" />
      ) : (
        <>
          <div className="surface-card overflow-x-auto rounded-2xl">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-ink/10 bg-ink/[0.04] text-right text-xs uppercase tracking-wide text-[var(--shop-muted)]">
                  <th className="px-4 py-3 font-semibold">الاسم</th>
                  <th className="px-4 py-3 font-semibold">الهاتف</th>
                  <th className="px-4 py-3 font-semibold">الحالة</th>
                  <th className="px-4 py-3 font-semibold">الجامعة/القسم</th>
                  <th className="px-4 py-3 font-semibold">اكتمال</th>
                  <th className="px-4 py-3 font-semibold">الطلب</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((s) => (
                  <tr
                    key={s.id}
                    className="border-b border-ink/5 transition-colors odd:bg-cream/40 last:border-0 hover:bg-peach/25"
                  >
                    <td className="px-4 py-3 font-medium text-ink">{s.name}</td>
                    <td className="px-4 py-3 tabular-nums text-ink-soft" dir="ltr">
                      {s.phone}
                    </td>
                    <td className="px-4 py-3 text-ink-soft">
                      {statusLabel(s.status)}
                    </td>
                    <td className="px-4 py-3 text-ink-soft">
                      {s.universityName || "—"}
                      {s.department ? ` — ${s.department}` : ""}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                          s.isCompleted
                            ? "bg-orange-ink/10 text-orange-ink"
                            : "bg-ink/[0.06] text-muted"
                        }`}
                      >
                        {s.isCompleted ? "مكتمل" : "غير مكتمل"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {/* TODO: link to per-student order detail when a dedicated route exists.
                          Currently /admin/orders has no per-student route; filtering by student
                          is not yet supported via URL param. Link to the general orders list
                          pre-filtered by this wholesaler as the closest available view. */}
                      <Link
                        href={`/admin/orders?wholesaler=${wholesalerId}`}
                        className="inline-flex min-h-[44px] items-center rounded-lg px-3 text-xs font-medium text-orange-ink underline-offset-2 hover:underline"
                      >
                        عرض الطلبات
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination — RTL: next page is ← (forward in RTL), prev page is → */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 pt-1 text-sm">
              <span className="text-ink-soft">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} من {filtered.length}
              </span>
              <div className="flex gap-2">
                {/* next page: goes to higher page number → RTL visually is ← */}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={page === totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  aria-label="الصفحة التالية"
                >
                  ←
                </Button>
                {/* prev page: goes to lower page number → RTL visually is → */}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                  aria-label="الصفحة السابقة"
                >
                  →
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
