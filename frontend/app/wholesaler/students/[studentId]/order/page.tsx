"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import {
  getWholesalerStudent,
  getFullSetPackages,
  getWholesalerStudentOrder,
  createWholesalerFullSetOrder,
  uploadWholesalerImage,
  type WholesalerStudentDetail,
  type FullSetPackage,
  type FullSetExistingOrder,
  type CreateFullSetPayload,
} from "@/lib/wholesaler";
import { FullSetOrderForm } from "@/components/wholesaler/FullSetOrderForm";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";

export default function WholesalerStudentOrderPage() {
  const params = useParams<{ studentId: string }>();
  const studentId = params.studentId;
  const router = useRouter();

  const [student, setStudent] = useState<WholesalerStudentDetail | null>(null);
  const [packages, setPackages] = useState<FullSetPackage[]>([]);
  const [existing, setExisting] = useState<FullSetExistingOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(false);
    Promise.all([
      getWholesalerStudent(studentId),
      getFullSetPackages(),
      getWholesalerStudentOrder(studentId).catch(() => null),
    ])
      .then(([s, pkgs, ex]) => {
        if (!alive) return;
        setStudent(s);
        setPackages(pkgs);
        setExisting(ex);
      })
      .catch((err) => {
        if (!alive) return;
        setLoadError(true);
        toast.error(getApiErrorMessage(err, "تعذر تحميل بيانات الطالب"));
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [studentId]);

  async function handleSubmit(payload: CreateFullSetPayload) {
    setSubmitting(true);
    try {
      const res = await createWholesalerFullSetOrder(studentId, payload);
      toast.success(`تم حفظ طلب ${res.packageName}`);
      router.push("/wholesaler/students");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر حفظ الطلب"));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <PageLoader />;

  if (loadError || !student) {
    return (
      <div className="space-y-4">
        <BackLink />
        <EmptyState title="تعذر تحميل الطالب" message="تحقق من الاتصال ثم حاول مجدداً." />
      </div>
    );
  }

  if (student.status !== "approved") {
    return (
      <div className="space-y-4">
        <BackLink />
        <EmptyState
          title="الطالب غير موافق عليه"
          message="يجب الموافقة على الطالب أولاً قبل إدخال الطلب."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <h1 className="section-heading font-display-ar text-xl font-bold text-ink">
            {existing ? "تعديل الطلب" : "طلب جديد"}
          </h1>
          <p className="mt-0.5 truncate text-sm text-ink-soft">
            {student.name}
            {student.universityName ? ` — ${student.universityName}` : ""}
          </p>
        </div>
        <BackLink />
      </div>

      {existing && (
        <p className="rounded-xl border border-line bg-[var(--shop-sink)] px-3.5 py-2.5 text-xs text-ink-soft">
          هذا الطالب لديه طلب مسجّل — الحقول معبّأة بالقيم الحالية، والحفظ يُحدّثها.
        </p>
      )}

      <FullSetOrderForm
        packages={packages}
        initial={existing}
        submitting={submitting}
        submitLabel={existing ? "تحديث الطلب" : "حفظ الطلب"}
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
      ← رجوع
    </Link>
  );
}
