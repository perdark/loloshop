"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  createWholesaler,
  extendWholesalerDeadline,
  getAdminWholesalers,
} from "@/lib/admin";
import { getApiErrorMessage } from "@/lib/api";
import { formatDateIQ, getJoinUrl } from "@/lib/format";
import type { AdminWholesaler, CreateWholesalerPayload } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";

const SLUG_RE = /^[a-z0-9-]+$/;

export default function AdminWholesalersPage() {
  const [wholesalers, setWholesalers] = useState<AdminWholesaler[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [extendOpen, setExtendOpen] = useState(false);
  const [selected, setSelected] = useState<AdminWholesaler | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState<CreateWholesalerPayload>({
    name: "",
    phone: "",
    email: "",
    password: "",
    referralCode: "",
    deadline: "",
  });
  const [newDeadline, setNewDeadline] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAdminWholesalers();
      setWholesalers(data);
    } catch {
      toast.error("تعذر تحميل الممثلين");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function validateCreate(): boolean {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "الاسم مطلوب";
    if (!form.phone.trim()) e.phone = "رقم الهاتف مطلوب";
    if (!form.email.trim()) e.email = "البريد مطلوب";
    if (!form.password || form.password.length < 6)
      e.password = "كلمة المرور ٦ أحرف على الأقل";
    if (!form.referralCode.trim()) e.referralCode = "رمز الدعوة مطلوب";
    else if (!SLUG_RE.test(form.referralCode))
      e.referralCode = "أحرف إنجليزية صغيرة وأرقام وشرطة فقط";
    if (!form.deadline) e.deadline = "الموعد النهائي مطلوب";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleCreate() {
    if (!validateCreate()) return;
    setSubmitting(true);
    try {
      await createWholesaler(form);
      toast.success("تم إنشاء الممثل");
      setCreateOpen(false);
      setForm({
        name: "",
        phone: "",
        email: "",
        password: "",
        referralCode: "",
        deadline: "",
      });
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر إنشاء الممثل"));
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
        <PageLoader />
      ) : wholesalers.length === 0 ? (
        <EmptyState message="لا يوجد ممثلون" />
      ) : (
        <div className="space-y-4">
          {wholesalers.map((w) => (
            <article
              key={w.id}
              className="rounded-xl border border-ink/10 bg-white p-4 lg:p-5"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h3 className="font-semibold text-ink">{w.name}</h3>
                  <p className="text-sm text-ink/60">{w.phone}</p>
                  <p className="mt-2 text-sm">
                    <span className="text-ink/50">الطلاب: </span>
                    {w.studentCount}
                    <span className="mx-2 text-ink/30">|</span>
                    <span className="text-ink/50">الموعد: </span>
                    {formatDateIQ(w.deadline)}
                  </p>
                  <p className="mt-1 break-all text-xs text-ink/50">
                    {w.referralUrl || getJoinUrl(w.referralCode)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <CopyButton
                    text={w.referralUrl || getJoinUrl(w.referralCode)}
                  />
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
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            error={errors.name}
          />
          <Input
            label="الهاتف"
            type="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            error={errors.phone}
          />
          <Input
            label="البريد الإلكتروني"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            error={errors.email}
          />
          <Input
            label="كلمة المرور"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            error={errors.password}
          />
          <Input
            label="رمز الدعوة (مثال: baghdad-cs-2026)"
            value={form.referralCode}
            onChange={(e) =>
              setForm({ ...form, referralCode: e.target.value.toLowerCase() })
            }
            error={errors.referralCode}
            dir="ltr"
          />
          <Input
            label="الموعد النهائي"
            type="date"
            value={form.deadline}
            onChange={(e) => setForm({ ...form, deadline: e.target.value })}
            error={errors.deadline}
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
        <Input
          label="الموعد النهائي الجديد"
          type="date"
          value={newDeadline}
          onChange={(e) => setNewDeadline(e.target.value)}
        />
      </Modal>
    </div>
  );
}
