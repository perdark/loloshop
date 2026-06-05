"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import { formatIQD } from "@/lib/format";
import type { PackageTier } from "@/lib/types";
import { VipBadge } from "./VipBadge";
import { vipAccent } from "./vipAccent";

/**
 * Editorial VIP package card — clean caption-below grammar (no scrim over the photo),
 * gold badge + sheen + accent dots, magnetic tilt on hover. CTA stays on the brand
 * gradient for contrast. Reduced-motion disables the tilt/sheen via globals.css.
 */
export function VipPackageCard({
  pkg,
  onChoose,
  busy = false,
}: {
  pkg: PackageTier;
  onChoose?: (pkg: PackageTier) => void;
  busy?: boolean;
}) {
  const a = vipAccent(pkg.accent);
  return (
    <article
      className="vip-tilt vip-border group relative flex flex-col overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)]"
      style={{ "--vip-accent": a } as CSSProperties}
    >
      <figure className="relative aspect-[4/5] overflow-hidden bg-[var(--shop-sink)]">
        {pkg.imageUrl ? (
          <Image
            src={pkg.imageUrl}
            alt={pkg.nameAr}
            fill
            unoptimized
            className="object-cover transition-transform duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.05]"
            sizes="(max-width: 639px) 88vw, 360px"
          />
        ) : (
          <div
            className="flex h-full items-center justify-center font-script text-5xl"
            style={{ color: `${a}55` } as CSSProperties}
          >
            VIP
          </div>
        )}
        <span className="vip-sheen pointer-events-none absolute inset-0" style={{ "--vip-accent": a } as CSSProperties} aria-hidden />
        <span className="absolute end-3 top-3">
          <VipBadge label={pkg.badgeLabel} accent={a} sheen />
        </span>
      </figure>

      <div className="flex flex-1 flex-col p-5">
        <h3 className="font-display-ar text-lg font-bold text-ink">{pkg.nameAr}</h3>
        {pkg.description && (
          <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-ink-soft">{pkg.description}</p>
        )}
        {!!pkg.includedItems?.length && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {pkg.includedItems.slice(0, 4).map((it, i) => (
              <span
                key={`${it}-${i}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-[var(--shop-sink)] px-2.5 py-0.5 text-xs font-medium text-ink-soft"
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: a } as CSSProperties} aria-hidden />
                {it}
              </span>
            ))}
          </div>
        )}
        <span
          aria-hidden
          className="mt-4 h-px w-full rounded-full"
          style={{ background: `linear-gradient(to left, transparent, ${a}40, transparent)` } as CSSProperties}
        />
        <p className="mt-3 font-display text-2xl font-bold text-ink" dir="ltr">
          {formatIQD(pkg.price)}
        </p>
        <p className="mt-0.5 text-xs text-[var(--shop-muted)]">الدفع نقداً عند الاستلام</p>
        {onChoose && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onChoose(pkg)}
            className="btn-shine mt-4 inline-flex min-h-12 items-center justify-center rounded-pill bg-brand-gradient px-6 text-sm font-bold text-white shadow-[var(--shadow-card)] transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            {busy ? "جارٍ…" : "اختر هذه الباقة"}
          </button>
        )}
      </div>
    </article>
  );
}
