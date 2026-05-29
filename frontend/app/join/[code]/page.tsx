"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { joinWithCode } from "@/lib/wholesaler";
import { getApiErrorMessage } from "@/lib/api";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { AuthCard } from "@/components/auth/AuthCard";

// Inline checkmark — warm brick on cream surface, no emoji, no gradient fill.
function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={2}
      stroke="currentColor"
      className="h-8 w-8"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

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
      <AuthCard title="طلبك قيد المراجعة">
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          {/* Quiet success mark — warm ink circle with a line-SVG check */}
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-ink/12 bg-[var(--shop-sink)] text-orange-ink">
            <CheckIcon />
          </div>
          <p className="text-sm text-ink-soft">
            سنُعلمك داخل التطبيق عند موافقة الممثل على حسابك.
          </p>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="التسجيل بدعوة الممثل">
      {/* Invite code badge — a quiet inset strip, not a dark header block */}
      <div className="mb-6 rounded-[12px] border border-ink/10 bg-[var(--shop-sink)] px-4 py-3 text-center">
        <p className="text-xs text-[var(--shop-muted)]">رمز الدعوة</p>
        <p className="mt-0.5 font-mono text-sm font-semibold tracking-widest text-ink" dir="ltr">
          {code}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="الاسم الثلاثي"
          placeholder="الاسم + اسم الأب + الجد"
          value={form.full_name_third}
          onChange={(e) => setForm({ ...form, full_name_third: e.target.value })}
          error={errors.full_name_third}
        />

        {/* Phone — country-code prefix kept in LTR slot */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="join-phone" className="text-sm font-medium text-ink">رقم الهاتف</label>
          <div className="flex items-stretch gap-2" dir="ltr">
            <span className="inline-flex select-none items-center rounded-xl border border-line bg-beige px-3 text-sm font-semibold text-ink">
              +964
            </span>
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
                "min-h-11 min-w-0 flex-1 rounded-xl border bg-beige px-3.5 py-2.5 text-ink outline-none transition-colors placeholder:text-ink/55",
                "focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20",
                errors.phone ? "border-danger" : "border-line",
              ].join(" ")}
            />
          </div>
          {errors.phone && (
            <p id="join-phone-error" className="text-xs text-danger" role="alert">
              {errors.phone}
            </p>
          )}
        </div>

        <Input
          label="البريد الإلكتروني"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          error={errors.email}
          autoComplete="email"
        />
        <Input
          label="كلمة المرور"
          type="password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          error={errors.password}
          autoComplete="new-password"
        />
        <Input
          label="تأكيد كلمة المرور"
          type="password"
          value={form.confirmPassword}
          onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
          error={errors.confirmPassword}
          autoComplete="new-password"
        />

        <Button type="submit" fullWidth loading={loading}>
          إرسال الطلب
        </Button>
      </form>
    </AuthCard>
  );
}
