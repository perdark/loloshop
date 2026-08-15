"use client";

import { useState } from "react";
import Link from "next/link";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import {
  counterSignupStudent,
  CounterSignupError,
  type CounterSignupPayload,
} from "@/lib/staff";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { STUDY_TYPE_LABELS, PASSWORD_MIN_CUSTOMER } from "@/lib/constants";
import type { StaffType } from "@/lib/types";

type FormState = {
  name: string;
  phone: string;
  phoneConfirm: string;
  password: string;
  university_name: string;
  department: string;
  gender: "" | "male" | "female";
  study_type: "" | "morning" | "evening";
  instagram_username: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  phone: "",
  phoneConfirm: "",
  password: "",
  university_name: "",
  department: "",
  gender: "",
  study_type: "",
  instagram_username: "",
};

type SuccessState = { name: string; phone: string };

// Mirrors the backend's normalizeIqPhone (backend/lib/otp.js): digits only, tolerate
// Arabic-Indic digits and a +964/00964/964 prefix, default the leading 0. The double-entry
// check must compare CANONICAL forms — «07701…» and «7701…» are the same number, and flagging
// them as a mismatch teaches staff to ignore the guard that exists to stop account takeovers.
function canonIqPhone(input: string): string {
  let d = input
    .replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c)))
    .replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c)))
    .replace(/\D/g, "");
  if (!d) return input.trim();
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("964")) d = d.slice(3);
  if (!d.startsWith("0")) d = "0" + d;
  return d;
}

