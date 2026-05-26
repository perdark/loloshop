"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, getApiErrorMessage } from "@/lib/api";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";

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
    <div dir="rtl" lang="ar" className="space-y-5">
      <Link href="/staff" className="text-sm text-orange-ink hover:underline">
        ← لوحة الطلبات
      </Link>

      <h1 className="font-display text-2xl font-bold text-ink">الممثلون</h1>

      {rows.length === 0 ? (
        <EmptyState message="لا يوجد ممثلون" />
      ) : (
        <div className="space-y-3">
          {rows.map((w) => (
            <Link
              key={w.id}
              href={`/staff/wholesalers/${w.id}/students`}
              className="block rounded-xl border border-ink/10 bg-white p-4 hover:bg-ink/5"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-ink">{w.name}</p>
                  <p className="text-sm text-ink/60" dir="ltr">
                    {w.phone}
                  </p>
                </div>
                <div className="text-left text-xs text-ink/60">
                  <p>الطلاب: {w.student_count}</p>
                  <p>بانتظار: {w.pending_count}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

