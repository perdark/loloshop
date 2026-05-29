import Image from "next/image";
import { formatIQD } from "@/lib/format";
import { resolveCatalogMediaUrl } from "@/lib/catalog";
import type { OrderBreakdownLine } from "@/lib/types";

interface OrderBreakdownCardProps {
  lines: OrderBreakdownLine[];
  total: number;
  title?: string;
}

export function OrderBreakdownCard({
  lines,
  total,
  title = "تفاصيل السعر (من الخادم)",
}: OrderBreakdownCardProps) {
  return (
    <div className="rounded-2xl border border-orange/30 bg-orange/5 p-5 ring-1 ring-orange/10">
      <p className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
        <span aria-hidden className="h-2 w-2 rounded-full bg-brand-gradient" />
        {title}
      </p>
      <ul className="space-y-2.5 text-sm">
        {lines.map((line, i) => {
          const photo = line.customerImageUrl
            ? resolveCatalogMediaUrl(line.customerImageUrl)
            : null;
          return (
            <li key={`${line.label}-${i}`} className="space-y-2">
              <div className="flex justify-between gap-2">
                <span className="text-ink/75">{line.label}</span>
                <span className="tabular-nums" dir="ltr">
                  {formatIQD(line.price)}
                </span>
              </div>
              {photo && (
                <div>
                  <p className="mb-1 text-[11px] text-[var(--shop-muted)]">
                    صورة من الزبون
                  </p>
                  <div className="relative h-24 w-full overflow-hidden rounded-xl border border-orange/15 bg-white">
                    <Image
                      src={photo}
                      alt=""
                      fill
                      className="object-contain"
                      unoptimized
                    />
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-3.5 flex items-center justify-between border-t border-orange/20 pt-3.5 font-bold">
        <span>المجموع</span>
        <span className="text-lg tabular-nums text-orange-ink" dir="ltr">
          {formatIQD(total)}
        </span>
      </div>
      <p className="mt-2 text-xs text-[var(--shop-muted)]">الدفع نقداً عند الاستلام</p>
    </div>
  );
}
