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
      <div dir="rtl" lang="ar">
        <EmptyState message="لا توجد دفعة نشطة" />
        <Link href="/wholesaler" className="mt-4 block text-sm text-orange">
          العودة
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8" dir="rtl" lang="ar">
      <Link href="/wholesaler" className="text-sm text-orange hover:underline">
        ← لوحة الممثل
      </Link>

      {summaries.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {summaries.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => selectBatch(b.id)}
              className={`rounded-lg border px-3 py-2 text-sm ${
                batch?.id === b.id
                  ? "border-orange bg-orange/10 text-orange"
                  : "border-ink/10 bg-white"
              }`}
            >
              {b.nameAr}
            </button>
          ))}
        </div>
      )}

      {batch && (
        <>
          <h1 className="font-display text-xl font-bold text-ink">
            {batch.nameAr}
          </h1>

          {batch.deadline && <BatchCountdown deadline={batch.deadline} />}

          <div className="rounded-xl border border-orange/30 bg-orange/5 p-4 text-center">
            <p className="text-sm text-ink/70">مجموع الدفعة</p>
            <p className="font-display text-2xl font-bold text-orange" dir="ltr">
              {formatIQD(batch.grandTotal)}
            </p>
          </div>

          <ul className="space-y-2">
            {batch.students.map((s) => (
              <li
                key={s.id}
                className="rounded-lg border border-ink/10 bg-white px-4 py-3 text-sm"
              >
                <p className="font-medium text-ink">{s.name}</p>
                {s.fullNameThird && (
                  <p className="text-xs text-ink/60">{s.fullNameThird}</p>
                )}
                <p className="mt-1 font-bold text-orange" dir="ltr">
                  {formatIQD(s.total)}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
