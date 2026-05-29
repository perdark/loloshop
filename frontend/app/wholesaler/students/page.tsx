"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { getWholesalerStudents } from "@/lib/wholesaler";
import { getApiErrorMessage } from "@/lib/api";
import type { StudentApprovalStatus, WholesalerStudentRow } from "@/lib/types";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatCard } from "@/components/ui/StatCard";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type CompletionFilter = "" | "completed" | "not_completed";

function statusLabel(s: StudentApprovalStatus): string {
  if (s === "approved") return "موافق عليه";
  if (s === "rejected") return "مرفوض";
  return "بانتظار الموافقة";
}

/**
 * Status pill classes — palette-only, no green/red/amber/emerald/rose.
 * - approved  → active peak: orange tint
 * - rejected  → danger brick
 * - pending   → neutral default
 */
function statusPillClass(s: StudentApprovalStatus): string {
  if (s === "approved")
    return "bg-orange-ink/10 text-orange-ink";
  if (s === "rejected")
    return "border border-danger/40 bg-danger/10 text-danger";
  return "border border-line bg-[var(--shop-sink)] text-ink-soft";
}

function completionLabel(isCompleted: boolean): string {
  return isCompleted ? "مكتمل" : "غير مكتمل";
}

function completionPillClass(isCompleted: boolean): string {
  return isCompleted
    ? "bg-orange/15 text-orange-ink"
    : "border border-line bg-[var(--shop-sink)] text-[var(--shop-muted)]";
}

const PAGE_SIZE = 25;

export default function WholesalerStudentsPage() {
  const [rows, setRows] = useState<WholesalerStudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [status, setStatus] = useState<"" | StudentApprovalStatus>("");
  const [completion, setCompletion] = useState<CompletionFilter>("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  function fetchStudents(s: "" | StudentApprovalStatus) {
    setLoading(true);
    setLoadError(false);
    getWholesalerStudents({ status: s })
      .then(setRows)
      .catch((err) => {
        setLoadError(true);
        toast.error(getApiErrorMessage(err, "تعذر تحميل الطلاب"));
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refetch on filter change
    fetchStudents(status);
  }, [status]);

  // reset page whenever filters change (adjust state during render — no effect)
  const filtersKey = `${search}|${status}|${completion}`;
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
    if (completion) {
      const wantCompleted = completion === "completed";
      out = out.filter((r) => r.isCompleted === wantCompleted);
    }
    return out;
  }, [rows, search, completion]);

  const stats = useMemo(() => {
    let completed = 0;
    let pending = 0;
    for (const r of rows) {
      if (r.isCompleted) completed += 1;
      if (r.status === "pending_approval") pending += 1;
    }
    return { total: rows.length, pending, completed };
  }, [rows]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (loading) return <PageLoader />;

  if (loadError) {
    return (
      <div className="space-y-4">
        <BackLink />
        <EmptyState
          title="تعذر تحميل الطلاب"
          message="تحقق من الاتصال ثم حاول مجدداً."
          action={
            <Button variant="ghost" onClick={() => fetchStudents(status)}>
              إعادة المحاولة
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="section-heading font-display-ar text-xl font-bold text-ink">الطلاب</h1>
        <BackLink />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="الكل" value={String(stats.total)} />
        <StatCard label="بانتظار الموافقة" value={String(stats.pending)} />
        <StatCard label="تصميم مكتمل" value={String(stats.completed)} accent="profit" />
      </div>

      <section className="surface-card space-y-3 rounded-2xl p-3.5">
        {/* Name search */}
        <Input
          type="search"
          placeholder="بحث باسم الطالب…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full"
          aria-label="بحث باسم الطالب"
        />

        {/* Filters */}
        <div>
          <p className="mb-2 text-sm font-medium text-ink">تصفية</p>
          <div className="flex flex-wrap gap-2">
            {([
              { id: "", label: "الكل" },
              { id: "pending_approval", label: "بانتظار" },
              { id: "approved", label: "موافق" },
              { id: "rejected", label: "مرفوض" },
            ] as const).map((o) => (
              <Button
                key={o.id}
                variant={status === o.id ? "primary" : "ghost"}
                onClick={() => setStatus(o.id as "" | StudentApprovalStatus)}
              >
                {o.label}
              </Button>
            ))}
            <span className="mx-1 h-11 w-px bg-line" aria-hidden />
            {([
              { id: "", label: "الكل" },
              { id: "completed", label: "مكتمل" },
              { id: "not_completed", label: "غير مكتمل" },
            ] as const).map((o) => (
              <Button
                key={o.id}
                variant={completion === o.id ? "primary" : "ghost"}
                onClick={() => setCompletion(o.id as CompletionFilter)}
              >
                {o.label}
              </Button>
            ))}
          </div>
        </div>
      </section>

      {filtered.length === 0 ? (
        <EmptyState message={search ? "لا توجد نتائج لهذا البحث" : "لا يوجد طلاب"} />
      ) : (
        <>
          <ul className="space-y-3">
            {paginated.map((s) => (
              <li key={s.id} className="surface-card card-lift rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-display-ar font-bold text-ink">{s.name}</p>
                    <p className="mt-0.5 text-sm tabular-nums text-ink-soft" dir="ltr">
                      {s.phone}
                    </p>
                    <p className="mt-1 text-xs text-[var(--shop-muted)]">
                      {s.universityName || "—"}
                      {s.department ? ` — ${s.department}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusPillClass(s.status)}`}
                    >
                      {statusLabel(s.status)}
                    </span>
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${completionPillClass(s.isCompleted)}`}
                    >
                      {completionLabel(s.isCompleted)}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 pt-1 text-sm">
              <span className="text-ink-soft">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} من {filtered.length}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                  aria-label="الصفحة السابقة"
                >
                  ›
                </Button>
                <Button
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

function BackLink() {
  return (
    <Link
      href="/wholesaler"
      className="inline-flex min-h-11 items-center text-sm font-medium text-orange-ink hover:underline"
    >
      ← رجوع
    </Link>
  );
}
