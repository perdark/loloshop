"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AuthCard } from "@/components/auth/AuthCard";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { forgotPassword, getApiErrorMessage } from "@/lib/auth-api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      setError("البريد الإلكتروني مطلوب");
      return;
    }
    setError("");
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
          <p className="text-ink/70">
            إذا كان البريد مسجّلاً لدينا، ستصلك رسالة برابط إعادة التعيين.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-block text-sm text-orange hover:underline"
          >
            العودة لتسجيل الدخول
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="البريد الإلكتروني"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={error}
            autoComplete="email"
          />
          <Button type="submit" fullWidth loading={loading}>
            إرسال الرابط
          </Button>
          <p className="text-center text-sm">
            <Link href="/login" className="text-orange hover:underline">
              العودة لتسجيل الدخول
            </Link>
          </p>
        </form>
      )}
    </AuthCard>
  );
}
