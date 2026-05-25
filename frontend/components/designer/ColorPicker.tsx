"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { listProducts } from "@/lib/designer";
import type { Product, ProductVariant } from "@/lib/types";
import { Spinner } from "@/components/ui/Spinner";

interface Props {
  selectedVariantId: string | null;
  onSelect: (variant: ProductVariant, product: Product) => void;
}

const COLOR_HEX: Record<string, string> = {
  "أبيض": "#f8f8f6",
  "رمادي فاتح": "#c8c8c8",
  "أخضر داكن": "#1f4e3d",
  "أسود": "#111111",
  "كحلي": "#0b1e3f",
  "عنابي": "#7a1f2b",
};

export function ColorPicker({ selectedVariantId, onSelect }: Props) {
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    listProducts("sash")
      .then((items) => {
        if (cancelled) return;
        setProduct(items[0] || null);
      })
      .catch(() => toast.error("تعذر تحميل المنتجات"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center p-12">
        <Spinner />
      </div>
    );
  }

  if (!product || product.variants.length === 0) {
    return (
      <p className="p-6 text-center text-ink/60">
        لا توجد ألوان متاحة حالياً
      </p>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <p className="text-sm text-ink/70">اختر لون الوشاح:</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {product.variants.map((v) => {
          const hex = COLOR_HEX[v.color || ""] || "#999";
          const active = v.id === selectedVariantId;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => onSelect(v, product)}
              className={`group flex flex-col items-center gap-2 rounded-xl border-2 p-3 transition-all ${
                active
                  ? "border-orange bg-orange/10"
                  : "border-ink/10 hover:border-ink/30"
              }`}
            >
              <span
                className="block h-16 w-16 rounded-full shadow-sm ring-1 ring-ink/10"
                style={{ background: hex }}
              />
              <span className="text-sm font-medium text-ink">{v.color}</span>
              <span className="text-xs text-ink/60">
                {new Intl.NumberFormat("ar-IQ").format(v.price)} د.ع
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
