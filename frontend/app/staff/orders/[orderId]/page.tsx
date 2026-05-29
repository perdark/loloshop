"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { StaffOrderBreakdown } from "@/components/staff/StaffOrderBreakdown";
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
import { getOrderBreakdown } from "@/lib/orders";
import { listFonts } from "@/lib/designer";
import type { StaffDesign, StaffOrder } from "@/lib/staff-types";
import type { FontDef, OrderBreakdownDetail, OrderStatus } from "@/lib/types";

/**
 * Build a Google Fonts direct TTF download URL for a given font family name.
 * Google Fonts serves static TTFs at a predictable path on fonts.gstatic.com.
 * This URL opens the Google Fonts page which lets the user download the family.
 */
function googleFontsPageUrl(fontId: string): string {
  // Convert kebab-case id to Title Case family name for the Google Fonts URL
  const family = fontId
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("+");
  return `https://fonts.google.com/specimen/${family}`;
}

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
  const [breakdown, setBreakdown] = useState<OrderBreakdownDetail | null>(null);
  // Font catalogue — needed to map font IDs to display names (all Google Fonts currently)
  const [fontCatalogue, setFontCatalogue] = useState<FontDef[]>([]);
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
      // design may be null when order exists but student hasn't saved yet — do NOT block on it
      const [d, bd, fonts] = await Promise.all([
        getDesignByStudent(o.studentId).catch(() => null),
        getOrderBreakdown(orderId).catch(() => null),
        listFonts().catch(() => [] as FontDef[]),
      ]);
      setDesign(d);
      setBreakdown(bd);
      setFontCatalogue(fonts);
    } catch {
      toast.error("تعذر تحميل تفاصيل الطلب");
    } finally {
      setLoading(false);
    }
  }, [orderId, router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
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

  // Show spinner only while the order itself is loading — design null is handled inline
  if (loading || !order) {
    return <PageLoader />;
  }

  const exportInput = design
    ? {
        leftCanvas: design.left_canvas,
        rightCanvas: design.right_canvas,
        sashColor: design.sash_color,
        fontsUsed: design.fonts_used || [],
      }
    : null;

  const logoUrl = design ? resolveImageUrl(design.logo_url) : null;
  const extraUrl = design ? resolveImageUrl(design.extra_image_url) : null;

  const canStartPrint =
    order.status === "design_complete" || order.status === "staff_review";

  return (
    <div>
      <div className="mb-4">
        <Link
          href="/staff"
          className="inline-flex text-sm font-medium text-orange-ink hover:underline"
        >
          ← العودة للطلبات
        </Link>
      </div>

      <PageHeader
        title={order.studentName}
        subtitle={`${ORDER_STATUS_LABELS[order.status]} · ${order.productName}`}
      />

      <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
        {/* ── Design preview panel ── */}
        <section className="rounded-3xl border border-ink/10 bg-white p-4 shadow-[var(--shadow-card)] lg:p-6">
          <h2 className="section-heading mb-4 font-display text-lg font-bold text-ink">
            معاينة التصميم
          </h2>

          {design ? (
            <>
              <DesignViewer
                sashColor={design.sash_color}
                leftCanvas={design.left_canvas}
                rightCanvas={design.right_canvas}
                fontsUsed={design.fonts_used || []}
              />
              {exportInput && (
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
              )}
            </>
          ) : (
            <div className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-ink/20 bg-cream/50 p-6 text-center">
              <span className="text-2xl" aria-hidden="true">🎨</span>
              <p className="text-sm font-medium text-ink/70">لا يوجد تصميم محفوظ بعد</p>
              <p className="text-xs text-ink/45">لم يكمل الطالب تصميم الوشاح حتى الآن</p>
            </div>
          )}
        </section>

        {/* ── Student data + attachments ── */}
        <section className="space-y-4">
          <article className="rounded-2xl border border-ink/10 bg-white p-5 shadow-[var(--shadow-soft)]">
            <h2 className="font-display text-lg font-bold text-ink">
              بيانات الطالب
            </h2>
            <dl className="mt-4 space-y-2.5 text-sm">
              {/* Phone comes from design row; fall back gracefully if no design */}
              {design?.phone && (
                <div className="flex justify-between gap-4 border-b border-ink/5 pb-2.5">
                  <dt className="text-ink/50">الهاتف</dt>
                  <dd dir="ltr">{design.phone}</dd>
                </div>
              )}
              <div className="flex justify-between gap-4 border-b border-ink/5 pb-2.5">
                <dt className="text-ink/50">الجامعة</dt>
                <dd className="font-medium text-ink">
                  {design?.university_name || order.universityName || "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-ink/5 pb-2.5">
                <dt className="text-ink/50">القسم</dt>
                <dd className="font-medium text-ink">
                  {design?.department || order.department || "—"}
                </dd>
              </div>
              {design?.sash_color && (
                <div className="flex justify-between gap-4 border-b border-ink/5 pb-2.5">
                  <dt className="text-ink/50">لون الوشاح</dt>
                  <dd className="font-medium text-ink">{design.sash_color}</dd>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <dt className="text-ink/50">تاريخ الطلب</dt>
                <dd className="font-medium text-ink">{formatDateIQ(order.createdAt)}</dd>
              </div>
            </dl>
          </article>

          {design?.notes && (
            <article className="rounded-2xl border border-orange/30 bg-orange/5 p-5 shadow-[var(--shadow-soft)]">
              <h3 className="text-sm font-semibold text-orange-ink">ملاحظات الطالب</h3>
              <p className="mt-2 text-sm text-ink/80">{design.notes}</p>
            </article>
          )}

          {/* ── Fonts used — with download links ── */}
          {design?.fonts_used && design.fonts_used.length > 0 && (
            <article className="rounded-2xl border border-ink/10 bg-white p-5 shadow-[var(--shadow-soft)]">
              <h3 className="mb-3 text-sm font-semibold text-ink">الخطوط المستخدمة</h3>
              <ul className="space-y-2">
                {design.fonts_used.map((fontId) => {
                  const meta = fontCatalogue.find((f) => f.id === fontId);
                  const displayName = meta?.name_ar || fontId;
                  // Backend supplies file_url — a direct download of the real font
                  // files (Google zip for google-source, /uploads path for local).
                  // Fall back to the specimen page only if it's somehow missing.
                  const downloadHref = meta?.file_url || googleFontsPageUrl(fontId);
                  return (
                    <li key={fontId} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-ink/80" dir="ltr">{displayName}</span>
                      <a
                        href={downloadHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[44px] inline-flex items-center rounded-lg bg-cream px-3 py-1 text-xs font-medium text-orange-ink hover:bg-orange/10 transition-colors"
                        aria-label={`تنزيل خط ${displayName} من Google Fonts`}
                      >
                        تنزيل الخط
                      </a>
                    </li>
                  );
                })}
              </ul>
            </article>
          )}

          {breakdown && <StaffOrderBreakdown detail={breakdown} />}

          {/* ── Attachments with explicit download buttons ── */}
          {(logoUrl || extraUrl) && (
            <article className="rounded-2xl border border-ink/10 bg-white p-5 shadow-[var(--shadow-soft)]">
              <h3 className="mb-3 text-sm font-semibold text-ink">المرفقات</h3>
              <div className="flex flex-col gap-6 sm:flex-row">
                {logoUrl && (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs text-ink/50">شعار الجامعة</p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={logoUrl}
                      alt="شعار الجامعة"
                      className="max-h-40 rounded-xl border border-ink/10 bg-cream object-contain shadow-[var(--shadow-soft)]"
                    />
                    <a
                      href={logoUrl}
                      download
                      className="mt-1 min-h-[44px] inline-flex items-center justify-center rounded-xl border border-orange/40 bg-cream px-4 py-2 text-sm font-medium text-orange-ink hover:bg-orange/10 transition-colors"
                    >
                      تنزيل الشعار
                    </a>
                  </div>
                )}
                {extraUrl && (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs text-ink/50">صورة إضافية</p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={extraUrl}
                      alt="صورة إضافية"
                      className="max-h-40 rounded-xl border border-ink/10 bg-cream object-contain shadow-[var(--shadow-soft)]"
                    />
                    <a
                      href={extraUrl}
                      download
                      className="mt-1 min-h-[44px] inline-flex items-center justify-center rounded-xl border border-orange/40 bg-cream px-4 py-2 text-sm font-medium text-orange-ink hover:bg-orange/10 transition-colors"
                    >
                      تنزيل الصورة
                    </a>
                  </div>
                )}
              </div>
            </article>
          )}

          <article className="rounded-2xl border border-ink/10 bg-white p-5 shadow-[var(--shadow-soft)]">
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
