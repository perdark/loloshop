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
import { PageLoader } from "@/components/ui/Spinner";

const GENDER_KEY = "loloshop_student_gender";

export default function StudentProductPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [loading, setLoading] = useState(true);
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
    getProductFull(id)
      .then(setProduct)
      .catch(() => toast.error("تعذر تحميل المنتج"))
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

  if (loading || !product) return <PageLoader />;

  const groups = product.optionGroups
    .filter((g) => groupVisibleForGender(g, gender))
    .sort((a, b) => a.sort - b.sort);

  return (
    <div className="pb-28">
      <div className="space-y-6">
        <div>
          <Link
            href="/shop"
            className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-orange-ink transition-colors hover:text-orange"
          >
            <span aria-hidden>→</span>
            المنتجات
          </Link>
          <h1 className="mt-2 font-display text-2xl font-bold text-ink">
            {product.nameAr}
          </h1>
          {product.description && (
            <p className="mt-1.5 text-sm leading-relaxed text-ink/60">
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

        {!gender && (
          <div className="flex items-start gap-2.5 rounded-2xl border border-orange/30 bg-orange/5 p-3.5 text-sm leading-relaxed text-ink/70 ring-1 ring-orange/10">
            <span aria-hidden className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand-gradient" />
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
              className="btn-shine flex min-h-12 w-full items-center justify-center gap-2 rounded-pill bg-brand-gradient font-display text-base font-bold text-white shadow-[var(--shadow-pop)] transition-transform hover:scale-[1.01] active:scale-100"
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
            <p className="text-center text-xs text-ink/50">
              اختيار اللون والنوع والسعر يتم داخل المصمّم
            </p>
          </div>
        )}
      </div>

      {product.type !== "sash" && (
        <div className="surface-glass fixed inset-x-0 bottom-0 z-30 border-t border-orange/10 px-4 py-3.5 shadow-[var(--shadow-float)]">
          <div className="mx-auto max-w-lg">
          {confirmed ? (
            <Button fullWidth variant="secondary" onClick={() => router.push("/shop")}>
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
