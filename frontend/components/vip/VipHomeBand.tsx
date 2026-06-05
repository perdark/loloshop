"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Reveal } from "@/components/Reveal";
import { listVipPackages } from "@/lib/packages";
import type { PackageTier } from "@/lib/types";
import { vipAccent } from "./vipAccent";
import { IconCrest, IconArrow } from "./VipIcons";

/**
 * Home highlight band linking to the VIP showcase. Self-contained: fetches VIP
 * packages and renders nothing when none exist. One editorial band (not a grid),
 * reusing the warm-veil card grammar from the cart's MissingPiecesCard.
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
  const hook = vip.description || "خامات فاخرة، تطريز ذهبي، وتجهيز بأولوية — إطلالة تخرّج لا تُنسى.";

  return (
    <Reveal>
      <Link
        href="/vip"
        className="vip-border vip-sheen card-lift group relative flex items-center gap-4 overflow-hidden rounded-[var(--radius-card)] bg-warm-veil p-5 shadow-[var(--shadow-card)] transition-all duration-250 hover:shadow-[var(--shadow-float)] active:scale-[0.99]"
        style={{ "--vip-accent": a } as CSSProperties}
      >
        <span
          aria-hidden
          className="vip-float flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-white shadow-[var(--shadow-card)]"
        >
          <IconCrest className="h-7 w-7" />
        </span>

        <div className="min-w-0 flex-1">
          <span
            className="inline-flex items-center gap-1 rounded-full bg-ink px-2.5 py-0.5 font-display text-[11px] font-bold tracking-wide"
            style={{ color: a } as CSSProperties}
          >
            {vip.badgeLabel || "VIP"}
          </span>
          <p className="mt-1.5 font-display-ar text-base font-bold text-ink">ارتقِ إلى إطلالة VIP</p>
          <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-ink-soft">{hook}</p>
        </div>

        <IconArrow className="h-5 w-5 shrink-0 text-orange-ink transition-transform duration-200 group-hover:-translate-x-0.5" />
      </Link>
    </Reveal>
  );
}
