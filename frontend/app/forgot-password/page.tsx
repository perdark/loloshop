"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AuthCard } from "@/components/auth/AuthCard";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  forgotPasswordByPhone,
  resetPasswordByPhone,
  getApiErrorMessage,
} from "@/lib/auth-api";
import { PASSWORD_MIN_CUSTOMER } from "@/lib/constants";

// Email recovery was removed (2026-07-19): SMTP was never configured in production so the
// flow was already dead, and it carried a reset-token endpoint plus the nodemailer
// dependency for nothing. WhatsApp OTP is the only self-service path now — and it covers
// retail + wholesaler only. Privileged accounts are reset by an admin from the staff /
// workshop / design screens, or on the server with `npm run set-password`.
//
// Two steps: request the OTP, then enter code + new password.
type PhoneStep = "request" | "verify";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [phoneError, setPhoneError] = useState("");
  // Guidance, not a failure — kept separate from phoneError so it never renders red or
  // marks the input invalid. See the ERR_OTP_UNAVAILABLE branch in handleSubmit.
  const [notice, setNotice] = useState("");
  const [phoneStep, setPhoneStep] = useState<PhoneStep>("request");
  // Reset OTP challenge. Returned for ANY number (a decoy when the phone isn't
  // registered), so this never reveals whether an account exists.
  const [challengeId, setChallengeId] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Step 1 — request the OTP.
    if (phoneStep === "request") {
      if (!phone.trim()) {
        setPhoneError("رقم الهاتف مطلوب");
        return;
      }
      setPhoneError("");
      setNotice("");
      setLoading(true);
      try {
        const result = await forgotPasswordByPhone(phone.trim());
        // Self-service reset is unavailable — show it as a calm next step, not a failure.
        // No toast (it would flash and leave), no red, and we stay on this step so the
        // customer can still read it. Nothing here says why.
        if ("supportRequired" in result) {
          setNotice(result.message);
          return;
        }
        setChallengeId(result.challengeId);
        setPhoneStep("verify");
        toast.success("إذا كان الرقم مسجّلاً، ستصلك رسالة واتساب بالرمز");
      } catch (err) {
        // Inline, under the phone field it belongs to — the toast put the only failure
        // message on the screen somewhere the eye isn't, then took it away again.
        setPhoneError(getApiErrorMessage(err, "تعذّر إرسال الرمز"));
      } finally {
        setLoading(false);
      }
      return;
    }

    // Step 2 — verify the OTP and set the new password.
    if (code.trim().length < 6) {
      setPhoneError("أدخل الرمز المكوّن من 6 أرقام");
      return;
    }
    if (newPassword.length < PASSWORD_MIN_CUSTOMER) {
      setPhoneError(`كلمة المرور يجب أن تكون ${PASSWORD_MIN_CUSTOMER} أحرف على الأقل`);
      return;
    }
    setPhoneError("");
    setLoading(true);
    try {
      await resetPasswordByPhone(challengeId, code.trim(), newPassword);
      toast.success("تم تعيين كلمة المرور، سجّل الدخول الآن");
      router.push("/login");
    } catch (err) {
      setPhoneError(getApiErrorMessage(err, "تعذّر إعادة التعيين"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard
      title="استعادة كلمة المرور"
      subtitle={
        phoneStep === "request"
          ? "نرسل لك رمزاً على واتساب لتعيين كلمة مرور جديدة"
          : undefined
      }
    >
      <form onSubmit={handleSubmit} className="flex w-full flex-1 flex-col">
        <div className="space-y-4">
        {phoneStep === "request" ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="fp-phone" className="text-sm font-medium text-ink">
              رقم الهاتف
            </label>
            <div className="flex items-stretch gap-2" dir="ltr">
              <span
                id="fp-phone-country"
                aria-label="رمز الدولة العراق"
                className="inline-flex select-none items-center rounded-xl border border-line bg-beige px-3 text-sm font-semibold text-ink"
              >
                +964
              </span>
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
                  "min-h-12 min-w-0 flex-1 rounded-xl border bg-beige px-3.5 py-2.5 text-base text-ink shadow-[var(--shadow-soft)] outline-none transition-colors placeholder:text-ink/55",
                  "focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20",
                  phoneError ? "border-danger" : "border-line",
                ].join(" ")}
              />
            </div>
            {phoneError && (
              <p id="fp-phone-error" className="text-sm font-medium text-danger" role="alert">
                {phoneError}
              </p>
            )}
            {notice ? (
              // Neutral card, not text-danger and not role="alert" — this is a next step,
              // not something the customer did wrong. It also replaces the «سيصلك رمز عبر
              // واتساب» hint below, which would otherwise promise a message that isn't coming.
              <p
                className="rounded-xl border border-line bg-beige px-3.5 py-3 text-sm font-medium leading-relaxed text-ink"
                role="status"
              >
                {notice}
              </p>
            ) : (
              <p className="text-xs text-[var(--shop-muted)]">
                سيصلك رمز عبر واتساب لإعادة التعيين
              </p>
            )}
          </div>
        ) : (
          <>
            <p className="text-sm text-ink-soft">
              أدخل الرمز الذي وصلك عبر واتساب على الرقم{" "}
              <span dir="ltr" className="font-semibold text-ink">
                +964{phone}
              </span>{" "}
              وكلمة المرور الجديدة.
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
            {phoneError && (
              <p className="text-sm font-medium text-danger" role="alert">
                {phoneError}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                setPhoneStep("request");
                setCode("");
                setNewPassword("");
                setPhoneError("");
              }}
              className="inline-flex min-h-11 items-center text-sm font-medium text-orange-ink underline-offset-4 hover:underline"
            >
              تغيير الرقم
            </button>
          </>
        )}
        </div>

        {/* Primary action anchored at the bottom of the column. */}
        <div className="mt-auto space-y-4 pt-8">
          <Button type="submit" size="lg" fullWidth loading={loading}>
            {phoneStep === "request" ? "إرسال الرمز" : "تعيين كلمة المرور"}
          </Button>
          <p className="text-center text-sm">
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center px-1 font-medium text-orange-ink underline-offset-4 hover:underline"
            >
              العودة لتسجيل الدخول
            </Link>
          </p>
        </div>
      </form>
    </AuthCard>
  );
}
