import Image from "next/image";
import { formatIQD } from "@/lib/format";
import type { ShopPackageCard as ShopPackage } from "@/lib/types";

interface ShopPackageCardProps {
  pkg: ShopPackage;
}

/**
 * Package lookbook card — full-bleed photo with scrim. Packages bundle the
 * whole graduation look (robe + sash + cap), so the photo runs edge-to-edge
 * and the contents line + price sit over a dark gradient for a premium feel.
 */
export function ShopPackageCardView({ pkg }: ShopPackageCardProps) {
  return (
    <article className="card-lift group relative block aspect-[3/4] overflow-hidden rounded-lg bg-peach/40 shadow-[var(--shadow-card)] ring-1 ring-ink/10">
      {pkg.imageUrl ? (
        <Image
          src={pkg.imageUrl}
          alt={pkg.nameAr}
          fill
          className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.06]"
          sizes="(max-width: 512px) 50vw, 240px"
        />
      ) : (
        <div className="flex h-full items-center justify-center font-script text-4xl text-orange-ink/40">
          باكج
        </div>
      )}

      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/80 via-black/35 to-transparent"
      />

      <span className="absolute end-2.5 top-2.5 rounded-[3px] bg-ink/75 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white backdrop-blur-sm">
        إطلالة كاملة
      </span>

      <div className="absolute inset-x-0 bottom-0 p-3.5">
        <h3 className="line-clamp-2 font-display text-base font-bold leading-snug text-white drop-shadow-sm">
          {pkg.nameAr}
        </h3>
        <p className="mt-1 text-xs font-medium text-white/70">روب + وشاح + قبعة</p>
        <p className="mt-1.5 text-lg font-bold tabular-nums text-white drop-shadow-sm" dir="ltr">
          {formatIQD(pkg.price)}
        </p>
      </div>
    </article>
  );
}
