"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { BatchCountdown } from "@/components/catalog/BatchCountdown";
import { getBatch } from "@/lib/batches";
import { formatIQD } from "@/lib/format";
import type { BatchDetail } from "@/lib/types";
import { Button } from "@/components/ui/Button";

export default function AdminBatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [batch, setBatch] = useState<BatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setError(false);
    getBatch(id)
      .then(setBatch)
      .catch(() => { toast.error("تعذر تحميل الدفعة"); setError(true); })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) return (
    <div dir="rtl" lang="ar" className="space-y-6 animate-fade-page-in">
      <div className="skeleton h-5 w-24 rounded-full" />
      <div className="skeleton h-8 w-64" />
      <div className="skeleton h-20 w-full rounded-2xl" />
      <div className="skeleton h-64 w-full rounded-2xl" />
    </div>
  );

  if (error || !batch) return (
    <div dir="rtl" lang="ar" className="space-y-4">
      <Link href="/admin/batches" className="inline-flex items-center gap-1 text-sm font-medium text-orange-ink hover:text-orange">
        <span aria-hidden>←</span> الدفعات
      </Link>
      <div className="rounded-2xl border border-danger/25 bg-[var(--shop-sink)] px-6 py-10 text-center">
        <p className="text-base font-semibold text-ink">تعذر تحميل الدفعة</p>
        <p className="mt-1 text-sm text-ink-soft">تحقق من اتصالك ثم أعد المحاولة.</p>
        <Button className="mt-4" onClick={load}>إعادة المحاولة</Button>
      </div>
    </div>
  );

  return (
    <div dir="rtl" lang="ar" className="space-y-6">
      <Link
        href="/admin/batches"
        className="inline-flex items-center gap-1 text-sm font-medium text-orange-ink transition-colors hover:text-orange"
      >
        <span aria-hidden>←</span> الدفعات
      </Link>

      <div className="relative ps-3.5">
        <span
          aria-hidden
          className="absolute bottom-1 start-0 top-1 w-1 rounded-full bg-orange-ink"
        />
        <h1 className="font-display text-2xl font-bold leading-tight text-ink lg:text-3xl">{batch.nameAr}</h1>
      </div>

      {batch.deadline && <BatchCountdown deadline={batch.deadline} />}

      <div className="surface-card rounded-2xl border border-line p-5 text-center">
        <p className="text-sm font-medium text-ink-soft">مجموع الدفعة</p>
        <p className="mt-1.5 font-display text-3xl font-bold tabular-nums text-orange-ink" dir="ltr">
          {formatIQD(batch.grandTotal)}
        </p>
      </div>

      <div className="surface-card overflow-x-auto rounded-2xl">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-ink/10 bg-ink/[0.04] text-right text-xs uppercase tracking-wide text-[var(--shop-muted)]">
              <th className="px-4 py-3 font-semibold">الاسم</th>
              <th className="px-4 py-3 font-semibold">الاسم الثنائي</th>
              <th className="px-4 py-3 font-semibold">المجموع</th>
              <th className="px-4 py-3 font-semibold">تكلفة</th>
              <th className="px-4 py-3 font-semibold">ربح</th>
            </tr>
          </thead>
          <tbody>
            {batch.students.map((s) => (
              <tr
                key={s.id}
                className="border-b border-ink/5 transition-colors odd:bg-cream/40 last:border-0 hover:bg-peach/25"
              >
                <td className="px-4 py-3 font-medium text-ink">{s.name}</td>
                <td className="px-4 py-3 text-ink-soft">
                  {s.fullNameThird || "—"}
                </td>
                <td className="px-4 py-3 tabular-nums text-ink-soft" dir="ltr">
                  {formatIQD(s.total)}
                </td>
                <td className="px-4 py-3 tabular-nums text-ink-soft" dir="ltr">
                  {s.cost != null ? formatIQD(s.cost) : "—"}
                </td>
                <td
                  className={`px-4 py-3 font-semibold tabular-nums ${
                    s.profit != null && s.profit < 0 ? "text-danger" : "text-ink"
                  }`}
                  dir="ltr"
                >
                  {s.profit != null ? formatIQD(s.profit) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
