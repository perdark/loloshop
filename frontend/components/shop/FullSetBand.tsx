"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AutoRotatingImage } from "@/components/ui/AutoRotatingImage";
import { listFullSetPackages } from "@/lib/catalog";
import { formatIQD } from "@/lib/format";
import type { FullSetPackage } from "@/lib/catalog";

/** Cover photo first, then the rest of the admin gallery — de-duplicated. */
function packagePhotos(pkg: FullSetPackage): string[] {
  return [...new Set([pkg.imageUrl, ...(pkg.gallery ?? [])].filter(
    (u): u is string => !!u
  ))];
}

export function FullSetBand() {
  const [packages, setPackages] = useState<FullSetPackage[]>([]);

  useEffect(() => {
    listFullSetPackages()
      .then(setPackages)
      .catch(() => {});
  }, []);

  if (packages.length === 0) return null;

  return (
    <section className="py-12 sm:py-16">
      <div className="mb-7 flex items-baseline justify-between gap-4">
        <h2 className="text-balance font-display-ar text-[clamp(1.6rem,4.5vw,2.4rem)] font-bold leading-tight text-ink">
          طقم التخرج الكامل
        </h2>
        <span className="shrink-0 text-sm font-medium text-[var(--shop-muted)]">
          روب + قبعة + وشاح
        </span>
      </div>

      {/* Editorial tiles — caption below (not scrim over photo) */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {packages.map((pkg) => {
          const photos = packagePhotos(pkg);
          return (
          <Link
            key={pkg.id}
            href={`/full-set/${pkg.id}`}
            className="group block space-y-3"
          >
            {/* Image — tall editorial crop; slide through the admin gallery
                (arrows on desktop, swipe on touch, dots). Auto-rotate stays off
                on this scroll-heavy page to avoid full-res cycling stalls. */}
            <div className="relative aspect-[4/5] w-full overflow-hidden rounded-[var(--radius-card)] bg-[var(--shop-sink)]">
              {photos.length > 1 ? (
                <AutoRotatingImage
                  images={photos}
                  alt={pkg.nameAr}
                  sizes="(max-width: 639px) 100vw, 50vw"
                  autoRotate={false}
                  controls
                  imgClassName="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                />
              ) : photos[0] ? (
                <Image
                  src={photos[0]}
                  alt={pkg.nameAr}
                  fill
                  loading="lazy"
                  className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  sizes="(max-width: 639px) 100vw, 50vw"
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
          );
        })}
      </div>

      {/* See-more → the dedicated packages page */}
      <div className="mt-9 flex justify-center sm:mt-12">
        <Link
          href="/full-set"
          className="group inline-flex min-h-12 items-center gap-2 rounded-pill border border-orange-ink/30 bg-surface px-7 text-sm font-semibold text-orange-ink shadow-[var(--shadow-soft)] transition-colors hover:bg-orange-ink hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-ink"
        >
          عرض كل الأطقم
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="h-4 w-4 transition-transform duration-200 ease-out group-hover:-translate-x-0.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
        </Link>
      </div>
    </section>
  );
}
