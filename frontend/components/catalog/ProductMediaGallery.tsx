"use client";

import Image from "next/image";
import { useState } from "react";
import { resolveCatalogMediaUrl } from "@/lib/catalog";
import { BrandMark } from "@/components/ui/BrandLogo";
import { productImageVT } from "@/lib/view-transition";
import type { ProductImage } from "@/lib/types";

interface ProductMediaGalleryProps {
  nameAr: string;
  imageUrl: string | null;
  images: ProductImage[];
  /** product id — names the hero so the storefront card morphs into it */
  productId?: string | number;
}

export function ProductMediaGallery({
  nameAr,
  imageUrl,
  images,
  productId,
}: ProductMediaGalleryProps) {
  const heroVT =
    productId != null ? { viewTransitionName: productImageVT(productId) } : undefined;
  const gallery = [...images].sort((a, b) => a.sort - b.sort);
  const allUrls = [
    ...(imageUrl ? [imageUrl] : []),
    ...gallery.map((i) => i.url).filter((u) => u !== imageUrl),
  ];
  const [active, setActive] = useState(0);
  const hero = allUrls[active] || null;

  if (!hero && allUrls.length === 0) {
    return (
      <div
        className="flex aspect-[4/3] items-center justify-center rounded-2xl bg-peach/40"
        style={heroVT}
      >
        <BrandMark size={64} className="opacity-30" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* The full product photo — never cropped, no zoom.
          `object-contain` inside a fixed 4/5 box keeps the whole garment visible (the
          catalog is shot portrait: measured 2026-08-01, photos are 1856x2304 = 4:5, a few
          1792x2400) while reserving the space BEFORE the image loads. The previous
          natural-height <img> reserved nothing and was the bulk of a 1.10 CLS.
          It also goes through next/image now: these originals are 4-6 MB PNGs and the
          optimizer serves them as ~13-30 KB WebP with a 4h cache — the raw /uploads URL
          is `Cache-Control: private, no-store`, so it re-downloaded in full every visit. */}
      <div
        className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-beige ring-1 ring-orange/10"
        style={heroVT}
      >
        {hero && (
          <Image
            src={resolveCatalogMediaUrl(hero) || hero}
            alt={nameAr}
            fill
            // The hero is the LCP element — the default `loading="lazy"` would make the
            // browser wait for the intersection observer before even starting it.
            // NOT `priority`: that prop is deprecated in Next 16 (it silently does
            // nothing). Its replacement `preload` is also wrong here — this page is a
            // client component that fetches the product in an effect, so the src does not
            // exist at SSR time and a <head> preload link could never be written.
            loading="eager"
            fetchPriority="high"
            sizes="(max-width: 767px) 100vw, 640px"
            className="object-contain"
          />
        )}
      </div>
      {allUrls.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {allUrls.map((url, i) => (
            <button
              key={`${url}-${i}`}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`صورة ${i + 1}`}
              aria-pressed={active === i}
              className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2 transition-all ${
                active === i
                  ? "border-orange shadow-[var(--shadow-soft)]"
                  : "border-transparent opacity-65 hover:opacity-100"
              }`}
            >
              <Image
                src={resolveCatalogMediaUrl(url) || url}
                alt=""
                fill
                loading="lazy"
                // 64px thumbnail off a multi-megabyte original — `unoptimized` here was
                // pulling the whole file down per thumb. `sizes` pins the optimizer to
                // the actual rendered size (64 CSS px, 3x on a phone).
                sizes="64px"
                className="object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