// «تسجيل طالب في المحل» — the counter-signup screen: a staff member (مدير الإنتاج) creates a
// student's account in person at the shop, no WhatsApp OTP. See
// backend/controllers/counterSignupController.js for why this is safe — the authenticated
// staff session standing in front of the student IS the authorisation, same idea as a
// wholesaler-linked student skipping the OTP on login.
export default function CounterSignupPage() {
  const { user, loading: authLoading } = useRequireAuth(["staff", "admin"]);

  const myTypes: StaffType[] =
    user?.staff_types && user.staff_types.length
      ? user.staff_types
      : user?.staff_type
        ? [user.staff_type]
        : [];
  // Same gate as /staff/custom-order: the whole /api/staff/* router is `requireRole('staff')`
  // (blocks admin by design) and this endpoint additionally needs requireStaffType() with no
  // extra role, i.e. manager-only. There is no /admin mirror for this screen — an admin who
  // lands here would 403 on submit, so they're told plainly instead.
  const isAdmin = user?.role === "admin";
  const isManager = myTypes.includes("manager");

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  // 409 ERR_PHONE_TAKEN — shown prominently, separate from a field error, because it needs
  // guidance ("go find them instead") rather than a "fix this input" instruction.
  const [phoneTaken, setPhoneTaken] = useState<{ message: string; studentId: string | null } | null>(
    null
  );
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<SuccessState | null>(null);

  if (authLoading || !user) return <PageLoader />;

  if (isAdmin || !isManager) {
    return (
      <div dir="rtl" lang="ar" className="space-y-5 animate-fade-page-in">
        <PageHeader title="تسجيل طالب في المحل" backHref="/staff" backLabel="رجوع للمنصّة" />
        <EmptyState
          title="غير مصرّح"
          message="تسجيل الطلاب في المحل مخصّص لمدير الإنتاج فقط."
        />
      </div>
    );
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: "" } : e));
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "الاسم مطلوب";
    if (!form.phone.trim()) e.phone = "رقم الهاتف مطلوب";
    if (!form.phoneConfirm.trim()) e.phoneConfirm = "أعد كتابة رقم الهاتف للتأكيد";
    else if (canonIqPhone(form.phone) !== canonIqPhone(form.phoneConfirm)) {
      e.phoneConfirm = "الرقمان غير متطابقين — تأكد من كتابة نفس الرقم مرتين";
    }
    if (!form.password || form.password.length < PASSWORD_MIN_CUSTOMER) {
      e.password = `كلمة المرور ${PASSWORD_MIN_CUSTOMER} أحرف على الأقل`;
    }
    if (!form.university_name.trim()) e.university_name = "اسم الجامعة مطلوب";
    if (!form.department.trim()) e.department = "القسم / التخصص مطلوب";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setPhoneTaken(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      const payload: CounterSignupPayload = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        phone_confirm: form.phoneConfirm.trim(),
        password: form.password,
        university_name: form.university_name.trim(),
        department: form.department.trim(),
        gender: form.gender || undefined,
        study_type: form.study_type || undefined,
        instagram_username: form.instagram_username.trim().replace(/^@+/, "") || undefined,
      };
      const created = await counterSignupStudent(payload);
      setSuccess({ name: created.name, phone: created.phone });
    } catch (err) {
      if (err instanceof CounterSignupError) {
        if (err.code === "ERR_PHONE_TAKEN") {
          setPhoneTaken({ message: err.message, studentId: err.studentId ?? null });
        } else if (err.field) {
          // Backend field names are snake_case (matches every form key here except the
          // confirm phone, which the backend would name `phone_confirm` if it validated the
          // match — see the contract note on CounterSignupPayload).
          const key = err.field === "phone_confirm" ? "phoneConfirm" : err.field;
          setErrors((prev) => ({ ...prev, [key]: err.message }));
        } else {
          setFormError(err.message);
        }
      } else {
        setFormError("تعذر إنشاء الحساب");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setErrors({});
    setFormError("");
    setPhoneTaken(null);
    setSuccess(null);
  }

  if (success) {
    return (
      <div dir="rtl" lang="ar" className="mx-auto max-w-lg animate-fade-page-in space-y-5">
        <PageHeader title="تسجيل طالب في المحل" backHref="/staff" backLabel="رجوع للمنصّة" />
        <div className="rounded-2xl border border-line bg-surface p-6 text-center shadow-[var(--shadow-soft)]">
          <span
            aria-hidden
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-orange-ink/10 text-orange-ink"
          >
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
          <h2 className="mt-4 font-display text-xl font-bold text-ink">تم إنشاء الحساب</h2>
          <p className="mt-1 text-sm text-ink-soft">
            {success.name} —{" "}
            <span dir="ltr" className="font-semibold text-ink">{success.phone}</span>
          </p>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            الحساب جاهز للاستخدام فوراً بدون رمز تحقق. يمكن للطالب تسجيل الدخول برقمه وكلمة
            المرور التي أدخلتها الآن.
          </p>
          <div className="mt-6 flex flex-col gap-2.5">
            <Link href="/staff/custom-order">
              <Button fullWidth size="lg">
                أنشئ الطلب من شاشة الطلبات
              </Button>
            </Link>
            <Button variant="ghost" fullWidth onClick={resetForm}>
              تسجيل طالب آخر
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" lang="ar" className="mx-auto max-w-lg animate-fade-page-in space-y-5">
      <PageHeader
        title="تسجيل طالب في المحل"
        subtitle="أنشئ حساب الطالب مباشرةً — بدون رمز تحقق واتساب"
        backHref="/staff"
        backLabel="رجوع للمنصّة"
      />

      {phoneTaken && (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 px-5 py-4">
          <p className="text-sm font-bold text-amber-900">هذا الرقم مسجّل مسبقاً</p>
          <p className="mt-1 text-sm leading-relaxed text-amber-800">{phoneTaken.message}</p>
          <p className="mt-2 text-xs leading-relaxed text-amber-700">
            سجّل دخول الطالب بدل إنشاء حساب جديد، أو ابحث عنه باسمه أو رقمه في «طلب مخصص» لإضافة
            طلب على حسابه الحالي.
          </p>
          <div className="mt-3">
            <Link
              href="/staff/custom-order"
              className="inline-flex min-h-11 items-center rounded-full border border-amber-400 bg-white px-4 text-sm font-semibold text-amber-900 transition-colors hover:bg-amber-100"
            >
              اذهب إلى طلب مخصص
            </Link>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
        <Input
          label="اسم الطالب الكامل"
          value={form.name}
          onChange={(e) => setField("name", e.target.value)}
          error={errors.name}
          autoComplete="off"
        />

        {/* Phone — entered once here… */}
        <PhoneField
          id="cs-phone"
          label="رقم الهاتف"
          value={form.phone}
          onChange={(v) => setField("phone", v)}
          error={errors.phone}
        />
        {/* …and again here. Deliberate: the staff member is holding the student's phone,
            not typing from memory, so a second entry catches a slipped digit before it
            becomes a stranger's account. */}
        <PhoneField
          id="cs-phone-confirm"
          label="أعد كتابة رقم الهاتف"
          value={form.phoneConfirm}
          onChange={(v) => setField("phoneConfirm", v)}
          error={errors.phoneConfirm}
        />

        <Input
          label="كلمة المرور"
          type="password"
          value={form.password}
          onChange={(e) => setField("password", e.target.value)}
          error={errors.password}
          autoComplete="new-password"
        />
        {/* Ownership note — the account belongs to the student, not the shop. */}
        <p className="-mt-2 rounded-xl border border-orange-ink/20 bg-orange-ink/[0.05] px-3.5 py-2.5 text-xs leading-relaxed text-ink-soft">
          هذه كلمة مرور الطالب الشخصية — دع الطالب يكتبها بنفسه أو يختارها معك، فهو من سيستخدمها
          لتسجيل الدخول لاحقاً.
        </p>

        <Input
          label="الجامعة"
          value={form.university_name}
          onChange={(e) => setField("university_name", e.target.value)}
          error={errors.university_name}
        />
        <Input
          label="القسم / التخصص"
          value={form.department}
          onChange={(e) => setField("department", e.target.value)}
          error={errors.department}
        />

        {/* Study schedule — optional here (unlike self-registration). */}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">الدراسة (اختياري)</span>
          <div className="flex gap-3">
            {(Object.entries(STUDY_TYPE_LABELS) as [("morning" | "evening"), string][]).map(
              ([value, label]) => (
                <label key={value} className="flex-1">
                  <input
                    type="radio"
                    name="study_type"
                    value={value}
                    checked={form.study_type === value}
                    onChange={() => setField("study_type", value)}
                    className="peer sr-only"
                  />
                  <span className="block min-h-11 cursor-pointer rounded-xl border border-line bg-beige py-3 text-center text-sm peer-checked:border-orange-ink peer-checked:bg-orange-ink/10 peer-checked:font-semibold peer-checked:text-orange-ink">
                    {label}
                  </span>
                </label>
              )
            )}
          </div>
        </div>

        {/* Gender — decides which option groups the student sees; optional at the counter
            just like self-registration, but worth asking while they're standing here. */}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">الجنس (اختياري)</span>
          <div className="flex gap-3">
            {([
              ["male", "ذكر"],
              ["female", "أنثى"],
            ] as const).map(([value, label]) => (
              <label key={value} className="flex-1">
                <input
                  type="radio"
                  name="gender"
                  value={value}
                  checked={form.gender === value}
                  onChange={() => setField("gender", value)}
                  className="peer sr-only"
                />
                <span className="block min-h-11 cursor-pointer rounded-xl border border-line bg-beige py-3 text-center text-sm peer-checked:border-orange-ink peer-checked:bg-orange-ink/10 peer-checked:font-semibold peer-checked:text-orange-ink">
                  {label}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="cs-instagram" className="text-sm font-medium text-ink">
            يوزر الانستا (اختياري)
          </label>
          <div className="flex items-stretch gap-0" dir="ltr">
            <span className="inline-flex select-none items-center rounded-s-xl border border-e-0 border-line bg-beige px-3 text-sm font-semibold text-ink">
              @
            </span>
            <input
              id="cs-instagram"
              type="text"
              autoComplete="off"
              value={form.instagram_username}
              onChange={(e) => setField("instagram_username", e.target.value.replace(/^@+/, ""))}
              placeholder="username"
              className="min-h-12 min-w-0 flex-1 rounded-e-xl border border-line bg-beige px-3.5 py-2.5 text-base text-ink shadow-[var(--shadow-soft)] outline-none transition-colors focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20"
            />
          </div>
        </div>

        {formError && (
          <p role="alert" className="rounded-xl border border-danger/25 bg-danger/5 px-3.5 py-2.5 text-sm font-medium text-danger">
            {formError}
          </p>
        )}

        <Button type="submit" size="lg" fullWidth loading={submitting}>
          إنشاء حساب الطالب
        </Button>
      </form>
    </div>
  );
}

/** Local +964 phone field — matches /register's entry pattern (digits typed after a fixed
 *  prefix), reused twice on this screen for phone + phone_confirm. */
function PhoneField({
  id,
  label,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <div className="flex items-stretch gap-2" dir="ltr">
        <span className="inline-flex select-none items-center rounded-xl border border-line bg-beige px-3 text-sm font-semibold text-ink">
          +964
        </span>
        <input
          id={id}
          type="tel"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
          placeholder="7XX XXX XXXX"
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          className={[
            "min-h-12 min-w-0 flex-1 rounded-xl border bg-beige px-3.5 py-2.5 text-base text-ink shadow-[var(--shadow-soft)] outline-none transition-colors placeholder:text-ink/55",
            "focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20",
            error ? "border-danger" : "border-line",
          ].join(" ")}
        />
      </div>
      {error && (
        <p id={`${id}-error`} className="text-sm font-medium text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
