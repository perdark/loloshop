"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  approveStudent,
  getPendingStudents,
  getWholesalerDashboard,
  rejectStudent,
} from "@/lib/wholesaler";
import { getApiErrorMessage } from "@/lib/api";
import { formatDateIQ, formatDateShort, getJoinUrl } from "@/lib/format";
import type { PendingStudent, WholesalerDashboard } from "@/lib/types";
import { CopyButton } from "@/components/ui/CopyButton";
import { Button } from "@/components/ui/Button";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";

export default function WholesalerDashboardPage() {
  const [dashboard, setDashboard] = useState<WholesalerDashboard | null>(null);
  const [pending, setPending] = useState<PendingStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dash, students] = await Promise.all([
        getWholesalerDashboard(),
        getPendingStudents(),
      ]);
      setDashboard(dash);
      setPending(students);
    } catch {
      toast.error("تعذر تحميل البيانات");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleApprove(id: string) {
    setActionId(id);
    try {
      await approveStudent(id);
      toast.success("تمت الموافقة");
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر الموافقة"));
    } finally {
      setActionId(null);
    }
  }

  async function handleReject(id: string, name: string) {
    if (!confirm(`رفض طلب ${name}؟`)) return;
    setActionId(id);
    try {
      await rejectStudent(id);
      toast.success("تم الرفض");
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر الرفض"));
    } finally {
      setActionId(null);
    }
  }

  if (loading || !dashboard) {
    return <PageLoader />;
  }

  const joinUrl =
    dashboard.referralUrl || getJoinUrl(dashboard.referralCode);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-ink p-6 text-center text-cream">
        <p className="text-sm text-cream/70">الموعد النهائي</p>
        <p className="mt-2 font-display text-3xl font-bold text-orange">
          {formatDateIQ(dashboard.deadline)}
        </p>
      </section>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-ink/10 bg-white p-4 text-center">
          <p className="text-2xl font-bold text-ink">{dashboard.studentCount}</p>
          <p className="mt-1 text-xs text-ink/60">عدد الطلاب</p>
        </div>
        <div className="rounded-xl border border-ink/10 bg-white p-4 text-center">
          <p className="text-2xl font-bold text-orange">{dashboard.pendingCount}</p>
          <p className="mt-1 text-xs text-ink/60">بانتظار الموافقة</p>
        </div>
        <div className="rounded-xl border border-ink/10 bg-white p-4 text-center">
          <p className="text-2xl font-bold text-ink">{dashboard.completedDesigns}</p>
          <p className="mt-1 text-xs text-ink/60">تصاميم مكتملة</p>
        </div>
      </div>

      <section className="rounded-xl border border-ink/10 bg-white p-4">
        <p className="mb-2 text-sm font-medium text-ink">رابط الدعوة</p>
        <p className="break-all text-xs text-ink/60" dir="ltr">
          {joinUrl}
        </p>
        <div className="mt-3">
          <CopyButton text={joinUrl} fullWidth />
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-display text-lg font-bold text-ink">
          طلاب بانتظار الموافقة
        </h2>
        {pending.length === 0 ? (
          <EmptyState message="لا يوجد طلاب بانتظار الموافقة" />
        ) : (
          <ul className="space-y-3">
            {pending.map((student) => (
              <li
                key={student.id}
                className="rounded-xl border border-ink/10 bg-white p-4"
              >
                <p className="font-semibold text-ink">{student.fullName}</p>
                <p className="text-sm text-ink/60" dir="ltr">
                  {student.phone}
                </p>
                <p className="mt-1 text-xs text-ink/40">
                  {formatDateShort(student.createdAt)}
                </p>
                <div className="mt-4 flex gap-2">
                  <Button
                    fullWidth
                    onClick={() => handleApprove(student.id)}
                    loading={actionId === student.id}
                    disabled={!!actionId}
                  >
                    موافقة
                  </Button>
                  <Button
                    variant="danger"
                    fullWidth
                    onClick={() => handleReject(student.id, student.fullName)}
                    loading={actionId === student.id}
                    disabled={!!actionId}
                  >
                    رفض
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
