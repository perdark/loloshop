"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  approveStudent,
  bulkSetStudentStatus,
  getPendingStudents,
  getWholesalerDashboard,
  rejectStudent,
} from "@/lib/wholesaler";
import { getApiErrorMessage } from "@/lib/api";
import { formatDateIQ, formatDateShort, formatIQD, getJoinUrl } from "@/lib/format";
import type { PendingStudent, WholesalerDashboard } from "@/lib/types";
import { CopyButton } from "@/components/ui/CopyButton";
import { Button } from "@/components/ui/Button";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";

export default function WholesalerDashboardPage() {
  const [dashboard, setDashboard] = useState<WholesalerDashboard | null>(null);
  const [pending, setPending] = useState<PendingStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [reject, setReject] = useState<
    { ids: string[]; label: string } | null
  >(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dash, students] = await Promise.all([
        getWholesalerDashboard(),
        getPendingStudents(),
      ]);
      setDashboard(dash);
      setPending(students);
      setSelected(new Set());
    } catch {
      toast.error("تعذر تحميل البيانات");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
  }, [load]);

  const allSelected = pending.length > 0 && selected.size === pending.length;

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === pending.length ? new Set() : new Set(pending.map((s) => s.id))
    );
  }

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

  async function handleBulkApprove() {
    const ids = [...selected];
    if (!ids.length) return;
    setBulkBusy(true);
    try {
      const count = await bulkSetStudentStatus(ids, "approve");
      toast.success(`تمت الموافقة على ${count} طالب`);
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذرت الموافقة الجماعية"));
    } finally {
      setBulkBusy(false);
    }
  }

  async function confirmReject() {
    if (!reject) return;
    const { ids } = reject;
    setBulkBusy(true);
    try {
      if (ids.length === 1) await rejectStudent(ids[0]);
      else await bulkSetStudentStatus(ids, "reject");
      toast.success("تم الرفض");
      setReject(null);
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر الرفض"));
    } finally {
      setBulkBusy(false);
    }
  }

  if (loading || !dashboard) {
    return <PageLoader />;
  }

  const joinUrl =
    dashboard.referralUrl || getJoinUrl(dashboard.referralCode);
  const whatsappShare = `https://wa.me/?text=${encodeURIComponent(
    `سجّل وصمّم وشاح تخرجك من هنا: ${joinUrl}`
  )}`;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-ink p-6 text-center text-cream">
        <p className="text-sm text-cream/70">الموعد النهائي</p>
        <p className="mt-2 font-display text-3xl font-bold text-orange-ink">
          {formatDateIQ(dashboard.deadline)}
        </p>
      </section>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-ink/10 bg-white p-4 text-center">
          <p className="text-2xl font-bold text-ink">{dashboard.studentCount}</p>
          <p className="mt-1 text-xs text-ink/60">عدد الطلاب</p>
        </div>
        <div className="rounded-xl border border-ink/10 bg-white p-4 text-center">
          <p className="text-2xl font-bold text-orange-ink">{dashboard.pendingCount}</p>
          <p className="mt-1 text-xs text-ink/60">بانتظار الموافقة</p>
        </div>
        <div className="rounded-xl border border-ink/10 bg-white p-4 text-center">
          <p className="text-2xl font-bold text-ink">{dashboard.completedDesigns}</p>
          <p className="mt-1 text-xs text-ink/60">تصاميم مكتملة</p>
        </div>
      </div>

      {(dashboard.commissionRate ?? 0) > 0 && (
        <section className="rounded-xl border border-orange/30 bg-orange/5 p-4 text-center">
          <p className="text-xs text-ink/60">
            عمولتك المستحقة ({dashboard.commissionRate}%)
          </p>
          <p className="mt-1 font-display text-2xl font-bold text-orange-ink">
            {formatIQD(dashboard.earnedCommission ?? 0)}
          </p>
        </section>
      )}

      <section className="rounded-xl border border-ink/10 bg-white p-4">
        <p className="mb-2 text-sm font-medium text-ink">رابط الدعوة</p>
        <p className="break-all text-xs text-ink/60" dir="ltr">
          {joinUrl}
        </p>
        <div className="mt-3 flex gap-2">
          <CopyButton text={joinUrl} fullWidth />
          <a
            href={whatsappShare}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 flex-1 items-center justify-center rounded-lg bg-orange px-4 text-sm font-semibold text-white"
          >
            مشاركة عبر واتساب
          </a>
        </div>
      </section>

      <section className="pb-28">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-ink">
            طلاب بانتظار الموافقة
          </h2>
          {pending.length > 0 && (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink/70">
              <input
                type="checkbox"
                className="size-4 accent-orange"
                checked={allSelected}
                onChange={toggleAll}
              />
              تحديد الكل
            </label>
          )}
        </div>
        {pending.length === 0 ? (
          <EmptyState message="لا يوجد طلاب بانتظار الموافقة" />
        ) : (
          <ul className="space-y-3">
            {pending.map((student) => (
              <li
                key={student.id}
                className="rounded-xl border border-ink/10 bg-white p-4"
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0 accent-orange"
                    checked={selected.has(student.id)}
                    onChange={() => toggleOne(student.id)}
                    aria-label={`تحديد ${student.fullName}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{student.fullName}</p>
                    <p className="text-sm text-ink/60" dir="ltr">
                      {student.phone}
                    </p>
                    <p className="mt-1 text-xs text-ink/40">
                      {formatDateShort(student.createdAt)}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <Button
                    fullWidth
                    onClick={() => handleApprove(student.id)}
                    loading={actionId === student.id}
                    disabled={!!actionId || bulkBusy}
                  >
                    موافقة
                  </Button>
                  <Button
                    variant="danger"
                    fullWidth
                    onClick={() =>
                      setReject({ ids: [student.id], label: student.fullName })
                    }
                    disabled={!!actionId || bulkBusy}
                  >
                    رفض
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-white/95 p-4 backdrop-blur">
          <div className="mx-auto flex max-w-md items-center gap-2">
            <span className="text-sm font-medium text-ink">
              {selected.size} محدد
            </span>
            <Button
              fullWidth
              onClick={handleBulkApprove}
              loading={bulkBusy}
            >
              موافقة الجماعية
            </Button>
            <Button
              variant="danger"
              fullWidth
              disabled={bulkBusy}
              onClick={() =>
                setReject({
                  ids: [...selected],
                  label: `${selected.size} طالب`,
                })
              }
            >
              رفض
            </Button>
          </div>
        </div>
      )}

      <Modal
        open={!!reject}
        onClose={() => (bulkBusy ? null : setReject(null))}
        title="تأكيد الرفض"
        footer={
          <>
            <Button
              variant="ghost"
              fullWidth
              onClick={() => setReject(null)}
              disabled={bulkBusy}
            >
              إلغاء
            </Button>
            <Button
              variant="danger"
              fullWidth
              onClick={confirmReject}
              loading={bulkBusy}
            >
              رفض
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink/70">
          هل تريد رفض {reject?.label}؟ لا يمكن التراجع عن هذا الإجراء.
        </p>
      </Modal>
    </div>
  );
}
