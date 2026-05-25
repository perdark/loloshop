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
  const [loading, setLoading] = useState(false);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  function handleDigitChange(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    if (digit && index < 5) {
      inputsRef.current[index + 1]?.focus();
    }
  }

  function handleKeyDown(index: number, key: string) {
    if (key === "Backspace" && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = digits.join("");
    if (!phone.trim()) {
      toast.error("أدخل رقم الهاتف");
      return;
    }
    if (code.length !== 6) {
      toast.error("أدخل الرمز المكوّن من ٦ أرقام");
      return;
    }

    setLoading(true);
    try {
      await verifyOtp(phone.trim(), code);
      toast.success("تم التحقق بنجاح");
      router.replace("/login");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "رمز غير صحيح"));
    } finally {
      setLoading(false);
    }
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
          <p className="mb-2 text-sm font-medium text-ink">رمز التحقق</p>
          <div className="flex justify-center gap-2" dir="ltr">
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
                onChange={(e) => handleDigitChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e.key)}
                className="h-12 w-10 rounded-lg border border-ink/15 text-center text-lg font-bold text-ink outline-none focus:border-orange focus:ring-2 focus:ring-orange/20"
                aria-label={`رقم ${i + 1}`}
              />
            ))}
          </div>
        </div>
        <Button type="submit" fullWidth loading={loading}>
          تحقق
        </Button>
        <p className="text-center text-sm">
          <Link href="/login" className="text-orange hover:underline">
            العودة لتسجيل الدخول
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
