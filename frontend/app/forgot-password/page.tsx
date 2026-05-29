"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AuthCard } from "@/components/auth/AuthCard";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  forgotPassword,
  forgotPasswordByPhone,
  resetPasswordByPhone,
  getApiErrorMessage,
} from "@/lib/auth-api";

type Mode = "email" | "phone";
// phone reset has two steps: request the OTP, then enter code + new password.
type PhoneStep = "request" | "verify";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("phone");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [emailError, setEmailError] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [phoneStep, setPhoneStep] = useState<PhoneStep>("request");
  const [sent, setSent] = useState(false); // email success screen
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (mode === "phone") {
      // Step 1: request the OTP.
      if (phoneStep === "request") {
        if (!phone.trim()) {
          setPhoneError("رقم الهاتف مطلوب");
          return;
        }
        setPhoneError("");
        setLoading(true);
        try {
          await forgotPasswordByPhone(phone.trim());
          setPhoneStep("verify");
          toast.success("إذا كان الرقم مسجّلاً، ستصلك رسالة واتساب بالرمز");
        } catch (err) {
          toast.error(getApiErrorMessage(err, "تعذّر إرسال الرمز"));
        } finally {
          setLoading(false);
        }
        return;
      }

      // Step 2: verify OTP + set the new password.
      if (code.trim().length < 6) {
        setPhoneError("أدخل الرمز المكوّن من 6 أرقام");
        return;
      }
      if (newPassword.length < 6) {
        setPhoneError("كلمة المرور يجب أن تكون 6 أحرف على الأقل");
        return;
      }
      setPhoneError("");
      setLoading(true);
      try {
        await resetPasswordByPhone(phone.trim(), code.trim(), newPassword);
        toast.success("تم تعيين كلمة المرور، سجّل الدخول الآن");
        router.push("/login");
      } catch (err) {
        toast.error(getApiErrorMessage(err, "تعذّر إعادة التعيين"));
      } finally {
        setLoading(false);
      }
      return;
    }

    // email mode
    if (!email.trim()) {
      setEmailError("البريد الإلكتروني مطلوب");
      return;
    }
    setEmailError("");
    setLoading(true);
    try {
      await forgotPassword(email.trim());
      setSent(true);
      toast.success("تحقق من بريدك الإلكتروني");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر إرسال الرابط"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard title="استعادة كلمة المرور">
      {sent ? (
        <div className="text-center">
          {/* Envelope icon — line SVG in palette colours, no emoji */}
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-ink/12 bg-[var(--shop-sink)] text-orange-ink shadow-[var(--shadow-soft)]">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.5} stroke="currentColor" className="h-8 w-8" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25H4.5a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0l-9.75 6.75L2.25 6.75" />
            </svg>
          </div>
          <p className="text-ink-soft">
            إذا كان البريد مسجّلاً لدينا، ستصلك رسالة برابط إعادة التعيين.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-block text-sm font-medium text-orange-ink hover:underline"
          >
            العودة لتسجيل الدخول
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Mode toggle — hidden once the phone OTP has been requested */}
          {phoneStep === "request" && (
            <div
              className="flex overflow-hidden rounded-xl border border-ink/15 bg-beige text-sm font-medium"
              role="group"
              aria-label="طريقة الاسترداد"
            >
              <button
                type="button"
                onClick={() => { setMode("phone"); setEmailError(""); }}
                className={[
                  "flex-1 min-h-11 transition-colors",
                  mode === "phone" ? "bg-orange-ink text-white" : "text-ink/60 hover:text-ink",
                ].join(" ")}
              >
                رقم الهاتف
              </button>
              <button
                type="button"
                onClick={() => { setMode("email"); setPhoneError(""); }}
                className={[
                  "flex-1 min-h-11 transition-colors",
                  mode === "email" ? "bg-orange-ink text-white" : "text-ink/60 hover:text-ink",
                ].join(" ")}
              >
                البريد الإلكتروني
              </button>
            </div>
          )}

          {mode === "phone" ? (
            phoneStep === "request" ? (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="fp-phone" className="text-sm font-medium text-ink">رقم الهاتف</label>
                <div className="flex items-stretch gap-2" dir="ltr">
                  <span
                    id="fp-phone-country"
                    aria-label="رمز الدولة العراق"
                    className="inline-flex select-none items-center rounded-xl border border-ink/15 bg-beige px-3 text-sm font-semibold text-ink"
                  >+964</span>
                  <input
                    id="fp-phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                    placeholder="7XX XXX XXXX"
                    aria-invalid={!!phoneError}
                    aria-describedby={`fp-phone-country${phoneError ? " fp-phone-error" : ""}`}
                    className={[
                      "min-h-11 min-w-0 flex-1 rounded-xl border bg-white px-3.5 py-2.5 text-ink outline-none transition-colors placeholder:text-ink/55",
                      "focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20",
                      phoneError ? "border-danger" : "border-ink/15",
                    ].join(" ")}
                  />
                </div>
                {phoneError && <p id="fp-phone-error" className="text-xs text-danger" role="alert">{phoneError}</p>}
                <p className="text-xs text-[var(--shop-muted)]">سيصلك رمز عبر واتساب لإعادة التعيين</p>
              </div>
            ) : (
              <>
                <p className="text-sm text-ink-soft">
                  أدخل الرمز الذي وصلك عبر واتساب على الرقم{" "}
                  <span dir="ltr" className="font-semibold text-ink">+964{phone}</span> وكلمة المرور الجديدة.
                </p>
                <Input
                  label="رمز التحقق"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  dir="ltr"
                />
                <Input
                  label="كلمة المرور الجديدة"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                {phoneError && <p className="text-xs text-danger" role="alert">{phoneError}</p>}
                <button
                  type="button"
                  onClick={() => { setPhoneStep("request"); setCode(""); setNewPassword(""); setPhoneError(""); }}
                  className="text-xs font-medium text-orange-ink hover:underline"
                >
                  تغيير الرقم
                </button>
              </>
            )
          ) : (
            <Input
              label="البريد الإلكتروني"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={emailError}
              autoComplete="email"
            />
          )}

          <Button type="submit" fullWidth loading={loading}>
            {mode === "email"
              ? "إرسال الرابط"
              : phoneStep === "request"
                ? "إرسال الرمز"
                : "تعيين كلمة المرور"}
          </Button>
          <p className="text-center text-sm">
            <Link href="/login" className="text-orange-ink hover:underline">
              العودة لتسجيل الدخول
            </Link>
          </p>
        </form>
      )}
    </AuthCard>
  );
}
