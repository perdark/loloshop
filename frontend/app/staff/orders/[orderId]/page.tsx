"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { DesignViewer } from "@/components/staff/DesignViewer";
import { ExportPngButton } from "@/components/staff/ExportPngButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ORDER_SOURCE_LABELS, ORDER_STATUS_LABELS, PRODUCT_TYPE_LABELS } from "@/lib/constants";
import { formatDateIQ } from "@/lib/format";
import {
  getProductionOrder,
  advanceOrder,
  confirmDelivery,
  revertOrder,
  claimOrder,
  releaseOrder,
  uploadFinalDesign,
  approveDesign,
  rejectDesign,
} from "@/lib/staff";
import { getApiErrorMessage } from "@/lib/api";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import type { ProductionOrderDetail, ProductionOrderItem } from "@/lib/staff-types";
import type { StaffType } from "@/lib/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  const base =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
    "http://localhost:4000";
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

// ─── Final design upload widget ───────────────────────────────────────────────

function FinalDesignUpload({
  orderId,
  currentUrl,
  onUploaded,
}: {
  orderId: string;
  currentUrl: string | null | undefined;
  onUploaded: (url: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const result = await uploadFinalDesign(orderId, file);
      onUploaded(result.url);
      toast.success("تم رفع التصميم النهائي");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر رفع الملف"));
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  const resolvedUrl = resolveImageUrl(currentUrl);

  return (
    <article className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
      <h3 className="mb-3 text-sm font-semibold text-ink">معاينة التصميم النهائي</h3>

      {resolvedUrl && (
        <div className="mb-4">
          <a href={resolvedUrl} target="_blank" rel="noopener noreferrer">
            <div className="relative h-48 w-full overflow-hidden rounded-xl border border-line bg-surface-sink">
              <Image
                src={resolvedUrl}
                alt="التصميم النهائي"
                fill
                sizes="(max-width: 768px) 100vw, 50vw"
                className="object-contain"
                loading="eager"
                unoptimized
              />
            </div>
          </a>
          <a
            href={resolvedUrl}
            download
            className="mt-2 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-orange-ink/30 bg-surface-sink px-4 py-2 text-sm font-medium text-orange-ink transition-colors hover:bg-orange-ink/10"
          >
            تنزيل التصميم النهائي
          </a>
        </div>
      )}

      <div
        role="button"
        tabIndex={0}
        aria-label="اسحب وأفلت الصورة أو اختر ملف"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        className={[
          "flex min-h-[88px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 text-center transition-colors",
          dragOver
            ? "border-orange-ink bg-orange-ink/8"
            : "border-line bg-surface-sink hover:border-orange-ink/40 hover:bg-orange-ink/5",
          uploading ? "pointer-events-none opacity-60" : "",
        ].join(" ")}
      >
        {uploading ? (
          <span className="text-sm text-ink-soft">جارٍ الرفع...</span>
        ) : (
          <>
            <span className="text-2xl" aria-hidden>⬆</span>
            <span className="text-sm font-medium text-ink-soft">
              {currentUrl ? "استبدال الملف" : "اسحب وأفلت الصورة أو اختر ملف"}
            </span>
            <span className="text-xs text-muted">PNG / JPG / WebP</span>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={handleChange}
      />
    </article>
  );
}

// ─── Intake helpers ───────────────────────────────────────────────────────────

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.round(diff / 86_400_000);
}

function iqPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  return d ? (d.startsWith("0") ? `964${d.slice(1)}` : d) : null;
}

/** Countdown chip shared between intake card and Instagram copy. */
function EventChip({ eventDate }: { eventDate: string | null }) {
  const days = daysUntil(eventDate);
  if (days === null) return null;
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
        days === 0
          ? "bg-danger/15 text-danger"
          : days < 0
            ? "bg-ink/10 text-ink-soft"
            : days <= 7
              ? "bg-danger/10 text-danger"
              : "bg-ink/8 text-ink-soft"
      }`}
    >
      {days === 0 ? "اليوم" : days < 0 ? `قبل ${Math.abs(days)} يوم` : `حفلتهم بعد ${days} يوم`}
    </span>
  );
}

// ─── Intake Card ──────────────────────────────────────────────────────────────

function IntakeCard({
  intake,
  totalPrice,
}: {
  intake: NonNullable<ProductionOrderDetail["order"]["intake"]>;
  totalPrice?: number;
}) {
  const phone1 = iqPhone(intake.phone_primary);
  const phone2 = iqPhone(intake.phone_secondary);
  const remaining =
    totalPrice !== undefined && intake.deposit !== undefined
      ? totalPrice - intake.deposit
      : null;

  return (
    <article className="rounded-2xl border border-orange-ink/20 bg-orange-ink/5 p-5 shadow-[var(--shadow-soft)]">
      <h3 className="mb-3 font-display-ar text-sm font-bold text-ink">بيانات الطلبية (انستا)</h3>
      <dl className="space-y-2.5 text-sm">
        {intake.customer_name && (
          <div className="flex justify-between gap-4 border-b border-orange-ink/10 pb-2.5">
            <dt className="text-muted">الاسم</dt>
            <dd className="font-medium text-ink">{intake.customer_name}</dd>
          </div>
        )}
        {intake.instagram_username && (
          <div className="flex justify-between gap-4 border-b border-orange-ink/10 pb-2.5">
            <dt className="text-muted">انستغرام</dt>
            <dd>
              <a
                href={`https://instagram.com/${intake.instagram_username}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-orange-ink underline underline-offset-2"
                dir="ltr"
              >
                @{intake.instagram_username}
              </a>
            </dd>
          </div>
        )}
        {phone1 && (
          <div className="flex justify-between gap-4 border-b border-orange-ink/10 pb-2.5">
            <dt className="text-muted">الهاتف الأول</dt>
            <dd className="flex gap-2">
              <a href={`tel:+${phone1}`} className="font-medium text-ink tabular-nums" dir="ltr">
                +{phone1}
              </a>
              <a
                href={`https://wa.me/${phone1}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full bg-[#25D366]/15 px-2 py-0.5 text-xs font-semibold text-[#128C7E]"
              >
                واتساب
              </a>
            </dd>
          </div>
        )}
        {phone2 && (
          <div className="flex justify-between gap-4 border-b border-orange-ink/10 pb-2.5">
            <dt className="text-muted">الهاتف الثاني</dt>
            <dd className="flex gap-2">
              <a href={`tel:+${phone2}`} className="font-medium text-ink tabular-nums" dir="ltr">
                +{phone2}
              </a>
              <a
                href={`https://wa.me/${phone2}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full bg-[#25D366]/15 px-2 py-0.5 text-xs font-semibold text-[#128C7E]"
              >
                واتساب
              </a>
            </dd>
          </div>
        )}
        {(intake.governorate || intake.area_details) && (
          <div className="flex justify-between gap-4 border-b border-orange-ink/10 pb-2.5">
            <dt className="text-muted">العنوان</dt>
            <dd className="font-medium text-ink">
              {[intake.governorate, intake.area_details].filter(Boolean).join(" / ")}
            </dd>
          </div>
        )}
        {intake.event_date && (
          <div className="flex justify-between gap-4 border-b border-orange-ink/10 pb-2.5">
            <dt className="text-muted">تاريخ الحفلة</dt>
            <dd className="flex items-center gap-2">
              <span className="font-medium text-ink">{intake.event_date}</span>
              <EventChip eventDate={intake.event_date} />
            </dd>
          </div>
        )}
        {intake.deposit !== undefined && (
          <div className="flex justify-between gap-4 border-b border-orange-ink/10 pb-2.5">
            <dt className="text-muted">واصل</dt>
            <dd className="font-semibold tabular-nums text-ink" dir="ltr">
              {intake.deposit.toLocaleString("ar-IQ")} د.ع
            </dd>
          </div>
        )}
        {remaining !== null && (
          <div className="flex justify-between gap-4 border-b border-orange-ink/10 pb-2.5">
            <dt className="text-muted">المتبقي</dt>
            <dd className="font-semibold tabular-nums text-ink" dir="ltr">
              {Math.max(0, remaining).toLocaleString("ar-IQ")} د.ع
            </dd>
          </div>
        )}
        {intake.notes && (
          <div className="border-b border-orange-ink/10 pb-2.5">
            <dt className="mb-1 text-muted">ملاحظة</dt>
            <dd className="rounded-lg border border-orange-ink/15 bg-surface px-3 py-2 text-xs text-ink-soft">
              {intake.notes}
            </dd>
          </div>
        )}
      </dl>
    </article>
  );
}

