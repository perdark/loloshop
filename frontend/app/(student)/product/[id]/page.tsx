"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CustomerImageUpload } from "@/components/catalog/CustomerImageUpload";
import { ReceiptUpload } from "@/components/catalog/ReceiptUpload";
import { OptionGroupField } from "@/components/catalog/OptionGroupField";
import { OrderBreakdownCard } from "@/components/catalog/OrderBreakdownCard";
import { ProductMediaGallery } from "@/components/catalog/ProductMediaGallery";
import { PriceBreakdown } from "@/components/catalog/PriceBreakdown";
import { getProductFull } from "@/lib/catalog";
import { getApiErrorMessage } from "@/lib/api";
import {
  customerImageRequired,
  customerTextRequired,
  getSelectedOptionId,
  selectionKey,
  validateCustomerImages,
  validateCustomerTexts,
} from "@/lib/customerImage";
import { buildConfigureSelections, configureOrder } from "@/lib/orders";
import {
  computePriceBreakdown,
  groupVisibleForGender,
  validateSelection,
  type OptionSelection,
} from "@/lib/pricing";
import { addToCart } from "@/lib/cart";
import { isAuthenticated, loginHref } from "@/lib/auth";
import { formatIQD, formatDiscountPercent } from "@/lib/format";
import { backHrefFromParam } from "@/lib/back";
import type { CatalogProduct, ConfigureOrderResult, RobeMeasurements } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

const GENDER_KEY = "loloshop_student_gender";

/** Skeleton shaped like the 2-col product layout (gallery + options). */
function ProductPageSkeleton() {
  return (
    <div
      className="animate-fade-page-in pb-28"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">جارٍ تحميل المنتج…</span>
      <div className="mx-auto max-w-5xl lg:grid lg:grid-cols-2 lg:items-start lg:gap-10">
        {/* Gallery col */}
        <div className="space-y-3">
          <div className="skeleton h-5 w-24 rounded-pill" />
          <div className="skeleton h-7 w-2/3 rounded-xl" />
          <div className="skeleton aspect-[4/3] w-full rounded-2xl" />
          <div className="flex gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-16 w-16 rounded-xl" />
            ))}
          </div>
        </div>
        {/* Options col */}
        <div className="mt-6 space-y-5 lg:mt-0">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2.5">
              <div className="skeleton h-4 w-1/3 rounded-pill" />
              <div className="grid grid-cols-3 gap-2">
                {[0, 1, 2].map((j) => (
                  <div key={j} className="skeleton h-10 rounded-xl" />
                ))}
              </div>
            </div>
          ))}
          <div className="skeleton h-[80px] w-full rounded-2xl" />
          <div className="skeleton h-12 w-full rounded-pill" />
        </div>
      </div>
    </div>
  );
}

