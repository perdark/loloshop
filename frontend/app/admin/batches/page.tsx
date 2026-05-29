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
                className="surface-card card-lift group block rounded-2xl p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-display text-base font-bold text-ink transition-colors group-hover:text-orange-ink">{b.nameAr}</p>
                    {b.wholesalerName && (
                      <p className="text-sm text-ink-soft">{b.wholesalerName}</p>
                    )}
                    <p className="mt-1 text-xs text-[var(--shop-muted)]">
                      الموعد: {formatDateIQ(b.deadline)} · <span className="tabular-nums">{b.orderCount}</span> طلب
                    </p>
                  </div>
                  <p className="font-display text-lg font-bold tabular-nums text-orange-ink" dir="ltr">
                    {formatIQD(b.grandTotal)}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link
        href="/admin"
        className="inline-flex items-center gap-1 text-sm font-medium text-orange-ink transition-colors hover:text-orange"
      >
        <span aria-hidden>←</span> لوحة التحكم
      </Link>
    </div>
  );
}
