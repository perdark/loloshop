"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { getApiErrorMessage } from "@/lib/api";
import { toArabicDigits } from "@/lib/format";
import { getStudioUsage, type StudioUsageRow } from "@/lib/studio";

interface UsagePanelProps {
  open: boolean;
  onClose: () => void;
}

/** Admin-only — «كم صرف كل مصمم؟» instead of 3-4 separate ChatGPT subscriptions.
 *  Shows $ cost (the shop's real bill unit here, not IQD) + message/image counts, last 30 days. */
export function UsagePanel({ open, onClose }: UsagePanelProps) {
  const [rows, setRows] = useState<StudioUsageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    getStudioUsage()
      .then(setRows)
      .catch((e) => setError(getApiErrorMessage(e, "تعذر تحميل بيانات الاستهلاك")))
      .finally(() => setLoading(false));
  }, [open]);

  const totalCost = rows?.reduce((sum, r) => sum + (r.cost_usd || 0), 0) ?? 0;

  return (
    <Modal open={open} onClose={onClose} title="الاستهلاك — آخر ٣٠ يوماً">
      {loading ? (
        <p className="py-8 text-center text-sm text-ink-soft">جارٍ التحميل…</p>
      ) : error ? (
        <div className="py-6 text-center">
          <p className="text-sm text-danger">{error}</p>
        </div>
      ) : !rows || rows.length === 0 ? (
        <EmptyState message="لا يوجد استخدام مسجّل حتى الآن." />
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead className="bg-surface-sink text-ink-soft">
                <tr>
                  <th className="px-3 py-2 text-start font-semibold">الاسم</th>
                  <th className="px-3 py-2 text-end font-semibold">رسائل</th>
                  <th className="px-3 py-2 text-end font-semibold">صور</th>
                  <th className="px-3 py-2 text-end font-semibold">التكلفة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.user_id}>
                    <td className="px-3 py-2 font-medium text-ink">{r.name}</td>
                    <td className="px-3 py-2 text-end text-ink-soft">
                      {toArabicDigits(r.messages)}
                    </td>
                    <td className="px-3 py-2 text-end text-ink-soft">
                      {toArabicDigits(r.images)}
                    </td>
                    <td className="px-3 py-2 text-end font-semibold text-ink" dir="ltr">
                      ${r.cost_usd.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-end text-sm font-semibold text-ink-soft" dir="ltr">
            الإجمالي: ${totalCost.toFixed(2)}
          </p>
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <Button variant="ghost" onClick={onClose}>
          إغلاق
        </Button>
      </div>
    </Modal>
  );
}
