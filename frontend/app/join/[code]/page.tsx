"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { getReferralInfo, joinWithCode, type ReferralInfo } from "@/lib/wholesaler";
import { getApiErrorMessage } from "@/lib/api";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { AuthCard } from "@/components/auth/AuthCard";
import { GradCapLoader } from "@/components/ui/GradCapLoader";
import { STUDY_TYPE_LABELS } from "@/lib/constants";

// Inline checkmark — warm brick on cream surface, no emoji, no gradient fill.
function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={2}
      stroke="currentColor"
      className="h-8 w-8"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

export default function JoinPage() {
  const params = useParams();
  const code = params.code as string;

  // Resolve the referral code → the rep's name + cohort (جامعة/قسم). The student
  // inherits these, so we show them as read-only context instead of asking for them.
  const [info, setInfo] = useState<ReferralInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);

  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    full_name_third: "",
    phone: "",
    email: "",
    password: "",
    confirmPassword: "",
    study_type: "" as "" | "morning" | "evening",
    instagram_username: "",
  });

  useEffect(() => {
    let alive = true;
    getReferralInfo(code)
      .then((data) => {
        if (alive) setInfo(data);
      })
      .catch(() => {
        if (alive) setInvalid(true);
      })
      .finally(() => {
        if (alive) setInfoLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [code]);

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.full_name_third.trim()) e.full_name_third = "الاسم الثلاثي مطلوب";
    if (!form.phone.trim()) e.phone = "رقم الهاتف مطلوب";
    if (!form.password || form.password.length < 6)
      e.password = "كلمة المرور ٦ أحرف على الأقل";
    if (form.password !== form.confirmPassword)
      e.confirmPassword = "كلمتا المرور غير متطابقتين";
    if (!form.study_type) e.study_type = "الدراسة الصباحية أو المسائية مطلوبة";
    if (!form.instagram_username.trim()) e.instagram_username = "يوزر الانستا مطلوب";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      await joinWithCode(code, {
        full_name_third: form.full_name_third.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        password: form.password,
        // الجامعة/القسم تُورَّث من ممثل الجامعة تلقائياً — لا يُدخلها الطالب.
        study_type: form.study_type as "morning" | "evening",
        instagram_username: form.instagram_username.trim().replace(/^@+/, ""),
      });
      setSubmitted(true);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر إرسال الطلب"));
    } finally {
      setLoading(false);
    }
  }

  if (infoLoading) {
    return (
      <div
        dir="rtl"
        className="flex min-h-[60vh] flex-col items-center justify-center gap-4"
      >
        <GradCapLoader size={72} />
        <p className="text-xs font-medium tracking-wide text-[var(--shop-muted)]">
          جارٍ التحميل…
        </p>
      </div>
    );
  }

  if (invalid) {
    return (
      <AuthCard title="الرابط غير صالح">
        <p className="text-sm text-ink-soft">
          رابط الدعوة غير صحيح أو لم يعد فعّالاً. تأكد من الرابط مع ممثل جامعتك.
        </p>
      </AuthCard>
    );
  }

  if (submitted) {
    return (
      <AuthCard title="طلبك قيد المراجعة">
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          {/* Quiet success mark — warm ink circle with a line-SVG check */}
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-ink/12 bg-[var(--shop-sink)] text-orange-ink">
            <CheckIcon />
          </div>
          <p className="text-sm text-ink-soft">
            سنُعلمك داخل التطبيق عند موافقة الممثل على حسابك.
          </p>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="التسجيل بدعوة الممثل">
      {/* Cohort context — the rep's name + جامعة/قسم the student is joining under.
          These are inherited automatically, so they are shown, not entered. */}
      <div className="mb-6 space-y-2 rounded-[12px] border border-ink/10 bg-[var(--shop-sink)] px-4 py-3">
        {info?.wholesalerName && (
          <p className="text-center text-sm text-ink">
            <span className="text-[var(--shop-muted)]">ممثل: </span>
            <span className="font-semibold">{info.wholesalerName}</span>
          </p>
        )}
        {(info?.universityName || info?.department) && (
          <p className="text-center text-sm text-ink">
            {info?.universityName && <span className="font-semibold">{info.universityName}</span>}
            {info?.universityName && info?.department && (
              <span className="mx-1.5 text-ink/30">·</span>
            )}
            {info?.department && <span>{info.department}</span>}
          </p>
        )}
        <p className="text-center text-xs text-[var(--shop-muted)]">
          ستُسجَّل ضمن هذه الجامعة والقسم تلقائياً
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="الاسم الثلاثي"
          placeholder="الاسم + اسم الأب + الجد"
          value={form.full_name_third}
          onChange={(e) => setForm({ ...form, full_name_third: e.target.value })}
          error={errors.full_name_third}
        />

        {/* Phone — country-code prefix kept in LTR slot */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="join-phone" className="text-sm font-medium text-ink">رقم الهاتف</label>
          <div className="flex items-stretch gap-2" dir="ltr">
            <span className="inline-flex select-none items-center rounded-xl border border-line bg-beige px-3 text-sm font-semibold text-ink">
              +964
            </span>
            <input
              id="join-phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "") })}
              placeholder="7XX XXX XXXX"
              aria-invalid={!!errors.phone}
              aria-describedby={errors.phone ? "join-phone-error" : undefined}
              className={[
                "min-h-11 min-w-0 flex-1 rounded-xl border bg-beige px-3.5 py-2.5 text-ink outline-none transition-colors placeholder:text-ink/55",
                "focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20",
                errors.phone ? "border-danger" : "border-line",
              ].join(" ")}
            />
          </div>
          {errors.phone && (
            <p id="join-phone-error" className="text-xs text-danger" role="alert">
              {errors.phone}
            </p>
          )}
        </div>

        <Input
          label="البريد الإلكتروني (اختياري)"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          error={errors.email}
          autoComplete="email"
        />
        <Input
          label="كلمة المرور"
          type="password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          error={errors.password}
          autoComplete="new-password"
        />
        <Input
          label="تأكيد كلمة المرور"
          type="password"
          value={form.confirmPassword}
          onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
          error={errors.confirmPassword}
          autoComplete="new-password"
        />

        {/* Study schedule — required pill toggles */}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">الدراسة</span>
          <div className="flex gap-3">
            {(Object.entries(STUDY_TYPE_LABELS) as [("morning" | "evening"), string][]).map(([value, label]) => (
              <label key={value} className="flex-1">
                <input
                  type="radio"
                  name="study_type"
                  value={value}
                  checked={form.study_type === value}
                  onChange={() => setForm({ ...form, study_type: value })}
                  className="peer sr-only"
                />
                <span className="block cursor-pointer rounded-xl border border-line bg-beige py-3 text-center text-sm peer-checked:border-orange-ink peer-checked:bg-orange-ink/10 peer-checked:font-semibold peer-checked:text-orange-ink">
                  {label}
                </span>
              </label>
            ))}
          </div>
          {errors.study_type && (
            <p className="text-xs text-danger" role="alert">{errors.study_type}</p>
          )}
        </div>

        {/* Instagram username — strip leading @ on submit */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="join-instagram" className="text-sm font-medium text-ink">
            يوزر الانستا
          </label>
          <div className="flex items-stretch gap-0" dir="ltr">
            <span className="inline-flex select-none items-center rounded-s-xl border border-e-0 border-line bg-beige px-3 text-sm font-semibold text-ink">
              @
            </span>
            <input
              id="join-instagram"
              type="text"
              inputMode="text"
              autoComplete="username"
              value={form.instagram_username}
              onChange={(e) =>
                setForm({ ...form, instagram_username: e.target.value.replace(/^@+/, "") })
              }
              placeholder="username"
              aria-invalid={!!errors.instagram_username}
              aria-describedby={errors.instagram_username ? "join-instagram-error" : undefined}
              className={[
                "min-h-11 min-w-0 flex-1 rounded-e-xl border bg-beige px-3.5 py-2.5 text-ink outline-none transition-colors placeholder:text-ink/55",
                "focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20",
                errors.instagram_username ? "border-danger" : "border-line",
              ].join(" ")}
            />
          </div>
          {errors.instagram_username && (
            <p id="join-instagram-error" className="text-xs text-danger" role="alert">
              {errors.instagram_username}
            </p>
          )}
        </div>

        <Button type="submit" fullWidth loading={loading}>
          إرسال الطلب
        </Button>
      </form>
    </AuthCard>
  );
}
