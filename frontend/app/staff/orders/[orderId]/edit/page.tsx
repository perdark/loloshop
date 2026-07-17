"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { getApiErrorMessage } from "@/lib/api";
import {
  getOrderEditContext,
  saveStudentFullSetOrder,
  uploadProductionImage,
  type OrderEditContext,
} from "@/lib/staff";
import type { CreateFullSetPayload } from "@/lib/wholesaler";
import { FullSetOrderForm } from "@/components/wholesaler/FullSetOrderForm";
import { Input } from "@/components/ui/Input";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";

// «تعديل الطلب» — admin/مدير الإنتاج edit a student's full طقم (the same form the rep
// uses, pre-filled) + the student's info (الاسم، يوزر الانستا، الهواتف). The backend
// preserves the bundle's rep-approval state across the save.
export default function StaffOrderEditPage() {
  const params = useParams<{ orderId: string }>();
  const orderId = params.orderId;
  const router = useRouter();
  const { user, loading: authLoading } = useRequireAuth(["staff", "admin"]);

  const [ctx, setCtx] = useState<OrderEditContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [instagram, setInstagram] = useState("");
  const [phonePrimary, setPhonePrimary] = useState("");
  const [phoneSecondary, setPhoneSecondary] = useState("");

  useEffect(() => {
    if (!user) return;
    let alive = true;
    setLoading(true);
    getOrderEditContext(orderId)
      .then((data) => {
        if (!alive) return;
        setCtx(data);
        setName(data.student.name || "");
        setInstagram(data.group?.instagram_username || data.student.instagram_username || "");
        setPhonePrimary(data.group?.phone_primary || data.student.phone || "");
        setPhoneSecondary(data.group?.phone_secondary || "");
      })
      .catch((e) => {
        if (alive) setLoadError(getApiErrorMessage(e, "تعذر تحميل بيانات الطلب"));
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, user?.id]);

  async function handleSubmit(payload: CreateFullSetPayload) {
    if (!ctx) return;
    if (!name.trim()) {
      toast.error("اسم الطالب مطلوب");
      return;
    }
    setSubmitting(true);
    try {
      await saveStudentFullSetOrder(ctx.student.id, {
        ...payload,
        student_info: {
          name: name.trim(),
          instagram_username: instagram.trim(),
          phone_primary: phonePrimary.trim(),
          phone_secondary: phoneSecondary.trim(),
        },
      });
      toast.success("تم حفظ التعديلات");
      router.push(`/staff/orders/${orderId}`);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر حفظ التعديلات"));
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading || !user || loading) return <PageLoader />;

  if (loadError || !ctx) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16" dir="rtl">
        <EmptyState title="تعذر تحميل الطلب" message={loadError || "تحقق من الاتصال ثم حاول مجدداً."} />
      </div>
    );
  }

  if (!ctx.can_edit_full_set) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16" dir="rtl">
        <EmptyState
          title="لا يمكن تعديل هذا الطلب من هنا"
          message="نموذج الطقم يخص طلبات الممثلين والطلبات المخصصة فقط — طلبات التجزئة تُعدَّل من صفحة الطلب مباشرة."
        />
      </div>
    );
  }

  return (
    <div dir="rtl" lang="ar" className="space-y-5 animate-fade-page-in">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="section-heading font-display-ar text-xl font-bold text-ink">تعديل الطلب</h1>
          <p className="mt-0.5 truncate text-sm text-ink-soft">
            {ctx.student.name}
            {ctx.student.rep_name ? ` — ممثل: ${ctx.student.rep_name}` : " — طلب مخصص"}
            {ctx.student.university_name ? ` · ${ctx.student.university_name}` : ""}
          </p>
        </div>
        <Link
          href={`/staff/orders/${orderId}`}
          className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-line bg-beige px-4 text-sm font-semibold text-ink-soft hover:border-orange-ink/40"
        >
          رجوع للطلب
        </Link>
      </div>

      <section className="rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-soft)]">
        <h2 className="mb-3 text-sm font-bold text-ink">معلومات الطالب</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Input
            label="اسم الطالب"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
          />
          <Input
            label="يوزر الانستا (بدون @)"
            value={instagram}
            onChange={(e) => setInstagram(e.target.value)}
            maxLength={100}
            dir="ltr"
          />
          <Input
            label="رقم الهاتف الأول"
            value={phonePrimary}
            onChange={(e) => setPhonePrimary(e.target.value)}
            maxLength={20}
            dir="ltr"
          />
          <Input
            label="رقم الهاتف الثاني (اختياري)"
            value={phoneSecondary}
            onChange={(e) => setPhoneSecondary(e.target.value)}
            maxLength={20}
            dir="ltr"
          />
        </div>
      </section>

      {ctx.existing && (
        <p className="rounded-xl border border-line bg-[var(--shop-sink)] px-3.5 py-2.5 text-xs text-ink-soft">
          الحقول معبّأة بالطلب الحالي — الحفظ يُحدّثه، وتبقى حالة موافقة الممثل كما هي.
        </p>
      )}

      <FullSetOrderForm
        pricing={ctx.pricing}
        initial={ctx.existing}
        submitting={submitting}
        submitLabel="حفظ التعديلات"
        onUploadImage={uploadProductionImage}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