// ─── Instagram-format copy button ─────────────────────────────────────────────

/** Parse label_snapshot 'GROUP: OPTION' → option value. Returns null if zone line. */
function parseOptionValue(label: string): { group: string; value: string } | null {
  const colonIdx = label.indexOf(":");
  if (colonIdx < 0) return null;
  return { group: label.slice(0, colonIdx).trim(), value: label.slice(colonIdx + 1).trim() };
}

/** Find option value in items[] by partial group name match. */
function findOpt(items: ProductionOrderItem[], groupPartial: string): string {
  const norm = groupPartial.trim();
  for (const item of items) {
    const parsed = parseOptionValue(item.label_snapshot);
    if (parsed && parsed.group.includes(norm)) return parsed.value;
    // Zone lines like 'الجهة اليمنى — اسم الخريج'
    if (!parsed && item.label_snapshot.includes(norm) && item.customer_text) {
      return item.customer_text;
    }
  }
  return "";
}

function buildInstaText(
  intake: NonNullable<ProductionOrderDetail["order"]["intake"]>,
  ordersByType: {
    robe?: { items: ProductionOrderItem[]; measurements?: { shoulder_cm: number; robe_length_cm: number; sleeve_length_cm: number } | null };
    cap?: { items: ProductionOrderItem[] };
    sash?: { items: ProductionOrderItem[] };
  },
  totalPrice?: number,
  deposit?: number
): string {
  const r = ordersByType.robe;
  const c = ordersByType.cap;
  const s = ordersByType.sash;

  const line = (label: string, value: string | null | undefined) =>
    value?.trim() ? `${label} / ${value.trim()}` : null;

  const lines: (string | null)[] = [
    line("يوزر الانستا", intake.instagram_username),
    line("الأسم", intake.customer_name),
  ];

  if (r) {
    lines.push(
      line("لون الروب", findOpt(r.items, "لون")),
      line("قماش الروب", findOpt(r.items, "قماش")),
      line("فصال روب", findOpt(r.items, "فصال")),
      r.measurements ? `طول الروب / ${r.measurements.robe_length_cm}` : null,
      r.measurements ? `طول الردن / ${r.measurements.sleeve_length_cm}` : null,
      r.measurements ? `عرض الكتف / ${r.measurements.shoulder_cm}` : null,
      line("ردن الروب", findOpt(r.items, "ردن")),
      "___",
    );
  }

  if (c) {
    lines.push(
      line("القبعة اللون", findOpt(c.items, "اللون")),
      line("القبعة عادية ام مثلثة", findOpt(c.items, "عادية")),
      line("القبعة من الجانب", findOpt(c.items, "الجانب")),
      line("القبعة من الأعلى", findOpt(c.items, "الأعلى")),
      "____",
    );
  }

  if (s) {
    lines.push(
      line("الوشاح لون الوشاح", findOpt(s.items, "لون الوشاح")),
      line("نوع الوشاح", findOpt(s.items, "نوع الوشاح")),
      line("عرض الوشاح", findOpt(s.items, "عرض الوشاح")),
      line("لون تطريز", findOpt(s.items, "تطريز")),
    );
    // Zone lines
    const rightZone = s.items.find((i) => i.label_snapshot.includes("اليمن") || i.label_snapshot.includes("يمين"));
    const leftZone = s.items.find((i) => i.label_snapshot.includes("اليسر") || i.label_snapshot.includes("يسار"));
    const backZone = s.items.find((i) => i.label_snapshot.includes("الخلف") || i.label_snapshot.includes("خلف"));
    if (backZone?.customer_text) lines.push(`الوشاح من الخلف / ${backZone.customer_text}`);
    if (leftZone?.customer_text) lines.push(`الوشاح من الجهة اليسرة / ${leftZone.customer_text}`);
    if (rightZone?.customer_text) lines.push(`الوشاح من الجهة اليمين / ${rightZone.customer_text}`);
    lines.push("————————");
  }

  if (intake.notes) lines.push(line("ملاحظة", intake.notes));
  lines.push("__");
  const loc = [intake.governorate, intake.area_details].filter(Boolean).join(" / ");
  if (loc) lines.push(`العنوان / ${loc}`);

  if (intake.phone_primary || intake.phone_secondary) {
    lines.push("رقمين");
    if (intake.phone_primary) lines.push(`الاول ${intake.phone_primary}`);
    if (intake.phone_secondary) lines.push(`الثاني ${intake.phone_secondary}`);
  }

  if (totalPrice !== undefined && deposit !== undefined) {
    const totalK = Math.round(totalPrice / 1000);
    const depositK = Math.round(deposit / 1000);
    lines.push(`${totalK} واصل ${depositK}`);
  }

  if (intake.event_date) lines.push(`حفلتهم ${intake.event_date}`);

  return lines.filter((l): l is string => l !== null && l !== "").join("\n");
}

