"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
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
  const [zoomed, setZoomed] = useState(false);
  const hero = allUrls[active] || null;

  // Lightbox: lock body scroll + close on Esc, navigate with arrows.
  useEffect(() => {
    if (!zoomed) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoomed(false);
      else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        // RTL: ArrowRight = previous, ArrowLeft = next
        setActive((i) => {
          const dir = e.key === "ArrowLeft" ? 1 : -1;
          return (i + dir + allUrls.length) % allUrls.length;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [zoomed, allUrls.length]);

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
      <button
        type="button"
        onClick={() => setZoomed(true)}
        aria-label="تكبير الصورة لعرضها كاملة"
        className="group relative block aspect-[4/3] w-full cursor-zoom-in overflow-hidden rounded-2xl bg-beige ring-1 ring-orange/10 transition-shadow duration-300 hover:shadow-[var(--shadow-float)]"
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
        {/* zoom affordance */}
        <span
          aria-hidden
          className="absolute bottom-3 end-3 inline-flex size-9 items-center justify-center rounded-full bg-ink/55 text-cream backdrop-blur-sm transition-opacity duration-200 group-hover:bg-ink/70"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="11" y1="8" x2="11" y2="14" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </span>
      </button>

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

      {/* Fullscreen lightbox — the FULL, uncropped image (object-contain) */}
      {zoomed && hero && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`عرض كامل لصورة ${nameAr}`}
          onClick={() => setZoomed(false)}
          className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/90 p-4 animate-fade-page-in"
        >
          <button
            type="button"
            onClick={() => setZoomed(false)}
            aria-label="إغلاق"
            className="absolute top-4 end-4 inline-flex size-11 items-center justify-center rounded-full bg-cream/15 text-cream backdrop-blur-sm transition-colors hover:bg-cream/25"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          <div
            className="relative h-[82vh] w-[92vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <Image
              src={resolveCatalogMediaUrl(hero) || hero}
              alt={nameAr}
              fill
              className="object-contain"
              sizes="92vw"
              unoptimized
            />
          </div>

          {allUrls.length > 1 && (
            <>
              {/* RTL: prev on the right, next on the left */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActive((i) => (i - 1 + allUrls.length) % allUrls.length);
                }}
                aria-label="السابق"
                className="absolute end-3 top-1/2 inline-flex size-12 -translate-y-1/2 items-center justify-center rounded-full bg-cream/15 text-2xl text-cream backdrop-blur-sm hover:bg-cream/25"
              >
                ›
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActive((i) => (i + 1) % allUrls.length);
                }}
                aria-label="التالي"
                className="absolute start-3 top-1/2 inline-flex size-12 -translate-y-1/2 items-center justify-center rounded-full bg-cream/15 text-2xl text-cream backdrop-blur-sm hover:bg-cream/25"
              >
                ‹
              </button>
              <span className="absolute bottom-4 inset-x-0 text-center text-sm font-medium text-cream/80 tabular-nums">
                {active + 1} / {allUrls.length}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
