"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import {
  getFullSetPackages,
  createQuickFullSetOrder,
  uploadWholesalerImage,
  type FullSetPricing,
  type CreateFullSetPayload,
} from "@/lib/wholesaler";
import { FullSetOrderForm } from "@/components/wholesaler/FullSetOrderForm";
import { PageLoader } from "@/components/ui/Spinner";
import { Input } from "@/components/ui/Input";

/**
 * طلب مخصص لطالب — the rep adds a student BY NAME ONLY (no account) and places the
 * SAME full-set طقم order in one shot. The backend creates a pre-approved, un-loginable
 * student and skips the order approval, so it goes straight to staff + the dashboard.
 * Reuses the shared <FullSetOrderForm/> exactly like the per-student rep order page.
 */
export default function WholesalerCustomOrderPage() {
  const router = useRouter();
  const [pricing, setPricing] = useState<FullSetPricing | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [studentName, setStudentName] = useState("");
  const [nameError, setNameError] = useState<string | undefined>();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getFullSetPackages()
      .then((pkgs) => {
        if (alive) setPricing(pkgs.pricing);
      })
      .catch((err) => {
        if (alive) toast.error(getApiErrorMessage(err, "تعذر تحميل التسعيرة"));
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  async function handleSubmit(payload: CreateFullSetPayload) {
    const name = studentName.trim();
    if (!name) {
      setNameError("اسم الطالب مطلوب");
      toast.error("يرجى إدخال اسم الطالب");
      return;
    }
    setNameError(undefined);
    setSubmitting(true);
    try {
      await createQuickFullSetOrder({ student_name: name, ...payload });
      toast.success("تم إنشاء الطلب المخصص");
      router.push("/wholesaler/students");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر إنشاء الطلب"));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <h1 className="section-heading font-display-ar text-xl font-bold text-ink">
            طلب مخصص لطالب
          </h1>
          <p className="mt-0.5 truncate text-sm text-ink-soft">
            أدخل اسم الطالب واملأ الطلب — يُرسل مباشرة إلى الإنتاج
          </p>
        </div>
        <BackLink />
      </div>

      <section className="surface-card space-y-3 rounded-2xl p-3.5">
        <Input
          label="اسم الطالب"
          value={studentName}
          onChange={(e) => {
            setStudentName(e.target.value);
            if (nameError) setNameError(undefined);
          }}
          placeholder="الاسم الكامل للطالب"
          maxLength={120}
          error={nameError}
          autoFocus
        />
        <p className="text-xs text-[var(--shop-muted)]">
          لا يحتاج الطالب إلى حساب — يُسجَّل بالاسم فقط ويُرسل الطلب فوراً دون موافقة.
        </p>
      </section>

      <FullSetOrderForm
        pricing={pricing}
        initial={null}
        submitting={submitting}
        submitLabel="إنشاء الطلب"
        onUploadImage={uploadWholesalerImage}
        onSubmit={handleSubmit}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/wholesaler/students"
      className="inline-flex min-h-11 shrink-0 items-center text-sm font-medium text-orange-ink hover:underline"
    >
      → رجوع
    </Link>
  );
}
