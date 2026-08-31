"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { AuthCard } from "@/components/auth/AuthCard";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  designTeamPortalLogin,
  getDesignTeamPortalMembers,
  type DesignTeamPortalMember,
} from "@/lib/design-team";
import { setToken, setUser } from "@/lib/auth";
import { getApiErrorStatus } from "@/lib/api";

/**
 * Private entrance for «أيادي التصميم». The secret is the URL path segment;
 * the server deliberately answers with a neutral 404 for a wrong key.
 */
export default function DesignTeamPortalPage() {
  const params = useParams();
  const router = useRouter();
  const key = Array.isArray(params.key) ? params.key[0] : (params.key ?? "");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [members, setMembers] = useState<DesignTeamPortalMember[]>([]);
  const [memberId, setMemberId] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setNotFound(false);
    setLoadFailed(false);
    (async () => {
      try {
        const list = await getDesignTeamPortalMembers(key);
        if (active) setMembers(list);
      } catch (error) {
        if (!active) return;
        if (getApiErrorStatus(error) === 404) setNotFound(true);
        else setLoadFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [key, reloadKey]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!memberId) nextErrors.memberId = "اختر الاسم";
    if (!password) nextErrors.password = "كلمة المرور مطلوبة";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSubmitting(true);
    try {
      const { token, user } = await designTeamPortalLogin(key, memberId, password);
      setToken(token);
      setUser(user);
      toast.success(`مرحباً ${user.name}`);
      router.replace("/design-support");
    } catch {
      toast.error("بيانات الدخول غير صحيحة");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-cream" dir="rtl" lang="ar">
        <span className="h-7 w-7 animate-spin rounded-full border-2 border-ink/20 border-t-orange-ink" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-2 bg-cream px-6 text-center" dir="rtl" lang="ar">
        <p className="font-display text-5xl font-bold text-ink/30">404</p>
        <p className="text-sm text-ink-soft">الصفحة غير موجودة</p>
      </div>
    );
  }

  if (loadFailed) {
    return (
      <AuthCard title="تعذّر فتح أيادي التصميم" subtitle="حدث خطأ في الاتصال بالخادم">
        <Button fullWidth onClick={() => setReloadKey((value) => value + 1)}>
          إعادة المحاولة
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="أيادي التصميم" subtitle="اختر اسمك وأدخل كلمة المرور">
      {members.length === 0 ? (
        <p className="text-center text-sm text-ink-soft">لا يوجد وصول مفعّل لهذا الرابط.</p>
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="design-team-member" className="text-sm font-medium text-ink">
              الاسم
            </label>
            <select
              id="design-team-member"
              value={memberId}
              onChange={(event) => setMemberId(event.target.value)}
              aria-invalid={Boolean(errors.memberId)}
              aria-describedby={errors.memberId ? "design-team-member-error" : undefined}
              className={[
                "min-h-12 w-full rounded-xl border bg-white px-3.5 py-2.5 text-ink outline-none transition-colors",
                "focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20",
                errors.memberId ? "border-danger" : "border-ink/15",
              ].join(" ")}
            >
              <option value="" disabled>
                اختر الاسم
              </option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
            {errors.memberId && (
              <p id="design-team-member-error" className="text-xs text-danger" role="alert">
                {errors.memberId}
              </p>
            )}
          </div>

          <Input
            label="كلمة المرور"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={errors.password}
            autoComplete="current-password"
          />

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-pill bg-orange-ink px-4 text-sm font-semibold text-white transition-[background-color,transform] duration-200 ease-out hover:bg-ink active:translate-y-px disabled:opacity-50 disabled:hover:bg-orange-ink"
          >
            {submitting && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
            {submitting ? "جارٍ الدخول…" : "دخول"}
          </button>
        </form>
      )}
    </AuthCard>
  );
}
