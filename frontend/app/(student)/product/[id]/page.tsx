"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CustomerImageUpload } from "@/components/catalog/CustomerImageUpload";
import { OptionGroupField } from "@/components/catalog/OptionGroupField";
import { OrderBreakdownCard } from "@/components/catalog/OrderBreakdownCard";
import { ProductMediaGallery } from "@/components/catalog/ProductMediaGallery";
import { PriceBreakdown } from "@/components/catalog/PriceBreakdown";
import { getProductFull } from "@/lib/catalog";
import { getApiErrorMessage } from "@/lib/api";
import {
  customerImageRequired,
  getSelectedOptionId,
  selectionKey,
  validateCustomerImages,
} from "@/lib/customerImage";
import { buildConfigureSelections, configureOrder } from "@/lib/orders";
import {
  computePriceBreakdown,
  groupVisibleForGender,
  validateSelection,
  type OptionSelection,
} from "@/lib/pricing";
import type { CatalogProduct, ConfigureOrderResult } from "@/lib/types";
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
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selection, setSelection] = useState<OptionSelection>({});
  const [customerImages, setCustomerImages] = useState<Record<string, string>>(
    {}
  );
  const [confirmed, setConfirmed] = useState<ConfigureOrderResult | null>(null);
  const [gender, setGender] = useState<"male" | "female" | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(GENDER_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage read on mount
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derived from product, no cascade
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
    setConfirmed(null);
  }

  const customerImageError = useMemo(() => {
    if (!product) return null;
    return validateCustomerImages(product, selection, customerImages);
  }, [product, selection, customerImages]);

  async function handleConfirm() {
    if (!product || !id) return;
    const err = validateSelection(product, selection, gender);
    if (err) {
      toast.error(err);
      return;
    }
    const imgErr = validateCustomerImages(product, selection, customerImages);
    if (imgErr) {
      toast.error(imgErr);
      return;
    }
    setSubmitting(true);
    try {
      const result = await configureOrder({
        productId: id,
        selections: buildConfigureSelections(
          product,
          selection,
          customerImages
        ),
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
              <Link href="/" className="text-sm font-medium text-orange-ink underline underline-offset-2">
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

  return (
    <div className="pb-28">
      {/* Editorial product layout: sticky gallery beside the options on desktop,
          single calm column on phones. */}
      <div className="mx-auto max-w-5xl lg:grid lg:grid-cols-2 lg:items-start lg:gap-10">
        {/* Left — title + gallery (sticky on desktop) */}
        <div className="space-y-5 lg:sticky lg:top-24">
          <div>
            <Link
              href="/"
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
              {needsImage && key && optionId && (
                <CustomerImageUpload
                  group={group}
                  optionId={optionId}
                  value={customerImages[key]}
                  onChange={(url) => {
                    setCustomerImages((prev) => ({ ...prev, [key]: url }));
                    setConfirmed(null);
                  }}
                />
              )}
            </div>
          );
        })}

        <PriceBreakdown lines={preview.lines} total={preview.total} compact />
        {confirmed && (
          <OrderBreakdownCard
            lines={confirmed.breakdown}
            total={confirmed.total}
          />
        )}

        {product.type === "sash" && (
          <div className="space-y-2">
            <button
              type="button"
              className="btn-shine flex min-h-12 w-full items-center justify-center gap-2 rounded-pill bg-orange-ink font-display text-base font-bold text-white shadow-[var(--shadow-float)] transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0"
              onClick={() => {
                sessionStorage.setItem(
                  "loloshop_sash_preset",
                  JSON.stringify({ productId: id, selections: selection })
                );
                router.push("/design");
              }}
            >
              صمّم وشاحك واطلبه
            </button>
            <p className="text-center text-xs text-[var(--shop-muted)]">
              اختيار اللون والنوع والسعر يتم داخل المصمّم
            </p>
          </div>
        )}
        </div>
      </div>

      {product.type !== "sash" && (
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
              disabled={Boolean(customerImageError)}
              onClick={handleConfirm}
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
