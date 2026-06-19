"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const RESEND_COOLDOWN = 60;

interface OtpVerifyFormProps {
  phone: string;
  onVerify: (code: string) => Promise<void>;
  onResend: () => Promise<void>;
  onBack: () => void;
  submitLabel: string;
  backLabel?: string;
}

export function OtpVerifyForm({
  phone,
  onVerify,
  onResend,
  onBack,
  submitLabel,
  backLabel = "← تغيير الرقم",
}: OtpVerifyFormProps) {
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [otpError, setOtpError] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);
  const [countdown, setCountdown] = useState(RESEND_COOLDOWN);
  const [resending, setResending] = useState(false);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Start countdown on mount
  useEffect(() => {
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
  }, []);

  // Focus first box on mount
  useEffect(() => {
    setTimeout(() => inputsRef.current[0]?.focus(), 420);
  }, []);

  function handleDigitChange(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    if (digit && index < 5) {
      inputsRef.current[index + 1]?.focus();
    }
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
      await onVerify(code);
      // onVerify is expected to handle navigation; if it returns normally the
      // component stays mounted (unusual) — just clear loading.
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "رمز غير صحيح";
      setOtpError(msg);
      toast.error(msg);
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
      await onResend();
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
    <form onSubmit={handleOtpSubmit} className="space-y-5">
      {/* WhatsApp hint */}
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
                otpError ? "border-danger bg-danger/5" : d ? "border-orange-ink bg-orange-ink/5" : "border-ink/15 bg-beige",
                otpLoading ? "opacity-50" : "",
              ].join(" ")}
            />
          ))}
        </div>
        {otpError && (
          <p id="otp-error" role="alert" className="mt-2 text-center text-xs text-danger">
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
          submitLabel
        )}
      </button>

      {/* Resend + back */}
      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          onClick={onBack}
          className="text-ink-soft transition-colors hover:text-ink"
        >
          {backLabel}
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
  );
}
