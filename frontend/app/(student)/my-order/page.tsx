"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import {
  getRepFullSetContext,
  submitRepFullSetOrder,
  type RepFullSetContext,
  type CreateFullSetPayload,
} from "@/lib/wholesaler";
import { uploadDesignImage } from "@/lib/designer";
import { FullSetOrderForm } from "@/components/wholesaler/FullSetOrderForm";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";

export default function StudentMyOrderPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<RepFullSetContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [formKey, setFormKey] = useState(0);

  async function load() {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await getRepFullSetContext();
      setCtx(data);
      setFormKey((k) => k + 1);
      // Non-rep students don't belong here — send them to the shop.
      if (!data.isRepStudent) router.replace("/");
    } catch (err) {
      setLoadError(true);
      toast.error(getApiErrorMessage(err, "تعذر تحميل النموذج"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(payload: CreateFullSetPayload) {
    setSubmitting(true);
    try {
      const res = await submitRepFullSetOrder(payload);
      toast.success(`تم استلام طلبك — ${res.packageName}`);
      setDone(true);
      // refresh so a later edit pre-fills with the saved values
      getRepFullSetContext()
        .then((d) => {
          setCtx(d);
          setFormKey((k) => k + 1);
        })
        .catch(() => {});
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر إرسال الطلب"));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <PageLoader />;

  if (loadError || !ctx) {
    return (
      <EmptyState
        title="تعذر تحميل النموذج"
        message="تحقق من الاتصال ثم حاول مجدداً."
        action={
          <Button variant="ghost" onClick={load}>
            إعادة المحاولة
          </Button>
        }
      />
    );
  }

  if (!ctx.isRepStudent) return <PageLoader />; // redirecting to "/"

  if (!ctx.approved) {
    return (
      <EmptyState
        title="بانتظار موافقة الممثل"
        message="سيتمكّن من إدخال طلبك بعد موافقة ممثل الجامعة على تسجيلك."
      />
    );
  }

  if (done) {
    return (
      <div className="space-y-5 py-6 text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-orange-ink/10 text-3xl text-orange-ink">
          ✓
        </div>
        <div>
          <h1 className="font-display-ar text-2xl font-bold text-ink">
            تم استلام طلبك
          </h1>
          <p className="mt-2 text-sm text-ink-soft">
            تم تسجيل طلب طقم التخرج الخاص بك. يمكنك تعديله في أي وقت قبل موعد التسليم.
          </p>
        </div>
        <Button onClick={() => setDone(false)}>تعديل الطلب</Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="section-heading font-display-ar text-2xl font-bold text-ink">
          {ctx.existing ? "تعديل طلبك" : "طلب طقم التخرج"}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          {ctx.existing
            ? "الحقول معبّأة بقيم طلبك الحالي — عدّلها ثم احفظ."
            : "املأ النموذج لطلب طقم تخرجك (روب + وشاح + قبعة)."}
        </p>
      </header>

      <FullSetOrderForm
        key={formKey}
        packages={ctx.packages}
        initial={ctx.existing}
        submitting={submitting}
        submitLabel={ctx.existing ? "تحديث الطلب" : "تأكيد الطلب"}
        onUploadImage={uploadDesignImage}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
