"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { api, getApiErrorMessage } from "@/lib/api";
import type { OrderStatus, StudentApprovalStatus, WholesalerStudentRow } from "@/lib/types";
import { PageLoader } from "@/components/ui/Spinner";
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

function statusPillClass(s: StudentApprovalStatus): string {
  if (s === "approved") return "bg-emerald-100 text-emerald-900";
  if (s === "rejected") return "bg-red-100 text-red-800";
  return "bg-amber-100 text-amber-900";
}

type CompletionFilter = "" | "completed" | "not_completed";

const PAGE_SIZE = 25;

export default function StaffWholesalerStudentsPage() {
  const { wholesalerId } = useParams<{ wholesalerId: string }>();
  const [rows, setRows] = useState<WholesalerStudentRow[]>([]);
  const [loading, setLoading] = useState(true);

  // filter state
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | StudentApprovalStatus>("");
  const [completion, setCompletion] = useState<CompletionFilter>("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!wholesalerId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    setLoading(true);
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
      .catch((err) => toast.error(getApiErrorMessage(err, "تعذر تحميل الطلاب")))
      .finally(() => setLoading(false));
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

  if (loading) return <PageLoader />;

  return (
    <div dir="rtl" lang="ar">
      <Link href="/staff/wholesalers" className="mb-4 inline-flex text-sm font-medium text-orange-ink hover:underline">
        ← الممثلون
      </Link>

      <PageHeader title="طلاب الممثل" subtitle="حالة الموافقة وإكمال الطلب لكل طالب" />

      {/* Search + filters */}
      <div className="surface-card mb-4 space-y-3 rounded-2xl p-3.5">
        <Input
          type="search"
          placeholder="بحث باسم الطالب…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full"
          aria-label="بحث باسم الطالب"
        />

        <div className="space-y-2">
          <p className="text-xs font-medium text-ink/60">حالة الموافقة</p>
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
          <p className="text-xs font-medium text-ink/60">حالة الاكتمال</p>
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
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {paginated.map((s) => (
              <article
                key={s.id}
                className="rounded-2xl border border-ink/10 bg-white p-4 shadow-[var(--shadow-soft)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-display text-base font-bold text-ink">{s.name}</p>
                    <p className="text-sm text-ink/60" dir="ltr">
                      {s.phone}
                    </p>
                    <p className="mt-1 text-xs text-ink/50">
                      {s.universityName || "—"}
                      {s.department ? ` — ${s.department}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusPillClass(s.status)}`}>
                      {statusLabel(s.status)}
                    </span>
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                        s.isCompleted
                          ? "bg-orange/15 text-orange-ink"
                          : "bg-ink/5 text-ink/60"
                      }`}
                    >
                      {s.isCompleted ? "مكتمل" : "غير مكتمل"}
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between gap-3 text-sm">
              <span className="text-ink/60">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} من {filtered.length}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                  aria-label="الصفحة السابقة"
                >
                  ›
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={page === totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  aria-label="الصفحة التالية"
                >
                  ‹
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
