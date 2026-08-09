"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { getApiErrorMessage } from "@/lib/api";
import {
  createStaffCustomOrder,
  getStaffCustomOrderConfig,
  getStudentFullSetContext,
  searchProductionStudents,
  uploadStaffCustomOrderImage,
  type CustomOrderConfig,
  type CustomOrderPayload,
} from "@/lib/staff";
import { CustomOrderForm } from "@/components/staff/CustomOrderForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import type { StaffType } from "@/lib/types";

// «طلب مخصص» for مدير الإنتاج — same shared form as /admin/custom-order, wired to the
// /api/staff/custom-order mirrors (manager-only server-side; admins use the admin page).
export default function StaffCustomOrderPage() {
  const { user, loading: authLoading } = useRequireAuth(["staff", "admin"]);
  const router = useRouter();
  const [config, setConfig] = useState<CustomOrderConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const myTypes: StaffType[] =
    user?.staff_types && user.staff_types.length
      ? user.staff_types
      : user?.staff_type
        ? [user.staff_type]
        : [];
  // NOT `role === 'admin' || …`. The whole /api/staff/* router is `requireRole('staff')`
  // (backend/routes/staff.js) — the admin role is blocked there BY DESIGN and uses the
  // /api/admin mounts instead. Claiming admins are authorised here renders a form whose
  // every request 403s, so admins are sent to their own page instead.
  const isAdmin = user?.role === "admin";
  const isManager = myTypes.includes("manager");

  useEffect(() => {
    if (isAdmin) router.replace("/admin/custom-order");
  }, [isAdmin, router]);

  useEffect(() => {
    if (!user || isAdmin || !isManager) return;
    let alive = true;
    getStaffCustomOrderConfig()
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, isManager]);

  if (authLoading || !user) return <PageLoader />;
  // Redirect in flight — never flash «غير مصرّح» at an admin who is simply on the wrong mount.
  if (isAdmin) return <PageLoader />;

  if (!isManager) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16" dir="rtl">
        <EmptyState title="غير مصرّح" message="الطلب المخصص مخصّص لمدير الإنتاج فقط." />
      </div>
    );
  }

  async function handleSubmit(payload: CustomOrderPayload) {
    setSubmitting(true);
    try {
      await createStaffCustomOrder(payload);
      toast.success(payload.student_id ? "تم حفظ طلب الطالب" : "تم إنشاء الطلب المخصص");
      router.push("/staff/queue");
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
            href="/staff/queue"
            className="inline-flex min-h-11 items-center rounded-full border border-line bg-beige px-4 text-sm font-semibold text-ink-soft hover:border-orange-ink/40"
          >
            رجوع للمنصّة
          </Link>
        }
      />

      {config ? (
        <CustomOrderForm
          config={config}
          submitting={submitting}
          onSubmit={handleSubmit}
          onUploadImage={uploadStaffCustomOrderImage}
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
