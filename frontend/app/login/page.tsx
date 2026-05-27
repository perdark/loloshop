"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AuthCard } from "@/components/auth/AuthCard";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { login, getApiErrorMessage } from "@/lib/auth-api";
import { setToken, setUser } from "@/lib/auth";
import type { UserRole } from "@/lib/types";

const ROLE_REDIRECT: Record<UserRole, string> = {
  admin: "/admin",
  staff: "/staff",
  wholesaler: "/wholesaler",
  retail: "/",
};

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const eMap: Record<string, string> = {};
    if (!phone.trim()) eMap.phone = "رقم الهاتف مطلوب";
    if (!password) eMap.password = "كلمة المرور مطلوبة";
    setErrors(eMap);
    if (Object.keys(eMap).length > 0) return;

    setLoading(true);
    try {
      const { token, user } = await login(phone.trim(), password);
      setToken(token);
      setUser(user);
      toast.success(`مرحباً ${user.name}`);
      router.replace(ROLE_REDIRECT[user.role]);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "بيانات الدخول غير صحيحة"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard title="تسجيل الدخول">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="رقم الهاتف"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={errors.phone}
          autoComplete="tel"
        />
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
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-orange px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-light disabled:opacity-50"
        >
          {loading && (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink border-t-transparent" />
          )}
          دخول
        </button>
        <div className="flex items-center justify-between text-sm">
          <Link href="/forgot-password" className="text-orange-ink hover:underline">
            نسيت كلمة المرور؟
          </Link>
          <Link href="/register" className="text-ink/70 hover:underline">
            إنشاء حساب
          </Link>
        </div>
      </form>
    </AuthCard>
  );
}
