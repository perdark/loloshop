"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  createWholesaler,
  deleteWholesaler,
  extendWholesalerDeadline,
  getAdminWholesalers,
  getWholesalerSashConfig,
  updateWholesalerCommission,
  updateWholesalerSashConfig,
  type WholesalerSashConfig,
} from "@/lib/admin";
import { SashSideLockEditor } from "@/components/designer/SashSideLockEditor";
import { getApiErrorMessage } from "@/lib/api";
import { formatDateIQ, formatIQD, getJoinUrl } from "@/lib/format";
import type { AdminWholesaler } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import Link from "next/link";

const SLUG_RE = /^[a-z0-9-]+$/;

export default function AdminWholesalersPage() {
  const [wholesalers, setWholesalers] = useState<AdminWholesaler[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [extendOpen, setExtendOpen] = useState(false);
  const [commissionOpen, setCommissionOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminWholesaler | null>(null);
  const [sashOpen, setSashOpen] = useState(false);
  const [sashConfig, setSashConfig] = useState<WholesalerSashConfig | null>(null);
  const [sashLoading, setSashLoading] = useState(false);
  const [selected, setSelected] = useState<AdminWholesaler | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // simpler per-field state to avoid any surprising remounts/focus jumps
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [deadline, setDeadline] = useState("");
  const [commission, setCommission] = useState("0");
  const [newDeadline, setNewDeadline] = useState("");
  const [newCommission, setNewCommission] = useState("0");

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(false);
    try {
      const data = await getAdminWholesalers();
      setWholesalers(data);
    } catch {
      toast.error("تعذر تحميل الممثلين");
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
  }, [load]);

  function validateCreate(): boolean {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "الاسم مطلوب";
    if (!phone.trim()) e.phone = "رقم الهاتف مطلوب";
    if (!email.trim()) e.email = "البريد مطلوب";
    if (!password || password.length < 6)
      e.password = "كلمة المرور ٦ أحرف على الأقل";
    if (!referralCode.trim()) e.referralCode = "رمز الدعوة مطلوب";
    else if (!SLUG_RE.test(referralCode))
      e.referralCode = "أحرف إنجليزية صغيرة وأرقام وشرطة فقط";
    if (!deadline) e.deadline = "الموعد النهائي مطلوب";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleCreate() {
    if (!validateCreate()) return;
    setSubmitting(true);
    try {
      await createWholesaler({
        name,
        phone,
        email,
        password,
        referralCode,
        deadline,
        commissionRate: Number(commission) || 0,
      });
      toast.success("تم إنشاء الممثل");
      setCreateOpen(false);
      setName("");
      setPhone("");
      setEmail("");
      setPassword("");
      setReferralCode("");
      setDeadline("");
      setCommission("0");
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر إنشاء الممثل"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCommission() {
    if (!selected) return;
    const rate = Number(newCommission);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      toast.error("نسبة بين 0 و 100");
      return;
    }
    setSubmitting(true);
    try {
      await updateWholesalerCommission(selected.id, rate);
      toast.success("تم تحديث العمولة");
      setCommissionOpen(false);
      setSelected(null);
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر تحديث العمولة"));
    } finally {
      setSubmitting(false);
    }
  }

  async function openSashConfig(w: AdminWholesaler) {
    setSelected(w);
    setSashConfig(null);
    setSashOpen(true);
    setSashLoading(true);
    try {
      const cfg = await getWholesalerSashConfig(w.id);
      setSashConfig(cfg);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر تحميل إعدادات الوشاح"));
      setSashOpen(false);
    } finally {
      setSashLoading(false);
    }
  }

  async function handleSashSave(cfg: WholesalerSashConfig) {
    if (!selected) return;
    setSubmitting(true);
    try {
      await updateWholesalerSashConfig(selected.id, cfg);
      toast.success("تم حفظ إعدادات الوشاح");
      setSashOpen(false);
      setSelected(null);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر حفظ الإعدادات"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleExtend() {
    if (!selected || !newDeadline) {
      toast.error("اختر تاريخاً");
      return;
    }
    setSubmitting(true);
    try {
      await extendWholesalerDeadline(selected.id, newDeadline);
      toast.success("تم تمديد الموعد");
      setExtendOpen(false);
      setNewDeadline("");
      setSelected(null);
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر تمديد الموعد"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div dir="rtl" lang="ar">
      <PageHeader
        title="الممثلون"
        subtitle="إدارة ممثلي الجامعات وروابط الدعوة"
        action={
          <Button onClick={() => setCreateOpen(true)}>إضافة ممثل</Button>
        }
      />

      {loading ? (
        <div className="space-y-3 animate-fade-page-in" aria-hidden>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton h-36 w-full rounded-2xl" />
          ))}
        </div>
      ) : fetchError ? (
        <div className="rounded-2xl border border-danger/25 bg-[var(--shop-sink)] px-6 py-10 text-center">
          <p className="text-base font-semibold text-ink">تعذر تحميل الممثلين</p>
          <p className="mt-1 text-sm text-ink-soft">تحقق من اتصالك ثم أعد المحاولة.</p>
          <Button className="mt-4" onClick={load}>إعادة المحاولة</Button>
        </div>
      ) : wholesalers.length === 0 ? (
        <EmptyState message="لا يوجد ممثلون" />
      ) : (
        <div className="space-y-4">
          {wholesalers.map((w) => (
            <article
              key={w.id}
              className="surface-card card-lift rounded-2xl p-4 lg:p-5"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h3 className="font-display text-lg font-bold text-ink">{w.name}</h3>
                  <p className="text-sm text-ink-soft" dir="ltr">{w.phone}</p>
                  <p className="mt-2 text-sm">
                    <span className="text-[var(--shop-muted)]">الطلاب: </span>
                    <span className="font-medium tabular-nums text-ink">{w.studentCount}</span>
                    <span className="mx-2 text-ink/30">|</span>
                    <span className="text-[var(--shop-muted)]">الموعد: </span>
                    {formatDateIQ(w.deadline)}
                  </p>
                  <p className="mt-1 text-sm">
                    <span className="text-[var(--shop-muted)]">العمولة: </span>
                    <span className="tabular-nums">{w.commissionRate}%</span>
                    <span className="mx-2 text-ink/30">|</span>
                    <span className="text-[var(--shop-muted)]">المستحق: </span>
                    <span className="font-semibold tabular-nums text-orange-ink" dir="ltr">
                      {formatIQD(w.earnedCommission ?? 0)}
                    </span>
                  </p>
                  <p className="mt-2 break-all rounded-lg bg-ink/[0.04] px-2.5 py-1.5 text-xs text-ink-soft" dir="ltr">
                    {w.referralUrl || getJoinUrl(w.referralCode)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <CopyButton
                    text={w.referralUrl || getJoinUrl(w.referralCode)}
                  />
                  <Link
                    href={`/admin/wholesalers/${w.id}/students`}
                    className="inline-flex min-h-11 items-center justify-center rounded-full border border-ink/15 bg-white/60 px-5 text-sm font-semibold text-ink transition-all duration-200 hover:border-orange/40 hover:bg-white hover:text-orange-ink"
                  >
                    عرض الطلاب
                  </Link>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setSelected(w);
                      setNewDeadline(
                        w.deadline
                          ? new Date(w.deadline).toISOString().slice(0, 10)
                          : ""
                      );
                      setExtendOpen(true);
                    }}
                  >
                    تمديد الموعد
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setSelected(w);
                      setNewCommission(String(w.commissionRate ?? 0));
                      setCommissionOpen(true);
                    }}
                  >
                    العمولة
                  </Button>
                  <Button variant="ghost" onClick={() => openSashConfig(w)}>
                    إعدادات الوشاح
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => setDeleteTarget(w)}
                  >
                    حذف
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="إضافة ممثل جديد"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={handleCreate} loading={submitting}>
              حفظ
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            label="الاسم"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={errors.name}
          />
          <Input
            label="الهاتف"
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            error={errors.phone}
          />
          <Input
            label="البريد الإلكتروني"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.email}
          />
          <Input
            label="كلمة المرور"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
          />
          <Input
            label="رمز الدعوة (مثال: baghdad-cs-2026)"
            autoComplete="off"
            value={referralCode}
            onChange={(e) => setReferralCode(e.target.value.toLowerCase())}
            error={errors.referralCode}
            dir="ltr"
          />
          <div dir="rtl" className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-muted">الموعد النهائي</label>
            <input
              type="date"
              autoComplete="off"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="min-h-11 w-full rounded-xl border border-line bg-beige px-3 py-2 text-end text-sm text-ink focus:border-orange-ink focus:outline-none focus:ring-2 focus:ring-orange-ink/15"
            />
            {errors.deadline && (
              <p className="text-xs text-danger">{errors.deadline}</p>
            )}
          </div>
          <Input
            label="نسبة العمولة (%)"
            type="number"
            min={0}
            max={100}
            step={0.5}
            autoComplete="off"
            value={commission}
            onChange={(e) => setCommission(e.target.value)}
          />
        </div>
      </Modal>

      <Modal
        open={commissionOpen}
        onClose={() => setCommissionOpen(false)}
        title={`العمولة — ${selected?.name ?? ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCommissionOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={handleCommission} loading={submitting}>
              حفظ
            </Button>
          </>
        }
      >
        <Input
          label="نسبة العمولة (%)"
          type="number"
          min={0}
          max={100}
          step={0.5}
          value={newCommission}
          onChange={(e) => setNewCommission(e.target.value)}
        />
      </Modal>

      <Modal
        open={extendOpen}
        onClose={() => setExtendOpen(false)}
        title={`تمديد الموعد — ${selected?.name ?? ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setExtendOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={handleExtend} loading={submitting}>
              حفظ
            </Button>
          </>
        }
      >
        <div dir="rtl" className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-muted">الموعد النهائي الجديد</label>
          <input
            type="date"
            value={newDeadline}
            onChange={(e) => setNewDeadline(e.target.value)}
            className="min-h-11 w-full rounded-xl border border-line bg-beige px-3 py-2 text-end text-sm text-ink focus:border-orange-ink focus:outline-none focus:ring-2 focus:ring-orange-ink/15"
          />
        </div>
      </Modal>

      <Modal
        open={sashOpen}
        onClose={() => !submitting && setSashOpen(false)}
        title={`إعدادات الوشاح — ${selected?.name ?? ""}`}
      >
        {sashLoading || !sashConfig ? (
          <PageLoader />
        ) : (
          <SashSideLockEditor
            editableSide={sashConfig.editable_sash_side}
            lockedSideDesign={sashConfig.locked_side_design}
            saving={submitting}
            onSave={handleSashSave}
          />
        )}
      </Modal>

      {/* ── Confirm: delete wholesaler ── */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="تأكيد حذف الممثل"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>إلغاء</Button>
            <Button
              variant="danger"
              loading={submitting}
              onClick={async () => {
                if (!deleteTarget) return;
                setSubmitting(true);
                try {
                  await deleteWholesaler(deleteTarget.id);
                  toast.success("تم حذف الممثل");
                  setDeleteTarget(null);
                  load();
                } catch (err) {
                  toast.error(getApiErrorMessage(err, "تعذر حذف الممثل"));
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              حذف «{deleteTarget?.name}»
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-soft">
          سيُحذف حساب الممثل «{deleteTarget?.name}» نهائياً وسيُلغى ربط الطلاب به. لا يمكن التراجع.
        </p>
      </Modal>
    </div>
  );
}
