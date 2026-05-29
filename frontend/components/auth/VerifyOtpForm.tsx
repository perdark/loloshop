"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AuthCard } from "@/components/auth/AuthCard";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { verifyOtp, getApiErrorMessage } from "@/lib/auth-api";

export function VerifyOtpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const defaultPhone = searchParams.get("phone") ?? "";

  const [phone, setPhone] = useState(defaultPhone);
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [otpError, setOtpError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  async function submitOtp(code: string) {
    if (!phone.trim()) {
      toast.error("أدخل رقم الهاتف");
      return;
    }
    setLoading(true);
    setOtpError("");
    try {
      await verifyOtp(phone.trim(), code);
      toast.success("تم التحقق بنجاح");
      router.replace("/login");
    } catch (err) {
      const msg = getApiErrorMessage(err, "رمز غير صحيح");
      setOtpError(msg);
      toast.error(msg);
      setDigits(["", "", "", "", "", ""]);
      setTimeout(() => inputsRef.current[0]?.focus(), 50);
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
    // auto-submit when 6th digit is filled
    if (digit && index === 5) {
      const code = next.join("");
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = digits.join("");
    if (code.length !== 6) {
      toast.error("أدخل الرمز المكوّن من ٦ أرقام");
      return;
    }
    await submitOtp(code);
  }

  return (
    <AuthCard title="التحقق من الرمز" subtitle="أدخل رمز واتساب">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="رقم الهاتف"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="tel"
        />
        <div>
          <p className="mb-3 text-center text-sm font-medium text-ink-soft">رمز التحقق المكوّن من ٦ أرقام</p>
          <div className="flex justify-center gap-2" dir="ltr" onPaste={handleDigitPaste}>
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => {
                  inputsRef.current[i] = el;
                }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={d}
                disabled={loading}
                onChange={(e) => handleDigitChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e.key)}
                aria-label={`رقم ${i + 1}`}
                aria-describedby={otpError ? "verify-otp-error" : undefined}
                aria-invalid={!!otpError || undefined}
                className={[
                  "h-12 w-10 rounded-xl border text-center text-xl font-bold text-ink outline-none transition-colors duration-150",
                  "focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20",
                  otpError ? "border-danger bg-danger/5" : d ? "border-orange-ink bg-orange-ink/5" : "border-ink/20 bg-beige",
                  loading ? "opacity-50" : "",
                ].join(" ")}
              />
            ))}
          </div>
          {otpError && (
            <p id="verify-otp-error" role="alert" className="mt-2 text-center text-xs text-danger">
              {otpError}
            </p>
          )}
        </div>
        <Button type="submit" fullWidth loading={loading}>
          تحقق
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
