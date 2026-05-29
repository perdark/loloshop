"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  register as apiRegister,
  verifyRegistrationOtp,
  resendVerifyOtp,
  fetchMe,
} from "@/lib/auth-api";
import { setToken, setSession } from "@/lib/auth";
import { getDashboardPath } from "@/lib/roles";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { toast } from "sonner";

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<"form" | "otp">("form");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    password: "",
    university_name: "",
    department: "",
    gender: "" as "" | "male" | "female",
  });

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await apiRegister({
        name: form.name.trim(),
        phone: form.phone.trim(),
        password: form.password,
        email: form.email.trim() || undefined,
        gender: form.gender || undefined,
        university_name: form.university_name.trim() || undefined,
        department: form.department.trim() || undefined,
      });
      toast.success("تم إرسال رمز التحقق إلى واتساب");
      setStep("otp");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "خطأ");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { token } = await verifyRegistrationOtp(form.phone.trim(), code);
      setToken(token);
      const user = await fetchMe();
      setSession(token, user);
      toast.success("تم إنشاء حسابك، مرحباً بك");
      router.push(getDashboardPath(user.role));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "خطأ");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      dir="rtl"
      className="flex min-h-screen items-center justify-center bg-cream px-4 py-10"
    >
      <Card className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="font-display text-2xl font-bold text-ink">
            {step === "form" ? "إنشاء حساب" : "تأكيد الرمز"}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            {step === "form"
              ? "سجّل لتصمّم وشاحك وتتابع طلباتك"
              : "أدخل الرمز المرسل إلى واتساب"}
          </p>
        </div>

        {step === "form" ? (
          <form onSubmit={handleRegister} className="space-y-4">
            <Input
              placeholder="الاسم الكامل"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <Input
              type="tel"
              inputMode="tel"
              placeholder="رقم الهاتف"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              required
            />
            <Input
              type="email"
              placeholder="البريد الإلكتروني (اختياري)"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <Input
              type="password"
              placeholder="كلمة المرور (6 أحرف على الأقل)"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              minLength={6}
              required
            />
            <Input
              placeholder="الجامعة (اختياري)"
              value={form.university_name}
              onChange={(e) =>
                setForm({ ...form, university_name: e.target.value })
              }
            />
            <Input
              placeholder="القسم / التخصص (اختياري)"
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
            />
            <div className="flex gap-3">
              <label className="flex-1">
                <input
                  type="radio"
                  name="gender"
                  value="male"
                  checked={form.gender === "male"}
                  onChange={(e) =>
                    setForm({ ...form, gender: e.target.value as "male" })
                  }
                  className="peer sr-only"
                />
                <span className="block cursor-pointer rounded-xl border border-ink/15 bg-paper py-3 text-center text-sm peer-checked:border-orange peer-checked:bg-orange/10 peer-checked:font-semibold peer-checked:text-orange-ink">
                  ذكر
                </span>
              </label>
              <label className="flex-1">
                <input
                  type="radio"
                  name="gender"
                  value="female"
                  checked={form.gender === "female"}
                  onChange={(e) =>
                    setForm({ ...form, gender: e.target.value as "female" })
                  }
                  className="peer sr-only"
                />
                <span className="block cursor-pointer rounded-xl border border-ink/15 bg-paper py-3 text-center text-sm peer-checked:border-orange peer-checked:bg-orange/10 peer-checked:font-semibold peer-checked:text-orange-ink">
                  أنثى
                </span>
              </label>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "جارٍ..." : "إنشاء الحساب"}
            </Button>
            <Link
              href="/login"
              className="block text-center text-sm text-orange-ink underline"
            >
              لديك حساب؟ تسجيل الدخول
            </Link>
          </form>
        ) : (
          <form onSubmit={handleVerify} className="space-y-4">
            <Input
              type="text"
              inputMode="numeric"
              placeholder="رمز التحقق"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "جارٍ..." : "تأكيد"}
            </Button>
            <button
              type="button"
              onClick={async () => {
                try {
                  await resendVerifyOtp(form.phone.trim());
                  toast.success("تم الإرسال");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "خطأ");
                }
              }}
              className="w-full text-sm text-ink-soft underline"
            >
              إعادة إرسال الرمز
            </button>
          </form>
        )}
      </Card>
    </main>
  );
}
