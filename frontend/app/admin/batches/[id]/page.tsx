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
      <Link href="/admin/batches" className="text-sm text-orange-ink hover:underline">
        ← الدفعات
      </Link>

      <h1 className="font-display text-2xl font-bold text-ink">{batch.nameAr}</h1>

      {batch.deadline && <BatchCountdown deadline={batch.deadline} />}

      <div className="rounded-xl border border-orange/30 bg-orange/5 p-4 text-center">
        <p className="text-sm text-ink/70">مجموع الدفعة</p>
        <p className="font-display text-2xl font-bold text-orange-ink" dir="ltr">
          {formatIQD(batch.grandTotal)}
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-ink/10 bg-white">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="border-b border-ink/10 bg-ink/5 text-right">
              <th className="px-4 py-3 font-semibold text-ink">الاسم</th>
              <th className="px-4 py-3 font-semibold text-ink">الاسم الثنائي</th>
              <th className="px-4 py-3 font-semibold text-ink">المجموع</th>
              <th className="px-4 py-3 font-semibold text-ink">تكلفة</th>
              <th className="px-4 py-3 font-semibold text-ink">ربح</th>
            </tr>
          </thead>
          <tbody>
            {batch.students.map((s) => (
              <tr key={s.id} className="border-b border-ink/5 last:border-0">
                <td className="px-4 py-3">{s.name}</td>
                <td className="px-4 py-3 text-ink/70">
                  {s.fullNameThird || "—"}
                </td>
                <td className="px-4 py-3" dir="ltr">
                  {formatIQD(s.total)}
                </td>
                <td className="px-4 py-3" dir="ltr">
                  {s.cost != null ? formatIQD(s.cost) : "—"}
                </td>
                <td
                  className={`px-4 py-3 font-semibold ${
                    s.profit != null && s.profit > 0 ? "text-emerald-700" : ""
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
