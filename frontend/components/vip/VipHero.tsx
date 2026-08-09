"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import { AutoRotatingImage } from "@/components/ui/AutoRotatingImage";
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
  images,
}: {
  kicker?: string;
  headline: string;
  sub?: string | null;
  badgeLabel?: string | null;
  imageUrl?: string | null;
  /** Admin-set gallery — when more than one, the hero photo auto-rotates. */
  images?: string[];
}) {
  const a = vipAccent(null);
  // Cover first, then the gallery; fall back to the default lookbook shot.
  const photos = (images && images.length ? images : [imageUrl]).filter(
    (u): u is string => !!u
  );
  const heroPhotos = photos.length ? photos : ["/lookbook/look-boutique.jpg"];

  return (
    <section
      className="full-bleed relative overflow-hidden h-[68vh] min-h-[420px] sm:h-[78vh]"
      dir="rtl"
    >
      {/* Layer 1 — living photo (auto-rotates through the admin's gallery) */}
      {heroPhotos.length > 1 ? (
        <AutoRotatingImage
          images={heroPhotos}
          alt={headline}
          sizes="100vw"
          eager
          showDots={false}
          imgClassName="object-cover object-[50%_18%]"
        />
      ) : (
        <Image
          src={heroPhotos[0]}
          alt={headline}
          fill
          loading="eager"
          fetchPriority="high"
          /* `unoptimized` REMOVED (2026-08-06). This is the VIP page's LCP image at
             sizes="100vw", and the prop overrides next.config even in production —
             so it was shipping the 4–6 MB original to a phone. Same fix as the staff
             order page on 2026-08-05, which measured 724 KB raw → 12 KB WebP (60×).
             Safe: `heroPhotos` is either a local /lookbook asset or a stored
             /uploads URL, both covered by images.remotePatterns. NOT an upload
             preview — a blob:/data: src is the one case that still needs the prop. */
          sizes="100vw"
          className="object-cover object-[50%_18%]"
        />
      )}

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
