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
      <Link href="/wholesaler" className="inline-flex min-h-11 items-center text-sm font-medium text-orange-ink hover:underline">
        ← لوحة الممثل
      </Link>

      <div>
        <h1 className="section-heading font-display text-2xl font-bold text-ink">باقات التخرج</h1>
        <p className="mt-2 text-sm text-ink-soft">
          مستوى الباقة يعتمد على نوع الوشاح — القبعة قابلة للتبديل بشكل مستقل
        </p>
      </div>

      {packages.length === 0 ? (
        <div className="surface-card rounded-2xl p-5 text-center text-sm text-ink-soft">
          لا توجد باقات متاحة حالياً
        </div>
      ) : (
        <div className="space-y-3">
          {packages.map((pkg) => {
            const isSelected = selected?.id === pkg.id;
            return (
              <button
                key={pkg.id}
                type="button"
                onClick={() => selectPackage(pkg)}
                className={`surface-card card-lift block w-full overflow-hidden rounded-2xl p-4 text-start transition-all ${
                  isSelected ? "ring-2 ring-orange/50 shadow-[var(--shadow-card)]" : ""
                }`}
              >
                {pkg.imageUrl && (
                  <div className="relative mb-3 aspect-[16/9] overflow-hidden rounded-xl bg-peach/30">
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
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-display font-bold text-ink">{pkg.nameAr}</p>
                    <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-beige/70 px-2 py-0.5 text-xs text-[var(--shop-muted)]">
                      وشاح: {pkg.sashTypeLabel || "—"}
                    </p>
                  </div>
                  {isSelected && (
                    <span className="shrink-0 rounded-full bg-orange/10 px-2.5 py-1 text-xs font-semibold text-orange-ink">
                      مختارة
                    </span>
                  )}
                </div>
                <p className="mt-2.5 font-display text-xl font-bold text-gradient-brand" dir="ltr">
                  {formatIQD(pkg.price)}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {selected && capOptions.length > 0 && (
        <section className="surface-card rounded-2xl p-5">
          <p className="section-heading mb-3 text-sm font-semibold text-ink">تبديل القبعة</p>
          <div className="flex flex-col gap-2">
            {capOptions.map((opt) => {
              const isChecked = capOptionId === opt.id;
              return (
                <label
                  key={opt.id}
                  className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-sm transition-colors ${
                    isChecked
                      ? "border-orange/50 bg-orange/5 text-ink"
                      : "border-ink/10 bg-beige/40 text-ink/70 hover:border-orange/30"
                  }`}
                >
                  <input
                    type="radio"
                    name="cap"
                    checked={isChecked}
                    onChange={() => setCapOptionId(opt.id)}
                    className="size-4 accent-orange"
                  />
                  <span className="font-medium">{opt.labelAr}</span>
                  {opt.id === selected.defaultCapOptionId && (
                    <span className="me-auto rounded-full bg-beige/70 px-2 py-0.5 text-xs text-[var(--shop-muted)]">
                      افتراضي
                    </span>
                  )}
                </label>
              );
            })}
          </div>
          <p className="mt-3 rounded-xl bg-beige/70 px-3 py-2 text-xs text-ink-soft">
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
        <div className="surface-card rounded-2xl p-5 text-center text-sm text-ink-soft">
          تعذر تحميل خيارات القبعة
        </div>
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
