"use client";

import Image from "next/image";
import { Reveal } from "@/components/Reveal";

/** Cinematic full-width photo band with overlaid copy. Replaces the 3-pillar grid.
 *  The photo is admin-managed (package story image); falls back to a bundled
 *  lookbook shot when unset. */
export function VipStoryStrip({
  line,
  imageUrl,
}: {
  line?: string | null;
  imageUrl?: string | null;
}) {
  return (
    <section className="full-bleed">
      {/* Centered band — breaks to full viewport then re-constrains for roundness */}
      <div className="relative mx-auto h-[360px] max-w-6xl overflow-hidden rounded-3xl sm:h-[460px] group">
        {/* Living photo */}
        <Image
          src={imageUrl || "/lookbook/detail-pedestal.jpg"}
          alt=""
          fill
          /* `unoptimized` removed — see the note in VipHero. Full-bleed band at
             100vw, stored /uploads or local /lookbook src, no blob preview. */
          sizes="100vw"
          className="object-cover animate-kenburns transition-transform duration-[1200ms] group-hover:scale-105"
        />

        {/* Scrim — lifts bottom copy off the photo */}
        <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/25 to-transparent" />

        {/* Copy — bottom-centered */}
        <Reveal>
          <div className="absolute inset-x-0 bottom-0 p-8 text-center sm:p-12">
            <h3 className="font-display-ar text-2xl font-bold text-white [text-wrap:balance] sm:text-3xl">
              {line || "لأن لحظة التخرج لا تتكرر"}
            </h3>
            <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-white/90">
              صمّمنا باقة VIP لتليق بجهد سنواتك، بتفاصيل تُحكى وخامات تبقى ذكرى خالدة.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
