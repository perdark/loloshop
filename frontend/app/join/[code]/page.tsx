"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { joinWithCode } from "@/lib/wholesaler";
import { getApiErrorMessage } from "@/lib/api";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { BrandMark } from "@/components/ui/BrandLogo";

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
        className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-hero-rich px-4 py-10"
        dir="rtl"
        lang="ar"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -end-24 h-72 w-72 rounded-full bg-orange/20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-28 -start-20 h-80 w-80 rounded-full bg-peach/40 blur-3xl"
        />
        <div className="relative w-full max-w-md rounded-3xl border border-white/60 bg-white p-8 text-center shadow-[var(--shadow-pop)] animate-auth-card-in">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-brand-gradient text-3xl text-white shadow-[var(--shadow-float)]">
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
      className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-hero-rich px-4 py-10"
      dir="rtl"
      lang="ar"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -end-24 h-72 w-72 rounded-full bg-orange/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-28 -start-20 h-80 w-80 rounded-full bg-peach/40 blur-3xl"
      />
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-white/60 bg-white shadow-[var(--shadow-pop)] animate-auth-card-in">
        <div className="relative overflow-hidden bg-ink px-6 py-7 text-center">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -top-16 mx-auto h-32 w-32 rounded-full bg-orange/30 blur-2xl"
          />
          <span
            aria-hidden
            className="relative mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-brand-gradient text-2xl shadow-[var(--shadow-float)]"
          >
            🎓
          </span>
          <BrandMark size={88} />
          <p className="relative mt-1 font-display text-lg font-semibold text-cream">لولو شوب</p>
          <p className="relative mt-1.5 text-sm text-cream/70">التسجيل عبر دعوة الممثل</p>
          <p className="relative mt-1 inline-block rounded-full bg-cream/10 px-3 py-0.5 text-xs text-cream/60" dir="ltr">
            {code}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="px-6 py-7 sm:px-8"
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
            <div className="flex flex-col gap-1.5">
              <label htmlFor="join-phone" className="text-sm font-medium text-ink">رقم الهاتف</label>
              <div className="flex items-stretch gap-2" dir="ltr">
                <span className="inline-flex select-none items-center rounded-xl border border-ink/15 bg-beige px-3 text-sm font-semibold text-ink">+964</span>
                <input
                  id="join-phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "") })}
                  placeholder="7XX XXX XXXX"
                  aria-invalid={!!errors.phone}
                  aria-describedby={errors.phone ? "join-phone-error" : undefined}
                  className={[
                    "min-h-11 min-w-0 flex-1 rounded-xl border bg-white px-3.5 py-2.5 text-ink outline-none transition-colors placeholder:text-ink/55",
                    "focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20",
                    errors.phone ? "border-red-500" : "border-ink/15",
                  ].join(" ")}
                />
              </div>
              {errors.phone && <p id="join-phone-error" className="text-xs text-red-600" role="alert">{errors.phone}</p>}
            </div>
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

      <p className="relative mt-6 text-center text-xs text-ink-soft">
        أوشحة وروبات التخرج · @loloshop96
      </p>
    </div>
  );
}
