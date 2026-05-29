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
    <article className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
      <h3 className="text-sm font-semibold text-ink">تفاصيل الطلب والسعر</h3>
      <ul className="mt-3 space-y-3 text-sm">
        {detail.breakdown.map((line, i) => (
          <li
            key={`${line.label}-${i}`}
            className="border-b border-line pb-3 last:border-0"
          >
            <div className="flex justify-between gap-2">
              <span className="text-ink-soft">{line.label}</span>
              <span dir="ltr">{formatIQD(line.price)}</span>
            </div>
            {line.customerImageUrl && (
              <div className="mt-2">
                <p className="mb-1 text-[11px] font-medium text-orange-ink">
                  صورة مطلوبة من الزبون
                </p>
                <div className="relative h-32 w-full overflow-hidden rounded-lg border border-orange-ink/20 bg-surface-sink">
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
                  className="mt-2 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-orange-ink/30 bg-surface-sink px-3 py-2 text-xs font-medium text-orange-ink transition-colors hover:bg-orange-ink/10"
                >
                  تنزيل الصورة
                </a>
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-between border-t border-line pt-3 font-bold">
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
