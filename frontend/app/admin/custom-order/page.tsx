"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createAdminCustomOrder,
  getAdminCustomOrderConfig,
  uploadAdminCustomOrderImage,
  type AdminCustomOrderConfig,
} from "@/lib/admin";
import { getApiErrorMessage } from "@/lib/api";
import {
  getStudentFullSetContext,
  searchProductionStudents,
  type CustomOrderPayload,
} from "@/lib/staff";
import { CustomOrderForm } from "@/components/staff/CustomOrderForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";

export default function AdminCustomOrderPage() {
  const router = useRouter();
  const [config, setConfig] = useState<AdminCustomOrderConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let alive = true;
    getAdminCustomOrderConfig()
      .then((data) => {
        if (alive) setConfig(data);
      })
      .catch((e) => {
        if (alive) toast.error(getApiErrorMessage(e, "تعذر تحميل نموذج الطلب"));
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  async function handleSubmit(payload: CustomOrderPayload) {
    setSubmitting(true);
    try {
      await createAdminCustomOrder(payload);
      toast.success(payload.student_id ? "تم حفظ طلب الطالب" : "تم إنشاء الطلب المخصص");
      router.push("/admin/orders");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر إنشاء الطلب"));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <PageLoader />;

  return (
    <div dir="rtl" lang="ar" className="space-y-5 animate-fade-page-in">
      <PageHeader
        title="طلب مخصص"
        subtitle="إنشاء أو تعديل طلب لطالب — جديد أو موجود"
        action={
          <Link
            href="/admin/orders"
            className="inline-flex min-h-11 items-center rounded-full border border-line bg-beige px-4 text-sm font-semibold text-ink-soft hover:border-orange-ink/40"
          >
            رجوع للطلبات
          </Link>
        }
      />

      {config ? (
        <CustomOrderForm
          config={config}
          submitting={submitting}
          onSubmit={handleSubmit}
          onUploadImage={uploadAdminCustomOrderImage}
          onSearchStudents={searchProductionStudents}
          onLoadStudentContext={getStudentFullSetContext}
          onRetailCreated={({ orders }) => router.push(`/staff/orders/${orders[0].id}`)}
        />
      ) : (
        <EmptyState title="تعذر تحميل نموذج الطلب" message="تحقق من الاتصال ثم أعد تحميل الصفحة." />
      )}
    </div>
  );
}