function InstaCopyButton({
  intake,
  order,
  currentItems,
  currentType,
  bundle,
}: {
  intake: NonNullable<ProductionOrderDetail["order"]["intake"]>;
  order: ProductionOrderDetail["order"];
  currentItems: ProductionOrderItem[];
  currentType: string;
  bundle: ProductionOrderDetail["bundle"];
}) {
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!intake.customer_name && !intake.instagram_username) {
      toast.error("لا تتوفر بيانات الانستا لهذا الطلب");
      return;
    }

    setCopying(true);
    try {
      // Build ordersByType starting from the current order
      const ordersByType: Parameters<typeof buildInstaText>[1] = {};

      const setType = (
        type: string,
        its: ProductionOrderItem[],
        meas?: { shoulder_cm: number; robe_length_cm: number; sleeve_length_cm: number } | null
      ) => {
        if (type === "robe") ordersByType.robe = { items: its, measurements: meas };
        else if (type === "cap") ordersByType.cap = { items: its };
        else if (type === "sash") ordersByType.sash = { items: its };
      };
      setType(currentType, currentItems, order.measurements);

      // Fetch siblings from bundle[]
      if (bundle) {
        const { api } = await import("@/lib/api");
        await Promise.all(
          bundle
            .filter((bi) => !bi.is_current)
            .map(async (bi) => {
              try {
                const { data } = await api.get<{ data: ProductionOrderDetail }>(
                  `/production/orders/${bi.id}`
                );
                const sibling = data.data;
                setType(
                  sibling.order.product_type,
                  sibling.items,
                  sibling.order.measurements
                );
              } catch {
                // Non-critical — silently skip
              }
            })
        );
      }

      const text = buildInstaText(
        intake,
        ordersByType,
        order.price,
        intake.deposit
      );
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("تم النسخ");
      setTimeout(() => setCopied(false), 3000);
    } catch {
      toast.error("تعذر النسخ — يرجى المحاولة يدوياً");
    } finally {
      setCopying(false);
    }
  }

  return (
    <button
      type="button"
      disabled={copying}
      onClick={handleCopy}
      className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-orange-ink/30 bg-surface-sink px-4 py-2 text-sm font-semibold text-orange-ink transition-colors hover:bg-orange-ink/10 disabled:opacity-60"
    >
      {copying ? "جارٍ التحضير..." : copied ? "تم النسخ" : "نسخ بصيغة الانستا"}
    </button>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProductionOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params.orderId as string;

  const { user } = useRequireAuth(["staff", "admin"]);

  const [detail, setDetail] = useState<ProductionOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Reject modal
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectSubmitting, setRejectSubmitting] = useState(false);

  // Revert confirm modal
  const [revertOpen, setRevertOpen] = useState(false);
  const [revertSubmitting, setRevertSubmitting] = useState(false);

  // Delivery confirmation modal (ready → delivered)
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [deliverSubmitting, setDeliverSubmitting] = useState(false);
  const [deliveryMethod, setDeliveryMethod] = useState<"delivery" | "pickup">("delivery");
  const [recipientName, setRecipientName] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryPhone, setDeliveryPhone] = useState("");
  const [deliveryNote, setDeliveryNote] = useState("");

  const hasClaimedRef = useRef(false);
  // Someone else already has this order's tab open — warn instead of stealing it.
  const [conflictOwner, setConflictOwner] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(false);
    try {
      const d = await getProductionOrder(orderId);
      setDetail(d);
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

  // Presence: claim on mount + heartbeat every 30s so the queue tag reflects who
  // ACTUALLY has the tab open right now (and self-heals if a tab crashes — the
  // backend treats presence older than its TTL as free). Release on unmount.
  useEffect(() => {
    let mounted = true;
    async function beat() {
      try {
        const res = await claimOrder(orderId);
        if (!mounted) return;
        if (res.claimed) {
          hasClaimedRef.current = true;
          setConflictOwner(null);
        } else {
          // Another staff member is actively working this order.
          hasClaimedRef.current = false;
          setConflictOwner(res.working_staff_name ?? "موظف آخر");
        }
      } catch {
        // Non-critical — silently ignore
      }
    }
    beat();
    const interval = setInterval(beat, 30_000);
    return () => {
      mounted = false;
      clearInterval(interval);
      if (hasClaimedRef.current) {
        releaseOrder(orderId).catch(() => undefined);
        hasClaimedRef.current = false;
      }
    };
  }, [orderId]);

  async function handleAdvance() {
    if (!detail) return;
    setActionLoading(true);
    try {
      const updated = await advanceOrder(detail.order.id);
      toast.success(
        `تم النقل إلى: ${ORDER_STATUS_LABELS[updated.status] ?? updated.status}`
      );
      await releaseOrder(orderId).catch(() => undefined);
      hasClaimedRef.current = false;
      // Invalidate App Router cache before navigating so browser-back shows fresh status.
      router.refresh();
      router.push("/staff");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر تحديث الحالة"));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleConfirmDelivery() {
    if (!detail) return;
    const method = deliveryMethod;
    const recipient = recipientName.trim();
    if (!recipient) {
      toast.error("اكتب اسم مستلم الطلب");
      return;
    }
    if (method === "delivery" && (!deliveryAddress.trim() || !deliveryPhone.trim())) {
      toast.error("عنوان ورقم هاتف التوصيل مطلوبان");
      return;
    }
    setDeliverSubmitting(true);
    try {
      await confirmDelivery(detail.order.id, {
        delivery_method: method,
        recipient_name: recipient,
        delivery_address: method === "delivery" ? deliveryAddress.trim() : undefined,
        delivery_phone: method === "delivery" ? deliveryPhone.trim() : undefined,
        delivery_notes: deliveryNote.trim() || undefined,
      });
      toast.success("تم تأكيد التسليم");
      setDeliverOpen(false);
      await releaseOrder(orderId).catch(() => undefined);
      hasClaimedRef.current = false;
      router.refresh();
      router.push("/staff");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر تأكيد التسليم"));
    } finally {
      setDeliverSubmitting(false);
    }
  }

  async function handleRevert() {
    if (!detail) return;
    setRevertSubmitting(true);
    try {
      const updated = await revertOrder(detail.order.id);
      toast.success(
        `تم الإرجاع إلى: ${ORDER_STATUS_LABELS[updated.status as keyof typeof ORDER_STATUS_LABELS] ?? updated.status}`
      );
      setRevertOpen(false);
      // Invalidate App Router cache before navigating.
      router.refresh();
      router.push("/staff");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر إرجاع الطلب"));
      setRevertOpen(false);
    } finally {
      setRevertSubmitting(false);
    }
  }

  async function handleApprove() {
    if (!detail?.design) return;
    setActionLoading(true);
    try {
      await approveDesign(detail.design.id);
      toast.success("تمت الموافقة على التصميم");
      router.refresh();
      router.push("/staff");
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
      router.refresh();
      router.push("/staff");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر رفض التصميم"));
      setRejectOpen(false);
    } finally {
      setRejectSubmitting(false);
    }
  }

  function handleFinalDesignUploaded(url: string) {
    if (!detail) return;
    setDetail({
      ...detail,
      order: { ...detail.order, final_design_url: url },
    });
  }

  // ── Loading skeleton ──
  if (loading) {
    return (
      <div dir="rtl" lang="ar" className="space-y-4 animate-fade-page-in" aria-hidden>
        <div className="skeleton h-5 w-32 rounded-full" />
        <div className="skeleton h-9 w-56 rounded-xl" />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="skeleton h-80 rounded-3xl" />
          <div className="space-y-3">
            <div className="skeleton h-36 rounded-2xl" />
            <div className="skeleton h-28 rounded-2xl" />
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
          <Button className="mt-4" onClick={load}>إعادة المحاولة</Button>
        </div>
      </div>
    );
  }

  const { order, design, items, package_orders, bundle, can_see_design, available_actions } = detail;
  const intake = order.intake ?? null;
  const productLabel = PRODUCT_TYPE_LABELS[order.product_type as keyof typeof PRODUCT_TYPE_LABELS] ?? "المنتج";
  const isAdmin = user?.role === "admin";

  // Presence banner — someone else is working on this order. `conflictOwner` is
  // the live heartbeat signal (updates without a reload); the order snapshot is
  // the fallback for the first paint before the heartbeat resolves.
  const presenceOwner =
    conflictOwner ??
    (order.working_staff_id && order.working_staff_id !== user?.id
      ? order.working_staff_name
      : null);

  // Resolve image URLs
  const logoUrl = design ? resolveImageUrl(design.logo_url) : null;
  const extraUrl = design ? resolveImageUrl(design.extra_image_url) : null;

  // Canvas available only when server says so. Show the preview when EITHER
  // side has artwork — a sash may have only the right panel (university name /
  // logo / year) drawn while the left (student name) is left empty, and vice
  // versa. Gating on left_canvas alone hid those designs from staff entirely.
  const showCanvas =
    can_see_design && (design?.left_canvas != null || design?.right_canvas != null);

  // Actions are exclusively derived from the server's available_actions object —
  // no parallel frontend state machine. This means buttons shown == buttons that work.
  const canApprove = available_actions.can_approve;
  const canReject = available_actions.can_reject;
  const showAdvance = !!available_actions.advance;
  const showRevert = !!available_actions.revert;
  const advanceLabel = available_actions.advance?.label ?? "تقدم للمرحلة التالية";

  // Approve and advance never apply to the same order, presented as ONE primary button.
  // The final ready→delivered advance opens a delivery-confirmation modal first so we
  // capture HOW it was handed over (توصيل/استلام · المستلم · العنوان/الرقم).
  const showPrimaryAction = canApprove || showAdvance;
  const isDeliveryAction = !canApprove && showAdvance && order.status === "ready";
  const primaryLabel = canApprove ? "موافقة على التصميم" : advanceLabel;
  const onPrimaryAction = canApprove
    ? handleApprove
    : isDeliveryAction
      ? () => setDeliverOpen(true)
      : handleAdvance;

  const exportInput =
    showCanvas && design
      ? {
          leftCanvas: design.left_canvas ?? null,
          rightCanvas: design.right_canvas ?? null,
          sashColor: design.sash_color,
          fontsUsed: design.fonts_used ?? [],
        }
      : null;

  // Final design upload — available to every staff member + admin
  const showFinalDesignUpload = !!user && (user.role === "admin" || user.role === "staff");

  // Show price only when backend returns it (admin + embroiderer)
  const showPrice = typeof order.price === "number" && order.price > 0;

  // Multi-role: مفصل (tailor) read-only view — only when tailor is the user's sole role
  // (a tailor who is also a designer sees the full view). Mirrors the backend strip.
  const myRoles: StaffType[] =
    user?.staff_types ?? (user?.staff_type ? [user.staff_type] : []);
  const isTailorOnly =
    user?.role === "staff" && myRoles.length > 0 && myRoles.every((r) => r === "tailor");

  // Missing final-design alert: order reached a stage where a final design should exist
  // (it has embroidery/a design) but none was uploaded.
  const designExpected = !!order.has_embroidery || !!design || !!order.design_id;
  const designStageReached = ["embroidery", "pressing", "preparing", "ready", "delivered"].includes(order.status);
  const missingFinalDesign = designExpected && designStageReached && !order.final_design_url;

  // ── مفصل (tailor): stripped read-only view — student name + sash/shawl info only ──
  if (isTailorOnly) {
    const sashItems = items.filter(
      (i) => i.group_id !== null || !!i.customer_text || !!i.customer_image_url
    );
    return (
      <div dir="rtl" lang="ar">
        <div className="mb-4">
          <Link
            href="/staff"
            className="inline-flex items-center gap-1 text-sm font-medium text-orange-ink hover:underline"
          >
            <span aria-hidden>→</span> العودة
          </Link>
        </div>
        <PageHeader title={order.student_name} subtitle={order.product_name} />
        <div className="space-y-4">
          <article className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
            <h2 className="font-display-ar text-lg font-bold text-ink">بيانات الطالب</h2>
            <p className="mt-2 text-sm">
              <span className="text-muted">الاسم: </span>
              <span className="font-semibold text-ink">{order.student_name}</span>
            </p>
          </article>
          <article className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
            <h3 className="mb-3 text-sm font-semibold text-ink">معلومات الوشاح والشال الأمريكي</h3>
            {sashItems.length > 0 ? (
              <ul className="space-y-3">
                {sashItems.map((item, idx) => (
                  <li key={idx} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-ink-soft">{item.label_snapshot}</span>
                      {item.customer_text && (
                        <span className="font-semibold text-ink">{item.customer_text}</span>
                      )}
                    </div>
                    {item.customer_image_url && (
                      <a
                        href={resolveImageUrl(item.customer_image_url) ?? "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block w-fit"
                        aria-label={`عرض صورة ${item.label_snapshot} بالحجم الكامل`}
                      >
                        <Image
                          src={resolveImageUrl(item.customer_image_url) ?? ""}
                          alt={`صورة — ${item.label_snapshot}`}
                          width={240}
                          height={240}
                          className="max-h-56 w-auto rounded-lg border border-line object-contain"
                          loading="lazy"
                          unoptimized
                        />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-soft">لا توجد تفاصيل وشاح لهذا الطلب.</p>
            )}
          </article>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" lang="ar">
      {/* Back link */}
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
        {...(isAdmin ? { backHref: "/admin", backLabel: "العودة للوحة التحكم" } : {})}
      />

      {/* Presence banner — admin/staff see which employee is working on this order */}
      {presenceOwner && (
        <div
          role="alert"
          className="mb-4 flex items-center gap-2 rounded-xl border border-orange-ink/25 bg-orange-ink/8 px-4 py-3 text-sm font-medium text-orange-ink"
        >
          <span aria-hidden>⚠</span>
          الموظف {presenceOwner} يعمل على هذا الطلب ({order.product_name})
        </div>
      )}

      {/* Missing final-design alert — finished embroidery/design but no final image uploaded */}
      {missingFinalDesign && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm font-medium text-danger"
        >
          <span aria-hidden>⚠</span>
          <span>
            تنبيه: لم تُرفع صورة التصميم النهائي رغم وصول الطلب إلى مرحلة «
            {ORDER_STATUS_LABELS[order.status] ?? order.status}». يرجى رفع التصميم النهائي للطلب.
          </span>
        </div>
      )}

      {/* ── Primary action — big tap target on mobile ── */}
      {(showPrimaryAction || showRevert) && (
        <div className="mb-4 flex flex-col gap-2 sm:hidden">
          {showPrimaryAction && (
            <Button
              fullWidth
              loading={actionLoading}
              onClick={onPrimaryAction}
            >
              {primaryLabel}
            </Button>
          )}
          {canReject && (
            <Button
              variant="danger"
              fullWidth
              loading={actionLoading}
              onClick={() => setRejectOpen(true)}
            >
              رفض التصميم
            </Button>
          )}
          {showRevert && (
            <Button
              variant="ghost"
              fullWidth
              onClick={() => setRevertOpen(true)}
            >
              إرجاع للتعديل
            </Button>
          )}
        </div>
      )}

      {/* Final design upload — single instance, visible at all breakpoints */}
      {showFinalDesignUpload && (
        <div className="mb-4">
          <FinalDesignUpload
            orderId={orderId}
            currentUrl={order.final_design_url}
            onUploaded={handleFinalDesignUploaded}
          />
        </div>
      )}

      {/* ── Delivery details — shown once the order is delivered ── */}
      {order.status === "delivered" && order.delivery_method && (
        <section className="mb-4 rounded-2xl border border-orange-ink/25 bg-orange-ink/[0.06] p-4 shadow-[var(--shadow-soft)]">
          <div className="mb-3 flex items-center gap-2">
            <span aria-hidden className="text-orange-ink">✓</span>
            <h2 className="font-display-ar text-base font-bold text-ink">تم التسليم</h2>
            <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-semibold text-ink-soft">
              {order.delivery_method === "delivery" ? "توصيل" : "استلام من المحل"}
            </span>
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {order.recipient_name && (
              <div className="flex gap-2">
                <dt className="text-muted">المستلم:</dt>
                <dd className="font-semibold text-ink">{order.recipient_name}</dd>
              </div>
            )}
            {order.delivered_at && (
              <div className="flex gap-2">
                <dt className="text-muted">وقت التسليم:</dt>
                <dd className="font-semibold text-ink">{formatDateIQ(order.delivered_at)}</dd>
              </div>
            )}
            {order.delivery_method === "delivery" && order.delivery_address && (
              <div className="flex gap-2 sm:col-span-2">
                <dt className="text-muted">العنوان:</dt>
                <dd className="font-semibold text-ink">{order.delivery_address}</dd>
              </div>
            )}
            {order.delivery_method === "delivery" && order.delivery_phone && (
              <div className="flex gap-2">
                <dt className="text-muted">الهاتف:</dt>
                <dd>
                  <a
                    href={`tel:${order.delivery_phone}`}
                    className="font-semibold text-orange-ink hover:underline"
                    dir="ltr"
                  >
                    {order.delivery_phone}
                  </a>
                </dd>
              </div>
            )}
            {order.delivered_by_name && (
              <div className="flex gap-2">
                <dt className="text-muted">أكّد التسليم:</dt>
                <dd className="font-semibold text-ink">{order.delivered_by_name}</dd>
              </div>
            )}
            {order.delivery_notes && (
              <div className="flex gap-2 sm:col-span-2">
                <dt className="text-muted">ملاحظة:</dt>
                <dd className="text-ink">{order.delivery_notes}</dd>
              </div>
            )}
          </dl>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2 lg:gap-8">
        {/* ── Design / sash preview panel ── */}
        <section className="rounded-3xl border border-line bg-surface p-4 shadow-[var(--shadow-card)] lg:p-6">
          <h2 className="mb-4 font-display-ar text-lg font-bold text-ink">
            {can_see_design ? "معاينة التصميم" : `بيانات ${productLabel}`}
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
                <div className="mt-6">
                  <ExportPngButton
                    design={exportInput}
                    studentName={order.student_name}
                  />
                </div>
              )}
            </>
          ) : can_see_design && !showCanvas ? (
            <div className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-surface-sink p-6 text-center">
              <p className="text-sm font-medium text-ink-soft">لا يوجد تصميم محفوظ بعد</p>
              <p className="text-xs text-muted">{`لم يكمل الطالب تصميم ${productLabel} حتى الآن`}</p>
            </div>
          ) : (
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
                <p className="text-sm text-ink-soft">لا تتوفر بيانات تصميم لهذا الدور</p>
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
            <h2 className="font-display-ar text-lg font-bold text-ink">بيانات الطالب</h2>
            <dl className="mt-4 space-y-2.5 text-sm">
              <div className="flex justify-between gap-4 border-b border-line pb-2.5">
                <dt className="text-muted">الهاتف</dt>
                <dd dir="ltr">{order.student_phone || "—"}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-line pb-2.5">
                <dt className="text-muted">انستغرام</dt>
                <dd dir="ltr">
                  {order.instagram_username ? (
                    <a
                      href={`https://instagram.com/${order.instagram_username}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-orange-ink underline underline-offset-2"
                    >
                      @{order.instagram_username}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-line pb-2.5">
                <dt className="text-muted">الجامعة</dt>
                <dd className="font-medium text-ink">{order.university_name || "—"}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-line pb-2.5">
                <dt className="text-muted">القسم</dt>
                <dd className="font-medium text-ink">{order.department || "—"}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-line pb-2.5">
                <dt className="text-muted">نوع الدراسة</dt>
                <dd className="font-medium text-ink">
                  {order.study_type === "morning"
                    ? "صباحي"
                    : order.study_type === "evening"
                      ? "مسائي"
                      : "—"}
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
              {showPrice && (
                <div className="flex justify-between gap-4 border-b border-line pb-2.5">
                  <dt className="text-muted">السعر الكلي</dt>
                  <dd className="font-bold text-orange-ink">{order.price} د.ع</dd>
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
                <dd className="font-medium text-ink">{formatDateIQ(order.created_at)}</dd>
              </div>
            </dl>
          </article>

          {/* Intake card — full-set form bundles only */}
          {intake && (
            <>
              <IntakeCard intake={intake} totalPrice={order.price} />
              <InstaCopyButton
                intake={intake}
                order={order}
                currentItems={items}
                currentType={order.product_type}
                bundle={bundle}
              />
            </>
          )}

          {/* Measurements */}
          {order.measurements && (
            <article className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
              <h3 className="mb-3 text-sm font-semibold text-ink">مقاسات الروب</h3>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-4 border-b border-line pb-2">
                  <dt className="text-muted">الكتف</dt>
                  <dd className="font-medium text-ink" dir="ltr">{order.measurements.shoulder_cm} cm</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-line pb-2">
                  <dt className="text-muted">طول الروب</dt>
                  <dd className="font-medium text-ink" dir="ltr">{order.measurements.robe_length_cm} cm</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">طول الردن</dt>
                  <dd className="font-medium text-ink" dir="ltr">{order.measurements.sleeve_length_cm} cm</dd>
                </div>
              </dl>
            </article>
          )}

          {/* Design notes */}
          {design?.notes && (
            <article className="rounded-2xl border border-orange-ink/20 bg-orange-ink/5 p-5 shadow-[var(--shadow-soft)]">
              <h3 className="text-sm font-semibold text-orange-ink">ملاحظات الطالب</h3>
              <p className="mt-2 text-sm text-ink-soft">{design.notes}</p>
            </article>
          )}

          {/* Rejection reason */}
          {design?.approval_status === "rejected" && design.rejection_reason && (
            <article className="rounded-2xl border border-danger/20 bg-danger/5 p-5">
              <h3 className="text-sm font-semibold text-danger">سبب الرفض</h3>
              <p className="mt-2 text-sm text-ink-soft">{design.rejection_reason}</p>
            </article>
          )}

          {/* Order specs — real priced options AND customer-entered type/embroidery
              (نوع الوشاح/القبعة, تطريز…). These last carry no group_id, so we keep any
              row that has a group OR customer content; only the contentless synthetic
              package base-price row ("طقم: …") is hidden. */}
          {items.filter(
            (i) => i.group_id !== null || !!i.customer_text || !!i.customer_image_url
          ).length > 0 && (
            <article className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
              <h3 className="mb-3 text-sm font-semibold text-ink">خيارات الطلب</h3>
              <ul className="space-y-3">
                {items
                  .filter(
                    (i) => i.group_id !== null || !!i.customer_text || !!i.customer_image_url
                  )
                  .map((item, idx) => (
                    <li key={idx} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="text-ink-soft">{item.label_snapshot}</span>
                        {item.customer_text && (
                          <span className="font-semibold text-ink">{item.customer_text}</span>
                        )}
                      </div>
                      {/* Customer reference photo shown inline (no download step) */}
                      {item.customer_image_url && (
                        <a
                          href={resolveImageUrl(item.customer_image_url) ?? "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block w-fit"
                          aria-label={`عرض صورة ${item.label_snapshot} بالحجم الكامل`}
                        >
                          <Image
                            src={resolveImageUrl(item.customer_image_url) ?? ""}
                            alt={`صورة العميل — ${item.label_snapshot}`}
                            width={240}
                            height={240}
                            className="max-h-56 w-auto rounded-lg border border-line object-contain"
                            loading="lazy"
                            unoptimized
                          />
                        </a>
                      )}
                    </li>
                  ))}
              </ul>
            </article>
          )}

          {/* Full package context — bundle (preferred) */}
          {bundle && bundle.length > 0 && (
            <article className="rounded-2xl border-2 border-orange-ink/20 bg-orange-ink/5 p-5 shadow-[var(--shadow-soft)]">
              <h3 className="mb-3 font-display-ar text-sm font-bold text-ink">الباقة الكاملة</h3>
              <ul className="space-y-2">
                {bundle.map((bi) => {
                  // The whole row is the click target for sibling pieces (not just the
                  // product-name text), so tapping anywhere on وشاح/روب/قبعة navigates.
                  const rowClass = `flex min-h-[44px] items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm transition-colors ${
                    bi.is_current
                      ? "border border-orange-ink/30 bg-orange-ink/10"
                      : "border border-line bg-surface hover:border-orange-ink/40 hover:bg-surface-sink"
                  }`;
                  const rowInner = (
                    <>
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <span
                          className={
                            bi.is_current ? "font-semibold text-orange-ink" : "font-medium text-ink"
                          }
                        >
                          {bi.product_name}
                        </span>
                        {bi.is_current && (
                          <span className="shrink-0 rounded-full bg-orange-ink px-1.5 py-0.5 text-[10px] font-bold text-white">
                            الحالي
                          </span>
                        )}
                      </div>
                      <span className="shrink-0 rounded-full border border-line bg-surface-sink px-2 py-0.5 text-xs text-ink-soft">
                        {ORDER_STATUS_LABELS[bi.status] ?? bi.status}
                      </span>
                    </>
                  );
                  return (
                    <li key={bi.id}>
                      {bi.is_current ? (
                        <div className={rowClass} aria-label="الطلب الحالي" aria-current="true">
                          {rowInner}
                        </div>
                      ) : (
                        <Link href={`/staff/orders/${bi.id}`} className={rowClass}>
                          {rowInner}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </article>
          )}

          {/* Package siblings fallback — legacy */}
          {!bundle && package_orders && package_orders.length > 0 && (
            <article className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
              <h3 className="mb-3 text-sm font-semibold text-ink">محتويات الحزمة</h3>
              <ul className="space-y-2">
                {package_orders.map((po) => (
                  <li key={po.id} className="flex items-center justify-between gap-2 text-sm">
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

          {/* ── Action buttons — desktop only (mobile shown above) ── */}
          {(showPrimaryAction || showRevert) && (
            <article className="hidden sm:block rounded-[var(--radius-card)] border border-orange-ink/15 bg-warm-veil p-5 shadow-[var(--shadow-soft)]">
              <h3 className="mb-4 font-display-ar text-base font-bold text-ink">الإجراءات</h3>
              <div className="flex flex-col gap-2">
                {showPrimaryAction && (
                  <Button fullWidth loading={actionLoading} onClick={onPrimaryAction}>
                    {primaryLabel}
                  </Button>
                )}
                {canReject && (
                  <Button
                    variant="danger"
                    fullWidth
                    loading={actionLoading}
                    onClick={() => setRejectOpen(true)}
                  >
                    رفض التصميم
                  </Button>
                )}
                {showRevert && (
                  <Button
                    variant="ghost"
                    fullWidth
                    onClick={() => setRevertOpen(true)}
                  >
                    إرجاع للتعديل
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
            <Button variant="danger" loading={rejectSubmitting} onClick={handleReject}>
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

      {/* ── Revert confirm modal ── */}
      <Modal
        open={revertOpen}
        onClose={() => setRevertOpen(false)}
        title="إرجاع الطلب للتعديل"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRevertOpen(false)}>
              إلغاء
            </Button>
            <Button variant="danger" loading={revertSubmitting} onClick={handleRevert}>
              تأكيد الإرجاع
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-soft">
          سيتم إرجاع الطلب للمرحلة السابقة. هل أنت متأكد؟
        </p>
      </Modal>

      {/* ── Delivery confirmation modal (ready → delivered) ── */}
      <Modal
        open={deliverOpen}
        onClose={() => !deliverSubmitting && setDeliverOpen(false)}
        title="تأكيد تسليم الطلب"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeliverOpen(false)} disabled={deliverSubmitting}>
              إلغاء
            </Button>
            <Button loading={deliverSubmitting} onClick={handleConfirmDelivery}>
              تأكيد التسليم
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-semibold text-ink">طريقة التسليم</p>
            <div className="grid grid-cols-2 gap-2">
              {([
                { v: "delivery", label: "توصيل (عنوان)" },
                { v: "pickup", label: "استلام من المحل" },
              ] as const).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setDeliveryMethod(opt.v)}
                  className={`min-h-11 rounded-xl border px-3 text-sm font-semibold transition-colors ${
                    deliveryMethod === opt.v
                      ? "border-orange-ink bg-orange-ink/10 text-orange-ink"
                      : "border-line bg-beige text-ink-soft hover:border-orange-ink/40"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-ink">
              اسم المستلم
            </label>
            <input
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="من استلم الطلب"
              className="w-full rounded-xl border border-line bg-beige px-4 py-2.5 text-sm text-ink outline-none transition-colors focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20"
              dir="rtl"
            />
          </div>

          {deliveryMethod === "delivery" && (
            <>
              <div>
                <label className="mb-1 block text-sm font-semibold text-ink">
                  عنوان التوصيل
                </label>
                <input
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                  placeholder="المحافظة / المنطقة / أقرب نقطة دالة"
                  className="w-full rounded-xl border border-line bg-beige px-4 py-2.5 text-sm text-ink outline-none transition-colors focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20"
                  dir="rtl"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-ink">
                  رقم هاتف التوصيل
                </label>
                <input
                  value={deliveryPhone}
                  onChange={(e) => setDeliveryPhone(e.target.value)}
                  placeholder="07XXXXXXXXX"
                  inputMode="tel"
                  className="w-full rounded-xl border border-line bg-beige px-4 py-2.5 text-sm text-ink outline-none transition-colors focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20"
                  dir="ltr"
                />
              </div>
            </>
          )}

          <div>
            <label className="mb-1 block text-sm font-semibold text-ink">
              ملاحظة (اختياري)
            </label>
            <textarea
              value={deliveryNote}
              onChange={(e) => setDeliveryNote(e.target.value)}
              rows={2}
              placeholder="أي تفاصيل عن التسليم"
              className="w-full resize-none rounded-xl border border-line bg-beige px-4 py-2.5 text-sm text-ink outline-none transition-colors focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20"
              dir="rtl"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
