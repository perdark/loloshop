"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { listBatches } from "@/lib/batches";
import { formatDateIQ, formatIQD } from "@/lib/format";
import type { BatchSummary } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";

export default function AdminBatchesPage() {
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    listBatches()
      .then(setBatches)
      .catch(() => { toast.error("تعذر تحميل الدفعات"); setError(true); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return (
    <div dir="rtl" lang="ar" className="space-y-6 animate-fade-page-in">
      <div className="skeleton h-9 w-36" />
      <ul className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <li key={i} className="skeleton h-20 w-full rounded-2xl" />
        ))}
      </ul>
    </div>
  );

  if (error) return (
    <div dir="rtl" lang="ar" className="space-y-4">
      <PageHeader title="الدفعات" subtitle="مواعيد نهائية ومجاميع الطلاب" />
      <div className="rounded-2xl border border-danger/25 bg-[var(--shop-sink)] px-6 py-10 text-center">
        <p className="text-base font-semibold text-ink">تعذر تحميل الدفعات</p>
        <p className="mt-1 text-sm text-ink-soft">تحقق من اتصالك ثم أعد المحاولة.</p>
        <Button className="mt-4" onClick={load}>إعادة المحاولة</Button>
      </div>
    </div>
  );

  return (
    <div dir="rtl" lang="ar" className="space-y-6">
      <PageHeader title="الدفعات" subtitle="مواعيد نهائية ومجاميع الطلاب" />

      {batches.length === 0 ? (
        <EmptyState message="لا دفعات بعد — ستظهر هنا عند إنشاء دفعات جديدة." />
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
