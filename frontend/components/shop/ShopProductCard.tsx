import Image from "next/image";
import Link from "next/link";
import { formatIQD } from "@/lib/format";
import type { ShopProductCard as ShopProduct } from "@/lib/types";

interface ShopProductCardProps {
  product: ShopProduct;
}

export function ShopProductCardLink({ product }: ShopProductCardProps) {
  return (
    <Link
      href={`/product/${product.id}`}
      className={`group flex h-full flex-col overflow-hidden rounded-xl border bg-beige shadow-sm transition-shadow hover:shadow-md ${
        product.featured
          ? "border-orange/40 ring-1 ring-orange/20"
          : "border-ink/10"
      }`}
    >
      <div className="relative aspect-[4/3] bg-peach/40">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={product.nameAr}
            fill
            className="object-cover"
            sizes="(max-width: 512px) 50vw, 200px"
            unoptimized
          />
        ) : (
          <div className="flex h-full items-center justify-center text-3xl text-ink/20">
            لولو
          </div>
        )}
        {product.featured && (
          <span className="absolute left-2 top-2 rounded-full bg-orange px-2 py-0.5 text-[10px] font-bold text-white">
            مميز
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-3">
        <p className="line-clamp-2 text-sm font-semibold text-ink group-hover:text-orange">
          {product.nameAr}
        </p>
        <p className="mt-auto pt-2 text-xs font-bold text-orange" dir="ltr">
          يبدأ من {formatIQD(product.basePrice)}
        </p>
      </div>
    </Link>
  );
}
