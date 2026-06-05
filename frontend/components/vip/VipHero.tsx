"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import { IconCrest } from "./VipIcons";
import { vipAccent } from "./vipAccent";

/**
 * Light cinematic hero — full-bleed editorial photo that fades into the cream
 * page at the bottom. No price, no CTA (those live in the package card below).
 * Ink headline on the faded lower third reads clearly without a dark box.
 */
export function VipHero({
  kicker,
  headline,
  sub,
  badgeLabel,
  imageUrl,
}: {
  kicker?: string;
  headline: string;
  sub?: string | null;
  badgeLabel?: string | null;
  imageUrl?: string | null;
}) {
  const a = vipAccent(null);

  return (
    <section
      className="full-bleed relative overflow-hidden h-[68vh] min-h-[420px] sm:h-[78vh]"
      dir="rtl"
    >
      {/* Layer 1 — living photo */}
      <Image
        src={imageUrl || "/lookbook/look-boutique.jpg"}
        alt={headline}
        fill
        priority
        unoptimized
        sizes="100vw"
        className="object-cover object-[50%_18%]"
      />

      {/* Layer 2 — editorial cream fade: blends photo into page at the bottom */}
      <div
        className="absolute inset-0 bg-gradient-to-t from-cream via-cream/55 to-transparent"
        aria-hidden
      />
      {/* faint top vignette — darkens sky/ceiling just enough to anchor the frame */}
      <div
        className="absolute inset-0 bg-gradient-to-b from-ink/10 to-transparent"
        aria-hidden
      />

      {/* Layer 3 — centred content anchored to the faded lower third */}
      <div className="relative z-10 mx-auto flex h-full max-w-5xl flex-col items-center justify-end gap-4 px-5 pb-12 text-center sm:pb-16">

        {/* VIP badge pill */}
        <div
          className="showcase-rise inline-flex items-center gap-2 rounded-full px-4 py-1.5 vip-sheen"
          style={{
            animationDelay: "80ms",
            backgroundColor: "color-mix(in srgb, var(--color-beige) 85%, transparent)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            boxShadow: `inset 0 0 0 1px ${a}55`,
          }}
        >
          <span className="inline-flex" style={{ color: a } as CSSProperties}>
            <IconCrest className="h-4 w-4" />
          </span>
          <span className="text-xs font-bold tracking-wider text-ink">
            {badgeLabel || "VIP"}
          </span>
        </div>

        {/* Optional kicker label above headline */}
        {kicker && (
          <p
            className="showcase-rise -mb-1 text-xs font-semibold tracking-wider"
            style={{ animationDelay: "130ms", color: a }}
          >
            {kicker}
          </p>
        )}

        {/* Headline */}
        <h1
          className="showcase-rise font-display-ar text-4xl font-bold leading-[1.08] text-ink [text-wrap:balance] sm:text-6xl"
          style={{ animationDelay: "180ms" }}
        >
          {headline}
        </h1>

        {/* Sub */}
        {sub && (
          <p
            className="showcase-rise max-w-md text-base leading-relaxed text-ink-soft"
            style={{ animationDelay: "280ms" }}
          >
            {sub}
          </p>
        )}
      </div>
    </section>
  );
}
