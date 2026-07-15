"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, getApiErrorMessage } from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";

interface Row {
  id: string;
  name: string;
  phone: string;
  student_count: number;
  pending_count: number;
  deadline: string | null;
}

/** Content-shaped skeleton: mimics the wholesaler card grid */
function WholesalerSkeleton() {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-hidden>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="skeleton h-24 w-full rounded-2xl" />
      ))}
    </div>
  );
}

export default function StaffWholesalersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setFetchError(false);
    api
      .get<{ data: Row[] }>("/staff/wholesalers")
      .then(({ data }) => setRows(data.data || []))
      .catch((err) => {
        toast.error(getApiErrorMessage(err, "تعذر تحميل الممثلين"));
        setFetchError(true);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div dir="rtl" lang="ar" className="space-y-6">
      <Link
        href="/staff"
        className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-orange-ink transition-colors hover:text-orange"
      >
        <span aria-hidden>→</span> لوحة الطلبات
      </Link>

      <PageHeader title="الممثلون" subtitle="طلاب كل ممثل جامعة" />

      {loading ? (
        <WholesalerSkeleton />
      ) : fetchError ? (
        <div className="rounded-2xl border border-[var(--color-danger)]/25 bg-[var(--shop-sink)] px-6 py-10 text-center">
          <p className="text-base font-semibold text-ink">تعذر تحميل الممثلين</p>
          <p className="mt-1 text-sm text-ink-soft">تحقق من اتصالك ثم أعد المحاولة.</p>
          <Button className="mt-4" onClick={load}>إعادة المحاولة</Button>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState message="لا يوجد ممثلون مسجلون حتى الآن." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((w) => (
            <Link
              key={w.id}
              href={`/staff/wholesalers/${w.id}/students`}
              className="card-lift block rounded-2xl border border-line bg-surface p-4 transition-all hover:border-orange-ink/30 hover:shadow-[var(--shadow-float)]"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-display text-base font-bold text-ink">{w.name}</p>
                  <p className="text-sm text-ink-soft" dir="ltr">
                    {w.phone}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5 text-xs">
                  {/* Neutral student count chip */}
                  <span className="rounded-full border border-line bg-surface-sink px-2.5 py-1 text-ink-soft">
                    الطلاب: {w.student_count}
                  </span>
                  {/* Pending: orange-ink accent when >0, quiet neutral otherwise */}
                  <span
                    className={`rounded-full border px-2.5 py-1 font-semibold ${
                      w.pending_count > 0
                        ? "border-orange-ink/30 bg-orange-ink/10 text-orange-ink"
                        : "border-line bg-surface-sink text-muted"
                    }`}
                  >
                    بانتظار: {w.pending_count}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
