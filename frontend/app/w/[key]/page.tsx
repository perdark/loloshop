"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { AuthCard } from "@/components/auth/AuthCard";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  getWorkshopPortalMembers,
  workshopPortalLogin,
  type PortalMember,
} from "@/lib/workshop";
import { setToken, setUser } from "@/lib/auth";
import type { User } from "@/lib/types";
import { getApiErrorStatus } from "@/lib/api";

/**
 * Private workshop portal — عمّال الورشة (Team B). Syrian workers have no Iraqi phone, so
 * no WhatsApp OTP: they pick their name + type a رمز (password). The secret key is the URL
 * path segment (/w/<key>); a wrong/missing key returns 404 so the page looks non-existent.
 * Copy is intentionally in Syrian dialect (اللهجة السورية).
 */
export default function WorkshopPortalPage() {
  const router = useRouter();
  const params = useParams();
  const key = Array.isArray(params.key) ? params.key[0] : (params.key ?? "");

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [members, setMembers] = useState<PortalMember[]>([]);

  const [workerId, setWorkerId] = useState("");
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
        const list = await getWorkshopPortalMembers(key);
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const eMap: Record<string, string> = {};
    if (!workerId) eMap.workerId = "اختار اسمك";
    if (!password) eMap.password = "الرمز مطلوب";
    setErrors(eMap);
    if (Object.keys(eMap).length > 0) return;

    setSubmitting(true);
    try {
      const { token, user } = await workshopPortalLogin(key, workerId, password);
      setToken(token);
      setUser(user as unknown as User);
      toast.success(`أهلين ${user.name} 👋`);
      router.replace("/workshop");
    } catch {
      toast.error("الاسم أو الرمز غلط");
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

  if (loadFailed) {
    return (
      <AuthCard title="تعذّر فتح الورشة" subtitle="صار خطأ بالاتصال، جرّب مرة ثانية">
        <Button fullWidth onClick={() => setReloadKey((value) => value + 1)}>
          إعادة المحاولة
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="ورشة لولو" subtitle="اختار اسمك وحطّ الرمز">
      {members.length === 0 ? (
        <p className="text-center text-sm text-ink-soft">ما في عمّال بعد.</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="worker-select" className="text-sm font-medium text-ink">
              الاسم
            </label>
            <select
              id="worker-select"
              value={workerId}
              onChange={(e) => setWorkerId(e.target.value)}
              aria-invalid={!!errors.workerId}
              className={[
                "min-h-12 w-full rounded-xl border bg-white px-3.5 py-2.5 text-ink outline-none transition-colors",
                "focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20",
                errors.workerId ? "border-danger" : "border-ink/15",
              ].join(" ")}
            >
              <option value="" disabled>
                اختار اسمك
              </option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            {errors.workerId && (
              <p className="text-xs text-danger" role="alert">
                {errors.workerId}
              </p>
            )}
          </div>

          <Input
            label="الرمز"
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
                <span>عم نفوّتك…</span>
              </>
            ) : (
              "فوت"
            )}
          </button>
        </form>
      )}
    </AuthCard>
  );
}
