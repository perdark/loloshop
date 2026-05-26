"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { getWholesalerStudents } from "@/lib/wholesaler";
import { getApiErrorMessage } from "@/lib/api";
import type { StudentApprovalStatus, WholesalerStudentRow } from "@/lib/types";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";

type CompletionFilter = "" | "completed" | "not_completed";

function statusLabel(s: StudentApprovalStatus): string {
  if (s === "approved") return "موافق عليه";
  if (s === "rejected") return "مرفوض";
  return "بانتظار الموافقة";
}

function completionLabel(isCompleted: boolean): string {
  return isCompleted ? "مكتمل" : "غير مكتمل";
}

export default function WholesalerStudentsPage() {
  const [rows, setRows] = useState<WholesalerStudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<"" | StudentApprovalStatus>("");
  const [completion, setCompletion] = useState<CompletionFilter>("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refetch on filter change
    setLoading(true);
    getWholesalerStudents({ status })
      .then(setRows)
      .catch((err) => toast.error(getApiErrorMessage(err, "تعذر تحميل الطلاب")))
      .finally(() => setLoading(false));
  }, [status]);

  const filtered = useMemo(() => {
    if (!completion) return rows;
    const wantCompleted = completion === "completed";
    return rows.filter((r) => r.isCompleted === wantCompleted);
  }, [rows, completion]);

  const stats = useMemo(() => {
    let completed = 0;
    let pending = 0;
    for (const r of rows) {
      if (r.isCompleted) completed += 1;
      if (r.status === "pending_approval") pending += 1;
    }
    return { total: rows.length, pending, completed };
  }, [rows]);

  if (loading) return <PageLoader />;

  return (
    <div dir="rtl" lang="ar" className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl font-bold text-ink">الطلاب</h1>
        <Link href="/wholesaler" className="text-sm text-orange-ink hover:underline">
          ← رجوع
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-ink/10 bg-white p-4 text-center">
          <p className="text-2xl font-bold text-ink">{stats.total}</p>
          <p className="mt-1 text-xs text-ink/60">الكل</p>
        </div>
        <div className="rounded-xl border border-ink/10 bg-white p-4 text-center">
          <p className="text-2xl font-bold text-orange-ink">{stats.pending}</p>
          <p className="mt-1 text-xs text-ink/60">بانتظار الموافقة</p>
        </div>
        <div className="rounded-xl border border-ink/10 bg-white p-4 text-center">
          <p className="text-2xl font-bold text-ink">{stats.completed}</p>
          <p className="mt-1 text-xs text-ink/60">تصميم مكتمل</p>
        </div>
      </div>

      <section className="rounded-xl border border-ink/10 bg-white p-3">
        <p className="mb-2 text-sm font-medium text-ink">تصفية</p>
        <div className="flex flex-wrap gap-2">
          {[
            { id: "", label: "الكل" },
            { id: "pending_approval", label: "بانتظار" },
            { id: "approved", label: "موافق" },
            { id: "rejected", label: "مرفوض" },
          ].map((o) => (
            <Button
              key={o.id}
              variant={status === (o.id as "" | StudentApprovalStatus) ? "primary" : "ghost"}
              onClick={() => setStatus(o.id as "" | StudentApprovalStatus)}
            >
              {o.label}
            </Button>
          ))}
          <span className="mx-1 h-11 w-px bg-ink/10" aria-hidden />
          {[
            { id: "", label: "الكل" },
            { id: "completed", label: "مكتمل" },
            { id: "not_completed", label: "غير مكتمل" },
          ].map((o) => (
            <Button
              key={o.id}
              variant={completion === (o.id as CompletionFilter) ? "primary" : "ghost"}
              onClick={() => setCompletion(o.id as CompletionFilter)}
            >
              {o.label}
            </Button>
          ))}
        </div>
      </section>

      {filtered.length === 0 ? (
        <EmptyState message="لا يوجد طلاب" />
      ) : (
        <ul className="space-y-3">
          {filtered.map((s) => (
            <li key={s.id} className="rounded-xl border border-ink/10 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-ink">{s.name}</p>
                  <p className="text-sm text-ink/60" dir="ltr">
                    {s.phone}
                  </p>
                  <p className="mt-1 text-xs text-ink/50">
                    {s.universityName || "—"}
                    {s.department ? ` — ${s.department}` : ""}
                  </p>
                </div>
                <div className="text-left">
                  <span className="inline-flex rounded-full bg-ink/5 px-2 py-1 text-xs text-ink/70">
                    {statusLabel(s.status)}
                  </span>
                  <div className="mt-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-1 text-xs ${
                        s.isCompleted
                          ? "bg-orange/10 text-orange-ink"
                          : "bg-ink/5 text-ink/60"
                      }`}
                    >
                      {completionLabel(s.isCompleted)}
                    </span>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

