"use client";

import { useEffect, useMemo, useState } from "react";
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
import type { CreateFullSetPayload } from "@/lib/wholesaler";
import { FullSetOrderForm } from "@/components/wholesaler/FullSetOrderForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/Spinner";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

export default function AdminCustomOrderPage() {
  const router = useRouter();
  const [config, setConfig] = useState<AdminCustomOrderConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [studentName, setStudentName] = useState("");
  const [wholesalerId, setWholesalerId] = useState("");

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

  const selectedWholesaler = useMemo(
    () => config?.wholesalers.find((w) => w.id === wholesalerId) || null,
    [config, wholesalerId]
  );

  async function handleSubmit(payload: CreateFullSetPayload) {
    const name = studentName.trim();
    if (!name) {
      toast.error("اسم الطالب مطلوب");
      return;
    }
    setSubmitting(true);
    try {
      await createAdminCustomOrder({
        student_name: name,
        wholesaler_id: wholesalerId || null,
        ...payload,
      });
      toast.success("تم إنشاء الطلب المخصص");
      router.push("/admin/orders");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر إنشاء الطلب"));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <PageLoader />;

  const wholesalerOptions = [
    { value: "", label: "طلب مستقل بدون ممثل" },
    ...(config?.wholesalers || []).map((w) => ({
      value: w.id,
      label: `${w.name}${w.universityName ? ` — ${w.universityName}` : ""}`,
    })),
  ];

  return (
    <div dir="rtl" lang="ar" className="space-y-5 animate-fade-page-in">
      <PageHeader
        title="طلب مخصص"
        subtitle="إنشاء طلب باسم الطالب مباشرة من الأدمن"
        action={
          <Link
            href="/admin/orders"
            className="inline-flex min-h-11 items-center rounded-full border border-line bg-beige px-4 text-sm font-semibold text-ink-soft hover:border-orange-ink/40"
          >
            رجوع للطلبات
          </Link>
        }
      />

      <section className="rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-soft)]">
        <div className="grid gap-3 md:grid-cols-2">
          <Input
            label="اسم الطالب"
            value={studentName}
            onChange={(e) => setStudentName(e.target.value)}
            placeholder="الاسم الكامل للطالب"
            maxLength={120}
            autoFocus
          />
          <Select
            label="ربط الطلب"
            value={wholesalerId}
            onChange={(e) => setWholesalerId(e.target.value)}
            options={wholesalerOptions}
          />
        </div>
        <p className="mt-2 text-xs text-muted">
          الطلب المستقل يظهر مباشرة في الإنتاج. عند ربطه بممثل، يرث الجامعة والقسم وتسعيرة ذلك الممثل.
        </p>
      </section>

      <FullSetOrderForm
        pricing={selectedWholesaler?.pricing ?? config?.pricing ?? null}
        initial={null}
        submitting={submitting}
        submitLabel="إنشاء الطلب"
        onUploadImage={uploadAdminCustomOrderImage}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
