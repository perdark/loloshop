"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, getApiErrorMessage } from "@/lib/api";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

interface Row {
  id: string;
  name: string;
  phone: string;
  student_count: number;
  pending_count: number;
  deadline: string | null;
}

export default function StaffWholesalersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    setLoading(true);
    api
      .get<{ data: Row[] }>("/admin/wholesalers")
      .then(({ data }) => setRows(data.data || []))
      .catch((err) => toast.error(getApiErrorMessage(err, "تعذر تحميل الممثلين")))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <PageLoader />;

  return (
    <div dir="rtl" lang="ar">
      <Link href="/staff" className="mb-4 inline-flex text-sm font-medium text-orange-ink hover:underline">
        ← لوحة الطلبات
      </Link>

      <PageHeader title="الممثلون" subtitle="طلاب كل ممثل جامعة" />

      {rows.length === 0 ? (
        <EmptyState message="لا يوجد ممثلون" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((w) => (
            <Link
              key={w.id}
              href={`/staff/wholesalers/${w.id}/students`}
              className="card-lift block rounded-2xl border border-ink/10 bg-white p-4 shadow-[var(--shadow-soft)] transition-all hover:border-orange/40"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-display text-base font-bold text-ink">{w.name}</p>
                  <p className="text-sm text-ink/60" dir="ltr">
                    {w.phone}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5 text-xs">
                  <span className="rounded-full bg-ink/5 px-2.5 py-1 text-ink/70">
                    الطلاب: {w.student_count}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 ${
                      w.pending_count > 0
                        ? "bg-orange/15 font-medium text-orange-ink"
                        : "bg-ink/5 text-ink/60"
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

