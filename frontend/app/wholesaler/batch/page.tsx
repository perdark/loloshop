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
import { Button } from "@/components/ui/Button";

export default function WholesalerBatchPage() {
  const [summaries, setSummaries] = useState<BatchSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [batch, setBatch] = useState<BatchDetail | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [listError, setListError] = useState(false);

  // Load batch list on mount — no auto-select; user picks explicitly.
  useEffect(() => {
    setLoadingList(true);
    setListError(false);
    listBatches()
      .then((list) => setSummaries(list))
      .catch(() => {
        setListError(true);
        toast.error("تعذر تحميل الدفعات");
      })
      .finally(() => setLoadingList(false));
  }, []);

  async function selectBatch(batchId: string) {
    if (batchId === selectedId) return;
    setSelectedId(batchId);
    setBatch(null);
    setLoadingDetail(true);
    try {
      const detail = await getBatch(batchId);
      setBatch(detail);
    } catch {
      toast.error("تعذر تحميل تفاصيل الدفعة");
      setSelectedId(null);
    } finally {
      setLoadingDetail(false);
    }
  }

  if (loadingList) return <PageLoader />;

  if (listError) {
    return (
      <div className="space-y-4">
        <BackLink />
        <EmptyState
          title="تعذر تحميل الدفعات"
          message="تحقق من الاتصال ثم حاول مجدداً."
          action={
            <Button
              variant="ghost"
              onClick={() => {
                setListError(false);
                setLoadingList(true);
                listBatches()
                  .then((list) => setSummaries(list))
                  .catch(() => {
                    setListError(true);
                    toast.error("تعذر تحميل الدفعات");
                  })
                  .finally(() => setLoadingList(false));
              }}
            >
              إعادة المحاولة
            </Button>
          }
        />
      </div>
    );
  }

  if (!summaries.length) {
    return (
      <div className="space-y-4">
        <BackLink />
        <EmptyState message="لا توجد دفعة نشطة" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8">
      <BackLink />

      {/* Explicit batch selector — always visible so user sees which batch they picked */}
      <section>
        <p className="mb-2 text-sm font-semibold text-ink">اختر الدفعة</p>
        <div className="flex flex-wrap gap-2">
          {summaries.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => selectBatch(b.id)}
              className={`min-h-11 rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                selectedId === b.id
                  ? "border-orange-ink bg-orange/10 text-orange-ink shadow-[var(--shadow-soft)]"
                  : "border-line bg-beige text-ink-soft hover:border-orange/40 hover:text-ink"
              }`}
            >
              {b.nameAr}
            </button>
          ))}
        </div>
      </section>

      {/* Before selection */}
      {!selectedId && !loadingDetail && (
        <EmptyState message="اختر دفعة أعلاه لعرض تفاصيلها" />
      )}

      {/* Loading detail */}
      {loadingDetail && <PageLoader />}

      {/* Detail */}
      {batch && !loadingDetail && (
        <>
          <h1 className="section-heading font-display-ar text-2xl font-bold text-ink">
            {batch.nameAr}
          </h1>

          {batch.deadline && <BatchCountdown deadline={batch.deadline} />}

          <section className="surface-card rounded-2xl p-5 text-center">
            <p className="text-xs font-medium text-[var(--shop-muted)]">مجموع الدفعة</p>
            <p className="mt-1.5 font-display text-3xl font-bold text-ink" dir="ltr">
              {formatIQD(batch.grandTotal)}
            </p>
            <p className="mt-1 text-xs text-[var(--shop-muted)]">{batch.students.length} طالب</p>
          </section>

          <section>
            <h2 className="section-heading mb-3 font-display-ar text-lg font-bold text-ink">
              طلاب الدفعة
            </h2>

            {batch.students.length === 0 ? (
              <EmptyState
                title="لا يوجد طلاب في هذه الدفعة بعد"
                message="ستظهر أسماء الطلاب هنا بعد انضمامهم."
              />
            ) : (
              <ul className="space-y-3">
                {batch.students.map((s) => (
                  <li
                    key={s.id}
                    className="surface-card card-lift flex items-center justify-between gap-3 rounded-2xl p-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-display-ar font-bold text-ink">{s.name}</p>
                      {s.fullNameThird && (
                        <p className="mt-0.5 text-xs text-ink-soft">{s.fullNameThird}</p>
                      )}
                    </div>
                    <span
                      className="shrink-0 rounded-full border border-line bg-[var(--shop-sink)] px-3 py-1.5 text-sm font-bold text-ink"
                      dir="ltr"
                    >
                      {formatIQD(s.total)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/wholesaler"
      className="inline-flex min-h-11 items-center text-sm font-medium text-orange-ink hover:underline"
    >
      ← لوحة الممثل
    </Link>
  );
}
