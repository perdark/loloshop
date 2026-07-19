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
      setLoading(true);
      try {
        setChallengeId(await forgotPasswordByPhone(phone.trim()));
        setPhoneStep("verify");
        toast.success("إذا كان الرقم مسجّلاً، ستصلك رسالة واتساب بالرمز");
      } catch (err) {
        toast.error(getApiErrorMessage(err, "تعذّر إرسال الرمز"));
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
      toast.error(getApiErrorMessage(err, "تعذّر إعادة التعيين"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard title="استعادة كلمة المرور">
      <form onSubmit={handleSubmit} className="space-y-4">
        {phoneStep === "request" ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="fp-phone" className="text-sm font-medium text-ink">
              رقم الهاتف
            </label>
            <div className="flex items-stretch gap-2" dir="ltr">
              <span
                id="fp-phone-country"
                aria-label="رمز الدولة العراق"
                className="inline-flex select-none items-center rounded-xl border border-ink/15 bg-beige px-3 text-sm font-semibold text-ink"
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
                  "min-h-11 min-w-0 flex-1 rounded-xl border bg-white px-3.5 py-2.5 text-ink outline-none transition-colors placeholder:text-ink/55",
                  "focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20",
                  phoneError ? "border-danger" : "border-ink/15",
                ].join(" ")}
              />
            </div>
            {phoneError && (
              <p id="fp-phone-error" className="text-xs text-danger" role="alert">
                {phoneError}
              </p>
            )}
            <p className="text-xs text-[var(--shop-muted)]">
              سيصلك رمز عبر واتساب لإعادة التعيين
            </p>
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
              <p className="text-xs text-danger" role="alert">
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
              className="text-xs font-medium text-orange-ink hover:underline"
            >
              تغيير الرقم
            </button>
          </>
        )}

        <Button type="submit" fullWidth loading={loading}>
          {phoneStep === "request" ? "إرسال الرمز" : "تعيين كلمة المرور"}
        </Button>
        <p className="text-center text-sm">
          <Link href="/login" className="text-orange-ink hover:underline">
            العودة لتسجيل الدخول
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
