"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AuthCard } from "@/components/auth/AuthCard";
import { Input } from "@/components/ui/Input";
import { OtpVerifyForm } from "@/components/auth/OtpVerifyForm";
import { login, loginVerifyOtp, resendLoginOtp, getApiErrorMessage } from "@/lib/auth-api";
import { setToken, setUser, safeRedirectTarget } from "@/lib/auth";
import type { User, UserRole } from "@/lib/types";

const ROLE_REDIRECT: Record<UserRole, string> = {
  admin: "/admin",
  staff: "/staff",
  wholesaler: "/wholesaler",
  retail: "/",
  worker: "/workshop",
  design_helper: "/design-support",
};

export default function LoginPage() {
  const router = useRouter();

  // step: "credentials" | "otp"
  const [step, setStep] = useState<"credentials" | "otp">("credentials");

  // credentials step
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  function finishLogin(token: string, user: User) {
    setToken(token);
    setUser(user);
    toast.success(`مرحباً ${user.name} 🎉`);
    const redirect =
      typeof window !== "undefined"
        ? safeRedirectTarget(new URLSearchParams(window.location.search).get("redirect"))
        : null;
    router.replace(
      redirect && user.role === "retail" ? redirect : ROLE_REDIRECT[user.role]
    );
  }

  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault();
    const eMap: Record<string, string> = {};
    if (!phone.trim()) eMap.phone = "رقم الهاتف مطلوب";
    if (!password) eMap.password = "كلمة المرور مطلوبة";
    setErrors(eMap);
    if (Object.keys(eMap).length > 0) return;

    setLoading(true);
    try {
      const res = await login(phone.trim(), password);
      // Trusted device → backend skipped the OTP and logged us straight in.
      if ("token" in res) {
        finishLogin(res.token, res.user);
        return;
      }
      setStep("otp");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "بيانات الدخول غير صحيحة"));
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(code: string) {
    // loginVerifyOtp already throws Error with Arabic message on failure;
    // OtpVerifyForm catches it, shows it, clears digits, refocuses. It also stores the
    // returned device_token so this device skips the OTP next time.
    const { token, user } = await loginVerifyOtp(phone.trim(), code);
    finishLogin(token, user);
  }

  return (
    <AuthCard title={step === "credentials" ? "تسجيل الدخول" : "رمز التحقق"}>
      <div className="relative overflow-hidden">
        {/* Step 1 — credentials */}
        <div
          className="ease-in-out"
          style={{
            transition: "transform 350ms ease-in-out, opacity 350ms ease-in-out",
            transform: step === "otp" ? "translateX(120%)" : "translateX(0)",
            opacity: step === "otp" ? 0 : 1,
            position: step === "otp" ? "absolute" : "relative",
            width: "100%",
            pointerEvents: step === "otp" ? "none" : "auto",
          }}
        >
          <form onSubmit={handleCredentials} className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="phone-v2" className="text-sm font-medium text-ink">رقم الهاتف</label>
              <div className="flex items-stretch gap-2" dir="ltr">
                <span
                  id="phone-country"
                  aria-label="رمز الدولة العراق"
                  className="inline-flex select-none items-center rounded-xl border border-ink/15 bg-beige px-3 text-sm font-semibold text-ink"
                >+964</span>
                <input
                  id="phone-v2"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                  placeholder="7XX XXX XXXX"
                  aria-invalid={!!errors.phone}
                  aria-describedby={`phone-country${errors.phone ? " phone-error" : ""}`}
                  className={[
                    "min-h-11 min-w-0 flex-1 rounded-xl border bg-white px-3.5 py-2.5 text-ink outline-none transition-colors placeholder:text-ink/55",
                    "focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20",
                    errors.phone ? "border-danger" : "border-ink/15",
                  ].join(" ")}
                />
              </div>
              {errors.phone && <p id="phone-error" className="text-xs text-danger" role="alert">{errors.phone}</p>}
            </div>
            <Input
              label="كلمة المرور"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={errors.password}
              autoComplete="current-password"
            />
            <button
              type="submit"
              disabled={loading}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-pill bg-orange-ink px-4 text-sm font-semibold text-white transition-[background-color,transform] duration-200 ease-out hover:bg-ink active:translate-y-px disabled:opacity-50 disabled:hover:bg-orange-ink"
            >
              {loading ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>جارٍ التحقق…</span>
                </>
              ) : (
                "دخول"
              )}
            </button>
            <p className="text-center text-sm">
              <Link href="/forgot-password" className="font-medium text-orange-ink underline-offset-2 hover:underline">
                نسيت كلمة المرور؟
              </Link>
            </p>
            <p className="text-center text-sm text-ink-soft">
              ليس لديك حساب؟{" "}
              <Link href="/register" className="font-medium text-orange-ink underline-offset-2 hover:underline">
                أنشئ حساباً
              </Link>
            </p>
          </form>
        </div>

        {/* Step 2 — OTP */}
        <div
          className="ease-in-out"
          style={{
            transition: "transform 350ms ease-in-out, opacity 350ms ease-in-out",
            transform: step === "otp" ? "translateX(0)" : "translateX(-120%)",
            opacity: step === "otp" ? 1 : 0,
            position: step === "credentials" ? "absolute" : "relative",
            width: "100%",
            pointerEvents: step === "credentials" ? "none" : "auto",
          }}
        >
          {step === "otp" && (
            <OtpVerifyForm
              phone={phone}
              onVerify={verifyOtp}
              onResend={() => resendLoginOtp(phone.trim())}
              onBack={() => setStep("credentials")}
              submitLabel="تحقق ودخول"
              backLabel="← تغيير الرقم"
            />
          )}
        </div>
      </div>
    </AuthCard>
  );
}
