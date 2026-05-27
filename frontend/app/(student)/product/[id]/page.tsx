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
      .then(setProduct) // eslint-disable-line react-hooks/set-state-in-effect -- async fetch
      .catch(() => toast.error("تعذر تحميل المنتج"))
      .finally(() => setLoading(false));
  }, [id]);

  // Apply product presets + auto-select single-option required groups
  useEffect(() => {
    if (!product) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derived from product, no cascade
    setSelection((prev) => {
      const autoSel: OptionSelection = { ...prev };
      // Apply admin-configured presets first (child product defaults)
      for (const preset of product.presets ?? []) {
        for (const g of product.optionGroups) {
          const opt = g.options.find((o) => o.id === preset.optionId);
          if (opt) {
            if (autoSel[g.id] === undefined) {
              if (g.inputType === "single_select") autoSel[g.id] = preset.optionId;
              else if (g.inputType === "toggle") autoSel[g.id] = true;
            }
            break;
          }
        }
      }
      // Auto-select single-option required groups
      for (const g of product.optionGroups) {
        if (autoSel[g.id] !== undefined) continue;
        const active = g.options.filter((o) => o.active);
        if (g.required && active.length === 1) {
          autoSel[g.id] = active[0].id;
        }
      }
      return autoSel;
    });
    // Apply preset customer images (e.g. admin-uploaded مثلث reference photo)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derived from product, no cascade
    setCustomerImages((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      const imgs: Record<string, string> = {};
      for (const p of product.presets ?? []) {
        if (!p.customerImageUrl) continue;
        for (const g of product.optionGroups) {
          const opt = g.options.find((o) => o.id === p.optionId);
          if (opt) {
            imgs[selectionKey(g.id, p.optionId)] = p.customerImageUrl;
            break;
          }
        }
      }
      return Object.keys(imgs).length ? imgs : prev;
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
    <div className="mx-auto max-w-lg bg-cream pb-28">
      <header className="border-b border-ink/10 bg-beige px-4 py-4">
        <p className="font-script text-2xl text-orange">lolo shop</p>
        <p className="font-display text-sm font-semibold text-ink">لولو شوب</p>
      </header>

      <div className="space-y-5 px-4 py-6">
        <div>
          <Link href="/shop" className="text-sm text-orange hover:underline">
            ← المنتجات
          </Link>
          <h1 className="mt-2 font-display text-2xl font-bold text-ink">
            {product.nameAr}
          </h1>
          {product.description && (
            <p className="mt-1 text-sm text-ink/60">{product.description}</p>
          )}
        </div>

        <ProductMediaGallery
          nameAr={product.nameAr}
          imageUrl={product.imageUrl}
          images={product.images}
        />

        {!gender && (
          <div className="rounded-xl border border-orange/40 bg-orange/5 p-3 text-sm text-ink/70">
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
              className="flex min-h-12 w-full items-center justify-center rounded-xl bg-orange font-semibold text-white hover:bg-orange-light"
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
        <div className="fixed bottom-0 left-0 right-0 border-t border-neutral bg-beige p-4">
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
      )}
    </div>
  );
}
