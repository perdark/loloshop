"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  approveStudent,
  bulkSetStudentStatus,
  getMySashConfig,
  getPendingStudents,
  getWholesalerDashboard,
  rejectStudent,
  updateMySashConfig,
  type WholesalerSashConfig,
} from "@/lib/wholesaler";
import { SashSideLockEditor } from "@/components/designer/SashSideLockEditor";
import { getApiErrorMessage } from "@/lib/api";
import { formatDateIQ, formatDateShort, formatIQD, getJoinUrl } from "@/lib/format";
import type { PendingStudent, WholesalerDashboard } from "@/lib/types";
import { CopyButton } from "@/components/ui/CopyButton";
import { Button } from "@/components/ui/Button";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatCard } from "@/components/ui/StatCard";
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
  const [sashOpen, setSashOpen] = useState(false);
  const [sashConfig, setSashConfig] = useState<WholesalerSashConfig | null>(null);
  const [sashLoading, setSashLoading] = useState(false);
  const [sashSaving, setSashSaving] = useState(false);

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

  async function openSashConfig() {
    setSashConfig(null);
    setSashOpen(true);
    setSashLoading(true);
    try {
      setSashConfig(await getMySashConfig());
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر تحميل إعدادات الوشاح"));
      setSashOpen(false);
    } finally {
      setSashLoading(false);
    }
  }

  async function handleSashSave(cfg: WholesalerSashConfig) {
    setSashSaving(true);
    try {
      await updateMySashConfig(cfg);
      toast.success("تم حفظ إعدادات الوشاح");
      setSashOpen(false);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر حفظ الإعدادات"));
    } finally {
      setSashSaving(false);
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
      {/* Deadline hero — flat ink-toned surface, no orange blobs */}
      <section className="rounded-3xl bg-ink p-6 text-center">
        <p className="text-sm font-medium text-cream/70">الموعد النهائي</p>
        <p className="mt-2 font-display-ar text-4xl font-bold tracking-tight text-cream">
          {formatDateIQ(dashboard.deadline)}
        </p>
      </section>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="عدد الطلاب" value={String(dashboard.studentCount)} />
        <StatCard label="بانتظار الموافقة" value={String(dashboard.pendingCount)} />
        <StatCard label="تصاميم مكتملة" value={String(dashboard.completedDesigns)} accent="profit" />
      </div>

      {(dashboard.commissionRate ?? 0) > 0 && (
        <section className="surface-card rounded-2xl p-5 text-center">
          <p className="text-xs font-medium text-[var(--shop-muted)]">
            عمولتك المستحقة ({dashboard.commissionRate}%)
          </p>
          <p className="mt-1.5 font-display text-3xl font-bold text-ink" dir="ltr">
            {formatIQD(dashboard.earnedCommission ?? 0)}
          </p>
        </section>
      )}

      {/* Referral URL — legible, no gradients */}
      <section className="surface-card rounded-2xl p-5">
        <p className="mb-2 text-sm font-semibold text-ink">رابط الدعوة</p>
        <p
          className="break-all rounded-xl border border-line bg-[var(--shop-sink)] px-3 py-2.5 text-xs text-ink-soft"
          dir="ltr"
        >
          {joinUrl}
        </p>
        <div className="mt-3 flex gap-2">
          <CopyButton text={joinUrl} fullWidth />
          <a
            href={whatsappShare}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-shine flex min-h-11 flex-1 items-center justify-center rounded-full bg-orange-ink px-4 text-sm font-semibold text-white shadow-[var(--shadow-soft)] transition-transform active:scale-[0.98]"
          >
            مشاركة واتساب
          </a>
        </div>
      </section>

      <section className="surface-card rounded-2xl p-5">
        <p className="mb-1 text-sm font-semibold text-ink">تصميم الوشاح للطلاب</p>
        <p className="mb-3 text-xs text-ink-soft">
          حدّد الجانب الذي يصمّمه الطلاب وارسم الجانب الآخر مسبقاً.
        </p>
        <Button variant="ghost" fullWidth onClick={openSashConfig}>
          إعدادات الوشاح
        </Button>
      </section>

      <section className="pb-28">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-heading font-display-ar text-lg font-bold text-ink">
            طلاب بانتظار الموافقة
          </h2>
          {pending.length > 0 && (
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-ink-soft">
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
                className={`surface-card rounded-2xl p-4 transition-colors ${
                  selected.has(student.id) ? "ring-2 ring-orange/40" : ""
                }`}
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
                    <p className="font-display-ar font-bold text-ink">{student.fullName}</p>
                    <p className="text-sm text-ink-soft" dir="ltr">
                      {student.phone}
                    </p>
                    <p className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-[var(--shop-sink)] px-2 py-0.5 text-xs text-[var(--shop-muted)]">
                      {formatDateShort(student.createdAt)}
                    </p>
                  </div>
                  {/* Neutral "بانتظار" pill — no amber */}
                  <span className="inline-flex shrink-0 items-center rounded-full border border-line bg-[var(--shop-sink)] px-2.5 py-1 text-xs font-medium text-ink-soft">
                    بانتظار
                  </span>
                </div>
                {/* Tidy 2-button row — approve primary, reject danger, both ≥44px */}
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
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-cream p-4 shadow-[var(--shadow-float)]">
          <div className="mx-auto flex max-w-md items-center gap-2">
            <span className="inline-flex shrink-0 items-center rounded-full bg-orange/10 px-3 py-1.5 text-sm font-semibold text-orange-ink">
              {selected.size} محدد
            </span>
            <Button
              fullWidth
              onClick={handleBulkApprove}
              loading={bulkBusy}
            >
              موافقة جماعية
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
        <p className="text-sm text-ink-soft">
          هل تريد رفض {reject?.label}؟ لا يمكن التراجع عن هذا الإجراء.
        </p>
      </Modal>

      <Modal
        open={sashOpen}
        onClose={() => (sashSaving ? null : setSashOpen(false))}
        title="إعدادات الوشاح"
      >
        {sashLoading || !sashConfig ? (
          <PageLoader />
        ) : (
          <SashSideLockEditor
            editableSide={sashConfig.editable_sash_side}
            lockedSideDesign={sashConfig.locked_side_design}
            saving={sashSaving}
            onSave={handleSashSave}
          />
        )}
      </Modal>
    </div>
  );
}
