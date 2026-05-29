"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { PageLoader } from "@/components/ui/Spinner";
import { getApiErrorMessage } from "@/lib/api";
import type { User } from "@/lib/types";
import {
  createStaff,
  deleteStaff,
  getAdminStaff,
  resetStaffPassword,
} from "@/lib/admin";

export default function AdminStaffPage() {
  const [rows, setRows] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [selected, setSelected] = useState<User | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [newPassword, setNewPassword] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAdminStaff();
      setRows(data);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر تحميل الموظفين"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
  }, [load]);

  async function handleCreate() {
    if (!name.trim() || !phone.trim() || password.length < 6) {
      toast.error("يرجى إدخال الاسم والهاتف وكلمة مرور ٦ أحرف على الأقل");
      return;
    }
    setSubmitting(true);
    try {
      await createStaff({ name, phone, email, password });
      toast.success("تم إنشاء الموظف");
      setCreateOpen(false);
      setName("");
      setPhone("");
      setEmail("");
      setPassword("");
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر إنشاء الموظف"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetPassword() {
    if (!selected || newPassword.length < 6) {
      toast.error("كلمة المرور ٦ أحرف على الأقل");
      return;
    }
    setSubmitting(true);
    try {
      await resetStaffPassword(selected.id, newPassword);
      toast.success("تم تحديث كلمة المرور");
      setResetOpen(false);
      setNewPassword("");
      setSelected(null);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر تحديث كلمة المرور"));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <PageLoader />;

  return (
    <div dir="rtl" lang="ar">
      <PageHeader
        title="الموظفون"
        subtitle="إدارة حسابات الموظفين"
        action={<Button onClick={() => setCreateOpen(true)}>إضافة موظف</Button>}
      />

      {rows.length === 0 ? (
        <EmptyState message="لا يوجد موظفون" />
      ) : (
        <div className="space-y-3">
          {rows.map((u) => (
            <article
              key={u.id}
              className="surface-card card-lift rounded-2xl p-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-orange/10 font-display text-base font-bold text-orange-ink"
                  >
                    {u.name?.trim().charAt(0) || "م"}
                  </span>
                  <div>
                    <p className="font-semibold text-ink">{u.name}</p>
                    <p className="text-sm text-ink-soft" dir="ltr">
                      {u.phone}
                    </p>
                    {u.email && <p className="text-xs text-[var(--shop-muted)]">{u.email}</p>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setSelected(u);
                      setNewPassword("");
                      setResetOpen(true);
                    }}
                  >
                    تغيير كلمة المرور
                  </Button>
                  <Button
                    variant="danger"
                    onClick={async () => {
                      if (!confirm(`حذف الموظف ${u.name}؟`)) return;
                      try {
                        await deleteStaff(u.id);
                        toast.success("تم حذف الموظف");
                        load();
                      } catch (err) {
                        toast.error(getApiErrorMessage(err, "تعذر حذف الموظف"));
                      }
                    }}
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
        title="إضافة موظف"
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
          <Input label="الاسم" value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            label="الهاتف"
            type="tel"
            dir="ltr"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <Input
            label="البريد الإلكتروني (اختياري)"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            label="كلمة المرور"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
      </Modal>

      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title={`تغيير كلمة المرور — ${selected?.name ?? ""}`}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setResetOpen(false);
                setSelected(null);
              }}
            >
              إلغاء
            </Button>
            <Button onClick={handleResetPassword} loading={submitting}>
              حفظ
            </Button>
          </>
        }
      >
        <Input
          label="كلمة المرور الجديدة"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
      </Modal>
    </div>
  );
}

