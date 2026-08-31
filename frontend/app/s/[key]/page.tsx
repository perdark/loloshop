"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { AuthCard } from "@/components/auth/AuthCard";
import { Input } from "@/components/ui/Input";
import {
  getStaffPortalMembers,
  staffPortalLogin,
  type StaffPortalMember,
} from "@/lib/auth-api";
import { setToken, setUser } from "@/lib/auth";

/**
 * Private staff portal — for staff who have no phone (so can't receive a WhatsApp OTP).
 * The secret key is the URL path segment (/s/<key>); the backend validates it and
 * returns 404 for any wrong/missing key, so this looks like a non-existent page to
 * anyone who doesn't know the link. Staff pick their name + type a password — no OTP.
 */
export default function StaffPortalPage() {
  const router = useRouter();
  const params = useParams();
  const key = Array.isArray(params.key) ? params.key[0] : (params.key ?? "");

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [members, setMembers] = useState<StaffPortalMember[]>([]);

  const [staffId, setStaffId] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const list = await getStaffPortalMembers(key);
        if (!active) return;
        setMembers(list);
      } catch {
        // Wrong key (404) or any error → present a neutral "not found".
        if (active) setNotFound(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [key]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const eMap: Record<string, string> = {};
    if (!staffId) eMap.staffId = "اختر اسمك";
    if (!password) eMap.password = "كلمة المرور مطلوبة";
    setErrors(eMap);
    if (Object.keys(eMap).length > 0) return;

    setSubmitting(true);
    try {
      const { token, user } = await staffPortalLogin(key, staffId, password);
      setToken(token);
      setUser(user);
      toast.success(`مرحباً ${user.name} 🎉`);
      router.replace("/staff");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "بيانات الدخول غير صحيحة";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  // Initial members fetch — neutral spinner (don't reveal the portal until the key checks out).
  if (loading) {
    return (
      <div
        className="flex min-h-dvh items-center justify-center bg-cream"
        dir="rtl"
        lang="ar"
      >
        <span className="h-7 w-7 animate-spin rounded-full border-2 border-ink/20 border-t-orange-ink" />
      </div>
    );
  }

  // Wrong/missing key → indistinguishable from a page that doesn't exist.
  if (notFound) {
    return (
      <div
        className="flex min-h-dvh flex-col items-center justify-center gap-2 bg-cream px-6 text-center"
        dir="rtl"
        lang="ar"
      >
        <p className="font-display text-5xl font-bold text-ink/30">404</p>
        <p className="text-sm text-ink-soft">الصفحة غير موجودة</p>
      </div>
    );
  }

  return (
    <AuthCard title="دخول الموظفين" subtitle="اختر اسمك وأدخل كلمة المرور">
      {members.length === 0 ? (
        <p className="text-center text-sm text-ink-soft">لا يوجد موظفون بعد.</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="staff-select" className="text-sm font-medium text-ink">
              الاسم
            </label>
            <select
              id="staff-select"
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              aria-invalid={!!errors.staffId}
              aria-describedby={errors.staffId ? "staff-error" : undefined}
              className={[
                "min-h-12 w-full rounded-xl border bg-white px-3.5 py-2.5 text-ink outline-none transition-colors",
                "focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20",
                errors.staffId ? "border-danger" : "border-ink/15",
              ].join(" ")}
            >
              <option value="" disabled>
                اختر اسمك
              </option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            {errors.staffId && (
              <p id="staff-error" className="text-xs text-danger" role="alert">
                {errors.staffId}
              </p>
            )}
          </div>

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
            disabled={submitting}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-pill bg-orange-ink px-4 text-sm font-semibold text-white transition-[background-color,transform] duration-200 ease-out hover:bg-ink active:translate-y-px disabled:opacity-50 disabled:hover:bg-orange-ink"
          >
            {submitting ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                <span>جارٍ الدخول…</span>
              </>
            ) : (
              "دخول"
            )}
          </button>
        </form>
      )}
    </AuthCard>
  );
}
