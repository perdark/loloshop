"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import { getProductFull } from "@/lib/catalog";
import { confirmPackage, listPackages } from "@/lib/packages";
import { formatIQD } from "@/lib/format";
import type { CatalogOption } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { PageLoader } from "@/components/ui/Spinner";

const BATCH_STORAGE_KEY = "loloshop_wholesaler_batch_id";

export default function WholesalerPackagePage() {
  const router = useRouter();
  const [packages, setPackages] = useState<Awaited<ReturnType<typeof listPackages>>>(
    []
  );
  const [selected, setSelected] = useState<
    Awaited<ReturnType<typeof listPackages>>[number] | null
  >(null);
  const [capOptions, setCapOptions] = useState<CatalogOption[]>([]);
  const [capOptionId, setCapOptionId] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const pkgs = await listPackages();
      setPackages(pkgs);

      const capProduct = await findCapProductId();
      let caps: CatalogOption[] = [];
      if (capProduct) {
        const capFull = await getProductFull(capProduct, "wholesaler");
        const shapeGroup = capFull.optionGroups.find(
          (g) => g.inputType === "single_select"
        );
        caps = shapeGroup?.options.filter((o) => o.active) ?? [];
        setCapOptions(caps);
      }

      if (pkgs[0]) {
        setSelected(pkgs[0]);
        const defaultCap =
          pkgs[0].defaultCapOptionId &&
          caps.some((o) => o.id === pkgs[0].defaultCapOptionId)
            ? pkgs[0].defaultCapOptionId
            : caps[0]?.id ?? "";
        setCapOptionId(defaultCap);
      }
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر تحميل الباقات"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount fetch
    load();
  }, [load]);

  function selectPackage(
    pkg: (typeof packages)[number],
    caps: CatalogOption[] = capOptions
  ) {
    setSelected(pkg);
    const defaultCap =
      pkg.defaultCapOptionId && caps.some((o) => o.id === pkg.defaultCapOptionId)
        ? pkg.defaultCapOptionId
        : caps[0]?.id ?? "";
    setCapOptionId(defaultCap);
  }

  async function handleConfirm() {
    if (!selected || !capOptionId) {
      toast.error("اختر الباقة ونوع القبعة");
      return;
    }
    setSubmitting(true);
    try {
      const batchId =
        typeof window !== "undefined"
          ? localStorage.getItem(BATCH_STORAGE_KEY) ?? undefined
          : undefined;
      await confirmPackage({
        packageId: selected.id,
        capOptionId,
        batchId,
      });
      toast.success("تم اعتماد الباقة");
      router.push("/wholesaler");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر اعتماد الباقة"));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-6 pb-8" dir="rtl" lang="ar">
      <Link href="/wholesaler" className="text-sm text-orange-ink hover:underline">
        ← لوحة الممثل
      </Link>

      <h1 className="font-display text-xl font-bold text-ink">باقات التخرج</h1>
      <p className="text-sm text-ink/60">
        مستوى الباقة يعتمد على نوع الوشاح — القبعة قابلة للتبديل بشكل مستقل
      </p>

      {packages.length === 0 ? (
        <p className="rounded-xl border border-ink/10 bg-white p-4 text-sm text-ink/60">
          لا توجد باقات متاحة حالياً
        </p>
      ) : (
        <div className="space-y-3">
          {packages.map((pkg) => (
            <button
              key={pkg.id}
              type="button"
              onClick={() => selectPackage(pkg)}
              className={`w-full rounded-xl border p-4 text-right transition-colors ${
                selected?.id === pkg.id
                  ? "border-orange bg-orange/5"
                  : "border-ink/10 bg-white"
              }`}
            >
              {pkg.imageUrl && (
                <div className="relative mb-3 aspect-[16/9] overflow-hidden rounded-lg bg-peach/30">
                  <Image
                    src={pkg.imageUrl}
                    alt={pkg.nameAr}
                    fill
                    className="object-cover"
                    sizes="400px"
                    unoptimized
                  />
                </div>
              )}
              <p className="font-semibold text-ink">{pkg.nameAr}</p>
              <p className="mt-1 text-xs text-ink/50">
                وشاح: {pkg.sashTypeLabel || "—"}
              </p>
              <p className="mt-2 font-bold text-orange-ink" dir="ltr">
                {formatIQD(pkg.price)}
              </p>
            </button>
          ))}
        </div>
      )}

      {selected && capOptions.length > 0 && (
        <section className="rounded-xl border border-ink/10 bg-white p-4">
          <p className="mb-2 text-sm font-medium text-ink">تبديل القبعة</p>
          <div className="flex flex-col gap-2">
            {capOptions.map((opt) => (
              <label key={opt.id} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="cap"
                  checked={capOptionId === opt.id}
                  onChange={() => setCapOptionId(opt.id)}
                  className="accent-orange"
                />
                {opt.labelAr}
                {opt.id === selected.defaultCapOptionId && (
                  <span className="text-xs text-ink/50">(افتراضي)</span>
                )}
              </label>
            ))}
          </div>
          <p className="mt-3 text-xs text-ink/50">
            الوشاح: {selected.sashTypeLabel || "—"} — السعر ثابت للباقة
          </p>
          <Button
            fullWidth
            className="mt-4"
            disabled={submitting || !capOptionId}
            onClick={handleConfirm}
          >
            {submitting ? "جاري الاعتماد…" : "اعتماد الباقة"}
          </Button>
        </section>
      )}

      {selected && capOptions.length === 0 && (
        <p className="text-sm text-ink/60">تعذر تحميل خيارات القبعة</p>
      )}
    </div>
  );
}

async function findCapProductId(): Promise<string | null> {
  const { getShopFeed } = await import("@/lib/catalog");
  const feed = await getShopFeed();
  const cap = feed.byType?.cap?.[0];
  return cap?.id ?? null;
}
