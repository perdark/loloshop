"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { DesignViewer } from "@/components/staff/DesignViewer";
import { ExportPngButton } from "@/components/staff/ExportPngButton";
import { PdfExportButton } from "@/components/staff/PdfExportButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ORDER_SOURCE_LABELS, ORDER_STATUS_LABELS } from "@/lib/constants";
import { formatDateIQ } from "@/lib/format";
import {
  getProductionOrder,
  advanceOrder,
  approveDesign,
  rejectDesign,
} from "@/lib/staff";
import { listFonts } from "@/lib/designer";
import { getApiErrorMessage } from "@/lib/api";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import type { ProductionOrderDetail } from "@/lib/staff-types";
import type { FontDef } from "@/lib/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function googleFontsPageUrl(fontId: string): string {
  const family = fontId
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("+");
  return `https://fonts.google.com/specimen/${family}`;
}

function resolveImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  const base =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
    "http://localhost:4000";
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

// ─── Stage-advance button labels ─────────────────────────────────────────────

const ADVANCE_LABELS: Partial<Record<string, string>> = {
  design_complete: "إرسال للتطريز",
  embroidery:      "إنهاء التطريز، نقل للكوي",
  pressing:        "إنهاء الكوي، نقل للتجهيز",
  preparing:       "إنهاء التجهيز، تحديد جاهز",
  ready:           "تأكيد التسليم",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProductionOrderDetailPage() {
  const params = useParams();
  const orderId = params.orderId as string;

  const { user } = useRequireAuth(["staff", "admin"]);

  const [detail, setDetail] = useState<ProductionOrderDetail | null>(null);
  const [fontCatalogue, setFontCatalogue] = useState<FontDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Reject modal state
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectSubmitting, setRejectSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(false);
    try {
      const [d, fonts] = await Promise.all([
        getProductionOrder(orderId),
        listFonts().catch(() => [] as FontDef[]),
      ]);
      setDetail(d);
      setFontCatalogue(fonts);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر تحميل تفاصيل الطلب"));
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdvance() {
    if (!detail) return;
    setActionLoading(true);
    try {
      const updated = await advanceOrder(detail.order.id);
      toast.success(
        `تم النقل إلى: ${ORDER_STATUS_LABELS[updated.status] ?? updated.status}`
      );
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر تحديث الحالة"));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleApprove() {
    if (!detail?.design) return;
    setActionLoading(true);
    try {
      await approveDesign(detail.design.id);
      toast.success("تمت الموافقة على التصميم");
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر الموافقة على التصميم"));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReject() {
    if (!detail?.design || !rejectReason.trim()) {
      toast.error("يرجى كتابة سبب الرفض");
      return;
    }
    setRejectSubmitting(true);
    try {
      await rejectDesign(detail.design.id, rejectReason.trim());
      toast.success("تم رفض التصميم");
      setRejectOpen(false);
      setRejectReason("");
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر رفض التصميم"));
    } finally {
      setRejectSubmitting(false);
    }
  }

  // ── Loading skeleton ──
  if (loading) {
    return (
      <div dir="rtl" lang="ar" className="space-y-6 animate-fade-page-in" aria-hidden>
        <div className="skeleton h-5 w-32 rounded-full" />
        <div className="skeleton h-9 w-56 rounded-xl" />
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="skeleton h-96 rounded-3xl" />
          <div className="space-y-4">
            <div className="skeleton h-40 rounded-2xl" />
            <div className="skeleton h-32 rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  // ── Error state ──
  if (fetchError || !detail) {
    return (
      <div dir="rtl" lang="ar" className="space-y-4">
        <Link
          href="/staff"
          className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-orange-ink transition-colors hover:text-orange-ink"
        >
          <span aria-hidden>→</span> العودة
        </Link>
        <div className="rounded-2xl border border-[var(--color-danger)]/25 bg-[var(--shop-sink)] px-6 py-10 text-center">
          <p className="text-base font-semibold text-ink">تعذر تحميل تفاصيل الطلب</p>
          <p className="mt-1 text-sm text-ink-soft">تحقق من اتصالك ثم أعد المحاولة.</p>
          <Button className="mt-4" onClick={load}>
            إعادة المحاولة
          </Button>
        </div>
      </div>
    );
  }

  const { order, design, items, package_orders, bundle, can_see_design } = detail;
  const staffType = user?.staff_type;

  // Admin is treated as manager throughout production.
  const isManager = user?.role === "admin" || staffType === "manager";

  // Resolve image URLs
  const logoUrl = design ? resolveImageUrl(design.logo_url) : null;
  const extraUrl = design ? resolveImageUrl(design.extra_image_url) : null;

  // Canvas available only when server says so
  const showCanvas = can_see_design && design?.left_canvas != null;

  // Determine which action buttons to show
  const showApproveReject =
    (staffType === "designer" || isManager) &&
    design?.approval_status === "pending" &&
    order.status === "design_complete";

  const showAdvance =
    ADVANCE_LABELS[order.status] !== undefined &&
    (isManager ||
      (staffType === "designer" &&
        order.status === "design_complete" &&
        design?.approval_status === "approved") ||
      (staffType === "embroiderer" && order.status === "embroidery") ||
      (staffType === "presser" && order.status === "pressing") ||
      (staffType === "preparer" &&
        (order.status === "preparing" || order.status === "ready")));

  const advanceLabel = ADVANCE_LABELS[order.status] ?? "تقدم للمرحلة التالية";

  const exportInput =
    showCanvas && design
      ? {
          leftCanvas: design.left_canvas ?? null,
          rightCanvas: design.right_canvas ?? null,
          sashColor: design.sash_color,
          fontsUsed: design.fonts_used ?? [],
        }
      : null;

  return (
    <div dir="rtl" lang="ar">
      <div className="mb-4">
        <Link
          href="/staff"
          className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-orange-ink transition-colors hover:text-orange-ink"
        >
          <span aria-hidden>→</span> العودة
        </Link>
      </div>

      <PageHeader
        title={order.student_name}
        subtitle={`${ORDER_STATUS_LABELS[order.status] ?? order.status} · ${order.product_name}`}
      />

      <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
        {/* ── Design / sash preview panel ── */}
        <section className="rounded-3xl border border-line bg-surface p-4 shadow-[var(--shadow-card)] lg:p-6">
          <h2 className="mb-4 font-display-ar text-lg font-bold text-ink">
            {can_see_design ? "معاينة التصميم" : "بيانات الوشاح"}
          </h2>

          {can_see_design && showCanvas && design ? (
            <>
              <DesignViewer
                sashColor={design.sash_color}
                leftCanvas={design.left_canvas ?? null}
                rightCanvas={design.right_canvas ?? null}
                fontsUsed={design.fonts_used ?? []}
              />
              {exportInput && (
                <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <ExportPngButton
                    design={exportInput}
                    studentName={order.student_name}
                  />
                  <PdfExportButton
                    design={exportInput}
                    studentName={order.student_name}
                  />
                </div>
              )}
            </>
          ) : can_see_design && !showCanvas ? (
            <div className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-surface-sink p-6 text-center">
              <p className="text-sm font-medium text-ink-soft">
                لا يوجد تصميم محفوظ بعد
              </p>
              <p className="text-xs text-muted">
                لم يكمل الطالب تصميم الوشاح حتى الآن
              </p>
            </div>
          ) : (
            /* Presser: sash color swatch — fabric identification only, no artwork */
            <div className="space-y-4">
              {design?.sash_color ? (
                <div className="flex items-center gap-4 rounded-2xl border border-line bg-surface-sink p-5">
                  <span
                    className="h-12 w-12 shrink-0 rounded-xl border border-line shadow-[var(--shadow-soft)]"
                    style={{ backgroundColor: design.sash_color }}
                    aria-hidden
                  />
                  <div>
                    <p className="text-xs font-medium text-muted">لون الوشاح</p>
                    <p className="mt-0.5 font-bold text-ink" dir="ltr">{design.sash_color}</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-ink-soft">
                  لا تتوفر بيانات تصميم لهذا الدور
                </p>
              )}
              <p className="rounded-xl border border-line bg-[var(--shop-sink)] px-3 py-2 text-xs text-ink-soft">
                لا تتوفر بيانات التصميم لدور الكوي — فقط اللون معروض.
              </p>
            </div>
          )}
        </section>

        {/* ── Side panel ── */}
        <section className="space-y-4">
          {/* Student info */}
          <article className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
            <h2 className="font-display-ar text-lg font-bold text-ink">
              بيانات الطالب
            </h2>
            <dl className="mt-4 space-y-2.5 text-sm">
              <div className="flex justify-between gap-4 border-b border-line pb-2.5">
                <dt className="text-muted">الهاتف</dt>
                <dd dir="ltr">{order.student_phone || "—"}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-line pb-2.5">
                <dt className="text-muted">الجامعة</dt>
                <dd className="font-medium text-ink">
                  {order.university_name || "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-line pb-2.5">
                <dt className="text-muted">القسم</dt>
                <dd className="font-medium text-ink">
                  {order.department || "—"}
                </dd>
              </div>
              {order.batch_name && (
                <div className="flex justify-between gap-4 border-b border-line pb-2.5">
                  <dt className="text-muted">الدفعة</dt>
                  <dd className="font-medium text-ink">{order.batch_name}</dd>
                </div>
              )}
              {order.deadline && (
                <div className="flex justify-between gap-4 border-b border-line pb-2.5">
                  <dt className="text-muted">الموعد النهائي</dt>
                  <dd className="font-medium text-ink">{order.deadline}</dd>
                </div>
              )}
              {order.source && (
                <div className="flex justify-between gap-4 border-b border-line pb-2.5">
                  <dt className="text-muted">مصدر الطلب</dt>
                  <dd>
                    {order.source === "wholesaler" ? (
                      <span className="inline-flex rounded-full border border-orange-ink/25 bg-orange-ink/8 px-2.5 py-0.5 text-xs font-semibold text-orange-ink">
                        {order.wholesaler_name
                          ? `ممثل: ${order.wholesaler_name}`
                          : ORDER_SOURCE_LABELS.wholesaler}
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full border border-line bg-surface-sink px-2.5 py-0.5 text-xs font-semibold text-ink-soft">
                        {ORDER_SOURCE_LABELS.retail}
                      </span>
                    )}
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <dt className="text-muted">تاريخ الطلب</dt>
                <dd className="font-medium text-ink">
                  {formatDateIQ(order.created_at)}
                </dd>
              </div>
            </dl>
          </article>

          {/* Design notes */}
          {design?.notes && (
            <article className="rounded-2xl border border-orange-ink/20 bg-orange-ink/5 p-5 shadow-[var(--shadow-soft)]">
              <h3 className="text-sm font-semibold text-orange-ink">
                ملاحظات الطالب
              </h3>
              <p className="mt-2 text-sm text-ink-soft">{design.notes}</p>
            </article>
          )}

          {/* Rejection reason */}
          {design?.approval_status === "rejected" && design.rejection_reason && (
            <article className="rounded-2xl border border-danger/20 bg-danger/5 p-5">
              <h3 className="text-sm font-semibold text-danger">سبب الرفض</h3>
              <p className="mt-2 text-sm text-ink-soft">
                {design.rejection_reason}
              </p>
            </article>
          )}

          {/* Options breakdown */}
          {items.length > 0 && (
            <article className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
              <h3 className="mb-3 text-sm font-semibold text-ink">
                خيارات الطلب
              </h3>
              <ul className="space-y-2">
                {items.map((item, idx) => (
                  <li
                    key={idx}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span className="text-ink-soft">{item.label_snapshot}</span>
                    {item.customer_image_url && (
                      <a
                        href={
                          resolveImageUrl(item.customer_image_url) ?? "#"
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-[44px] items-center rounded-lg border border-orange-ink/25 bg-surface-sink px-3 py-1 text-xs font-medium text-orange-ink transition-colors hover:bg-orange-ink/10"
                      >
                        صورة العميل
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </article>
          )}

          {/* Full package context — new bundle field (preferred) */}
          {bundle && bundle.length > 0 && (
            <article className="rounded-2xl border-2 border-orange-ink/20 bg-orange-ink/5 p-5 shadow-[var(--shadow-soft)]">
              <h3 className="mb-3 font-display-ar text-sm font-bold text-ink">
                الباقة الكاملة
              </h3>
              <ul className="space-y-2">
                {bundle.map((bi) => (
                  <li
                    key={bi.id}
                    className={`flex min-h-[44px] items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm transition-colors ${
                      bi.is_current
                        ? "border border-orange-ink/30 bg-orange-ink/10"
                        : "border border-line bg-surface hover:bg-surface-sink"
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      {bi.is_current ? (
                        <span
                          className="font-semibold text-orange-ink"
                          aria-label="الطلب الحالي"
                        >
                          {bi.product_name}
                        </span>
                      ) : (
                        <Link
                          href={`/staff/orders/${bi.id}`}
                          className="font-medium text-ink hover:text-orange-ink hover:underline"
                        >
                          {bi.product_name}
                        </Link>
                      )}
                      {bi.is_current && (
                        <span className="shrink-0 rounded-full bg-orange-ink px-1.5 py-0.5 text-[10px] font-bold text-white">
                          الحالي
                        </span>
                      )}
                    </div>
                    <span className="shrink-0 rounded-full border border-line bg-surface-sink px-2 py-0.5 text-xs text-ink-soft">
                      {ORDER_STATUS_LABELS[bi.status] ?? bi.status}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          )}

          {/* Package siblings fallback — legacy package_orders field */}
          {!bundle && package_orders && package_orders.length > 0 && (
            <article className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
              <h3 className="mb-3 text-sm font-semibold text-ink">
                محتويات الحزمة
              </h3>
              <ul className="space-y-2">
                {package_orders.map((po) => (
                  <li
                    key={po.id}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <Link
                      href={`/staff/orders/${po.id}`}
                      className="font-medium text-orange-ink hover:underline"
                    >
                      {po.product_name}
                    </Link>
                    <span className="rounded-full border border-line bg-surface-sink px-2 py-0.5 text-xs text-ink-soft">
                      {ORDER_STATUS_LABELS[po.status] ?? po.status}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          )}

          {/* Fonts (embroiderer / manager) */}
          {can_see_design &&
            design?.fonts_used &&
            design.fonts_used.length > 0 && (
              <article className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
                <h3 className="mb-3 text-sm font-semibold text-ink">
                  الخطوط المستخدمة
                </h3>
                <ul className="space-y-2">
                  {design.fonts_used.map((fontId) => {
                    const meta = fontCatalogue.find((f) => f.id === fontId);
                    const displayName = meta?.name_ar || fontId;
                    const downloadHref =
                      meta?.file_url || googleFontsPageUrl(fontId);
                    return (
                      <li
                        key={fontId}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="text-ink-soft" dir="ltr">
                          {displayName}
                        </span>
                        <a
                          href={downloadHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-[44px] items-center rounded-lg border border-orange-ink/25 bg-surface-sink px-3 py-1 text-xs font-medium text-orange-ink transition-colors hover:bg-orange-ink/10"
                          aria-label={`تنزيل خط ${displayName}`}
                        >
                          تنزيل الخط
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </article>
            )}

          {/* Attachments */}
          {(logoUrl || extraUrl) && can_see_design && (
            <article className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
              <h3 className="mb-3 text-sm font-semibold text-ink">المرفقات</h3>
              <div className="flex flex-col gap-6 sm:flex-row">
                {logoUrl && (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs text-muted">شعار الجامعة</p>
                    <div className="relative h-40 w-40 overflow-hidden rounded-xl border border-line bg-surface-sink">
                      <Image
                        src={logoUrl}
                        alt="شعار الجامعة"
                        fill
                        sizes="160px"
                        className="object-contain"
                        loading="lazy"
                        unoptimized
                      />
                    </div>
                    <a
                      href={logoUrl}
                      download
                      className="mt-1 inline-flex min-h-[44px] items-center justify-center rounded-xl border border-orange-ink/30 bg-surface-sink px-4 py-2 text-sm font-medium text-orange-ink transition-colors hover:bg-orange-ink/10"
                    >
                      تنزيل الشعار
                    </a>
                  </div>
                )}
                {extraUrl && (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs text-muted">صورة إضافية</p>
                    <div className="relative h-40 w-40 overflow-hidden rounded-xl border border-line bg-surface-sink">
                      <Image
                        src={extraUrl}
                        alt="صورة إضافية"
                        fill
                        sizes="160px"
                        className="object-contain"
                        loading="lazy"
                        unoptimized
                      />
                    </div>
                    <a
                      href={extraUrl}
                      download
                      className="mt-1 inline-flex min-h-[44px] items-center justify-center rounded-xl border border-orange-ink/30 bg-surface-sink px-4 py-2 text-sm font-medium text-orange-ink transition-colors hover:bg-orange-ink/10"
                    >
                      تنزيل الصورة
                    </a>
                  </div>
                )}
              </div>
            </article>
          )}

          {/* ── Action buttons ── */}
          {(showApproveReject || showAdvance) && (
            <article className="rounded-[var(--radius-card)] border border-orange-ink/15 bg-warm-veil p-5 shadow-[var(--shadow-soft)]">
              <h3 className="mb-4 font-display-ar text-base font-bold text-ink">الإجراءات</h3>
              <div className="flex flex-col gap-2">
                {showApproveReject && (
                  <>
                    <Button
                      fullWidth
                      loading={actionLoading}
                      onClick={handleApprove}
                    >
                      موافقة على التصميم
                    </Button>
                    <Button
                      variant="danger"
                      fullWidth
                      loading={actionLoading}
                      onClick={() => setRejectOpen(true)}
                    >
                      رفض التصميم
                    </Button>
                  </>
                )}
                {showAdvance && (
                  <Button
                    variant={showApproveReject ? "secondary" : "primary"}
                    fullWidth
                    loading={actionLoading}
                    onClick={handleAdvance}
                  >
                    {advanceLabel}
                  </Button>
                )}
              </div>
            </article>
          )}
        </section>
      </div>

      {/* ── Reject reason modal ── */}
      <Modal
        open={rejectOpen}
        onClose={() => {
          setRejectOpen(false);
          setRejectReason("");
        }}
        title="رفض التصميم"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setRejectOpen(false);
                setRejectReason("");
              }}
            >
              إلغاء
            </Button>
            <Button
              variant="danger"
              loading={rejectSubmitting}
              onClick={handleReject}
            >
              تأكيد الرفض
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-ink-soft">
            أدخل سبب الرفض ليتمكن الطالب من تصحيح تصميمه.
          </p>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={4}
            placeholder="مثال: اللون لا يطابق المواصفات..."
            className="min-h-[88px] w-full resize-none rounded-xl border border-line bg-beige px-4 py-3 text-sm text-ink outline-none transition-colors focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20"
            dir="rtl"
          />
        </div>
      </Modal>
    </div>
  );
}
