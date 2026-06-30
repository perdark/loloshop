"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { toast } from "sonner";
import {
  getReturnedOrders,
  configureOrder,
  type ReturnedOrder,
  type ReturnedOrderSelection,
  type ConfigureSelectionPayload,
} from "@/lib/orders";
import type { RobeMeasurements } from "@/lib/types";
import { resolveCatalogMediaUrl } from "@/lib/catalog";
import { uploadDesignImage } from "@/lib/designer";
import { getApiErrorMessage } from "@/lib/api";
import { isAuthenticated, loginHref } from "@/lib/auth";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";

/** A line the student may edit (typed text and/or reference photo). */
function isEditable(s: ReturnedOrderSelection): boolean {
  return (
    s.requires_text ||
    s.requires_image ||
    !!s.customer_text ||
    !!s.customer_image_url
  );
}

export default function ReturnedOrdersPage() {
  const [orders, setOrders] = useState<ReturnedOrder[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const authed = isAuthenticated();

  async function load() {
    setLoadError(false);
    try {
      setOrders(await getReturnedOrders());
    } catch (err) {
      setLoadError(true);
      toast.error(getApiErrorMessage(err, "تعذر تحميل الطلبات"));
    }
  }

  useEffect(() => {
    if (authed) load();
  }, [authed]);

  if (!authed) {
    return (
      <div dir="rtl" lang="ar" className="px-4 py-10">
        <EmptyState
          title="سجّل الدخول"
          message="سجّل الدخول لعرض الطلبات التي أُرجعت إليك لتعديلها."
          action={
            <Link href={loginHref("/returned-orders")}>
              <Button>تسجيل الدخول</Button>
            </Link>
          }
        />
      </div>
    );
  }

  if (orders === null && !loadError) return <PageLoader />;

  return (
    <div dir="rtl" lang="ar" className="mx-auto w-full max-w-2xl px-4 py-6">
      <header className="mb-5">
        <h1 className="font-display-ar text-2xl font-bold text-ink">طلبات بانتظار تعديلك</h1>
        <p className="mt-1 text-sm text-ink-soft">
          أعاد لك الفريق هذه الطلبات لتعديلها وإعادة إرسالها.
        </p>
      </header>

      {loadError ? (
        <EmptyState
          message="حدث خطأ أثناء التحميل."
          action={<Button onClick={load}>إعادة المحاولة</Button>}
        />
      ) : orders && orders.length === 0 ? (
        <EmptyState
          title="لا توجد طلبات"
          message="ليست لديك طلبات بانتظار التعديل حالياً."
          action={
            <Link href="/">
              <Button variant="ghost">العودة للمتجر</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-5">
          {(orders ?? []).map((order) => (
            <ReturnedOrderCard
              key={order.id}
              order={order}
              onResubmitted={() =>
                setOrders((prev) => (prev ?? []).filter((o) => o.id !== order.id))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReturnedOrderCard({
  order,
  onResubmitted,
}: {
  order: ReturnedOrder;
  onResubmitted: () => void;
}) {
  // Editable values keyed by `${group_id}:${option_id}`.
  const key = (s: ReturnedOrderSelection) => `${s.group_id}:${s.option_id}`;
  const [texts, setTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(order.selections.map((s) => [key(s), s.customer_text ?? ""]))
  );
  const [images, setImages] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      order.selections
        .filter((s) => s.customer_image_url)
        .map((s) => [key(s), s.customer_image_url as string])
    )
  );
  const [measurements, setMeasurements] = useState<RobeMeasurements | null>(
    order.measurements ?? null
  );
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isRobe = order.product_type === "robe";
  const productImg = resolveCatalogMediaUrl(order.product_image_url);

  async function handleUpload(s: ReturnedOrderSelection, file: File) {
    const k = key(s);
    setUploadingKey(k);
    try {
      const url = await uploadDesignImage(file);
      setImages((p) => ({ ...p, [k]: url }));
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر رفع الصورة"));
    } finally {
      setUploadingKey(null);
    }
  }

  function updateMeasure(field: keyof RobeMeasurements, raw: string) {
    const num = field === "tailor_notes" ? raw : Number(raw.replace(/[^\d.]/g, ""));
    setMeasurements((p) => ({ ...(p ?? ({} as RobeMeasurements)), [field]: num }));
  }

  async function handleResubmit() {
    // Client-side required-field guard (backend re-validates too).
    for (const s of order.selections) {
      const k = key(s);
      if (s.requires_text && !texts[k]?.trim()) {
        toast.error(`يرجى تعبئة: ${s.group_name ?? s.label}`);
        return;
      }
      if (s.requires_image && !images[k]) {
        toast.error(`يرجى رفع صورة لـ: ${s.group_name ?? s.label}`);
        return;
      }
    }
    if (uploadingKey) {
      toast.error("يرجى الانتظار حتى يكتمل رفع الصورة.");
      return;
    }

    const selections: ConfigureSelectionPayload[] = order.selections.map((s) => {
      const k = key(s);
      const row: ConfigureSelectionPayload = {
        group_id: s.group_id,
        option_id: s.option_id,
      };
      if (s.qty && s.qty > 1) row.qty = s.qty;
      const t = texts[k]?.trim();
      if (t) row.customer_text = t;
      if (images[k]) row.customer_image_url = images[k];
      return row;
    });

    setSubmitting(true);
    try {
      await configureOrder({
        productId: order.product_id,
        designId: order.design_id ?? undefined,
        selections,
        measurements: isRobe && measurements ? measurements : undefined,
      });
      toast.success("تم إرسال الطلب من جديد ✓");
      onResubmitted();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر إرسال الطلب"));
    } finally {
      setSubmitting(false);
    }
  }

  const editableLines = order.selections.filter(isEditable);
  const readonlyLines = order.selections.filter((s) => !isEditable(s));

  return (
    <article className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-soft)]">
      {/* Header: product + return reason */}
      <div className="flex items-start gap-3 border-b border-line p-4">
        {productImg && (
          <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-beige">
            <Image src={productImg} alt={order.product_name} fill className="object-cover" sizes="64px" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="font-display-ar text-base font-bold text-ink">{order.product_name}</h2>
          <div
            role="alert"
            className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800"
            style={{ borderInlineStart: "4px solid #dc2626" }}
          >
            <p className="font-semibold">أُرجِع الطلب لتعديله</p>
            {order.returned_reason && <p className="mt-0.5 text-red-700">{order.returned_reason}</p>}
          </div>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {editableLines.length === 0 && !isRobe && (
          <p className="text-sm text-ink-soft">
            لا توجد حقول لتعديلها — يمكنك إعادة الإرسال مباشرة، أو التواصل معنا لأي تغيير.
          </p>
        )}

        {/* Editable spec lines */}
        {editableLines.map((s) => {
          const k = key(s);
          const showText = s.requires_text || !!s.customer_text;
          const showImage = s.requires_image || !!s.customer_image_url;
          const imgUrl = resolveCatalogMediaUrl(images[k]);
          return (
            <div key={k} className="rounded-xl border border-line bg-beige/40 p-3">
              <p className="mb-2 text-sm font-semibold text-ink">
                {s.group_name ?? s.label}
                {(s.requires_text || s.requires_image) && (
                  <span className="text-red-600"> *</span>
                )}
              </p>

              {showText && (
                <textarea
                  value={texts[k] ?? ""}
                  onChange={(e) => setTexts((p) => ({ ...p, [k]: e.target.value }))}
                  rows={2}
                  placeholder="اكتب التفاصيل…"
                  dir="rtl"
                  className="min-h-[44px] w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20"
                />
              )}

              {showImage && (
                <div className="mt-2">
                  {imgUrl && (
                    <span className="relative mb-2 block h-28 w-28 overflow-hidden rounded-lg border border-line bg-surface">
                      <Image src={imgUrl} alt="" fill className="object-contain" sizes="112px" />
                    </span>
                  )}
                  <label className="inline-flex min-h-[44px] cursor-pointer items-center rounded-full border border-orange-ink/40 bg-surface px-4 text-sm font-medium text-orange-ink transition-colors hover:bg-orange-ink/[0.06]">
                    {uploadingKey === k ? "جارٍ الرفع…" : imgUrl ? "تغيير الصورة" : "رفع صورة"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={uploadingKey === k}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleUpload(s, f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              )}
            </div>
          );
        })}

        {/* Robe measurements */}
        {isRobe && (
          <div className="rounded-xl border border-line bg-beige/40 p-3">
            <p className="mb-2 text-sm font-semibold text-ink">قياسات الروب <span className="text-red-600">*</span></p>
            <div className="grid grid-cols-2 gap-2">
              {([
                ["shoulder_cm", "الكتف (سم)"],
                ["chest_cm", "الصدر (سم)"],
                ["robe_length_cm", "الطول (سم)"],
                ["sleeve_length_cm", "الكم (سم)"],
              ] as [keyof RobeMeasurements, string][]).map(([field, label]) => (
                <label key={field} className="text-xs text-ink-soft">
                  {label}
                  <input
                    type="number"
                    inputMode="decimal"
                    value={
                      measurements && measurements[field] != null
                        ? String(measurements[field])
                        : ""
                    }
                    onChange={(e) => updateMeasure(field, e.target.value)}
                    className="mt-1 min-h-[44px] w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20"
                  />
                </label>
              ))}
            </div>
            <label className="mt-2 block text-xs text-ink-soft">
              ملاحظات للفصال
              <textarea
                value={measurements?.tailor_notes ?? ""}
                onChange={(e) => updateMeasure("tailor_notes", e.target.value)}
                rows={2}
                dir="rtl"
                className="mt-1 min-h-[44px] w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20"
              />
            </label>
          </div>
        )}

        {/* Read-only option choices (cannot be changed here) */}
        {readonlyLines.length > 0 && (
          <div className="rounded-xl border border-dashed border-line p-3 text-sm text-ink-soft">
            <p className="mb-1 font-medium text-ink">اختياراتك</p>
            <ul className="space-y-0.5">
              {readonlyLines.map((s) => (
                <li key={key(s)}>• {s.label}</li>
              ))}
            </ul>
          </div>
        )}

        <Button fullWidth loading={submitting} onClick={handleResubmit}>
          إعادة الإرسال
        </Button>
      </div>
    </article>
  );
}
