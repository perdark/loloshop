"use client";

import Image from "next/image";
import { useState } from "react";
import { resolveCatalogMediaUrl } from "@/lib/catalog";
import type { ProductImage } from "@/lib/types";

interface ProductMediaGalleryProps {
  nameAr: string;
  imageUrl: string | null;
  images: ProductImage[];
}

export function ProductMediaGallery({
  nameAr,
  imageUrl,
  images,
}: ProductMediaGalleryProps) {
  const gallery = [...images].sort((a, b) => a.sort - b.sort);
  const allUrls = [
    ...(imageUrl ? [imageUrl] : []),
    ...gallery.map((i) => i.url).filter((u) => u !== imageUrl),
  ];
  const [active, setActive] = useState(0);
  const hero = allUrls[active] || null;

  if (!hero && allUrls.length === 0) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center rounded-xl bg-peach/40 text-ink/30">
        لولو شوب
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-beige ring-1 ring-ink/10">
        {hero && (
          <Image
            src={resolveCatalogMediaUrl(hero) || hero}
            alt={nameAr}
            fill
            className="object-cover"
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
              className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 transition-colors ${
                active === i ? "border-orange" : "border-transparent opacity-70"
              }`}
            >
              <Image
                src={resolveCatalogMediaUrl(url) || url}
                alt=""
                fill
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
