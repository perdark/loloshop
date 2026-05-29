import Image from "next/image";
import Link from "next/link";
import { formatIQD } from "@/lib/format";
import { productImageVT } from "@/lib/view-transition";
import type { ShopPackageCard, ShopProductCard } from "@/lib/types";

/**
 * Clean editorial product tile — print-catalog layout: the photo sits in a
 * soft warm frame, and the name + price live *below* it in ink (no dark scrim
 * over the image). Quiet, scannable, lets the garment photography stay clean.
 */
export function ProductTile({ product }: { product: ShopProductCard }) {
  return (
    <Link href={`/product/${product.id}`} className="group block">
      <figure
        className="relative aspect-[3/4] overflow-hidden rounded-[10px] bg-beige shadow-[var(--shadow-soft)] ring-1 ring-ink/10"
        style={{ viewTransitionName: productImageVT(product.id) }}
      >
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={product.nameAr}
            fill
            className="object-cover transition-transform duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.045]"
            sizes="(max-width: 512px) 50vw, 240px"
          />
        ) : (
          <div className="flex h-full items-center justify-center font-script text-4xl text-orange-ink/25">
            lolo
          </div>
        )}
      </figure>

      <figcaption className="px-0.5 pt-2.5">
        <h3 className="line-clamp-1 font-display text-[0.95rem] font-semibold leading-tight text-ink">
          {product.nameAr}
        </h3>
        <p className="mt-1 flex items-baseline gap-1.5" dir="ltr">
          <span className="text-[10px] font-medium tracking-wide text-ink/40">
            يبدأ من
          </span>
          <span className="text-sm font-semibold tabular-nums text-ink/85">
            {formatIQD(product.basePrice)}
          </span>
        </p>
      </figcaption>
    </Link>
  );
}

/**
 * Package tile — same clean caption-below treatment, a touch taller. Packages
 * bundle the full graduation look (robe + sash + cap) and aren't individually
 * routable, so this is a presentational article, marked with a quiet label.
 */
export function PackageTile({ pkg }: { pkg: ShopPackageCard }) {
  return (
    <article className="group block">
      <figure className="relative aspect-[4/5] overflow-hidden rounded-[10px] bg-beige shadow-[var(--shadow-soft)] ring-1 ring-ink/10">
        {pkg.imageUrl ? (
          <Image
            src={pkg.imageUrl}
            alt={pkg.nameAr}
            fill
            className="object-cover transition-transform duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.045]"
            sizes="(max-width: 512px) 50vw, 240px"
          />
        ) : (
          <div className="flex h-full items-center justify-center font-script text-4xl text-orange-ink/25">
            باكج
          </div>
        )}
        <span className="absolute end-2.5 top-2.5 rounded-full bg-cream/90 px-2.5 py-1 font-display text-[10px] font-semibold tracking-wide text-orange-ink ring-1 ring-orange/20 backdrop-blur-sm">
          إطلالة كاملة
        </span>
      </figure>

      <figcaption className="px-0.5 pt-2.5">
        <h3 className="line-clamp-1 font-display text-[0.95rem] font-semibold leading-tight text-ink">
          {pkg.nameAr}
        </h3>
        <p className="mt-0.5 text-xs text-ink/45">روب + وشاح + قبعة</p>
        <p className="mt-1 text-sm font-semibold tabular-nums text-ink/85" dir="ltr">
          {formatIQD(pkg.price)}
        </p>
      </figcaption>
    </article>
  );
}
