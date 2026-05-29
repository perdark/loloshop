"use client";

import Image from "next/image";
import { formatIQD } from "@/lib/format";
import { resolveCatalogMediaUrl } from "@/lib/catalog";
import type { OrderBreakdownDetail } from "@/lib/types";

interface StaffOrderBreakdownProps {
  detail: OrderBreakdownDetail;
}

export function StaffOrderBreakdown({ detail }: StaffOrderBreakdownProps) {
  const withPhotos = detail.breakdown.filter((l) => l.customerImageUrl);

  return (
    <article className="rounded-2xl border border-ink/10 bg-white p-5 shadow-[var(--shadow-soft)]">
      <h3 className="text-sm font-semibold text-ink">تفاصيل الطلب والسعر</h3>
      <ul className="mt-3 space-y-3 text-sm">
        {detail.breakdown.map((line, i) => (
          <li
            key={`${line.label}-${i}`}
            className="border-b border-ink/5 pb-3 last:border-0"
          >
            <div className="flex justify-between gap-2">
              <span className="text-ink/80">{line.label}</span>
              <span dir="ltr">{formatIQD(line.price)}</span>
            </div>
            {line.customerImageUrl && (
              <div className="mt-2">
                <p className="mb-1 text-[11px] font-medium text-orange-ink">
                  صورة مطلوبة من الزبون
                </p>
                <div className="relative h-32 w-full overflow-hidden rounded-lg border border-orange/20 bg-cream">
                  <Image
                    src={
                      resolveCatalogMediaUrl(line.customerImageUrl) ||
                      line.customerImageUrl
                    }
                    alt=""
                    fill
                    className="object-contain"
                    unoptimized
                  />
                </div>
                {/* Download the original upload file — use raw /uploads URL, not next/image re-encode */}
                <a
                  href={
                    resolveCatalogMediaUrl(line.customerImageUrl) ||
                    line.customerImageUrl
                  }
                  download
                  className="mt-2 min-h-[44px] inline-flex w-full items-center justify-center rounded-xl border border-orange/40 bg-cream px-3 py-2 text-xs font-medium text-orange-ink hover:bg-orange/10 transition-colors"
                >
                  تنزيل الصورة
                </a>
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-between border-t border-ink/10 pt-3 font-bold">
        <span>المجموع</span>
        <span className="text-orange-ink" dir="ltr">
          {formatIQD(detail.total)}
        </span>
      </div>
      {withPhotos.length === 0 && (
        <p className="mt-2 text-xs text-[var(--shop-muted)]">
          لا توجد صور مرفوعة من الزبون لهذا الطلب.
        </p>
      )}
    </article>
  );
}
