"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { joinWithCode } from "@/lib/wholesaler";
import { getApiErrorMessage } from "@/lib/api";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export default function JoinPage() {
  const params = useParams();
  const code = params.code as string;

  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    full_name_third: "",
    phone: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.full_name_third.trim()) e.full_name_third = "الاسم الثلاثي مطلوب";
    if (!form.phone.trim()) e.phone = "رقم الهاتف مطلوب";
    if (!form.email.trim()) e.email = "البريد الإلكتروني مطلوب";
    if (!form.password || form.password.length < 6)
      e.password = "كلمة المرور ٦ أحرف على الأقل";
    if (form.password !== form.confirmPassword)
      e.confirmPassword = "كلمتا المرور غير متطابقتين";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      await joinWithCode(code, {
        full_name_third: form.full_name_third.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        password: form.password,
      });
      setSubmitted(true);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر إرسال الطلب"));
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center bg-cream px-4"
        dir="rtl"
        lang="ar"
      >
        <div className="w-full max-w-md rounded-2xl border border-ink/10 bg-white p-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-orange/20 text-3xl text-orange-ink">
            ✓
          </div>
          <h1 className="font-display text-2xl font-bold text-ink">
            طلبك بانتظار موافقة الممثل
          </h1>
          <p className="mt-3 text-sm text-ink/60">
            سنُعلمك داخل التطبيق عند الموافقة على حسابك
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-screen flex-col bg-cream px-4 py-8"
      dir="rtl"
      lang="ar"
    >
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="font-display text-3xl font-bold text-ink">لولو شوب</p>
          <p className="mt-2 text-sm text-ink/60">التسجيل عبر دعوة الممثل</p>
          <p className="mt-1 text-xs text-orange-ink" dir="ltr">
            {code}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-ink/10 bg-white p-6 shadow-sm"
        >
          <Input
            label="الاسم الثلاثي"
            placeholder="الاسم + اسم الأب + الجد"
            value={form.full_name_third}
            onChange={(e) =>
              setForm({ ...form, full_name_third: e.target.value })
            }
            error={errors.full_name_third}
          />
          <div className="mt-4">
            <Input
              label="رقم الهاتف"
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              error={errors.phone}
            />
          </div>
          <div className="mt-4">
            <Input
              label="البريد الإلكتروني"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              error={errors.email}
            />
          </div>
          <div className="mt-4">
            <Input
              label="كلمة المرور"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              error={errors.password}
            />
          </div>
          <div className="mt-4">
            <Input
              label="تأكيد كلمة المرور"
              type="password"
              value={form.confirmPassword}
              onChange={(e) =>
                setForm({ ...form, confirmPassword: e.target.value })
              }
              error={errors.confirmPassword}
            />
          </div>
          <div className="mt-6">
            <Button type="submit" fullWidth loading={loading}>
              إرسال الطلب
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
