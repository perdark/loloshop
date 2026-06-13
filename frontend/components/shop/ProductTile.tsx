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
        className="relative aspect-[3/4] overflow-hidden rounded-[10px] bg-beige ring-1 ring-ink/10 transition-shadow duration-300 group-hover:shadow-[var(--shadow-float)]"
        style={{ viewTransitionName: productImageVT(product.id) }}
      >
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={product.nameAr}
            fill
            className={`${
              product.imageFit === "contain" ? "object-contain" : "object-cover"
            } transition-transform duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.045]`}
            sizes="(max-width: 639px) 44vw, (max-width: 1023px) 30vw, 22vw"
          />
        ) : (
          <div className="flex h-full items-center justify-center font-script text-4xl text-orange-ink/25">
            lolo
          </div>
        )}
      </figure>

      <figcaption className="px-0.5 pt-2.5">
        <h3 className="truncate font-display text-[1.1rem] font-semibold leading-[1.6] pb-[3px] text-ink">
          {product.nameAr}
        </h3>
        <p className="mt-1 flex items-baseline gap-1.5" dir="ltr">
          <span className="text-[10px] font-medium tracking-wide text-[var(--shop-muted)]">
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
      <figure className="relative aspect-[4/5] overflow-hidden rounded-[10px] bg-beige ring-1 ring-ink/10 transition-shadow duration-300 group-hover:shadow-[var(--shadow-float)]">
        {pkg.imageUrl ? (
          <Image
            src={pkg.imageUrl}
            alt={pkg.nameAr}
            fill
            className="object-cover transition-transform duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.045]"
            sizes="(max-width: 639px) 44vw, (max-width: 1023px) 30vw, 22vw"
          />
        ) : (
          <div className="flex h-full items-center justify-center font-script text-4xl text-orange-ink/25">
            باكج
          </div>
        )}
      </figure>

      <figcaption className="px-0.5 pt-2.5">
        {/* Badge lives below the photo — never scrims the garment photography */}
        <span className="mb-1.5 inline-block rounded-full border border-orange-ink/20 px-2.5 py-0.5 font-display text-[10px] font-semibold tracking-wide text-orange-ink">
          إطلالة كاملة
        </span>
        <h3 className="truncate font-display text-[1.1rem] font-semibold leading-[1.6] pb-[3px] text-ink">
          {pkg.nameAr}
        </h3>
        <p className="mt-0.5 text-xs text-[var(--shop-muted)]">روب + وشاح + قبعة</p>
        <p className="mt-1 text-sm font-semibold tabular-nums text-ink/85" dir="ltr">
          {formatIQD(pkg.price)}
        </p>
      </figcaption>
    </article>
  );
}
