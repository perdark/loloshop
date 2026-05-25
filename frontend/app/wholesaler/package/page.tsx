"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { MOCK_PACKAGES } from "@/lib/mocks/catalog";
import { formatIQD } from "@/lib/format";
import type { PackageTier } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { PageLoader } from "@/components/ui/Spinner";

export default function WholesalerPackagePage() {
  const [packages, setPackages] = useState<PackageTier[]>([]);
  const [selected, setSelected] = useState<PackageTier | null>(null);
  const [capOptionId, setCapOptionId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setPackages(MOCK_PACKAGES);
    if (MOCK_PACKAGES[0]) {
      setSelected(MOCK_PACKAGES[0]);
      setCapOptionId(MOCK_PACKAGES[0].defaultCapOptionId);
    }
    setLoading(false);
  }, []);

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-6 pb-8" dir="rtl" lang="ar">
      <Link href="/wholesaler" className="text-sm text-orange hover:underline">
        ← لوحة الممثل
      </Link>

      <h1 className="font-display text-xl font-bold text-ink">باقات التخرج</h1>
      <p className="text-sm text-ink/60">
        مستوى الباقة يعتمد على نوع الوشاح — القبعة قابلة للتبديل بشكل مستقل
      </p>

      <div className="space-y-3">
        {packages.map((pkg) => (
          <button
            key={pkg.id}
            type="button"
            onClick={() => {
              setSelected(pkg);
              setCapOptionId(pkg.defaultCapOptionId);
            }}
            className={`w-full rounded-xl border p-4 text-right transition-colors ${
              selected?.id === pkg.id
                ? "border-orange bg-orange/5"
                : "border-ink/10 bg-white"
            }`}
          >
            <p className="font-semibold text-ink">{pkg.nameAr}</p>
            <p className="mt-1 text-xs text-ink/50">
              وشاح: {pkg.sashTypeLabel}
            </p>
            <p className="mt-2 font-bold text-orange" dir="ltr">
              {formatIQD(pkg.price)}
            </p>
          </button>
        ))}
      </div>

      {selected && (
        <section className="rounded-xl border border-ink/10 bg-white p-4">
          <p className="mb-2 text-sm font-medium text-ink">تبديل القبعة</p>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="cap"
                checked={capOptionId === selected.defaultCapOptionId}
                onChange={() => setCapOptionId(selected.defaultCapOptionId)}
                className="accent-orange"
              />
              {selected.defaultCapLabel} (افتراضي)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="cap"
                checked={capOptionId !== selected.defaultCapOptionId}
                onChange={() =>
                  setCapOptionId(
                    capOptionId === selected.defaultCapOptionId
                      ? "o-cap-alt"
                      : capOptionId
                  )
                }
                className="accent-orange"
              />
              قبعة بديلة (مثال: ملكي + قبعة عادية)
            </label>
          </div>
          <p className="mt-3 text-xs text-ink/50">
            الوشاح: {selected.sashTypeLabel} — السعر ثابت للباقة
          </p>
          <Button
            fullWidth
            className="mt-4"
            onClick={() => toast.success("تم اختيار الباقة للطلاب")}
          >
            اعتماد الباقة
          </Button>
        </section>
      )}
    </div>
  );
}
