"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { DesignViewer } from "@/components/staff/DesignViewer";
import { ExportPngButton } from "@/components/staff/ExportPngButton";
import { PdfExportButton } from "@/components/staff/PdfExportButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { ORDER_STATUS_LABELS } from "@/lib/constants";
import { formatDateIQ } from "@/lib/format";
import {
  getDesignByStudent,
  getStaffOrderById,
  updateOrderStatus,
} from "@/lib/staff";
import type { StaffDesign, StaffOrder } from "@/lib/staff-types";
import type { OrderStatus } from "@/lib/types";

function resolveImageUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  const base =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
    "http://localhost:4000";
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

export default function StaffOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params.orderId as string;

  const [order, setOrder] = useState<StaffOrder | null>(null);
  const [design, setDesign] = useState<StaffDesign | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const o = await getStaffOrderById(orderId);
      if (!o) {
        toast.error("الطلب غير موجود");
        router.replace("/staff");
        return;
      }
      setOrder(o);
      const d = await getDesignByStudent(o.studentId);
      setDesign(d);
    } catch {
      toast.error("تعذر تحميل تفاصيل الطلب");
    } finally {
      setLoading(false);
    }
  }, [orderId, router]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleStatusChange(next: OrderStatus, label: string) {
    if (!order) return;
    setActionLoading(true);
    try {
      await updateOrderStatus(order.id, next);
      toast.success(label);
      setOrder({ ...order, status: next });
      load();
    } catch {
      toast.error("تعذر تحديث الحالة");
    } finally {
      setActionLoading(false);
    }
  }

  if (loading || !order || !design) {
    return <PageLoader />;
  }

  const exportInput = {
    leftCanvas: design.left_canvas,
    rightCanvas: design.right_canvas,
    sashColor: design.sash_color,
    fontsUsed: design.fonts_used || [],
  };

  const logoUrl = resolveImageUrl(design.logo_url);
  const extraUrl = resolveImageUrl(design.extra_image_url);

  const canStartPrint =
    order.status === "design_complete" || order.status === "staff_review";

  return (
    <div>
      <div className="mb-4">
        <Link
          href="/staff"
          className="text-sm text-orange hover:underline"
        >
          ← العودة للطلبات
        </Link>
      </div>

      <PageHeader
        title={order.studentName}
        subtitle={`${ORDER_STATUS_LABELS[order.status]} · ${order.productName}`}
      />

      <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
        <section className="rounded-xl border border-ink/10 bg-white p-4 lg:p-6">
          <h2 className="mb-4 font-display text-lg font-bold text-ink">
            معاينة التصميم
          </h2>
          <DesignViewer
            sashColor={design.sash_color}
            leftCanvas={design.left_canvas}
            rightCanvas={design.right_canvas}
          />
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <ExportPngButton
              design={exportInput}
              studentName={order.studentName}
            />
            <PdfExportButton
              design={exportInput}
              studentName={order.studentName}
            />
          </div>
        </section>

        <section className="space-y-4">
          <article className="rounded-xl border border-ink/10 bg-white p-5">
            <h2 className="font-display text-lg font-bold text-ink">
              بيانات الطالب
            </h2>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-ink/50">الهاتف</dt>
                <dd dir="ltr">{design.phone}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink/50">الجامعة</dt>
                <dd>{design.university_name || order.universityName || "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink/50">القسم</dt>
                <dd>{design.department || order.department || "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink/50">لون الوشاح</dt>
                <dd>{design.sash_color || "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink/50">تاريخ الطلب</dt>
                <dd>{formatDateIQ(order.createdAt)}</dd>
              </div>
            </dl>
          </article>

          {design.notes && (
            <article className="rounded-xl border border-orange/30 bg-orange/5 p-5">
              <h3 className="text-sm font-semibold text-ink">ملاحظات الطالب</h3>
              <p className="mt-2 text-sm text-ink/80">{design.notes}</p>
            </article>
          )}

          {design.fonts_used?.length > 0 && (
            <article className="rounded-xl border border-ink/10 bg-white p-5">
              <h3 className="text-sm font-semibold text-ink">الخطوط المستخدمة</h3>
              <p className="mt-2 text-sm text-ink/70" dir="ltr">
                {design.fonts_used.join(" · ")}
              </p>
            </article>
          )}

          {(logoUrl || extraUrl) && (
            <article className="rounded-xl border border-ink/10 bg-white p-5">
              <h3 className="mb-3 text-sm font-semibold text-ink">المرفقات</h3>
              <div className="flex flex-col gap-4 sm:flex-row">
                {logoUrl && (
                  <div>
                    <p className="mb-2 text-xs text-ink/50">شعار الجامعة</p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={logoUrl}
                      alt="شعار الجامعة"
                      className="max-h-40 rounded-lg border border-ink/10 object-contain"
                    />
                  </div>
                )}
                {extraUrl && (
                  <div>
                    <p className="mb-2 text-xs text-ink/50">صورة إضافية</p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={extraUrl}
                      alt="صورة إضافية"
                      className="max-h-40 rounded-lg border border-ink/10 object-contain"
                    />
                  </div>
                )}
              </div>
            </article>
          )}

          <article className="rounded-xl border border-ink/10 bg-white p-5">
            <h3 className="mb-4 text-sm font-semibold text-ink">إجراءات</h3>
            <div className="flex flex-col gap-2">
              {canStartPrint && (
                <Button
                  fullWidth
                  loading={actionLoading}
                  onClick={() =>
                    handleStatusChange("printing", "تم بدء الطباعة")
                  }
                >
                  بدء الطباعة
                </Button>
              )}
              {order.status === "printing" && (
                <Button
                  variant="secondary"
                  fullWidth
                  loading={actionLoading}
                  onClick={() =>
                    handleStatusChange("ready", "تم وضع الطلب كجاهز للاستلام")
                  }
                >
                  جاهز للاستلام
                </Button>
              )}
            </div>
          </article>
        </section>
      </div>
    </div>
  );
}
