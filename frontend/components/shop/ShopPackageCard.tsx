import Image from "next/image";
import { formatIQD } from "@/lib/format";
import type { ShopPackageCard as ShopPackage } from "@/lib/types";

interface ShopPackageCardProps {
  pkg: ShopPackage;
}

export function ShopPackageCardView({ pkg }: ShopPackageCardProps) {
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-xl border border-ink/10 bg-beige shadow-sm">
      <div className="relative aspect-[4/3] bg-peach/30">
        {pkg.imageUrl ? (
          <Image
            src={pkg.imageUrl}
            alt={pkg.nameAr}
            fill
            className="object-cover"
            sizes="(max-width: 512px) 50vw, 200px"
            unoptimized
          />
        ) : (
          <div className="flex h-full items-center justify-center font-display text-lg text-orange-ink/60">
            باكج
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-3">
        <p className="font-semibold text-ink">{pkg.nameAr}</p>
        <p className="mt-1 text-xs text-ink/50">روب + وشاح + قبعة</p>
        <p className="mt-auto pt-2 text-sm font-bold text-orange-ink" dir="ltr">
          {formatIQD(pkg.price)}
        </p>
      </div>
    </article>
  );
}
