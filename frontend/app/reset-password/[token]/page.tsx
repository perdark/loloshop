"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { AuthCard } from "@/components/auth/AuthCard";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { resetPassword, getApiErrorMessage } from "@/lib/auth-api";

export default function ResetPasswordPage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const eMap: Record<string, string> = {};
    if (!password || password.length < 6)
      eMap.password = "كلمة المرور ٦ أحرف على الأقل";
    if (password !== confirm) eMap.confirm = "كلمتا المرور غير متطابقتين";
    setErrors(eMap);
    if (Object.keys(eMap).length > 0) return;

    setLoading(true);
    try {
      await resetPassword(token, password);
      toast.success("تم تحديث كلمة المرور");
      router.replace("/login");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر تحديث كلمة المرور"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard title="كلمة مرور جديدة" subtitle="اختر كلمة مرور قوية لحسابك">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="كلمة المرور الجديدة"
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
          حفظ
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
