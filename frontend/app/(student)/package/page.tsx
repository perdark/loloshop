"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import { getProductFull } from "@/lib/catalog";
import { confirmPackage, listPackages } from "@/lib/packages";
import { formatIQD } from "@/lib/format";
import type { CatalogOption, PackageTier } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

/**
 * Shared package-form page.
 * - Wholesaler-students land here via the home-page redirect.
 * - Retail students come from the "أكمل باكج التخرّج" cart suggestion card.
 * The form shows what's included, a cap-shape picker, the price,
 * and a confirm button → redirects to /cart on success.
 */

async function findCapProductId(packages: PackageTier[]): Promise<string | null> {
  // Each package may carry capProductId; fall back to feed scan if not.
  const capId = packages.find((p) => p.capProductId)?.capProductId;
  if (capId) return capId;
  // Fallback: use the shop feed cap list.
  const { getShopFeed } = await import("@/lib/catalog");
  const feed = await getShopFeed();
  return feed.byType?.cap?.[0]?.id ?? null;
}

function PackageSkeleton() {
  return (
    <div className="animate-fade-page-in space-y-5 pb-24" aria-busy="true">
      <span className="sr-only">جارٍ تحميل الباقات…</span>
      <div className="skeleton h-7 w-1/2 rounded-xl" />
      <div className="skeleton h-4 w-3/4 rounded-pill" />
      {[0, 1].map((i) => (
        <div key={i} className="skeleton h-[160px] w-full rounded-2xl" />
      ))}
      <div className="skeleton h-[200px] w-full rounded-2xl" />
      <div className="skeleton h-12 w-full rounded-pill" />
    </div>
  );
}