export default function StudentProductPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const backHref = backHrefFromParam(searchParams.get("from"), "/#catalog");
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selection, setSelection] = useState<OptionSelection>({});
  const [customerImages, setCustomerImages] = useState<Record<string, string>>(
    {}
  );
  const [customerTexts, setCustomerTexts] = useState<Record<string, string>>({});
  const [measurements, setMeasurements] = useState<RobeMeasurements>({
    shoulder_cm: 0,
    chest_cm: 0,
    robe_length_cm: 0,
    sleeve_length_cm: 0,
    tailor_notes: "",
    receipt_image_url: "",
  });
  const [showErrors, setShowErrors] = useState(false);
  const [confirmed, setConfirmed] = useState<ConfigureOrderResult | null>(null);
  const [addedToCart, setAddedToCart] = useState(false);
  const [addingToCart, setAddingToCart] = useState(false);
  const [gender, setGender] = useState<"male" | "female" | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(GENDER_KEY);
    if (saved === "male" || saved === "female") setGender(saved);
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    getProductFull(id)
      .then(setProduct)
      .catch((e) => {
        const msg = getApiErrorMessage(e, "تعذر تحميل المنتج — تحقق من الاتصال");
        setLoadError(msg);
        toast.error(msg);
      })
      .finally(() => setLoading(false));
  }, [id]);

  // Auto-select single-option required groups (e.g. product has only 1 sash type)
  useEffect(() => {
    if (!product) return;
    setSelection((prev) => {
      const autoSel: OptionSelection = { ...prev };
      for (const g of product.optionGroups) {
        if (prev[g.id] !== undefined) continue;
        const active = g.options.filter((o) => o.active);
        if (g.required && active.length === 1) {
          autoSel[g.id] = active[0].id;
        }
      }
      return autoSel;
    });
  }, [product]);

  const role = product?.priceRole ?? "retail";

  const preview = useMemo(() => {
    if (!product) return { lines: [], total: 0 };
    return computePriceBreakdown(product, selection, role);
  }, [product, selection, role]);

  function setGroupValue(groupId: string, value: OptionSelection[string]) {
    setSelection((prev) => ({ ...prev, [groupId]: value }));
    setCustomerImages((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (k.startsWith(`${groupId}:`)) delete next[k];
      }
      return next;
    });
    setCustomerTexts((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (k.startsWith(`${groupId}:`)) delete next[k];
      }
      return next;
    });
    setConfirmed(null);
    setShowErrors(false);
  }

  const measurementsError = useMemo(() => {
    if (!product || product.type !== "robe") return null;
    if (
      measurements.shoulder_cm <= 0 ||
      measurements.robe_length_cm <= 0 ||
      measurements.sleeve_length_cm <= 0
    ) {
      return "يرجى إدخال مقاسات الروب المطلوبة";
    }
    const chest = measurements.chest_cm ?? 0;
    if (chest > 0 && (chest < 60 || chest > 180)) {
      return "محيط الصدر يجب أن يكون بين ٦٠–١٨٠ سم";
    }
    return null;
  }, [product, measurements]);

  async function handleAddToCart() {
    if (!product || !id) return;
    // Browsing is open to everyone; the cart needs an account. Send anonymous
    // shoppers to login and bring them straight back to this product.
    if (!isAuthenticated()) {
      toast("سجّل دخولك كطالب لإضافة المنتج إلى السلة");
      router.push(loginHref(window.location.pathname));
      return;
    }
    const err = validateSelection(product, selection, gender);
    if (err) { toast.error(err); return; }
    const imgErr = validateCustomerImages(product, selection, customerImages);
    if (imgErr) { setShowErrors(true); toast.error(imgErr); return; }
    const txtErr = validateCustomerTexts(product, selection, customerTexts);
    if (txtErr) { setShowErrors(true); toast.error(txtErr); return; }
    if (measurementsError) { setShowErrors(true); toast.error(measurementsError); return; }
    setAddingToCart(true);
    try {
      await addToCart(
        id,
        buildConfigureSelections(product, selection, customerImages, customerTexts),
        product.type === "robe" ? { measurements } : undefined
      );
      setAddedToCart(true);
      toast.success("أضيف إلى السلة");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر الإضافة — سجّل دخولك كطالب"));
    } finally {
      setAddingToCart(false);
    }
  }

  async function handleConfirm() {
    if (!product || !id) return;
    // Same gate as add-to-cart: placing the order requires a student account.
    if (!isAuthenticated()) {
      toast("سجّل دخولك كطالب لإتمام الطلب");
      router.push(loginHref(window.location.pathname));
      return;
    }
    const err = validateSelection(product, selection, gender);
    if (err) { toast.error(err); return; }
    const imgErr = validateCustomerImages(product, selection, customerImages);
    if (imgErr) { setShowErrors(true); toast.error(imgErr); return; }
    const txtErr = validateCustomerTexts(product, selection, customerTexts);
    if (txtErr) { setShowErrors(true); toast.error(txtErr); return; }
    if (measurementsError) { setShowErrors(true); toast.error(measurementsError); return; }
    setSubmitting(true);
    try {
      const result = await configureOrder({
        productId: id,
        selections: buildConfigureSelections(product, selection, customerImages, customerTexts),
        ...(product.type === "robe" ? { measurements } : {}),
      });
      setConfirmed(result);
      toast.success("تم تأكيد الطلب");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر تأكيد الطلب — سجّل دخولك كطالب"));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <ProductPageSkeleton />;

  if (!product) {
    return (
      <div className="animate-step-in py-10">
        <EmptyState
          title="تعذّر تحميل المنتج"
          message={loadError ?? "المنتج غير موجود أو حدث خطأ في الاتصال"}
          icon={
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 9v4" /><path d="M12 17h.01" />
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            </svg>
          }
          action={
            <div className="flex flex-col items-center gap-2">
              <Button onClick={() => { setLoading(true); setLoadError(null); getProductFull(id!).then(setProduct).catch((e) => setLoadError(getApiErrorMessage(e, "تعذر التحميل"))).finally(() => setLoading(false)); }}>
                إعادة المحاولة
              </Button>
              <Link href={backHref} className="text-sm font-medium text-orange-ink underline underline-offset-2">
                العودة للمتجر
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  const groups = product.optionGroups
    .filter((g) => groupVisibleForGender(g, gender))
    .sort((a, b) => a.sort - b.sort);

  // Old-price markdown: strike compareAtPrice over the base price only when it's strictly higher.
  const hasDiscount =
    product.compareAtPrice != null && product.compareAtPrice > product.basePrice;
  const discountLabel = hasDiscount
    ? formatDiscountPercent(product.basePrice, product.compareAtPrice)
    : null;

  return (
    <div className="pb-28">
      {/* Editorial product layout: sticky gallery beside the options on desktop,
          single calm column on phones. */}
      <div className="mx-auto max-w-5xl lg:grid lg:grid-cols-2 lg:items-start lg:gap-10">
        {/* Left — title + gallery (sticky on desktop) */}
        <div className="space-y-5 lg:sticky lg:top-24">
          <div>
            <Link
              href={backHref}
              className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-orange-ink transition-colors hover:text-ink"
            >
              <span aria-hidden>→</span>
              المتجر
            </Link>
            <h1 className="mt-2 font-display-ar text-[clamp(1.6rem,4vw,2.4rem)] font-bold leading-tight text-ink">
              {product.nameAr}
            </h1>
            {product.description && (
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                {product.description}
              </p>
            )}

            {/* Old-price markdown — base price + struck compare-at + خصم badge */}
            {hasDiscount && (
              <div className="mt-3 flex flex-wrap items-center gap-2.5">
                <span
                  dir="ltr"
                  className="text-lg font-bold tabular-nums text-orange-ink"
                >
                  {formatIQD(product.basePrice)}
                </span>
                <span
                  dir="ltr"
                  className="text-sm font-medium tabular-nums text-ink-soft line-through"
                >
                  {formatIQD(product.compareAtPrice!)}
                </span>
                {discountLabel && (
                  <span className="inline-block rounded-full bg-orange-ink/10 px-2.5 py-0.5 text-xs font-bold text-orange-ink">
                    {discountLabel}
                  </span>
                )}
              </div>
            )}
          </div>

          <ProductMediaGallery
            nameAr={product.nameAr}
            imageUrl={product.imageUrl}
            images={product.images}
            productId={id}
          />
        </div>

        {/* Right — options, price, action */}
        <div className="mt-6 space-y-6 lg:mt-0">
        {!gender && (
          <div className="flex items-start gap-2.5 rounded-2xl border border-line bg-[var(--shop-sink)] p-3.5 text-sm leading-relaxed text-ink-soft">
            <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-orange-ink" />
            اختر جنسك من صفحة المنتجات لتفعيل الفلترة (مثلاً الشال للإناث).
          </div>
        )}

        {groups.map((group) => {
          const optionId = getSelectedOptionId(group, selection);
          const needsImage =
            optionId != null &&
            customerImageRequired(group, optionId);
          const needsText =
            optionId != null &&
            customerTextRequired(group, optionId);
          const isSashEmbroideryZone =
            product.type === "sash" && group.nameAr.startsWith("تطريز");
          const isSashThreadColor =
            product.type === "sash" && group.nameAr === "لون التطريز";
          const isSashTypedField = isSashEmbroideryZone || isSashThreadColor;
          const isCapEmbroideryGroup =
            product.type === "cap" &&
            (group.nameAr === "القبعة من الجانب" || group.nameAr === "القبعة من الأعلى");
          const isRobeSleeveToggle =
            product.type === "robe" &&
            group.inputType === "toggle" &&
            group.nameAr.startsWith("تطريز ردن الروب");
          const isShawlGroup = product.type === "shawl";
          const showUploadBlock =
            needsImage ||
            needsText ||
            isSashTypedField ||
            (isCapEmbroideryGroup && needsText) ||
            isRobeSleeveToggle ||
            isShawlGroup;
          const key =
            optionId != null ? selectionKey(group.id, optionId) : null;

          return (
            <div key={group.id}>
              <OptionGroupField
                group={group}
                selection={selection}
                role={role}
                lockedOptionId={group.lockedOptionId}
                onChange={setGroupValue}
              />
              {showUploadBlock && key && optionId && (
                <CustomerImageUpload
                  group={group}
                  optionId={optionId}
                  value={customerImages[key]}
                  onChange={(url) => {
                    setCustomerImages((prev) => ({ ...prev, [key]: url }));
                    setConfirmed(null);
                  }}
                  textValue={customerTexts[key]}
                  onTextChange={(text) => {
                    setCustomerTexts((prev) => ({ ...prev, [key]: text }));
                    setConfirmed(null);
                  }}
                  allowOptionalText={isShawlGroup || (isSashTypedField && !needsText)}
                  allowOptionalImage={
                    isShawlGroup ||
                    isSashEmbroideryZone ||
                    isRobeSleeveToggle ||
                    (isCapEmbroideryGroup && needsText)
                  }
                  showErrors={showErrors}
                />
              )}
            </div>
          );
        })}

        {/* قياسات الروب — mandatory measurements for robe products */}
        {product.type === "robe" && (
          <fieldset className="surface-card rounded-2xl p-4">
            <legend className="px-1 font-display text-sm font-bold text-ink">
              قياسات الروب
              <span className="ms-1 text-orange-ink">*</span>
            </legend>
            <p className="mt-1 text-xs leading-relaxed text-ink-soft">
              أدخل مقاساتك بالسنتيمتر لضمان الحجم المناسب.
            </p>
            <div className="mt-3 space-y-3">
              {(
                [
                  { key: "shoulder_cm", label: "كتف", optional: false },
                  { key: "chest_cm", label: "محيط الصدر", optional: true },
                  { key: "robe_length_cm", label: "طول الروب", optional: false },
                  { key: "sleeve_length_cm", label: "طول الردن", optional: false },
                ] as {
                  key: "shoulder_cm" | "chest_cm" | "robe_length_cm" | "sleeve_length_cm";
                  label: string;
                  optional: boolean;
                }[]
              ).map(({ key: mKey, label, optional }) => {
                const val = measurements[mKey] ?? 0;
                const hasError =
                  showErrors &&
                  (optional
                    ? val > 0 && (val < 60 || val > 180)
                    : val <= 0);
                return (
                  <div key={mKey} className="flex items-center gap-3">
                    <label
                      htmlFor={`m-${mKey}`}
                      className="w-28 shrink-0 text-sm font-semibold text-ink"
                    >
                      {label}
                      {optional && (
                        <span className="block text-[10px] font-normal text-ink-soft">
                          (اختياري)
                        </span>
                      )}
                    </label>
                    <div className="relative flex-1">
                      <input
                        id={`m-${mKey}`}
                        type="number"
                        inputMode="decimal"
                        min={1}
                        max={300}
                        placeholder="0"
                        value={val === 0 ? "" : val}
                        onChange={(e) => {
                          const n = parseFloat(e.target.value) || 0;
                          setMeasurements((prev) => ({ ...prev, [mKey]: n }));
                        }}
                        className={`min-h-11 w-full rounded-xl border pe-12 ps-3.5 py-2.5 text-sm font-medium text-ink placeholder:text-ink/30 outline-none transition-colors focus:ring-2 focus:ring-orange/30 ${
                          hasError
                            ? "border-red-400 bg-red-50 focus:border-red-400"
                            : "border-neutral bg-white focus:border-orange"
                        }`}
                      />
                      <span
                        aria-hidden
                        className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-ink-soft"
                      >
                        سم
                      </span>
                    </div>
                  </div>
                );
              })}
              {showErrors && measurementsError && (
                <p role="alert" className="text-xs font-medium text-red-500">
                  {measurementsError}
                </p>
              )}
            </div>
            {/* ملاحظات لفصال الروب — optional tailoring note (rides measurements.tailor_notes) */}
            <div className="mt-4">
              <label
                htmlFor="m-tailor-notes"
                className="block text-sm font-semibold text-ink"
              >
                ملاحظات لفصال الروب
                <span className="ms-1 text-xs font-normal text-ink-soft">(اختياري)</span>
              </label>
              <textarea
                id="m-tailor-notes"
                dir="rtl"
                rows={3}
                maxLength={500}
                placeholder="أي تفاصيل إضافية عن الفصال (مثال: تكبير الصدر قليلاً)…"
                value={measurements.tailor_notes ?? ""}
                onChange={(e) =>
                  setMeasurements((prev) => ({ ...prev, tailor_notes: e.target.value }))
                }
                className="mt-1.5 w-full resize-none rounded-xl border border-neutral bg-white px-3.5 py-2.5 text-sm leading-relaxed text-ink placeholder:text-ink/30 outline-none transition-colors focus:border-orange focus:ring-2 focus:ring-orange/30"
              />
            </div>
            {/* صورة الوصل — optional receipt photo (rides measurements.receipt_image_url) */}
            <ReceiptUpload
              value={measurements.receipt_image_url}
              onChange={(url) =>
                setMeasurements((prev) => ({ ...prev, receipt_image_url: url }))
              }
            />
          </fieldset>
        )}

        <PriceBreakdown lines={preview.lines} total={preview.total} compact />
        {confirmed && (
          <OrderBreakdownCard
            lines={confirmed.breakdown}
            total={confirmed.total}
          />
        )}

        </div>
      </div>

      {!product.customizable && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-cream px-4 py-3.5 shadow-[var(--shadow-float)]">
          <div className="mx-auto max-w-5xl">
            {addedToCart ? (
              <div className="flex gap-2">
                <Button
                  fullWidth
                  variant="secondary"
                  onClick={() => router.push("/cart")}
                >
                  عرض السلة
                </Button>
                <Button
                  fullWidth
                  variant="ghost"
                  onClick={() => router.push("/")}
                >
                  متابعة التسوق
                </Button>
              </div>
            ) : (
              <Button
                fullWidth
                loading={addingToCart}
                disabled={addingToCart}
                onClick={() => { setShowErrors(true); handleAddToCart(); }}
              >
                أضف إلى السلة
              </Button>
            )}
          </div>
        </div>
      )}

      {product.customizable && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-cream px-4 py-3.5 shadow-[var(--shadow-float)]">
          <div className="mx-auto max-w-5xl">
          {confirmed ? (
            <Button fullWidth variant="secondary" onClick={() => router.push("/")}>
              متابعة التسوق
            </Button>
          ) : (
            <Button
              fullWidth
              loading={submitting}
              disabled={submitting}
              onClick={() => { setShowErrors(true); handleConfirm(); }}
            >
              تأكيد الطلب (نقداً)
            </Button>
          )}
          </div>
        </div>
      )}
    </div>
  );
}
