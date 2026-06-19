"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Reveal } from "@/components/Reveal";
import { listVipPackages } from "@/lib/packages";
import { formatIQD } from "@/lib/format";
import type { PackageTier } from "@/lib/types";
import { vipAccent } from "./vipAccent";
import { IconCrest, IconArrow } from "./VipIcons";

/**
 * Home VIP feature — a full editorial statement band (not a list row) that
 * gives the premium tier real presence: framed photo, name, top perks, price,
 * and one earned-orange CTA. Links to the full /vip showcase. Renders nothing
 * when no VIP package exists. Uses the package's own assets (image, features,
 * price) instead of a generic one-liner.
 */
export function VipHomeBand() {
  const [vip, setVip] = useState<PackageTier | null>(null);

  useEffect(() => {
    let alive = true;
    listVipPackages()
      .then((list) => {
        if (alive && list.length) setVip(list[0]);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!vip) return null;
  const a = vipAccent(vip.accent);
  const photo = vip.imageUrl || vip.gallery?.[0] || null;
  const hook =
    vip.description ||
    "خامات فاخرة، تطريز ذهبي، وتجهيز بأولوية — إطلالة تخرّج لا تُنسى.";
  const perks = (vip.features || []).slice(0, 3);

  return (
    <Reveal>
      <Link
        href="/vip"
        aria-label={`اكتشف ${vip.nameAr || "باقة VIP"}`}
        className="vip-border vip-sheen card-lift group relative grid overflow-hidden rounded-[var(--radius-card)] bg-warm-veil shadow-[var(--shadow-card)] transition-all duration-300 hover:shadow-[var(--shadow-float)] active:scale-[0.995] md:grid-cols-[1.05fr_1fr]"
        style={{ "--vip-accent": a } as CSSProperties}
      >
        {/* Editorial photo — framed, not scrim-over (brand rule). Gold-crest fallback. */}
        <div className="relative aspect-[4/5] min-h-[16rem] overflow-hidden md:aspect-auto">
          {photo ? (
            <Image
              src={photo}
              alt={vip.nameAr}
              fill
              sizes="(min-width: 768px) 50vw, 100vw"
              className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
            />
          ) : (
            <span
              aria-hidden
              className="vip-float absolute inset-0 flex items-center justify-center bg-brand-gradient text-white"
            >
              <IconCrest className="h-20 w-20 opacity-90" />
            </span>
          )}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ boxShadow: `inset 0 0 0 1px ${a}66` }}
          />
        </div>

        {/* Content */}
        <div className="flex flex-col justify-center gap-4 p-6 sm:p-8">
          <span className="flex w-fit items-center gap-2.5 font-display text-xs font-bold uppercase tracking-[0.2em] text-ink">
            <span aria-hidden className="h-px w-7" style={{ background: a }} />
            {vip.badgeLabel || "VIP"}
          </span>

          <h2 className="font-display-ar text-[clamp(1.65rem,5vw,2.5rem)] font-bold leading-[1.1] text-ink text-balance">
            {vip.nameAr || "إطلالة VIP"}
          </h2>

          <p className="max-w-prose text-sm leading-relaxed text-ink-soft sm:text-base text-pretty">
            {hook}
          </p>

          {perks.length > 0 && (
            <ul className="flex flex-col gap-2">
              {perks.map((p) => (
                <li
                  key={p}
                  className="flex items-start gap-2.5 text-sm text-ink-soft"
                >
                  <span
                    aria-hidden
                    className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[11px] leading-none text-white"
                    style={{ background: a }}
                  >
                    ✓
                  </span>
                  {p}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-1 flex items-center justify-between gap-4">
            {vip.price > 0 && (
              <span className="font-display text-lg font-bold text-ink">
                {formatIQD(vip.price)}
              </span>
            )}
            <span className="inline-flex items-center gap-2 rounded-pill bg-orange-ink px-5 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-card)] transition-transform duration-200 ease-out group-hover:-translate-x-0.5">
              اكتشف الباقة
              <IconArrow className="h-4 w-4" />
            </span>
          </div>
        </div>
      </Link>
    </Reveal>
  );
}
