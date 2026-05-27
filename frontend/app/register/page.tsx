"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AuthCard } from "@/components/auth/AuthCard";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { register, getApiErrorMessage } from "@/lib/auth-api";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const eMap: Record<string, string> = {};
    if (!name.trim()) eMap.name = "الاسم مطلوب";
    if (!phone.trim()) eMap.phone = "رقم الهاتف مطلوب";
    if (!password) eMap.password = "كلمة المرور مطلوبة";
    if (password.length < 6) eMap.password = "كلمة المرور ٦ أحرف على الأقل";
    if (password !== confirm) eMap.confirm = "كلمتا المرور غير متطابقتين";
    setErrors(eMap);
    if (Object.keys(eMap).length > 0) return;

    setLoading(true);
    try {
      await register(name.trim(), phone.trim(), password);
      toast.success("تم إنشاء الحساب — أدخل رمز واتساب لتفعيله");
      router.replace(`/verify-otp?phone=${encodeURIComponent(phone.trim())}`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر إنشاء الحساب"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard title="إنشاء حساب جديد">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="الاسم الكامل"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
          autoComplete="name"
          placeholder="محمد علي محمد"
        />
        <Input
          label="رقم الهاتف (واتساب)"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={errors.phone}
          autoComplete="tel"
          placeholder="0512345678"
          dir="ltr"
        />
        <Input
          label="كلمة المرور"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          autoComplete="new-password"
        />
        <Input
          label="تأكيد كلمة المرور"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={errors.confirm}
          autoComplete="new-password"
        />
        <Button type="submit" fullWidth loading={loading}>
          إنشاء الحساب
        </Button>
        <p className="text-center text-sm text-ink/70">
          لديك حساب؟{" "}
          <Link href="/login" className="text-orange-ink hover:underline">
            تسجيل الدخول
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
