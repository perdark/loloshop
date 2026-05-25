"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { listBatches } from "@/lib/batches";
import { formatDateIQ, formatIQD } from "@/lib/format";
import type { BatchSummary } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";

export default function AdminBatchesPage() {
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listBatches()
      .then(setBatches)
      .catch(() => toast.error("تعذر تحميل الدفعات"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <PageLoader />;

  return (
    <div dir="rtl" lang="ar" className="space-y-6">
      <PageHeader title="الدفعات" subtitle="مواعيد نهائية ومجاميع الطلاب" />

      {batches.length === 0 ? (
        <EmptyState message="لا دفعات بعد" />
      ) : (
        <ul className="space-y-3">
          {batches.map((b) => (
            <li key={b.id}>
              <Link
                href={`/admin/batches/${b.id}`}
                className="block rounded-xl border border-ink/10 bg-white p-4 transition-shadow hover:shadow-md"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-ink">{b.nameAr}</p>
                    {b.wholesalerName && (
                      <p className="text-sm text-ink/60">{b.wholesalerName}</p>
                    )}
                    <p className="mt-1 text-xs text-ink/50">
                      الموعد: {formatDateIQ(b.deadline)} · {b.orderCount} طلب
                    </p>
                  </div>
                  <p className="font-bold text-orange" dir="ltr">
                    {formatIQD(b.grandTotal)}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link href="/admin" className="text-sm text-orange hover:underline">
        ← لوحة التحكم
      </Link>
    </div>
  );
}
