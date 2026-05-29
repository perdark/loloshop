"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { AuthCard } from "@/components/auth/AuthCard";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  register as apiRegister,
  verifyRegistrationOtp,
  resendVerifyOtp,
  fetchMe,
  getApiErrorMessage,
} from "@/lib/auth-api";
import { setToken, setUser } from "@/lib/auth";
import type { UserRole } from "@/lib/types";

const ROLE_REDIRECT: Record<UserRole, string> = {
  admin: "/admin",
  staff: "/staff",
  wholesaler: "/wholesaler",
  retail: "/",
};

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<"form" | "otp">("form");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    password: "",
    university_name: "",
    department: "",
    gender: "" as "" | "male" | "female",
  });

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "الاسم مطلوب";
    if (!form.phone.trim()) e.phone = "رقم الهاتف مطلوب";
    if (!form.password || form.password.length < 6)
      e.password = "كلمة المرور ٦ أحرف على الأقل";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      await apiRegister({
        name: form.name.trim(),
        phone: form.phone.trim(),
        password: form.password,
        email: form.email.trim() || undefined,
        gender: form.gender || undefined,
        university_name: form.university_name.trim() || undefined,
        department: form.department.trim() || undefined,
      });
      toast.success("تم إرسال رمز التحقق عبر واتساب");
      setStep("otp");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذّر إنشاء الحساب"));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (code.trim().length < 4) {
      toast.error("أدخل رمز التحقق");
      return;
    }
    setLoading(true);
    try {
      const { token } = await verifyRegistrationOtp(form.phone.trim(), code.trim());
      setToken(token);
      const user = await fetchMe();
      setUser(user);
      toast.success(`مرحباً ${user.name} 🎉`);
      router.replace(ROLE_REDIRECT[user.role]);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "رمز غير صحيح"));
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    try {
      await resendVerifyOtp(form.phone.trim());
      toast.success("تم إرسال رمز جديد");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذّر إرسال الرمز"));
    }
  }

  return (
    <AuthCard title={step === "form" ? "إنشاء حساب" : "رمز التحقق"}>
      {step === "form" ? (
        <form onSubmit={handleRegister} className="space-y-4">
          <Input
            label="الاسم الكامل"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            error={errors.name}
            autoComplete="name"
          />

          {/* Phone — country-code prefix kept in an LTR slot */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="reg-phone" className="text-sm font-medium text-ink">
              رقم الهاتف
            </label>
            <div className="flex items-stretch gap-2" dir="ltr">
              <span className="inline-flex select-none items-center rounded-xl border border-line bg-beige px-3 text-sm font-semibold text-ink">
                +964
              </span>
              <input
                id="reg-phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                value={form.phone}
                onChange={(e) =>
                  setForm({ ...form, phone: e.target.value.replace(/\D/g, "") })
                }
                placeholder="7XX XXX XXXX"
                aria-invalid={!!errors.phone}
                aria-describedby={errors.phone ? "reg-phone-error" : undefined}
                className={[
                  "min-h-11 min-w-0 flex-1 rounded-xl border bg-beige px-3.5 py-2.5 text-ink outline-none transition-colors placeholder:text-ink/55",
                  "focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20",
                  errors.phone ? "border-danger" : "border-line",
                ].join(" ")}
              />
            </div>
            {errors.phone && (
              <p id="reg-phone-error" className="text-xs text-danger" role="alert">
                {errors.phone}
              </p>
            )}
          </div>

          <Input
            label="البريد الإلكتروني (اختياري)"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
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
            label="الجامعة (اختياري)"
            value={form.university_name}
            onChange={(e) =>
              setForm({ ...form, university_name: e.target.value })
            }
          />
          <Input
            label="القسم / التخصص (اختياري)"
            value={form.department}
            onChange={(e) => setForm({ ...form, department: e.target.value })}
          />

          {/* Gender — optional pill toggles on tokens */}
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">الجنس (اختياري)</span>
            <div className="flex gap-3">
              {([
                ["male", "ذكر"],
                ["female", "أنثى"],
              ] as const).map(([value, label]) => (
                <label key={value} className="flex-1">
                  <input
                    type="radio"
                    name="gender"
                    value={value}
                    checked={form.gender === value}
                    onChange={() => setForm({ ...form, gender: value })}
                    className="peer sr-only"
                  />
                  <span className="block cursor-pointer rounded-xl border border-line bg-beige py-3 text-center text-sm peer-checked:border-orange-ink peer-checked:bg-orange-ink/10 peer-checked:font-semibold peer-checked:text-orange-ink">
                    {label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <Button type="submit" fullWidth loading={loading}>
            إنشاء الحساب
          </Button>
          <p className="text-center text-sm">
            لديك حساب؟{" "}
            <Link
              href="/login"
              className="font-medium text-orange-ink underline-offset-2 hover:underline"
            >
              تسجيل الدخول
            </Link>
          </p>
        </form>
      ) : (
        <form onSubmit={handleVerify} className="space-y-5">
          <div className="rounded-[12px] border border-ink/10 bg-cream px-4 py-3.5 text-center text-sm text-ink-soft">
            <p>أُرسل رمز التحقق عبر واتساب إلى</p>
            <p className="mt-1 font-bold tracking-widest text-ink" dir="ltr">
              +964 {form.phone}
            </p>
          </div>
          <Input
            label="رمز التحقق"
            type="text"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            autoComplete="one-time-code"
          />
          <Button type="submit" fullWidth loading={loading}>
            تأكيد ودخول
          </Button>
          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={() => setStep("form")}
              className="text-ink-soft transition-colors hover:text-ink"
            >
              ← رجوع
            </button>
            <button
              type="button"
              onClick={handleResend}
              className="font-medium text-orange-ink transition-colors hover:text-ink"
            >
              إعادة إرسال الرمز
            </button>
          </div>
        </form>
      )}
    </AuthCard>
  );
}
