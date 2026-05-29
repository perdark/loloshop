"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AuthCard } from "@/components/auth/AuthCard";
import { Input } from "@/components/ui/Input";
import { login, loginVerifyOtp, resendLoginOtp, getApiErrorMessage } from "@/lib/auth-api";
import { setToken, setUser } from "@/lib/auth";
import type { UserRole } from "@/lib/types";

const ROLE_REDIRECT: Record<UserRole, string> = {
  admin: "/admin",
  staff: "/staff",
  wholesaler: "/wholesaler",
  retail: "/",
};

const RESEND_COOLDOWN = 60;

export default function LoginPage() {
  const router = useRouter();

  // step: "credentials" | "otp"
  const [step, setStep] = useState<"credentials" | "otp">("credentials");

  // credentials step
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  // otp step
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [otpError, setOtpError] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);
  const [countdown, setCountdown] = useState(RESEND_COOLDOWN);
  const [resending, setResending] = useState(false);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // countdown timer — starts when OTP step mounts
  useEffect(() => {
    if (step !== "otp") return;
    // Reset and start interval; no synchronous setState needed since countdown
    // is reset in the handler that sets step="otp".
    timerRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(timerRef.current!);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current!);
  }, [step]);

  // focus first OTP input when step switches
  useEffect(() => {
    if (step === "otp") {
      setTimeout(() => inputsRef.current[0]?.focus(), 420);
    }
  }, [step]);

  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault();
    const eMap: Record<string, string> = {};
    if (!phone.trim()) eMap.phone = "رقم الهاتف مطلوب";
    if (!password) eMap.password = "كلمة المرور مطلوبة";
    setErrors(eMap);
    if (Object.keys(eMap).length > 0) return;

    setLoading(true);
    try {
      await login(phone.trim(), password);
      setCountdown(RESEND_COOLDOWN);
      setStep("otp");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "بيانات الدخول غير صحيحة"));
    } finally {
      setLoading(false);
    }
  }

  function handleDigitChange(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    if (digit && index < 5) {
      inputsRef.current[index + 1]?.focus();
    }
    // auto-submit when all filled
    if (digit && index === 5) {
      const code = [...next].join("");
      if (code.length === 6) submitOtp(code);
    }
  }

  function handleDigitPaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!text) return;
    e.preventDefault();
    const next = Array(6).fill("").map((_, i) => text[i] ?? "");
    setDigits(next);
    const lastFilled = Math.min(text.length, 5);
    inputsRef.current[lastFilled]?.focus();
    if (text.length === 6) submitOtp(text);
  }

  function handleKeyDown(index: number, key: string) {
    if (key === "Backspace" && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  }

  async function submitOtp(code: string) {
    setOtpLoading(true);
    setOtpError("");
    try {
      const { token, user } = await loginVerifyOtp(phone.trim(), code);
      setToken(token);
      setUser(user);
      toast.success(`مرحباً ${user.name} 🎉`);
      router.replace(ROLE_REDIRECT[user.role]);
    } catch (err) {
      const msg = getApiErrorMessage(err, "رمز غير صحيح");
      setOtpError(msg);
      toast.error(msg);
      // clear digits on error
      setDigits(["", "", "", "", "", ""]);
      setTimeout(() => inputsRef.current[0]?.focus(), 50);
    } finally {
      setOtpLoading(false);
    }
  }

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = digits.join("");
    if (code.length !== 6) {
      toast.error("أدخل الرمز المكوّن من ٦ أرقام");
      return;
    }
    await submitOtp(code);
  }

  async function handleResend() {
    if (countdown > 0 || resending) return;
    setResending(true);
    try {
      await resendLoginOtp(phone.trim());
      clearInterval(timerRef.current!);
      setCountdown(RESEND_COOLDOWN);
      timerRef.current = setInterval(() => {
        setCountdown((c) => {
          if (c <= 1) { clearInterval(timerRef.current!); return 0; }
          return c - 1;
        });
      }, 1000);
      setDigits(["", "", "", "", "", ""]);
      setOtpError("");
      setTimeout(() => inputsRef.current[0]?.focus(), 50);
      toast.success("تم إرسال رمز جديد");
    } catch {
      toast.error("تعذّر إرسال الرمز، حاول لاحقاً");
    } finally {
      setResending(false);
    }
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
                    errors.phone ? "border-red-500" : "border-ink/15",
                  ].join(" ")}
                />
              </div>
              {errors.phone && <p id="phone-error" className="text-xs text-red-600" role="alert">{errors.phone}</p>}
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
          <form onSubmit={handleOtpSubmit} className="space-y-5">
            {/* WhatsApp hint — a quiet paper inset, the copy names the channel */}
            <div className="rounded-[12px] border border-ink/10 bg-cream px-4 py-3.5 text-center text-sm text-ink-soft">
              <p>أُرسل رمز التحقق عبر واتساب إلى</p>
              <p className="mt-1 font-bold tracking-widest text-ink" dir="ltr">+964 {phone}</p>
            </div>

            {/* OTP digit boxes */}
            <div>
              <p className="mb-3 text-center text-sm font-medium text-ink-soft">أدخل الرمز المكوّن من ٦ أرقام</p>
              <div
                className="flex justify-center gap-2"
                dir="ltr"
                onPaste={handleDigitPaste}
              >
                {digits.map((d, i) => (
                  <input
                    key={i}
                    ref={(el) => { inputsRef.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={d}
                    disabled={otpLoading}
                    onChange={(e) => handleDigitChange(i, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(i, e.key)}
                    aria-label={`رقم ${i + 1}`}
                    aria-describedby={otpError ? "otp-error" : undefined}
                    aria-invalid={!!otpError || undefined}
                    className={[
                      "h-12 w-10 rounded-md border text-center text-xl font-bold text-ink outline-none transition-colors duration-150",
                      "focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20",
                      otpError ? "border-red-400 bg-red-50" : d ? "border-orange-ink bg-orange-ink/5" : "border-ink/15 bg-beige",
                      otpLoading ? "opacity-50" : "",
                    ].join(" ")}
                  />
                ))}
              </div>
              {otpError && (
                <p id="otp-error" role="alert" className="mt-2 text-center text-xs text-red-600">
                  {otpError}
                </p>
              )}
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={otpLoading || digits.join("").length < 6}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-pill bg-orange-ink px-4 text-sm font-semibold text-white transition-[background-color,transform] duration-200 ease-out hover:bg-ink active:translate-y-px disabled:opacity-50 disabled:hover:bg-orange-ink"
            >
              {otpLoading ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>جارٍ التحقق…</span>
                </>
              ) : (
                "تحقق ودخول"
              )}
            </button>

            {/* Resend + back */}
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => { setStep("credentials"); setDigits(["", "", "", "", "", ""]); }}
                className="text-ink-soft transition-colors hover:text-ink"
              >
                ← تغيير الرقم
              </button>
              <button
                type="button"
                onClick={handleResend}
                disabled={countdown > 0 || resending}
                className="font-medium text-orange-ink transition-colors hover:text-ink disabled:cursor-not-allowed disabled:text-ink/40"
              >
                {resending
                  ? "جارٍ الإرسال…"
                  : countdown > 0
                  ? `إعادة الإرسال (${countdown})`
                  : "إعادة إرسال الرمز"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </AuthCard>
  );
}
