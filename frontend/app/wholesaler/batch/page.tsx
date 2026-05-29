"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { BatchCountdown } from "@/components/catalog/BatchCountdown";
import { getBatch, listBatches } from "@/lib/batches";
import { formatIQD } from "@/lib/format";
import type { BatchDetail, BatchSummary } from "@/lib/types";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";

export default function WholesalerBatchPage() {
  const [summaries, setSummaries] = useState<BatchSummary[]>([]);
  const [batch, setBatch] = useState<BatchDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const list = await listBatches();
        setSummaries(list);
        if (list[0]) {
          if (typeof window !== "undefined") {
            localStorage.setItem("loloshop_wholesaler_batch_id", list[0].id);
          }
          const detail = await getBatch(list[0].id);
          setBatch(detail);
        }
      } catch {
        toast.error("تعذر تحميل الدفعة");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function selectBatch(batchId: string) {
    setLoading(true);
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("loloshop_wholesaler_batch_id", batchId);
      }
      setBatch(await getBatch(batchId));
    } catch {
      toast.error("تعذر تحميل تفاصيل الدفعة");
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <PageLoader />;

  if (!summaries.length) {
    return (
      <div className="space-y-4" dir="rtl" lang="ar">
        <Link href="/wholesaler" className="inline-flex min-h-11 items-center text-sm font-medium text-orange-ink hover:underline">
          ← لوحة الممثل
        </Link>
        <EmptyState message="لا توجد دفعة نشطة" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8" dir="rtl" lang="ar">
      <Link href="/wholesaler" className="inline-flex min-h-11 items-center text-sm font-medium text-orange-ink hover:underline">
        ← لوحة الممثل
      </Link>

      {summaries.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {summaries.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => selectBatch(b.id)}
              className={`min-h-11 rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
                batch?.id === b.id
                  ? "border-orange bg-orange/10 text-orange-ink shadow-[var(--shadow-soft)]"
                  : "border-ink/10 bg-white text-ink/70 hover:border-orange/30"
              }`}
            >
              {b.nameAr}
            </button>
          ))}
        </div>
      )}

      {batch && (
        <>
          <h1 className="section-heading font-display text-2xl font-bold text-ink">
            {batch.nameAr}
          </h1>

          {batch.deadline && <BatchCountdown deadline={batch.deadline} />}

          <section className="surface-card relative overflow-hidden rounded-2xl p-5 text-center">
            <span
              aria-hidden
              className="absolute inset-x-0 top-0 h-1 bg-brand-gradient"
            />
            <p className="text-xs font-medium text-[var(--shop-muted)]">مجموع الدفعة</p>
            <p className="mt-1.5 font-display text-3xl font-bold text-gradient-brand" dir="ltr">
              {formatIQD(batch.grandTotal)}
            </p>
            <p className="mt-1 text-xs text-[var(--shop-muted)]">{batch.students.length} طالب</p>
          </section>

          <section>
            <h2 className="section-heading mb-3 font-display text-lg font-bold text-ink">
              طلاب الدفعة
            </h2>
            <ul className="space-y-3">
              {batch.students.map((s) => (
                <li
                  key={s.id}
                  className="surface-card card-lift flex items-center justify-between gap-3 rounded-2xl p-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-display font-bold text-ink">{s.name}</p>
                    {s.fullNameThird && (
                      <p className="mt-0.5 text-xs text-ink-soft">{s.fullNameThird}</p>
                    )}
                  </div>
                  <span className="shrink-0 rounded-full bg-orange/10 px-3 py-1.5 text-sm font-bold text-orange-ink" dir="ltr">
                    {formatIQD(s.total)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