export default function PackagePage() {
  const router = useRouter();
  const [packages, setPackages] = useState<PackageTier[]>([]);
  const [selected, setSelected] = useState<PackageTier | null>(null);
  const [capOptions, setCapOptions] = useState<CatalogOption[]>([]);
  const [capOptionId, setCapOptionId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      // Try wholesaler packages first; if empty try retail.
      let pkgs = await listPackages("wholesaler");
      if (pkgs.length === 0) pkgs = await listPackages("retail");
      setPackages(pkgs);

      const capProductId = await findCapProductId(pkgs);
      let caps: CatalogOption[] = [];
      if (capProductId) {
        const capFull = await getProductFull(capProductId);
        const shapeGroup = capFull.optionGroups.find(
          (g) => g.inputType === "single_select"
        );
        caps = shapeGroup?.options.filter((o) => o.active) ?? [];
        setCapOptions(caps);
      }

      if (pkgs[0]) {
        setSelected(pkgs[0]);
        const def = pkgs[0].defaultCapOptionId;
        const defaultCap =
          def && caps.some((o) => o.id === def) ? def : (caps[0]?.id ?? "");
        setCapOptionId(defaultCap);
      }
    } catch (e) {
      setLoadError(true);
      toast.error(getApiErrorMessage(e, "تعذر تحميل الباقات"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function selectPackage(pkg: PackageTier) {
    setSelected(pkg);
    const def = pkg.defaultCapOptionId;
    const defaultCap =
      def && capOptions.some((o) => o.id === def) ? def : (capOptions[0]?.id ?? "");
    setCapOptionId(defaultCap);
  }

  async function handleConfirm() {
    if (!selected || !capOptionId) {
      toast.error("اختر الباقة ونوع القبعة");
      return;
    }
    setSubmitting(true);
    try {
      await confirmPackage({ packageId: selected.id, capOptionId });
      toast.success("تم اعتماد الباقة");
      router.push("/cart");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر اعتماد الباقة"));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <PackageSkeleton />;

  if (loadError) {
    return (
      <div className="space-y-4 py-8">
        <BackLink />
        <EmptyState
          title="تعذر تحميل الباقات"
          message="تحقق من الاتصال ثم حاول مجدداً."
          action={
            <Button variant="ghost" onClick={load}>
              إعادة المحاولة
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="animate-page-in space-y-6 pb-24">
      <BackLink />

      {/* Page heading */}
      <div>
        <h1 className="font-display-ar text-2xl font-bold leading-tight text-ink [text-wrap:balance]">
          باقات التخرج
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          كل شيء في مجموعة واحدة، الروب والوشاح والقبعة
        </p>
      </div>

      {packages.length === 0 ? (
        <EmptyState
          title="لا توجد باقات"
          message="لا توجد باقات متاحة حالياً — تواصل مع المسؤول."
        />
      ) : (
        <div className="space-y-3">
          {packages.map((pkg) => {
            const isSelected = selected?.id === pkg.id;
            return (
              <button
                key={pkg.id}
                type="button"
                onClick={() => selectPackage(pkg)}
                aria-pressed={isSelected}
                className={`block w-full overflow-hidden rounded-2xl bg-surface text-start shadow-[var(--shadow-soft)] transition-all duration-200 active:scale-[0.99] ${
                  isSelected
                    ? "ring-2 ring-orange-ink ring-offset-2 shadow-[var(--shadow-card)]"
                    : "ring-1 ring-line hover:ring-orange-ink/30"
                }`}
              >
                {pkg.imageUrl && (
                  <div className="relative aspect-[16/9] overflow-hidden bg-[var(--shop-sink)]">
                    <Image
                      src={pkg.imageUrl}
                      alt={pkg.nameAr}
                      fill
                      className="object-cover"
                      sizes="(max-width: 1023px) 100vw, 640px"
                      /* `unoptimized` removed — stored catalog image, see VipHero. */
                    />
                  </div>
                )}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-display-ar text-base font-bold text-ink">
                        {pkg.nameAr}
                      </p>
                      {/* What's included */}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <IncludedTag label="روب التخرج" />
                        <IncludedTag label={`وشاح ${pkg.sashTypeLabel || ""}`} />
                        <IncludedTag label="قبعة" />
                      </div>
                    </div>
                    {isSelected && (
                      <span className="mt-0.5 shrink-0 rounded-full bg-orange/10 px-2.5 py-1 text-xs font-semibold text-orange-ink">
                        مختارة
                      </span>
                    )}
                  </div>
                  <p
                    className="mt-3 font-display text-xl font-bold text-ink"
                    dir="ltr"
                  >
                    {formatIQD(pkg.price)}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--shop-muted)]">
                    الدفع نقداً عند الاستلام
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Cap picker */}
      {selected && capOptions.length > 0 && (
        <section className="rounded-2xl bg-surface p-5 shadow-[var(--shadow-soft)] ring-1 ring-line">
          <p className="mb-3 text-sm font-semibold text-ink">اختر شكل القبعة</p>
          <div className="flex flex-col gap-2">
            {capOptions.map((opt) => {
              const isChecked = capOptionId === opt.id;
              return (
                <label
                  key={opt.id}
                  className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-sm transition-colors ${
                    isChecked
                      ? "border-orange/50 bg-orange/5 text-ink"
                      : "border-line bg-[var(--shop-sink)] text-ink-soft hover:border-orange/30"
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
                    <span className="me-auto rounded-full bg-[var(--shop-sink)] px-2 py-0.5 text-xs text-[var(--shop-muted)]">
                      الافتراضي
                    </span>
                  )}
                </label>
              );
            })}
          </div>
          {/* Sash note */}
          <p className="mt-3 rounded-xl border border-line bg-[var(--shop-sink)] px-3 py-2 text-xs text-ink-soft">
            نوع الوشاح: {selected.sashTypeLabel || "—"} — مشمول في سعر الباقة
          </p>
        </section>
      )}

      {selected && capOptions.length === 0 && !loading && (
        <EmptyState
          title="تعذر تحميل خيارات القبعة"
          message="تعذر جلب الخيارات — حاول مجدداً أو تواصل مع المسؤول."
          action={
            <Button variant="ghost" onClick={load}>
              إعادة المحاولة
            </Button>
          }
        />
      )}

      {/* Sticky confirm CTA */}
      {packages.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line surface-glass px-4 py-3.5 shadow-[var(--shadow-float)]">
          <div className="mx-auto max-w-lg">
            <Button
              fullWidth
              size="lg"
              loading={submitting}
              disabled={!selected || !capOptionId || submitting}
              onClick={handleConfirm}
            >
              {submitting ? "جارٍ الاعتماد…" : "اعتماد الباقة وابدأ التصميم"}
            </Button>
            <p className="mt-2 text-center text-xs text-[var(--shop-muted)]">
              {selected ? formatIQD(selected.price) : ""} — الدفع نقداً عند الاستلام
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function IncludedTag({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--shop-sink)] px-2.5 py-0.5 text-xs font-medium text-ink-soft">
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="h-3 w-3 text-orange-ink"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
      {label}
    </span>
  );
}

function BackLink() {
  return (
    <Link
      href="/"
      className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-orange-ink transition-colors hover:text-ink"
    >
      <span aria-hidden>→</span>
      المتجر
    </Link>
  );
}
