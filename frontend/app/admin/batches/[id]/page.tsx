"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { BatchCountdown } from "@/components/catalog/BatchCountdown";
import { getBatch } from "@/lib/batches";
import { formatIQD } from "@/lib/format";
import type { BatchDetail } from "@/lib/types";
import { PageLoader } from "@/components/ui/Spinner";

export default function AdminBatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [batch, setBatch] = useState<BatchDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    getBatch(id)
      .then(setBatch)
      .catch(() => toast.error("تعذر تحميل الدفعة"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading || !batch) return <PageLoader />;

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
          className="absolute bottom-1 start-0 top-1 w-1 rounded-full bg-brand-gradient"
        />
        <h1 className="font-display text-2xl font-bold leading-tight text-ink lg:text-3xl">{batch.nameAr}</h1>
      </div>

      {batch.deadline && <BatchCountdown deadline={batch.deadline} />}

      <div className="surface-card relative overflow-hidden rounded-2xl p-5 text-center">
        <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-brand-gradient" />
        <span
          aria-hidden
          className="pointer-events-none absolute -end-8 -top-10 h-28 w-28 rounded-full bg-orange/10 blur-2xl"
        />
        <p className="relative text-sm font-medium text-ink-soft">مجموع الدفعة</p>
        <p className="relative mt-1.5 font-display text-3xl font-bold tabular-nums text-orange-ink" dir="ltr">
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
                <td className="px-4 py-3 text-ink/70">
                  {s.fullNameThird || "—"}
                </td>
                <td className="px-4 py-3 tabular-nums text-ink/80" dir="ltr">
                  {formatIQD(s.total)}
                </td>
                <td className="px-4 py-3 tabular-nums text-ink/80" dir="ltr">
                  {s.cost != null ? formatIQD(s.cost) : "—"}
                </td>
                <td
                  className={`px-4 py-3 font-semibold tabular-nums ${
                    s.profit != null && s.profit > 0 ? "text-emerald-700" : "text-ink-soft"
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
