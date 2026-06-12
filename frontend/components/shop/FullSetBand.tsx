"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { listFullSetPackages } from "@/lib/catalog";
import { formatIQD } from "@/lib/format";
import type { FullSetPackage } from "@/lib/catalog";

export function FullSetBand() {
  const [packages, setPackages] = useState<FullSetPackage[]>([]);

  useEffect(() => {
    listFullSetPackages()
      .then(setPackages)
      .catch(() => {});
  }, []);

  if (packages.length === 0) return null;

  return (
    <section className="scroll-reveal py-12 sm:py-16">
      <div className="mb-6 flex items-baseline justify-between gap-3">
        <h2 className="font-display-ar text-xl font-bold leading-tight text-ink">
          طقم التخرج الكامل
        </h2>
        <span className="shrink-0 text-xs font-medium text-[var(--shop-muted)]">
          روب + قبعة + وشاح
        </span>
      </div>

      {/* Editorial tiles — caption below (not scrim over photo) */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {packages.map((pkg) => (
          <Link
            key={pkg.id}
            href={`/full-set/${pkg.id}`}
            className="group block space-y-3"
          >
            {/* Image — tall editorial crop */}
            <div className="relative aspect-[4/5] w-full overflow-hidden rounded-[var(--radius-card)] bg-[var(--shop-sink)]">
              {pkg.imageUrl ? (
                <Image
                  src={pkg.imageUrl}
                  alt={pkg.nameAr}
                  fill
                  className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  sizes="(max-width: 639px) 100vw, 50vw"
                  unoptimized
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className="font-script text-4xl text-orange-ink/25">lolo</p>
                </div>
              )}
              {pkg.badgeLabel && (
                <span
                  className="absolute end-3 top-3 rounded-full px-2.5 py-1 text-xs font-bold text-white shadow-[var(--shadow-soft)]"
                  style={{ background: pkg.accent ?? "#f47b42" }}
                >
                  {pkg.badgeLabel}
                </span>
              )}
            </div>
            {/* Caption below — editorial, not card */}
            <div className="space-y-1 px-0.5">
              <p className="font-display-ar text-base font-bold leading-snug text-ink transition-colors group-hover:text-orange-ink">
                {pkg.nameAr}
              </p>
              {pkg.description && (
                <p className="line-clamp-2 text-xs leading-relaxed text-ink-soft">
                  {pkg.description}
                </p>
              )}
              <div className="flex items-center justify-between gap-2 pt-1">
                <p className="font-display-ar text-sm font-bold text-ink" dir="ltr">
                  {formatIQD(pkg.price)}
                </p>
                <span className="inline-flex min-h-8 items-center rounded-pill bg-orange-ink/10 px-3 text-xs font-semibold text-orange-ink transition-colors group-hover:bg-orange-ink group-hover:text-white">
                  اطلب طقمك
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
