"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import { listPackages } from "@/lib/packages";
import { formatIQD } from "@/lib/format";
import type { PackageTier } from "@/lib/types";
import { Button } from "@/components/ui/Button";

/**
 * VipShowcase — marketing display of VIP package tiers.
 *
 * The "pick" CTA routes to /package?pkg=<id> instead of calling
 * confirmPackage() directly. Calling confirmPackage with capOptionId:""
 * would create:
 *   (1) a sash order with design_id=NULL that the /design reconciler
 *       can't find (it queries WHERE design_id=$2), producing an orphan
 *       at the VIP price plus a second sash order at the individual price;
 *   (2) a cap order_item with option_id=null (no shape chosen).
 *
 * The /package page already handles cap selection + correct confirmPackage
 * invocation + redirect to /design, so we delegate to it.
 *
 * upgradeToVip (for students who already have a bundle) is a separate
 * path and is not affected by this component.
 */

interface VipShowcaseProps {
  /** Optional: surface only the single package with this id. */
  highlightPackageId?: string;
}

function ShowcaseSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <span className="sr-only">جارٍ تحميل باقات VIP…</span>
      {[0, 1].map((i) => (
        <div key={i} className="skeleton h-[220px] w-full rounded-2xl" />
      ))}
    </div>
  );
}

export function VipShowcase({ highlightPackageId }: VipShowcaseProps) {
  const [packages, setPackages] = useState<PackageTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let pkgs = await listPackages("wholesaler");
        if (pkgs.length === 0) pkgs = await listPackages("retail");
        if (!cancelled) setPackages(pkgs);
      } catch (e) {
        if (!cancelled) {
          setLoadError(true);
          toast.error(getApiErrorMessage(e, "تعذر تحميل الباقات"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <ShowcaseSkeleton />;

  if (loadError) {
    return (
      <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink-soft">
        تعذر تحميل الباقات — حاول مجدداً.
      </p>
    );
  }

  if (packages.length === 0) {
    return (
      <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink-soft">
        لا توجد باقات متاحة حالياً.
      </p>
    );
  }

  const displayed = highlightPackageId
    ? packages.filter((p) => p.id === highlightPackageId)
    : packages;

  return (
    <div className="space-y-4">
      {displayed.map((pkg) => (
        <VipPackageCard key={pkg.id} pkg={pkg} />
      ))}
    </div>
  );
}

function VipPackageCard({ pkg }: { pkg: PackageTier }) {
  return (
    <article className="overflow-hidden rounded-2xl bg-surface shadow-[var(--shadow-card)] ring-1 ring-line">
      {pkg.imageUrl && (
        <div className="relative aspect-[16/9] overflow-hidden bg-[var(--shop-sink)]">
          <Image
            src={pkg.imageUrl}
            alt={pkg.nameAr}
            fill
            className="object-cover"
            sizes="(max-width: 1023px) 100vw, 640px"
            unoptimized
          />
        </div>
      )}

      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display-ar text-lg font-bold text-ink">
              {pkg.nameAr}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <IncludedChip label="روب التخرج" />
              <IncludedChip label={`وشاح ${pkg.sashTypeLabel || ""}`} />
              <IncludedChip label="قبعة" />
            </div>
          </div>
          <div className="shrink-0 text-end">
            <p className="font-display text-xl font-bold text-ink" dir="ltr">
              {formatIQD(pkg.price)}
            </p>
            <p className="mt-0.5 text-xs text-[var(--shop-muted)]">نقداً</p>
          </div>
        </div>

        {/*
          Route to /package?pkg=<id> so the cap picker is presented before
          confirmPackage is called. Do NOT call confirmPackage here directly —
          see the file-level comment for why.
        */}
        <Link
          href={`/package?pkg=${encodeURIComponent(pkg.id)}`}
          className="mt-4 block"
        >
          <Button fullWidth size="lg">
            اختر هذه الباقة
          </Button>
        </Link>
      </div>
    </article>
  );
}

function IncludedChip({ label }: { label: string }) {
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
