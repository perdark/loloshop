import Image from "next/image";
import Link from "next/link";
import { formatIQD } from "@/lib/format";
import { productImageVT } from "@/lib/view-transition";
import type { ShopProductCard as ShopProduct } from "@/lib/types";

interface ShopProductCardProps {
  product: ShopProduct;
}

/**
 * Editorial lookbook card — the photo IS the card. Portrait crop lets the
 * full garment breathe; a bottom scrim carries the name + price in white so
 * premium product photography stays the hero with almost no chrome.
 */
export function ShopProductCardLink({ product }: ShopProductCardProps) {
  return (
    <Link
      href={`/product/${product.id}`}
      className="card-lift group relative block aspect-[3/4] overflow-hidden rounded-lg bg-peach/40 shadow-[var(--shadow-card)] ring-1 ring-ink/10"
      style={{ viewTransitionName: productImageVT(product.id) }}
    >
      {product.imageUrl ? (
        <Image
          src={product.imageUrl}
          alt={product.nameAr}
          fill
          className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.06]"
          sizes="(max-width: 512px) 50vw, 240px"
        />
      ) : (
        <div className="flex h-full items-center justify-center font-script text-4xl text-orange-ink/30">
          lolo
        </div>
      )}

      {/* Bottom-up scrim — keeps text legible over any photo */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/75 via-black/30 to-transparent"
      />

      <div className="absolute inset-x-0 bottom-0 p-3.5">
        <h3 className="line-clamp-2 font-display text-sm font-bold leading-snug text-white drop-shadow-sm">
          {product.nameAr}
        </h3>
        <p className="mt-1.5 flex items-baseline gap-1 text-white" dir="ltr">
          <span className="text-[10px] font-medium text-white/65">يبدأ من</span>
          <span className="text-base font-bold tabular-nums drop-shadow-sm">
            {formatIQD(product.basePrice)}
          </span>
        </p>
      </div>
    </Link>
  );
}

/**
 * Full-width editorial hero tile — the showcase slot for a section's best
 * shot. Wider crop, larger type, and a "اكتشف" cue give a premium photo the
 * room it deserves at the top of each category.
 */
export function ShopProductHeroCard({ product }: ShopProductCardProps) {
  return (
    <Link
      href={`/product/${product.id}`}
      className="card-lift group relative block aspect-[16/11] overflow-hidden rounded-xl bg-peach/40 shadow-[var(--shadow-card)] ring-1 ring-ink/10"
      style={{ viewTransitionName: productImageVT(product.id) }}
    >
      {product.imageUrl ? (
        <Image
          src={product.imageUrl}
          alt={product.nameAr}
          fill
          className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
          sizes="(max-width: 512px) 100vw, 512px"
        />
      ) : (
        <div className="flex h-full items-center justify-center font-script text-6xl text-orange-ink/30">
          lolo
        </div>
      )}

      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent"
      />

      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-5">
        <div className="min-w-0">
          <h3 className="line-clamp-2 font-display text-xl font-bold leading-snug text-white drop-shadow-sm">
            {product.nameAr}
          </h3>
          {product.description && (
            <p className="mt-1 line-clamp-1 text-xs text-white/70">
              {product.description}
            </p>
          )}
          <p className="mt-2 flex items-baseline gap-1 text-white" dir="ltr">
            <span className="text-[11px] font-medium text-white/65">يبدأ من</span>
            <span className="text-xl font-bold tabular-nums drop-shadow-sm">
              {formatIQD(product.basePrice)}
            </span>
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-pill bg-white px-4 py-2 font-display text-sm font-bold text-orange-ink shadow-[var(--shadow-pop)] transition-transform group-hover:scale-105">
          اكتشف
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="h-4 w-4 transition-transform group-hover:-translate-x-0.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14 6l-6 6 6 6" />
          </svg>
        </span>
      </div>
    </Link>
  );
}
