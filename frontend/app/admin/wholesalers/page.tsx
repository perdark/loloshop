"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  createWholesaler,
  deleteWholesaler,
  extendWholesalerDeadline,
  getAdminWholesalers,
  getWholesalerSashConfig,
  updateWholesaler,
  updateWholesalerPricing,
  updateWholesalerSashConfig,
  DEFAULT_PRICING_ADDONS,
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
  const [pricingOpen, setPricingOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
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
  const [university, setUniversity] = useState("");
  const [department, setDepartment] = useState("");
  const [newDeadline, setNewDeadline] = useState("");
  const [editUniversity, setEditUniversity] = useState("");
  const [editDepartment, setEditDepartment] = useState("");
  const [editEmbroideryColor, setEditEmbroideryColor] = useState("");
  const [createEmbroideryColor, setCreateEmbroideryColor] = useState("");
  // «التسعيرة» — create modal base prices (add-ons default server-side, tweak later).
  const [adminPrice, setAdminPrice] = useState("0");
  const [wholesalerPrice, setWholesalerPrice] = useState("50000");
  // «التسعيرة» edit modal: two base prices + the 5 editable add-on surcharges.
  const emptyPricing = {
    adminPrice: "0",
    wholesalerPrice: "50000",
    royal_sash: String(DEFAULT_PRICING_ADDONS.royal_sash),
    royal_cap_when_normal_sash: String(DEFAULT_PRICING_ADDONS.royal_cap_when_normal_sash),
    extra_cap_embroidery: String(DEFAULT_PRICING_ADDONS.extra_cap_embroidery),
    robe_sleeve_each: String(DEFAULT_PRICING_ADDONS.robe_sleeve_each),
    american_shawl: String(DEFAULT_PRICING_ADDONS.american_shawl),
    piece_sash_normal: String(DEFAULT_PRICING_ADDONS.piece_sash_normal),
    piece_sash_royal: String(DEFAULT_PRICING_ADDONS.piece_sash_royal),
    piece_cap_normal: String(DEFAULT_PRICING_ADDONS.piece_cap_normal),
    piece_cap_royal: String(DEFAULT_PRICING_ADDONS.piece_cap_royal),
    piece_robe_normal: String(DEFAULT_PRICING_ADDONS.piece_robe_normal),
    piece_robe_royal: String(DEFAULT_PRICING_ADDONS.piece_robe_royal),
  };
  const [pricingForm, setPricingForm] = useState(emptyPricing);

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
     
    load();
  }, [load]);

  function validateCreate(): boolean {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "الاسم مطلوب";
    if (!phone.trim()) e.phone = "رقم الهاتف مطلوب";
    if (!password || password.length < 6)
      e.password = "كلمة المرور ٦ أحرف على الأقل";
    if (!referralCode.trim()) e.referralCode = "رمز الدعوة مطلوب";
    else if (!SLUG_RE.test(referralCode))
      e.referralCode = "أحرف إنجليزية صغيرة وأرقام وشرطة فقط";
    if (!deadline) e.deadline = "الموعد النهائي مطلوب";
    if (!university.trim()) e.university = "اسم الجامعة مطلوب";
    if (!department.trim()) e.department = "القسم / التخصص مطلوب";
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
        universityName: university.trim(),
        department: department.trim(),
        adminPrice: Math.max(0, Math.round(Number(adminPrice) || 0)),
        wholesalerPrice: Math.max(0, Math.round(Number(wholesalerPrice) || 0)),
        embroideryColor: createEmbroideryColor.trim() || undefined,
      });
      toast.success("تم إنشاء الممثل");
      setCreateOpen(false);
      setName("");
      setPhone("");
      setEmail("");
      setPassword("");
      setReferralCode("");
      setDeadline("");
      setAdminPrice("0");
      setWholesalerPrice("50000");
      setUniversity("");
      setDepartment("");
      setCreateEmbroideryColor("");
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر إنشاء الممثل"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEdit() {
    if (!selected) return;
    if (!editUniversity.trim() || !editDepartment.trim()) {
      toast.error("اسم الجامعة والقسم مطلوبان");
      return;
    }
    setSubmitting(true);
    try {
      await updateWholesaler(selected.id, {
        universityName: editUniversity.trim(),
        department: editDepartment.trim(),
        embroideryColor: editEmbroideryColor.trim() || undefined,
      });
      toast.success("تم تحديث بيانات الممثل");
      setEditOpen(false);
      setSelected(null);
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر تحديث البيانات"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePricing() {
    if (!selected) return;
    const num = (v: string) => Math.max(0, Math.round(Number(v) || 0));
    if ([pricingForm.adminPrice, pricingForm.wholesalerPrice].some((v) => Number(v) < 0)) {
      toast.error("السعر يجب أن يكون رقماً موجباً");
      return;
    }
    setSubmitting(true);
    try {
      await updateWholesalerPricing(selected.id, {
        adminPrice: num(pricingForm.adminPrice),
        wholesalerPrice: num(pricingForm.wholesalerPrice),
        pricingAddons: {
          royal_sash: num(pricingForm.royal_sash),
          royal_cap_when_normal_sash: num(pricingForm.royal_cap_when_normal_sash),
          extra_cap_embroidery: num(pricingForm.extra_cap_embroidery),
          robe_sleeve_each: num(pricingForm.robe_sleeve_each),
          american_shawl: num(pricingForm.american_shawl),
          piece_sash_normal: num(pricingForm.piece_sash_normal),
          piece_sash_royal: num(pricingForm.piece_sash_royal),
          piece_cap_normal: num(pricingForm.piece_cap_normal),
          piece_cap_royal: num(pricingForm.piece_cap_royal),
          piece_robe_normal: num(pricingForm.piece_robe_normal),
          piece_robe_royal: num(pricingForm.piece_robe_royal),
        },
      });
      toast.success("تم تحديث التسعيرة");
      setPricingOpen(false);
      setSelected(null);
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر تحديث التسعيرة"));
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
                  {(w.universityName || w.department) && (
                    <p className="mt-1 text-sm text-ink">
                      {w.universityName}
                      {w.universityName && w.department ? " — " : ""}
                      {w.department}
                    </p>
                  )}
                  <p className="mt-2 text-sm">
                    <span className="text-[var(--shop-muted)]">الطلاب: </span>
                    <span className="font-medium tabular-nums text-ink">{w.studentCount}</span>
                    <span className="mx-2 text-ink/30">|</span>
                    <span className="text-[var(--shop-muted)]">الموعد: </span>
                    {formatDateIQ(w.deadline)}
                  </p>
                  <p className="mt-1 text-sm">
                    <span className="text-[var(--shop-muted)]">سعر المدير: </span>
                    <span className="tabular-nums" dir="ltr">{formatIQD(w.adminPrice)}</span>
                    <span className="mx-2 text-ink/30">|</span>
                    <span className="text-[var(--shop-muted)]">سعر الممثل والطلاب: </span>
                    <span className="tabular-nums" dir="ltr">{formatIQD(w.wholesalerPrice)}</span>
                  </p>
                  <p className="mt-1 text-sm">
                    <span className="text-[var(--shop-muted)]">المستحق (الفرق): </span>
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
                      setEditUniversity(w.universityName ?? "");
                      setEditDepartment(w.department ?? "");
                      setEditEmbroideryColor(w.embroideryColor ?? "");
                      setEditOpen(true);
                    }}
                  >
                    تعديل
                  </Button>
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
                      setPricingForm({
                        adminPrice: String(w.adminPrice ?? 0),
                        wholesalerPrice: String(w.wholesalerPrice || 50000),
                        royal_sash: String(w.pricingAddons.royal_sash),
                        royal_cap_when_normal_sash: String(w.pricingAddons.royal_cap_when_normal_sash),
                        extra_cap_embroidery: String(w.pricingAddons.extra_cap_embroidery),
                        robe_sleeve_each: String(w.pricingAddons.robe_sleeve_each),
                        american_shawl: String(w.pricingAddons.american_shawl),
                        piece_sash_normal: String(w.pricingAddons.piece_sash_normal),
                        piece_sash_royal: String(w.pricingAddons.piece_sash_royal),
                        piece_cap_normal: String(w.pricingAddons.piece_cap_normal),
                        piece_cap_royal: String(w.pricingAddons.piece_cap_royal),
                        piece_robe_normal: String(w.pricingAddons.piece_robe_normal),
                        piece_robe_royal: String(w.pricingAddons.piece_robe_royal),
                      });
                      setPricingOpen(true);
                    }}
                  >
                    التسعيرة
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
            label="البريد الإلكتروني (اختياري)"
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
          <Input
            label="الجامعة"
            autoComplete="off"
            value={university}
            onChange={(e) => setUniversity(e.target.value)}
            error={errors.university}
          />
          <Input
            label="القسم / التخصص"
            autoComplete="off"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            error={errors.department}
          />
          <Input
            label="لون التطريز (اختياري)"
            autoComplete="off"
            value={createEmbroideryColor}
            onChange={(e) => setCreateEmbroideryColor(e.target.value)}
            placeholder="مثال: ذهبي"
            maxLength={200}
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
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="سعر خاص بالمدير (د.ع)"
              type="number"
              min={0}
              step={1000}
              autoComplete="off"
              value={adminPrice}
              onChange={(e) => setAdminPrice(e.target.value)}
              dir="ltr"
            />
            <Input
              label="سعر الممثل والطلاب (د.ع)"
              type="number"
              min={0}
              step={1000}
              autoComplete="off"
              value={wholesalerPrice}
              onChange={(e) => setWholesalerPrice(e.target.value)}
              dir="ltr"
            />
          </div>
          <p className="text-xs text-ink-soft">
            اضافات على السعر تُضبط لكل ممثل بعد الإنشاء من زر «التسعيرة».
          </p>
        </div>
      </Modal>

      <Modal
        open={pricingOpen}
        onClose={() => setPricingOpen(false)}
        title={`التسعيرة — ${selected?.name ?? ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPricingOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={handlePricing} loading={submitting}>
              حفظ
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <h4 className="mb-2 text-sm font-bold text-ink">السعر الأساسي للطقم</h4>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="سعر خاص بالمدير (د.ع)"
                type="number"
                min={0}
                step={1000}
                dir="ltr"
                value={pricingForm.adminPrice}
                onChange={(e) =>
                  setPricingForm((f) => ({ ...f, adminPrice: e.target.value }))
                }
              />
              <Input
                label="سعر الممثل والطلاب (د.ع)"
                type="number"
                min={0}
                step={1000}
                dir="ltr"
                value={pricingForm.wholesalerPrice}
                onChange={(e) =>
                  setPricingForm((f) => ({ ...f, wholesalerPrice: e.target.value }))
                }
              />
            </div>
            <p className="mt-1.5 text-xs text-ink-soft">
              سعر المدير خاص لا يراه الممثل أو الطالب · سعر الممثل والطلاب هو السعر الظاهر في طلب
              الطقم. الفرق بينهما = ربح الممثل المستحق.
            </p>
          </div>

          <div>
            <h4 className="mb-2 text-sm font-bold text-ink">اضافات على السعر (للممثل والطلاب)</h4>
            <div className="space-y-2.5">
              <PricingAddonRow
                label="وشاح ملكي"
                value={pricingForm.royal_sash}
                onChange={(v) => setPricingForm((f) => ({ ...f, royal_sash: v }))}
              />
              <PricingAddonRow
                label="وشاح عادي + قبعة ملكية"
                value={pricingForm.royal_cap_when_normal_sash}
                onChange={(v) =>
                  setPricingForm((f) => ({ ...f, royal_cap_when_normal_sash: v }))
                }
              />
              <PricingAddonRow
                label="تطريز القبعة الثاني (الأول مجاني)"
                value={pricingForm.extra_cap_embroidery}
                onChange={(v) =>
                  setPricingForm((f) => ({ ...f, extra_cap_embroidery: v }))
                }
              />
              <PricingAddonRow
                label="تطريز ردن الروب (لكل ردن · ردنان)"
                value={pricingForm.robe_sleeve_each}
                onChange={(v) => setPricingForm((f) => ({ ...f, robe_sleeve_each: v }))}
              />
              <PricingAddonRow
                label="شال امريكي"
                value={pricingForm.american_shawl}
                onChange={(v) => setPricingForm((f) => ({ ...f, american_shawl: v }))}
              />
            </div>
          </div>

          <div>
            <h4 className="mb-2 text-sm font-bold text-ink">أسعار القطع عند الطلب الجزئي</h4>
            <div className="space-y-2.5">
              <PricingAddonRow
                label="وشاح عادي"
                value={pricingForm.piece_sash_normal}
                onChange={(v) => setPricingForm((f) => ({ ...f, piece_sash_normal: v }))}
              />
              <PricingAddonRow
                label="وشاح ملكي"
                value={pricingForm.piece_sash_royal}
                onChange={(v) => setPricingForm((f) => ({ ...f, piece_sash_royal: v }))}
              />
              <PricingAddonRow
                label="قبعة عادية"
                value={pricingForm.piece_cap_normal}
                onChange={(v) => setPricingForm((f) => ({ ...f, piece_cap_normal: v }))}
              />
              <PricingAddonRow
                label="قبعة ملكية"
                value={pricingForm.piece_cap_royal}
                onChange={(v) => setPricingForm((f) => ({ ...f, piece_cap_royal: v }))}
              />
              <PricingAddonRow
                label="روب عادي"
                value={pricingForm.piece_robe_normal}
                onChange={(v) => setPricingForm((f) => ({ ...f, piece_robe_normal: v }))}
              />
              <PricingAddonRow
                label="روب ملكي"
                value={pricingForm.piece_robe_royal}
                onChange={(v) => setPricingForm((f) => ({ ...f, piece_robe_royal: v }))}
              />
            </div>
            <p className="mt-1.5 text-xs text-ink-soft">
              تُستخدم هذه الأسعار فقط إذا لم يختر الطالب الطقم الكامل.
            </p>
          </div>
        </div>
      </Modal>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={`تعديل بيانات — ${selected?.name ?? ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={handleEdit} loading={submitting}>
              حفظ
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-ink-soft">
            الجامعة والقسم يُورّثان لكل طالب يسجّل عبر رابط هذا الممثل.
          </p>
          <Input
            label="الجامعة"
            autoComplete="off"
            value={editUniversity}
            onChange={(e) => setEditUniversity(e.target.value)}
          />
          <Input
            label="القسم / التخصص"
            autoComplete="off"
            value={editDepartment}
            onChange={(e) => setEditDepartment(e.target.value)}
          />
          <Input
            label="لون التطريز (اختياري)"
            autoComplete="off"
            value={editEmbroideryColor}
            onChange={(e) => setEditEmbroideryColor(e.target.value)}
            placeholder="مثال: ذهبي"
            maxLength={200}
          />
        </div>
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

/** One «اضافات على السعر» row: an Arabic label + a compact د.ع amount field. */
function PricingAddonRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-line bg-beige px-3 py-2">
      <span className="text-sm text-ink">{label}</span>
      <span className="flex items-center gap-1.5">
        <input
          type="number"
          min={0}
          step={1000}
          dir="ltr"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-28 rounded-lg border border-line bg-white px-2.5 py-1.5 text-end text-sm tabular-nums text-ink focus:border-orange-ink focus:outline-none focus:ring-2 focus:ring-orange-ink/15"
        />
        <span className="text-xs text-ink-soft">د.ع</span>
      </span>
    </label>
  );
}
