"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { AuthCard } from "@/components/auth/AuthCard";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { OtpVerifyForm } from "@/components/auth/OtpVerifyForm";
import {
  register as apiRegister,
  verifyRegistrationOtp,
  resendVerifyOtp,
  fetchMe,
  getApiErrorMessage,
  FieldError,
} from "@/lib/auth-api";
import { setToken, setUser } from "@/lib/auth";
import type { UserRole } from "@/lib/types";
import { STUDY_TYPE_LABELS, PASSWORD_MIN_CUSTOMER } from "@/lib/constants";

const ROLE_REDIRECT: Record<UserRole, string> = {
  admin: "/admin",
  staff: "/staff",
  wholesaler: "/wholesaler",
  retail: "/",
  worker: "/workshop",
  design_helper: "/design-support",
};

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<"form" | "otp">("form");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Submit failure the backend did NOT attribute to a field — rendered inline above the
  // primary action instead of as a toast that floats over the form and then vanishes.
  const [formError, setFormError] = useState("");
  // OTP challenge pinned to the account register() just created; resending rotates it.
  const [challengeId, setChallengeId] = useState("");
  const [form, setForm] = useState({
    name: "",
    phone: "",
    password: "",
    university_name: "",
    department: "",
    study_type: "" as "" | "morning" | "evening",
    instagram_username: "",
    gender: "" as "" | "male" | "female",
  });

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "الاسم مطلوب";
    if (!form.phone.trim()) e.phone = "رقم الهاتف مطلوب";
    if (!form.password || form.password.length < PASSWORD_MIN_CUSTOMER)
      e.password = `كلمة المرور ${PASSWORD_MIN_CUSTOMER} أحرف على الأقل`;
    if (!form.university_name.trim()) e.university_name = "اسم الجامعة مطلوب";
    if (!form.department.trim()) e.department = "القسم / التخصص مطلوب";
    if (!form.study_type) e.study_type = "الدراسة الصباحية أو المسائية مطلوبة";
    if (!form.instagram_username.trim()) e.instagram_username = "يوزر الانستا مطلوب";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!validate()) return;
    setLoading(true);
    try {
      const created = await apiRegister({
        name: form.name.trim(),
        phone: form.phone.trim(),
        password: form.password,
        gender: form.gender || undefined,
        university_name: form.university_name.trim(),
        department: form.department.trim(),
        study_type: form.study_type as "morning" | "evening",
        instagram_username: form.instagram_username.trim().replace(/^@+/, ""),
      });
      setChallengeId(created.challenge_id);
      toast.success("تم إرسال رمز التحقق عبر واتساب");
      setStep("otp");
    } catch (err) {
      // The backend names the field that failed (رقم مستخدم، كلمة مرور قصيرة، …). Pin the
      // message under that input so the student can see what to fix instead of a blanket
      // «تعذّر إنشاء الحساب».
      const message = getApiErrorMessage(err, "تعذّر إنشاء الحساب");
      const field = err instanceof FieldError ? err.field : undefined;
      if (field) setErrors((prev) => ({ ...prev, [field]: message }));
      // Named field → it already renders under that input. Unnamed → one inline alert by
      // the submit button. Either way it stays on screen until the student fixes it.
      else setFormError(message);
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(code: string) {
    // verifyRegistrationOtp already throws Error with Arabic message on failure;
    // OtpVerifyForm catches it, shows it, clears digits, refocuses.
    const { token } = await verifyRegistrationOtp(challengeId, code);
    setToken(token);
    const user = await fetchMe();
    setUser(user);
    toast.success(`مرحباً ${user.name} 🎉`);
    router.replace(ROLE_REDIRECT[user.role]);
  }

  return (
    <AuthCard
      title={step === "form" ? "إنشاء حساب" : "رمز التحقق"}
      subtitle={step === "form" ? "بياناتك تُستخدم لتجهيز وشاحك وتسليمه" : undefined}
    >
      {step === "form" ? (
        <form onSubmit={handleRegister} className="flex w-full flex-1 flex-col">
          <div className="space-y-4">
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
                  "min-h-12 min-w-0 flex-1 rounded-xl border bg-beige px-3.5 py-2.5 text-base text-ink shadow-[var(--shadow-soft)] outline-none transition-colors placeholder:text-ink/55",
                  "focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20",
                  errors.phone ? "border-danger" : "border-line",
                ].join(" ")}
              />
            </div>
            {errors.phone && (
              <p id="reg-phone-error" className="text-sm font-medium text-danger" role="alert">
                {errors.phone}
              </p>
            )}
          </div>

          <Input
            label="كلمة المرور"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            error={errors.password}
            autoComplete="new-password"
          />
          <Input
            label="الجامعة"
            value={form.university_name}
            onChange={(e) =>
              setForm({ ...form, university_name: e.target.value })
            }
            error={errors.university_name}
          />
          <Input
            label="القسم / التخصص"
            value={form.department}
            onChange={(e) => setForm({ ...form, department: e.target.value })}
            error={errors.department}
          />

          {/* Study schedule — required pill toggles */}
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">الدراسة</span>
            <div className="flex gap-3">
              {(Object.entries(STUDY_TYPE_LABELS) as [("morning" | "evening"), string][]).map(([value, label]) => (
                <label key={value} className="flex-1">
                  <input
                    type="radio"
                    name="study_type"
                    value={value}
                    checked={form.study_type === value}
                    onChange={() => setForm({ ...form, study_type: value })}
                    className="peer sr-only"
                  />
                  <span className="block cursor-pointer rounded-xl border border-line bg-beige py-3 text-center text-sm peer-checked:border-orange-ink peer-checked:bg-orange-ink/10 peer-checked:font-semibold peer-checked:text-orange-ink">
                    {label}
                  </span>
                </label>
              ))}
            </div>
            {errors.study_type && (
              <p className="text-sm font-medium text-danger" role="alert">{errors.study_type}</p>
            )}
          </div>

          {/* Instagram username — strip leading @ on submit */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="reg-instagram" className="text-sm font-medium text-ink">
              يوزر الانستا
            </label>
            <div className="flex items-stretch gap-0" dir="ltr">
              <span className="inline-flex select-none items-center rounded-s-xl border border-e-0 border-line bg-beige px-3 text-sm font-semibold text-ink">
                @
              </span>
              <input
                id="reg-instagram"
                type="text"
                inputMode="text"
                autoComplete="username"
                value={form.instagram_username}
                onChange={(e) =>
                  setForm({ ...form, instagram_username: e.target.value.replace(/^@+/, "") })
                }
                placeholder="username"
                aria-invalid={!!errors.instagram_username}
                aria-describedby={errors.instagram_username ? "reg-instagram-error" : undefined}
                className={[
                  "min-h-12 min-w-0 flex-1 rounded-e-xl border bg-beige px-3.5 py-2.5 text-base text-ink shadow-[var(--shadow-soft)] outline-none transition-colors placeholder:text-ink/55",
                  "focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20",
                  errors.instagram_username ? "border-danger" : "border-line",
                ].join(" ")}
              />
            </div>
            {errors.instagram_username && (
              <p id="reg-instagram-error" className="text-sm font-medium text-danger" role="alert">
                {errors.instagram_username}
              </p>
            )}
          </div>

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
          </div>

          {/* Primary action anchored at the bottom of the column. */}
          <div className="mt-auto space-y-4 pt-8">
            {formError && (
              <p
                role="alert"
                className="rounded-xl border border-danger/25 bg-danger/5 px-3.5 py-2.5 text-sm font-medium text-danger"
              >
                {formError}
              </p>
            )}
            <Button type="submit" size="lg" fullWidth loading={loading}>
              إنشاء الحساب
            </Button>
            <p className="text-center text-sm text-ink-soft">
              لديك حساب؟{" "}
              <Link
                href="/login"
                className="inline-flex min-h-11 items-center px-1 font-medium text-orange-ink underline-offset-4 hover:underline"
              >
                تسجيل الدخول
              </Link>
            </p>
          </div>
        </form>
      ) : (
        <OtpVerifyForm
          phone={form.phone}
          onVerify={verifyOtp}
          onResend={async () => setChallengeId(await resendVerifyOtp(challengeId))}
          onBack={() => setStep("form")}
          submitLabel="تأكيد ودخول"
          backLabel="← رجوع"
        />
      )}
    </AuthCard>
  );
}
