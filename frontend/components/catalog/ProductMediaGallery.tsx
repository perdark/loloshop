"use client";

import Image from "next/image";
import { useState } from "react";
import { resolveCatalogMediaUrl } from "@/lib/catalog";
import { BrandMark } from "@/components/ui/BrandLogo";
import { productImageVT } from "@/lib/view-transition";
import type { ImageFit, ProductImage } from "@/lib/types";

interface ProductMediaGalleryProps {
  nameAr: string;
  imageUrl: string | null;
  images: ProductImage[];
  /** product id — names the hero so the storefront card morphs into it */
  productId?: string | number;
  /** "contain" zooms the hero out to show the whole photo (matches the tile). */
  imageFit?: ImageFit;
}

export function ProductMediaGallery({
  nameAr,
  imageUrl,
  images,
  productId,
  imageFit = "cover",
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
      <div
        className="group relative aspect-[4/3] overflow-hidden rounded-2xl bg-beige ring-1 ring-orange/10 transition-shadow duration-300 hover:shadow-[var(--shadow-float)]"
        style={heroVT}
      >
        {hero && (
          <Image
            src={resolveCatalogMediaUrl(hero) || hero}
            alt={nameAr}
            fill
            className={`${
              imageFit === "contain" ? "object-contain" : "object-cover"
            } transition-transform duration-500 group-hover:scale-105`}
            priority
            unoptimized
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
                className="object-cover"
                unoptimized
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
